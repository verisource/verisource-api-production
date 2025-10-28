import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pino from "pino";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { spawnSync } from "child_process";
import Ajv from "ajv";
import cors from "cors";
import type { CredentialV3 } from "./types/credential.js";

// ---------- Logger ----------
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level: (label) => ({ level: label })
  }
});

// ---------- Config from ENV ----------
const NODE_ENV = process.env.NODE_ENV || "development";
const PORT = Number(process.env.PORT || 8080);
const API_KEYS = (process.env.API_KEYS || "").split(",").map(s => s.trim()).filter(Boolean);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
const ALLOWED_FETCH_HOSTS = (process.env.ALLOWED_FETCH_HOSTS || "").split(",").map(s => s.trim()).filter(Boolean);

const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 250);
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const MAX_DURATION_SECONDS = Number(process.env.MAX_DURATION_SECONDS || 300);
const WORKER_TIMEOUT_MS = 600_000; // 10 minutes
const MAX_INFLIGHT = Number(process.env.MAX_INFLIGHT || 2);

const ALLOWED_CODECS = (process.env.ALLOWED_CODECS || "h264,hevc,vp9,av1")
  .split(",")
  .map(s => s.trim().toLowerCase());
const ALLOWED_CONTAINERS = (process.env.ALLOWED_CONTAINERS || "mp4,mov,mkv,webm")
  .split(",")
  .map(s => s.trim().toLowerCase());

// Usage tracking per API key
const usageByKey = new Map<string, { count: number; lastReset: number }>();
const USAGE_WINDOW_MS = 3600_000; // 1 hour
const USAGE_MAX_PER_KEY = 1000;

// Concurrency control
let inflight = 0;
const inflightGauge = { value: () => inflight };

// Metrics (simple counters)
const metrics = {
  requests: { total: 0, success: 0, error: 0 },
  verifications: { total: 0, proven_strong: 0, proven_derived: 0, inconclusive: 0, not_proven: 0 },
  durations: [] as number[]
};

// ---------- Helpers ----------
const rid = () => Math.random().toString(16).slice(2, 10);

async function withSlot<T>(fn: () => Promise<T> | T): Promise<T> {
  if (inflight >= MAX_INFLIGHT) {
    throw new Error("Server busy, try again later");
  }
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
  }
}

// ---------- App ----------
const app = express();
app.set("x-powered-by", false);
app.set("trust proxy", 1);

// Helmet
app.use(helmet({ 
  crossOriginResourcePolicy: { policy: "same-site" }
}));

// Request logging with request ID
app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as any).requestId = rid();
  logger.info({
    at: "request",
    requestId: (req as any).requestId,
    method: req.method,
    path: req.path,
    ip: req.ip
  });
  next();
});

// CORS
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("Origin not allowed by CORS"));
  },
  credentials: false
}));

// JSON body limit
app.use(express.json({ limit: "2mb" }));

// Rate limiting (per IP)
const limiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({
      at: "rate_limit_exceeded",
      requestId: (req as any).requestId,
      ip: req.ip
    });
    res.status(429).json({ 
      requestId: (req as any).requestId,
      error: "Too many requests from this IP", 
      retryAfter: 60 
    });
  }
});
app.use(limiter);

// API key middleware with usage tracking
function requireApiKey(req: Request, res: Response, next: NextFunction) {
  if (API_KEYS.length === 0) {
    if (NODE_ENV === "production") {
      return res.status(500).json({ 
        requestId: (req as any).requestId,
        error: "Server misconfigured: no API keys in production" 
      });
    }
    logger.warn({ at: "api_key_missing", msg: "No API keys configured" });
    return next();
  }
  
  const key = req.header("x-api-key");
  if (!key || !API_KEYS.includes(key)) {
    logger.warn({
      at: "auth_failed",
      requestId: (req as any).requestId,
      ip: req.ip
    });
    return res.status(401).json({ 
      requestId: (req as any).requestId,
      error: "Missing or invalid API key",
      hint: "Include x-api-key header with valid key"
    });
  }
  
  // Track usage per key
  const now = Date.now();
  let usage = usageByKey.get(key);
  
  if (!usage || now - usage.lastReset > USAGE_WINDOW_MS) {
    usage = { count: 0, lastReset: now };
    usageByKey.set(key, usage);
  }
  
  usage.count++;
  
  if (usage.count > USAGE_MAX_PER_KEY) {
    logger.warn({
      at: "quota_exceeded",
      requestId: (req as any).requestId,
      key: key.substring(0, 8) + "...",
      count: usage.count
    });
    return res.status(429).json({ 
      requestId: (req as any).requestId,
      error: "API key quota exceeded", 
      limit: USAGE_MAX_PER_KEY,
      window: "1 hour",
      retryAfter: Math.ceil((usage.lastReset + USAGE_WINDOW_MS - now) / 1000)
    });
  }
  
  (req as any).apiKey = key;
  next();
}

// Apply API key check to protected routes
app.use((req: Request, res: Response, next: NextFunction) => {
  if (["/healthz", "/livez", "/readyz", "/metrics"].includes(req.path)) {
    return next();
  }
  return requireApiKey(req, res, next);
});

// Multer with stricter limits
const upload = multer({
  dest: "/tmp",
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: 1,
    fields: 5,
    parts: 10,
    headerPairs: 2000
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      "video/mp4",
      "video/quicktime",
      "video/x-matroska",
      "video/x-msvideo"
    ];
    
    if (ALLOWED_CODECS.some(c => ["vp9", "av1"].includes(c))) {
      allowedTypes.push("video/webm");
    }
    
    const ok = allowedTypes.includes(file.mimetype);
    if (!ok) {
      return cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
    cb(null, true);
  }
});

// Multer error handler (before other error handlers)
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err && err.code === "LIMIT_FILE_SIZE") {
    logger.warn({
      at: "file_too_large",
      requestId: (req as any).requestId,
      limit: MAX_FILE_BYTES
    });
    return res.status(413).json({ 
      requestId: (req as any).requestId,
      error: "File too large",
      maxSize: `${MAX_FILE_MB}MB`
    });
  }
  if (err && err.message?.startsWith("Unsupported file type")) {
    logger.warn({
      at: "unsupported_file_type",
      requestId: (req as any).requestId,
      error: err.message
    });
    return res.status(400).json({ 
      requestId: (req as any).requestId,
      error: err.message 
    });
  }
  next(err);
});

// ---------- AJV (schema validator) ----------
const ajv = new Ajv({ allErrors: true, strict: false });
const schemaPath = path.join(process.cwd(), "src/schema/credential-min.json");

if (!fs.existsSync(schemaPath)) {
  logger.error({ at: "startup", error: `Schema file not found: ${schemaPath}` });
  process.exit(1);
}

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const validateCredential = ajv.compile(schema);

// ---------- Core Helpers ----------

async function downloadToTmp(url: string, requestId: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("URL must be http or https");
  }
  
  if (ALLOWED_FETCH_HOSTS.length > 0 && !ALLOWED_FETCH_HOSTS.includes(u.host)) {
    throw new Error(`Fetch host not allowed: ${u.host} (allowed: ${ALLOWED_FETCH_HOSTS.join(", ")})`);
  }
  
  logger.info({ at: "download_start", requestId, url: u.host });
  
  const res = await fetch(url, {
    timeout: 30000,
    headers: {
      "User-Agent": "Verisource-Video-Verifier/1.0"
    }
  });
  
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  
  const contentLength = res.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_FILE_BYTES) {
    throw new Error(`File too large: ${contentLength} bytes > ${MAX_FILE_BYTES} bytes`);
  }
  
  const tmp = path.join("/tmp", `veri_${Date.now()}_${Math.random().toString(16).slice(2)}.bin`);
  const ws = fs.createWriteStream(tmp);
  
  return new Promise<string>((resolve, reject) => {
    let downloadedBytes = 0;
    
    (res.body as any).on("data", (chunk: Buffer) => {
      downloadedBytes += chunk.length;
      if (downloadedBytes > MAX_FILE_BYTES) {
        ws.destroy();
        reject(new Error(`File too large: exceeds ${MAX_FILE_BYTES} bytes`));
      }
    });
    
    (res.body as any).pipe(ws);
    (res.body as any).on("error", reject);
    ws.on("finish", () => {
      logger.info({ at: "download_complete", requestId, bytes: downloadedBytes });
      resolve(tmp);
    });
    ws.on("error", reject);
  });
}

function parseCredential(raw: unknown): CredentialV3 {
  if (typeof raw === "string") {
    try { 
      raw = JSON.parse(raw); 
    } catch { 
      throw new Error("Invalid credential JSON string"); 
    }
  }
  
  if (!validateCredential(raw)) {
    const msg = ajv.errorsText(validateCredential.errors, { separator: "; " });
    throw new Error(`Credential validation failed: ${msg}`);
  }
  
  return raw as CredentialV3;
}

function validateSegmentHashes(segs: string[]): void {
  const segRe = /^seg_(\d+):[a-f0-9]{16,64}$/;
  const seen = new Set<number>();
  
  for (const s of segs) {
    const m = segRe.exec(s);
    if (!m) {
      throw new Error(`Invalid segment hash format: ${s}`);
    }
    seen.add(Number(m[1]));
  }
  
  // Check contiguous (0, 1, 2, ... N-1)
  for (let i = 0; i < seen.size; i++) {
    if (!seen.has(i)) {
      throw new Error(`Segment indices must be contiguous starting at seg_0 (missing seg_${i})`);
    }
  }
}

function segMap(list: string[]) {
  const m = new Map<string, string>();
  for (const s of list) {
    const [id, hex] = s.split(":");
    if (id && hex) m.set(id, hex);
  }
  return m;
}

function verdictFromCoverage(c: number, hasMismatchedRuns: boolean): string {
  if (c === 1) return "PROVEN_STRONG";
  if (c >= 0.98 && !hasMismatchedRuns) return "PROVEN_STRONG";
  if (c >= 0.80) return "PROVEN_DERIVED";
  if (c >= 0.30) return "INCONCLUSIVE";
  return "NOT_PROVEN";
}

function detectMismatchedRuns(matches: Map<string, boolean>): boolean {
  const MISMATCH_RUN_THRESHOLD = 3;
  let consecutiveMismatches = 0;
  
  const sortedKeys = Array.from(matches.keys()).sort((a, b) => {
    const aIdx = parseInt(a.replace("seg_", ""));
    const bIdx = parseInt(b.replace("seg_", ""));
    return aIdx - bIdx;
  });
  
  for (const key of sortedKeys) {
    if (!matches.get(key)) {
      consecutiveMismatches++;
      if (consecutiveMismatches >= MISMATCH_RUN_THRESHOLD) {
        return true;
      }
    } else {
      consecutiveMismatches = 0;
    }
  }
  
  return false;
}

function computeMatchedRanges(matches: Map<string, boolean>): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = -1;
  
  const sortedKeys = Array.from(matches.keys()).sort((a, b) => {
    const aIdx = parseInt(a.replace("seg_", ""));
    const bIdx = parseInt(b.replace("seg_", ""));
    return aIdx - bIdx;
  });
  
  for (let i = 0; i < sortedKeys.length; i++) {
    const idx = parseInt(sortedKeys[i].replace("seg_", ""));
    const match = matches.get(sortedKeys[i]);
    
    if (match) {
      if (start === -1) start = idx;
    } else {
      if (start !== -1) {
        ranges.push([start, idx - 1]);
        start = -1;
      }
    }
  }
  
  if (start !== -1) {
    const lastIdx = parseInt(sortedKeys[sortedKeys.length - 1].replace("seg_", ""));
    ranges.push([start, lastIdx]);
  }
  
  return ranges;
}

interface WorkerResult {
  canonicalization: string;
  width: number;
  height: number;
  fps: number;
  segmentsTotal: number;
  segmentHashes: string[];
}

function runWorkerOn(pathOrUrl: string, requestId: string): WorkerResult {
  const startTime = Date.now();
  
  logger.info({ at: "worker_start", requestId });
  
  const run = spawnSync(
    "node", 
    ["worker/video-worker.js", pathOrUrl], 
    { 
      encoding: "utf8",
      timeout: WORKER_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024
    }
  );
  
  const duration = Date.now() - startTime;
  
  if (run.error) {
    if ((run.error as any).code === "ETIMEDOUT") {
      throw new Error(`Worker timeout after ${WORKER_TIMEOUT_MS / 1000}s`);
    }
    throw new Error(`Worker error: ${run.error.message}`);
  }
  
  if (run.status !== 0) {
    const errMsg = run.stderr || run.stdout || "worker failed";
    throw new Error(`Worker failed (exit ${run.status}): ${errMsg}`);
  }
  
  let result: WorkerResult;
  try {
    result = JSON.parse(run.stdout);
  } catch {
    throw new Error(`Worker output is not valid JSON`);
  }
  
  logger.info({ 
    at: "worker_complete", 
    requestId, 
    durationMs: duration, 
    segments: result.segmentsTotal 
  });
  
  return result;
}

interface VideoInfo {
  container: string;
  codec: string;
  durationSec: number;
}

function probeVideoInfo(p: string, requestId: string): VideoInfo {
  logger.debug({ at: "ffprobe_start", requestId });
  
  const out = spawnSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=format_name,duration",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name",
    "-of", "json",
    p
  ], { encoding: "utf8" });

  if (out.status !== 0) {
    throw new Error(`ffprobe failed: ${out.stderr || "unknown error"}`);
  }
  
  let j: any;
  try {
    j = JSON.parse(out.stdout);
  } catch {
    throw new Error("ffprobe output is not valid JSON");
  }
  
  const formatNames: string[] = String(j.format?.format_name || "")
    .split(",")
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);
  
  const codec = (j.streams?.[0]?.codec_name || "").toLowerCase();
  const durationSec = Math.floor(Number(j.format?.duration || 0));

  return { 
    container: formatNames.join(","),
    codec, 
    durationSec 
  };
}

function enforceVideoPolicy(info: VideoInfo): void {
  const tokens = info.container.split(",").map(s => s.trim());
  const contOk = tokens.some(t => ALLOWED_CONTAINERS.includes(t));
  
  if (!contOk) {
    throw new Error(
      `Container not allowed: [${tokens.join(", ")}] (allowed: ${ALLOWED_CONTAINERS.join(", ")})`
    );
  }

  if (!ALLOWED_CODECS.includes(info.codec)) {
    throw new Error(
      `Codec not allowed: ${info.codec} (allowed: ${ALLOWED_CODECS.join(", ")})`
    );
  }

  if (info.durationSec > MAX_DURATION_SECONDS) {
    throw new Error(
      `Duration too long: ${info.durationSec}s (max ${MAX_DURATION_SECONDS}s)`
    );
  }
}

function determineStatusCode(msg: string): number {
  if (/timeout/i.test(msg)) return 504;
  if (/too large|too long|exceeds/i.test(msg)) return 413;
  if (/validation|invalid|not allowed|missing|mismatch|contiguous|unsupported/i.test(msg)) return 400;
  if (/busy/i.test(msg)) return 503;
  return 500;
}

function trackMetrics(verdict: string, durationMs: number): void {
  metrics.requests.total++;
  metrics.verifications.total++;
  
  const v = verdict.toLowerCase().replace(/-/g, "_");
  if (v in metrics.verifications) {
    (metrics.verifications as any)[v]++;
  }
  
  metrics.durations.push(durationMs);
  if (metrics.durations.length > 1000) {
    metrics.durations = metrics.durations.slice(-1000);
  }
}

// ---------- Routes ----------

/**
 * GET /healthz - Basic health check
 */
app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ 
    ok: true,
    service: "verisource-video-verifier",
    version: "1.0.0"
  });
});

/**
 * GET /livez - Liveness probe
 */
app.get("/livez", (_req: Request, res: Response) => {
  res.json({ alive: true });
});

/**
 * GET /readyz - Readiness probe
 */
app.get("/readyz", (_req: Request, res: Response) => {
  // Check if server is ready to accept traffic
  const ready = 
    API_KEYS.length > 0 || NODE_ENV !== "production" &&
    fs.existsSync(schemaPath) &&
    inflight < MAX_INFLIGHT;
  
  if (!ready) {
    return res.status(503).json({ ready: false });
  }
  
  res.json({ ready: true });
});

/**
 * GET /metrics - Prometheus-style metrics
 */
app.get("/metrics", (_req: Request, res: Response) => {
  const durations = metrics.durations.sort((a, b) => a - b);
  const p50 = durations[Math.floor(durations.length * 0.5)] || 0;
  const p95 = durations[Math.floor(durations.length * 0.95)] || 0;
  const p99 = durations[Math.floor(durations.length * 0.99)] || 0;
  
  const lines = [
    `# HELP http_requests_total Total HTTP requests`,
    `# TYPE http_requests_total counter`,
    `http_requests_total ${metrics.requests.total}`,
    ``,
    `# HELP verifications_total Total verifications by verdict`,
    `# TYPE verifications_total counter`,
    `verifications_total{verdict="proven_strong"} ${metrics.verifications.proven_strong}`,
    `verifications_total{verdict="proven_derived"} ${metrics.verifications.proven_derived}`,
    `verifications_total{verdict="inconclusive"} ${metrics.verifications.inconclusive}`,
    `verifications_total{verdict="not_proven"} ${metrics.verifications.not_proven}`,
    ``,
    `# HELP verification_duration_ms Verification duration percentiles`,
    `# TYPE verification_duration_ms summary`,
    `verification_duration_ms{quantile="0.5"} ${p50}`,
    `verification_duration_ms{quantile="0.95"} ${p95}`,
    `verification_duration_ms{quantile="0.99"} ${p99}`,
    ``,
    `# HELP inflight_requests Currently processing requests`,
    `# TYPE inflight_requests gauge`,
    `inflight_requests ${inflight}`
  ];
  
  res.type("text/plain").send(lines.join("\n") + "\n");
});

/**
 * GET / - API documentation
 */
app.get("/", (req: Request, res: Response) => {
  res.json({
    requestId: (req as any).requestId,
    service: "Verisource Video Verification API",
    version: "1.0.0",
    auth: "x-api-key header required",
    endpoints: {
      "POST /verify": "Verify video via multipart upload",
      "POST /verify-by-url": "Verify video via URL",
      "GET /healthz": "Health check",
      "GET /livez": "Liveness probe",
      "GET /readyz": "Readiness probe",
      "GET /metrics": "Prometheus metrics"
    },
    limits: {
      maxFileSize: `${MAX_FILE_MB}MB`,
      maxDuration: `${MAX_DURATION_SECONDS}s`,
      rateLimitIP: "60/min",
      rateLimitKey: `${USAGE_MAX_PER_KEY}/hour`,
      maxConcurrent: MAX_INFLIGHT
    }
  });
});

/**
 * POST /verify
 */
app.post("/verify", upload.single("file"), async (req: Request, res: Response) => {
  let tmpPath: string | null = null;
  const startTime = Date.now();
  const requestId = (req as any).requestId;
  
  try {
    if (!req.file?.path) {
      return res.status(400).json({ 
        requestId,
        error: "Provide video file in 'file' field (multipart/form-data)" 
      });
    }
    tmpPath = req.file.path;

    // Gate by ffprobe
    const info = probeVideoInfo(tmpPath, requestId);
    enforceVideoPolicy(info);

    // Parse credential
    if (req.body?.credential == null) {
      return res.status(400).json({ 
        requestId,
        error: "Missing 'credential' field (full V3 JSON)" 
      });
    }
    const cred = parseCredential(req.body.credential);

    const fb = cred.fingerprintBundle || {};
    
    // Check algorithm
    const algorithm = (fb.algorithm || "").toLowerCase();
    if (algorithm !== "sha256+segphash") {
      return res.status(400).json({
        requestId,
        error: `Unsupported fingerprintBundle.algorithm: '${fb.algorithm}' (expected 'sha256+segphash')`
      });
    }
    
    const segs = fb.segmentHashes;
    const recipe = fb.canonicalization || "";
    
    if (!recipe.startsWith("vid:v1")) {
      return res.status(400).json({ 
        requestId,
        error: "Credential is not vid:v1 (canonicalization must start with 'vid:v1')" 
      });
    }
    
    if (!Array.isArray(segs) || segs.length === 0) {
      return res.status(400).json({ 
        requestId,
        error: "Credential missing fingerprintBundle.segmentHashes[]" 
      });
    }
    
    // Validate segment hashes
    validateSegmentHashes(segs);

    // Run worker with concurrency control
    const cand = await withSlot(() => Promise.resolve(runWorkerOn(tmpPath!, requestId)));
    
    // Check canonicalization match
    if (cand.canonicalization !== recipe) {
      return res.status(400).json({
        requestId,
        error: "Canonicalization mismatch between candidate and credential",
        candidate: cand.canonicalization,
        expected: recipe
      });
    }

    // Compare segments
    const refMap = segMap(segs);
    const candMap = segMap(cand.segmentHashes);

    let matched = 0;
    let compared = 0;
    const diffs: string[] = [];
    const matchMap = new Map<string, boolean>();
    
    for (const [id, hex] of candMap.entries()) {
      if (!refMap.has(id)) continue;
      compared++;
      const match = hex === refMap.get(id);
      matchMap.set(id, match);
      
      if (match) {
        matched++;
      } else {
        if (diffs.length < 10) {
          diffs.push(id);
        }
      }
    }
    
    const coverage = compared ? matched / compared : 0;
    const hasMismatchedRuns = detectMismatchedRuns(matchMap);
    const matchedRanges = computeMatchedRanges(matchMap);
    
    const verdict = verdictFromCoverage(coverage, hasMismatchedRuns);
    
    const notes = ["VFR→CFR resample", "De-interlaced"];
    const warnings: string[] = [];
    
    if (coverage < 1 && coverage >= 0.8) {
      warnings.push(`${((1 - coverage) * 100).toFixed(1)}% of segments differ`);
    }
    
    if (hasMismatchedRuns && verdict !== "PROVEN_STRONG") {
      warnings.push("Detected runs of mismatched segments");
    }
    
    const duration = Date.now() - startTime;
    
    logger.info({ 
      at: "verification_complete", 
      requestId, 
      verdict, 
      coverage, 
      durationMs: duration 
    });
    
    trackMetrics(verdict, duration);
    metrics.requests.success++;

    return res.json({
      requestId,
      verdict,
      coverage: Number(coverage.toFixed(4)),
      segmentsMatched: matched,
      segmentsCompared: compared,
      candidateSegmentsTotal: cand.segmentHashes.length,
      referenceSegmentsTotal: segs.length,
      canonicalization: cand.canonicalization,
      matchedRanges,
      firstMismatches: diffs.slice(0, 5),
      notes,
      warnings,
      metadata: {
        processingTimeMs: duration,
        candidateWidth: cand.width,
        candidateHeight: cand.height,
        candidateFps: cand.fps,
        candidateDuration: info.durationSec,
        candidateCodec: info.codec,
        candidateContainer: info.container
      }
    });
    
  } catch (e: any) {
    const duration = Date.now() - startTime;
    const msg = e?.message || String(e);
    
    logger.error({ 
      at: "verification_failed", 
      requestId, 
      error: msg, 
      durationMs: duration 
    });
    
    const statusCode = determineStatusCode(msg);
    metrics.requests.error++;
    
    return res.status(statusCode).json({ 
      requestId,
      error: msg,
      processingTimeMs: duration
    });
    
  } finally {
    if (req.file?.path) { 
      try { fs.unlinkSync(req.file.path); } catch {} 
    }
    if (tmpPath && !req.file?.path) { 
      try { fs.unlinkSync(tmpPath); } catch {} 
    }
  }
});

/**
 * POST /verify-by-url
 */
app.post("/verify-by-url", async (req: Request, res: Response) => {
  let tmpPath: string | null = null;
  const startTime = Date.now();
  const requestId = (req as any).requestId;
  
  try {
    const { url, credential } = req.body || {};
    
    if (!url) {
      return res.status(400).json({ requestId, error: "Missing 'url' field" });
    }
    
    if (!credential) {
      return res.status(400).json({ requestId, error: "Missing 'credential' field" });
    }

    const cred = parseCredential(credential);
    const fb = cred.fingerprintBundle || {};
    
    // Check algorithm
    const algorithm = (fb.algorithm || "").toLowerCase();
    if (algorithm !== "sha256+segphash") {
      return res.status(400).json({
        requestId,
        error: `Unsupported fingerprintBundle.algorithm: '${fb.algorithm}' (expected 'sha256+segphash')`
      });
    }
    
    const segs = fb.segmentHashes;
    const recipe = fb.canonicalization || "";
    
    if (!recipe.startsWith("vid:v1")) {
      return res.status(400).json({ requestId, error: "Credential must be vid:v1" });
    }
    
    if (!Array.isArray(segs) || segs.length === 0) {
      return res.status(400).json({ requestId, error: "Credential missing segmentHashes" });
    }
    
    // Validate segment hashes
    validateSegmentHashes(segs);

    tmpPath = await downloadToTmp(String(url), requestId);

    // Gate by ffprobe
    const info = probeVideoInfo(tmpPath, requestId);
    enforceVideoPolicy(info);

    // Run worker with concurrency control
    const cand = await withSlot(() => Promise.resolve(runWorkerOn(tmpPath!, requestId)));
    
    // Check canonicalization match
    if (cand.canonicalization !== recipe) {
      return res.status(400).json({
        requestId,
        error: "Canonicalization mismatch",
        candidate: cand.canonicalization,
        expected: recipe
      });
    }

    // Compare segments
    const refMap = segMap(segs);
    const candMap = segMap(cand.segmentHashes);

    let matched = 0;
    let compared = 0;
    const diffs: string[] = [];
    const matchMap = new Map<string, boolean>();
    
    for (const [id, hex] of candMap.entries()) {
      if (!refMap.has(id)) continue;
      compared++;
      const match = hex === refMap.get(id);
      matchMap.set(id, match);
      
      if (match) {
        matched++;
      } else {
        if (diffs.length < 10) {
          diffs.push(id);
        }
      }
    }
    
    const coverage = compared ? matched / compared : 0;
    const hasMismatchedRuns = detectMismatchedRuns(matchMap);
    const matchedRanges = computeMatchedRanges(matchMap);
    
    const verdict = verdictFromCoverage(coverage, hasMismatchedRuns);
    
    const notes = ["VFR→CFR resample", "De-interlaced"];
    const warnings: string[] = [];
    
    if (coverage < 1 && coverage >= 0.8) {
      warnings.push(`${((1 - coverage) * 100).toFixed(1)}% of segments differ`);
    }
    
    if (hasMismatchedRuns && verdict !== "PROVEN_STRONG") {
      warnings.push("Detected runs of mismatched segments");
    }
    
    const duration = Date.now() - startTime;
    
    logger.info({ 
      at: "verification_complete", 
      requestId, 
      verdict, 
      coverage, 
      durationMs: duration 
    });
    
    trackMetrics(verdict, duration);
    metrics.requests.success++;

    return res.json({
      requestId,
      verdict,
      coverage: Number(coverage.toFixed(4)),
      segmentsMatched: matched,
      segmentsCompared: compared,
      candidateSegmentsTotal: cand.segmentHashes.length,
      referenceSegmentsTotal: segs.length,
      canonicalization: cand.canonicalization,
      matchedRanges,
      firstMismatches: diffs.slice(0, 5),
      notes,
      warnings,
      metadata: {
        processingTimeMs: duration,
        candidateWidth: cand.width,
        candidateHeight: cand.height,
        candidateFps: cand.fps,
        candidateDuration: info.durationSec,
        candidateCodec: info.codec,
        candidateContainer: info.container
      }
    });
    
  } catch (e: any) {
    const duration = Date.now() - startTime;
    const msg = e?.message || String(e);
    
    logger.error({ 
      at: "verification_failed", 
      requestId, 
      error: msg, 
      durationMs: duration 
    });
    
    const statusCode = determineStatusCode(msg);
    metrics.requests.error++;
    
    return res.status(statusCode).json({ 
      requestId,
      error: msg,
      processingTimeMs: duration
    });
    
  } finally {
    if (tmpPath) { 
      try { fs.unlinkSync(tmpPath); } catch {} 
    }
  }
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ 
    error: "Not found",
    endpoints: ["/", "/healthz", "/livez", "/readyz", "/metrics", "POST /verify", "POST /verify-by-url"]
  });
});

// Error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ 
    at: "unhandled_error", 
    requestId: (req as any).requestId, 
    error: err.message 
  });
  res.status(500).json({ 
    requestId: (req as any).requestId,
    error: err.message || "Internal server error" 
  });
});

// ---------- Production Safety Checks ----------
if (NODE_ENV === "production") {
  if (API_KEYS.length === 0) {
    logger.fatal({ at: "startup", error: "PRODUCTION without API_KEYS is unsafe" });
    process.exit(1);
  }
  if (ALLOWED_ORIGINS.length === 0) {
    logger.fatal({ at: "startup", error: "PRODUCTION without ALLOWED_ORIGINS is unsafe" });
    process.exit(1);
  }
  if (ALLOWED_FETCH_HOSTS.length === 0) {
    logger.fatal({ at: "startup", error: "PRODUCTION without ALLOWED_FETCH_HOSTS is unsafe" });
    process.exit(1);
  }
}

// ---------- Graceful Shutdown ----------
const server = app.listen(PORT, () => {
  logger.info({
    at: "startup",
    env: NODE_ENV,
    port: PORT,
    apiKeys: API_KEYS.length,
    allowedOrigins: ALLOWED_ORIGINS.length,
    allowedFetchHosts: ALLOWED_FETCH_HOSTS.length,
    maxConcurrent: MAX_INFLIGHT
  });
});

function shutdown(signal: string) {
  logger.info({ at: "shutdown", signal });
  
  server.close(() => {
    logger.info({ at: "shutdown_complete" });
    process.exit(0);
  });
  
  // Hard exit after 10 seconds
  setTimeout(() => {
    logger.warn({ at: "shutdown_timeout", msg: "Forcing exit" });
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Unhandled rejections
process.on("unhandledRejection", (reason) => {
  logger.error({ at: "unhandled_rejection", reason });
});

process.on("uncaughtException", (error) => {
  logger.fatal({ at: "uncaught_exception", error: error.message });
  process.exit(1);
});
