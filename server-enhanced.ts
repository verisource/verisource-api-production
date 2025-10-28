import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { spawnSync } from "child_process";
import Ajv from "ajv";
import type { CredentialV3 } from "./types/credential.js";

// ---------- Config ----------
const MAX_FILE_BYTES = 250 * 1024 * 1024;   // 250 MB
const MAX_DURATION_SEC = 300;               // 5 minutes
const WORKER_TIMEOUT_MS = 600_000;          // 10 minutes
const RATE_LIMIT_WINDOW_MS = 60_000;        // 1 minute
const RATE_LIMIT_MAX = 60;                  // 60 req/min/IP
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

// ---------- App ----------
const app = express();
app.set("x-powered-by", false);
app.set("trust proxy", 1); // Trust first proxy for rate limiting

// JSON body limit for credential input (not for file upload)
app.use(express.json({ limit: "2mb" }));

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Basic rate limiting
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ 
      error: "Too many requests", 
      retryAfter: RATE_LIMIT_WINDOW_MS / 1000 
    });
  }
});
app.use(limiter);

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
  console.error(`Schema file not found: ${schemaPath}`);
  process.exit(1);
}

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const validateCredential = ajv.compile(schema);

// ---------- Helpers ----------

async function downloadToTmp(url: string): Promise<string> {
  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  
  // Only allow http/https
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("URL must be http or https");
  }
  
  const res = await fetch(url, { 
    timeout: 30000,  // 30 second timeout
    headers: {
      "User-Agent": "Verisource-Video-Verifier/1.0"
    }
  });
  
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  
  // Check content length if available
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
  
  // Sort by segment index
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
  
  // Sort by segment index
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
      maxBuffer: 50 * 1024 * 1024  // 50MB buffer
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
  } catch (e) {
    throw new Error(`Worker output is not valid JSON: ${run.stdout.slice(0, 200)}`);
  }
  
  console.log(`Worker completed in ${duration}ms (${result.segmentsTotal} segments)`);
  
  return result;
}

// ---------- Routes ----------

/**
 * GET /healthz
 * Health check endpoint
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
    endpoints: {
      "POST /verify": {
        description: "Verify a video against a V3 credential",
        accepts: {
          file: "video file (multipart form-data)",
          url: "video URL (JSON body)",
          credential: "V3 credential JSON (string or object)"
        },
        returns: {
          verdict: "PROVEN_STRONG | PROVEN_DERIVED | INCONCLUSIVE | NOT_PROVEN",
          coverage: "number (0-1)",
          segmentsMatched: "number",
          segmentsCompared: "number"
        }
      },
      "GET /healthz": {
        description: "Health check"
      }
    },
    limits: {
      maxFileSize: `${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB`,
      maxDuration: `${MAX_DURATION_SEC}s`,
      rateLimit: `${RATE_LIMIT_MAX} requests per minute per IP`
    }
  });
});

/**
 * POST /verify
 * Accepts:
 *  - multipart file (field: file) OR { url }
 *  - credential: full V3 credential JSON (string or object)
 * Returns verdict and coverage using vid:v1 segment hashes.
 */
app.post("/verify", upload.single("file"), async (req: Request, res: Response) => {
  let tmpPath: string | null = null;
  const startTime = Date.now();
  
  try {
    // 1) Input video
    if (req.file?.path) {
      tmpPath = req.file.path;
    } else if (req.body?.url) {
      tmpPath = await downloadToTmp(String(req.body.url));
    } else {
      return res.status(400).json({ 
        error: "Provide a video file (multipart) or a url" 
      });
    }

    // 2) Full credential (V3)
    if (req.body?.credential == null) {
      return res.status(400).json({ 
        error: "Missing 'credential' field (full V3 JSON)" 
      });
    }
    
    const cred = parseCredential(req.body.credential);

    // 3) Extract needed fields
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

    // 4) Canonicalize candidate and compute segment hashes
    const cand = runWorkerOn(tmpPath);

    // 5) Compare same segment indices (seg_0..)
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
        if (diffs.length < 10) {  // Limit to 10 mismatches
          diffs.push(id);
        }
      }
    }
    
    const coverage = compared ? matched / compared : 0;
    const hasMismatchedRuns = detectMismatchedRuns(matchMap);
    const matchedRanges = computeMatchedRanges(matchMap);
    
    const verdict = verdictFromCoverage(coverage, hasMismatchedRuns);
    
    // Notes and warnings
    const notes = ["VFR→CFR resample", "De-interlaced"];
    const warnings: string[] = [];
    
    if (coverage < 1 && coverage >= 0.8) {
      warnings.push(`${((1 - coverage) * 100).toFixed(1)}% of segments differ`);
    }
    
    if (hasMismatchedRuns && verdict !== "PROVEN_STRONG") {
      warnings.push("Detected runs of mismatched segments");
    }
    
    const duration = Date.now() - startTime;
    console.log(`Verification completed in ${duration}ms: ${verdict} (${(coverage * 100).toFixed(1)}%)`);

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
    console.error(`Verification failed after ${duration}ms:`, msg);
    
    // Determine appropriate status code
    let statusCode = 500;
    if (msg.includes("timeout") || msg.includes("Too large")) {
      statusCode = 413;
    } else if (msg.includes("validation") || msg.includes("Invalid")) {
      statusCode = 400;
    }
    
    return res.status(statusCode).json({ 
      error: msg,
      processingTimeMs: duration
    });
    
  } finally {
    // Cleanup tmp upload
    if (req.file?.path) { 
      try { 
        fs.unlinkSync(req.file.path); 
      } catch (e) {
        console.error("Cleanup error:", e);
      }
    }
    if (tmpPath && !req.file?.path) { 
      try { 
        fs.unlinkSync(tmpPath); 
      } catch (e) {
        console.error("Cleanup error:", e);
      }
    }
  }
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ 
    error: "Not found",
    endpoints: ["/", "/healthz", "POST /verify"]
  });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ 
    error: err.message || "Internal server error" 
  });
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`╔════════════════════════════════════════════════════════════╗`);
  console.log(`║  Verisource Video Verification API                         ║`);
  console.log(`║  Version: 1.0.0                                            ║`);
  console.log(`╠════════════════════════════════════════════════════════════╣`);
  console.log(`║  Listening on: http://localhost:${PORT.toString().padEnd(35)}║`);
  console.log(`║  Health check: http://localhost:${PORT}/healthz${' '.repeat(23)}║`);
  console.log(`╠════════════════════════════════════════════════════════════╣`);
  console.log(`║  Limits:                                                   ║`);
  console.log(`║    - Max file size: ${Math.round(MAX_FILE_BYTES/1024/1024)}MB${' '.repeat(36)}║`);
  console.log(`║    - Max duration: ${MAX_DURATION_SEC}s${' '.repeat(37)}║`);
  console.log(`║    - Rate limit: ${RATE_LIMIT_MAX}/min/IP${' '.repeat(31)}║`);
  console.log(`║    - Worker timeout: ${WORKER_TIMEOUT_MS / 1000}s${' '.repeat(29)}║`);
  console.log(`╚════════════════════════════════════════════════════════════╝`);
});
