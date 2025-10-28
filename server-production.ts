import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { spawnSync } from "child_process";
import Ajv from "ajv";
import cors from "cors";
import type { CredentialV3 } from "./types/credential.js";

// ---------- Config from ENV ----------
const PORT = Number(process.env.PORT || 8080);
const API_KEYS = (process.env.API_KEYS || "").split(",").map(s => s.trim()).filter(Boolean);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
const ALLOWED_FETCH_HOSTS = (process.env.ALLOWED_FETCH_HOSTS || "").split(",").map(s => s.trim()).filter(Boolean);

const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 250);
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const MAX_DURATION_SECONDS = Number(process.env.MAX_DURATION_SECONDS || 300); // 5 min default
const WORKER_TIMEOUT_MS = 600_000; // 10 minutes

const ALLOWED_CODECS = (process.env.ALLOWED_CODECS || "h264,hevc").split(",").map(s => s.trim().toLowerCase());
const ALLOWED_CONTAINERS = (process.env.ALLOWED_CONTAINERS || "mp4,mov,mkv").split(",").map(s => s.trim().toLowerCase());

// ---------- App ----------
const app = express();
app.set("x-powered-by", false);
app.set("trust proxy", 1); // Trust first proxy

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - ${req.ip}`);
  next();
});

// CORS (allow only your frontends)
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow CLI/cURL
    if (ALLOWED_ORIGINS.length === 0) return cb(null, true); // allow all if not configured
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("Origin not allowed by CORS"));
  },
  credentials: false
}));

// JSON body limit for credential input (not for file upload)
app.use(express.json({ limit: "2mb" }));

// Basic rate limiting
const limiter = rateLimit({
  windowMs: 60_000, // 1 minute
  max: 60,          // 60 req/min/IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ 
      error: "Too many requests", 
      retryAfter: 60 
    });
  }
});
app.use(limiter);

// API key middleware
function requireApiKey(req: Request, res: Response, next: NextFunction) {
  // Skip API key check if none are configured (for development)
  if (API_KEYS.length === 0) {
    console.warn("⚠️  WARNING: No API keys configured. Skipping authentication.");
    return next();
  }
  
  const key = req.header("x-api-key");
  if (!key || !API_KEYS.includes(key)) {
    return res.status(401).json({ error: "Missing or invalid API key" });
  }
  next();
}

// Apply API key check to all routes except health check
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/healthz") return next();
  return requireApiKey(req, res, next);
});

// Multer upload with file-size cap and basic type filter
const upload = multer({
  dest: "/tmp",
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    // Allow common video types; extend as needed
    const allowedTypes = [
      "video/mp4",
      "video/quicktime",
      "video/x-matroska",
      "video/x-msvideo",
      "video/webm",
      "video/mpeg"
    ];
    const ok = allowedTypes.includes(file.mimetype);
    if (!ok) {
      return cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
    cb(null, true);
  }
});

// ---------- AJV (schema validator) ----------
const ajv = new Ajv({ allErrors: true, strict: false });
const schemaPath = path.join(process.cwd(), "src/schema/credential-min.json");

if (!fs.existsSync(schemaPath)) {
  console.error(`❌ Schema file not found: ${schemaPath}`);
  process.exit(1);
}

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const validateCredential = ajv.compile(schema);

// ---------- Helpers ----------

async function downloadToTmp(url: string): Promise<string> {
  // Parse and validate URL
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  
  // Only allow http/https
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("URL must be http or https");
  }
  
  // Check against allowlist
  if (ALLOWED_FETCH_HOSTS.length > 0 && !ALLOWED_FETCH_HOSTS.includes(u.host)) {
    throw new Error(`Fetch host not allowed: ${u.host}`);
  }
  
  const res = await fetch(url, {
    timeout: 30000,
    headers: {
      "User-Agent": "Verisource-Video-Verifier/1.0"
    }
  });
  
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  
  // Check content-length if available
  const contentLength = res.headers.get("content-length");
  if (contentLength && parseInt(contentLength) > MAX_FILE_BYTES) {
    throw new Error(`File too large: ${contentLength} bytes > ${MAX_FILE_BYTES} bytes`);
  }
  
  const tmp = path.join(
    "/tmp", 
    `veri_${Date.now()}_${Math.random().toString(16).slice(2)}.bin`
  );
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
    ws.on("finish", () => resolve(tmp));
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

function runWorkerOn(pathOrUrl: string): WorkerResult {
  const startTime = Date.now();
  
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
  
  console.log(`✅ Worker completed in ${duration}ms (${result.segmentsTotal} segments)`);
  
  return result;
}

// ffprobe: container/codec/duration gate
interface VideoInfo {
  container: string;
  codec: string;
  durationSec: number;
}

function probeVideoInfo(p: string): VideoInfo {
  const out = spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "format=format_name,duration",
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
  
  const container = (j.format?.format_name || "").split(",")[0]; // e.g., mov,mp4,m4a,3gp,3g2,mj2
  const codec = (j.streams?.[0]?.codec_name || "").toLowerCase();
  const durationSec = Math.floor(Number(j.format?.duration || 0));

  return { container, codec, durationSec };
}

function enforceVideoPolicy(info: VideoInfo) {
  const contOk = ALLOWED_CONTAINERS.some(c => info.container.includes(c));
  if (!contOk) {
    throw new Error(`Container not allowed: ${info.container} (allowed: ${ALLOWED_CONTAINERS.join(", ")})`);
  }

  if (!ALLOWED_CODECS.includes(info.codec)) {
    throw new Error(`Codec not allowed: ${info.codec} (allowed: ${ALLOWED_CODECS.join(", ")})`);
  }

  if (info.durationSec > MAX_DURATION_SECONDS) {
    throw new Error(`Duration too long: ${info.durationSec}s (max ${MAX_DURATION_SECONDS}s)`);
  }
}

// ---------- Routes ----------

/**
 * GET /healthz
 * Health check endpoint (no authentication required)
 */
app.get("/healthz", (_req: Request, res: Response) => {
  res.json({ 
    ok: true,
    service: "verisource-video-verifier",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /
 * API documentation
 */
app.get("/", (_req: Request, res: Response) => {
  res.json({
    service: "Verisource Video Verification API",
    version: "1.0.0",
    authentication: API_KEYS.length > 0 ? "Required (x-api-key header)" : "Not required",
    endpoints: {
      "POST /verify": {
        description: "Verify video via multipart upload",
        authentication: "x-api-key header",
        accepts: {
          file: "video file (multipart form-data)",
          credential: "V3 credential JSON (string or object)"
        }
      },
      "POST /verify-by-url": {
        description: "Verify video via URL",
        authentication: "x-api-key header",
        accepts: {
          url: "video URL",
          credential: "V3 credential JSON"
        }
      },
      "GET /healthz": {
        description: "Health check (no authentication)"
      }
    },
    limits: {
      maxFileSize: `${MAX_FILE_MB}MB`,
      maxDuration: `${MAX_DURATION_SECONDS}s`,
      rateLimit: "60 requests per minute per IP",
      allowedCodecs: ALLOWED_CODECS,
      allowedContainers: ALLOWED_CONTAINERS,
      allowedFetchHosts: ALLOWED_FETCH_HOSTS.length > 0 ? ALLOWED_FETCH_HOSTS : "All hosts allowed"
    }
  });
});

/**
 * POST /verify
 * Verify video via multipart upload
 */
app.post("/verify", upload.single("file"), async (req: Request, res: Response) => {
  let tmpPath: string | null = null;
  const startTime = Date.now();
  
  try {
    if (!req.file?.path) {
      return res.status(400).json({ 
        error: "Provide video file in 'file' field (multipart/form-data)" 
      });
    }
    tmpPath = req.file.path;

    // Gate by ffprobe (duration/codec/container)
    const info = probeVideoInfo(tmpPath);
    enforceVideoPolicy(info);

    // Credential (full V3 JSON)
    if (req.body?.credential == null) {
      return res.status(400).json({ 
        error: "Missing 'credential' field (full V3 JSON)" 
      });
    }
    const cred = parseCredential(req.body.credential);

    const fb = cred.fingerprintBundle || {};
    const segs = fb.segmentHashes;
    const recipe = fb.canonicalization || "";
    
    if (!recipe.startsWith("vid:v1")) {
      return res.status(400).json({ 
        error: "Credential is not vid:v1 (canonicalization must start with 'vid:v1')" 
      });
    }
    
    if (!Array.isArray(segs) || segs.length === 0) {
      return res.status(400).json({ 
        error: "Credential missing fingerprintBundle.segmentHashes[]" 
      });
    }

    const cand = runWorkerOn(tmpPath);

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
    console.log(`✅ Verification: ${verdict} (${(coverage * 100).toFixed(1)}%) in ${duration}ms`);

    return res.json({
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
    console.error(`❌ Verification failed after ${duration}ms:`, msg);
    
    let statusCode = 500;
    if (msg.includes("timeout") || msg.includes("too large") || msg.includes("too long")) {
      statusCode = 413;
    } else if (msg.includes("validation") || msg.includes("Invalid") || msg.includes("not allowed")) {
      statusCode = 400;
    }
    
    return res.status(statusCode).json({ 
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
 * Verify video via URL (fetch from allowlisted hosts)
 */
app.post("/verify-by-url", async (req: Request, res: Response) => {
  let tmpPath: string | null = null;
  const startTime = Date.now();
  
  try {
    const { url, credential } = req.body || {};
    
    if (!url) {
      return res.status(400).json({ error: "Missing 'url' field" });
    }
    
    if (!credential) {
      return res.status(400).json({ error: "Missing 'credential' field (full V3 JSON)" });
    }

    const cred = parseCredential(credential);
    const fb = cred.fingerprintBundle || {};
    const segs = fb.segmentHashes;
    const recipe = fb.canonicalization || "";
    
    if (!recipe.startsWith("vid:v1")) {
      return res.status(400).json({ error: "Credential must be vid:v1" });
    }
    
    if (!Array.isArray(segs) || segs.length === 0) {
      return res.status(400).json({ error: "Credential missing fingerprintBundle.segmentHashes[]" });
    }

    tmpPath = await downloadToTmp(String(url));

    // Gate by ffprobe
    const info = probeVideoInfo(tmpPath);
    enforceVideoPolicy(info);

    const cand = runWorkerOn(tmpPath);
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
    
    const duration = Date.now() - startTime;
    console.log(`✅ Verification: ${verdict} (${(coverage * 100).toFixed(1)}%) in ${duration}ms`);

    return res.json({
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
        candidateFps: cand.fps
      }
    });
    
  } catch (e: any) {
    const duration = Date.now() - startTime;
    const msg = e?.message || String(e);
    console.error(`❌ Verification failed after ${duration}ms:`, msg);
    
    let statusCode = 500;
    if (msg.includes("timeout") || msg.includes("too large")) {
      statusCode = 413;
    } else if (msg.includes("validation") || msg.includes("Invalid") || msg.includes("not allowed")) {
      statusCode = 400;
    }
    
    return res.status(statusCode).json({ 
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
    endpoints: ["/", "/healthz", "POST /verify", "POST /verify-by-url"]
  });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({ 
    error: err.message || "Internal server error" 
  });
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`╔════════════════════════════════════════════════════════════╗`);
  console.log(`║  Verisource Video Verification API                         ║`);
  console.log(`║  Version: 1.0.0 (Production Hardened)                      ║`);
  console.log(`╠════════════════════════════════════════════════════════════╣`);
  console.log(`║  Listening on: http://localhost:${PORT.toString().padEnd(35)}║`);
  console.log(`║  Health check: http://localhost:${PORT}/healthz${' '.repeat(23)}║`);
  console.log(`╠════════════════════════════════════════════════════════════╣`);
  console.log(`║  Security:                                                 ║`);
  console.log(`║    - API Keys: ${API_KEYS.length > 0 ? `${API_KEYS.length} configured` : 'NONE (dev mode)'.padEnd(27)}${' '.repeat(API_KEYS.length > 0 ? 20 : 0)}║`);
  console.log(`║    - CORS Origins: ${ALLOWED_ORIGINS.length || 'All allowed'.padEnd(27)}${' '.repeat(15)}║`);
  console.log(`║    - Fetch Hosts: ${ALLOWED_FETCH_HOSTS.length || 'All allowed'.padEnd(28)}${' '.repeat(14)}║`);
  console.log(`╠════════════════════════════════════════════════════════════╣`);
  console.log(`║  Limits:                                                   ║`);
  console.log(`║    - Max file size: ${MAX_FILE_MB}MB${' '.repeat(35)}║`);
  console.log(`║    - Max duration: ${MAX_DURATION_SECONDS}s${' '.repeat(37)}║`);
  console.log(`║    - Rate limit: 60/min/IP${' '.repeat(32)}║`);
  console.log(`║    - Allowed codecs: ${ALLOWED_CODECS.join(', ').padEnd(30)}${' '.repeat(8)}║`);
  console.log(`║    - Allowed containers: ${ALLOWED_CONTAINERS.join(', ').padEnd(25)}${' '.repeat(8)}║`);
  console.log(`╚════════════════════════════════════════════════════════════╝`);
  
  if (API_KEYS.length === 0) {
    console.warn(`⚠️  WARNING: No API keys configured. Authentication disabled!`);
    console.warn(`⚠️  Set API_KEYS environment variable in production.`);
  }
});
