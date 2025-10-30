/**
 * Minimal HTTP API for video verification (vid:v1).
 * POST /verify
 * Body (multipart/form-data or JSON by URL):
 *  - file: binary video (preferred)  OR
 *  - url: http(s) URL to fetch
 *  - reference: JSON with { canonicalization:'vid:v1:...', segmentHashes:[...], segmentsTotal:n }
 *
 * Response:
 * { 
 *   verdict, 
 *   coverage, 
 *   segmentsMatched, 
 *   segmentsCompared, 
 *   candidateSegmentsTotal, 
 *   referenceSegmentsTotal, 
 *   canonicalization, 
 *   notes:[] 
 * }
 */
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const fetch = require("node-fetch");

const app = express();
const upload = multer({ dest: "/tmp" });

app.use(express.json({ limit: "5mb" }));

function segMap(list) {
  const m = new Map();
  for (const s of list) {
    const [id, hex] = s.split(":");
    m.set(id, hex);
  }
  return m;
}

function verdictFromCoverage(c) {
  if (c === 1) return "PROVEN_STRONG";
  if (c >= 0.80) return "PROVEN_DERIVED";
  if (c >= 0.30) return "INCONCLUSIVE";
  return "NOT_PROVEN";
}

async function runWorker(inputPath) {
  const run = spawnSync("node", ["worker/video-worker.js", inputPath], { 
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024  // 50MB buffer for large videos
  });
  if (run.status !== 0) {
    throw new Error(run.stderr || run.stdout || "worker failed");
  }
  return JSON.parse(run.stdout);
}

async function downloadToTmp(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const tmp = path.join(
    "/tmp",
    `veri_${Date.now()}_${Math.random().toString(16).slice(2)}.bin`
  );
  const file = fs.createWriteStream(tmp);
  await new Promise((resolve, reject) => {
    res.body.pipe(file);
    res.body.on("error", reject);
    file.on("finish", resolve);
  });
  return tmp;
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "verisource-video-verifier" });
});

app.post("/verify", upload.single("file"), async (req, res) => {
  let inputPath = null;
  let downloadedFile = null;
  
  try {
    // 1) get candidate file path
    if (req.file?.path) {
      inputPath = req.file.path;
    } else if (req.body?.url) {
      downloadedFile = await downloadToTmp(req.body.url);
      inputPath = downloadedFile;
    } else {
      return res.status(400).json({ 
        error: "Provide file (multipart) or url" 
      });
    }
    
    // 2) parse reference JSON
    let reference = null;
    try {
      reference = typeof req.body.reference === "string" 
        ? JSON.parse(req.body.reference) 
        : req.body.reference;
    } catch {
      return res.status(400).json({ error: "Invalid reference JSON" });
    }
    
    if (!reference?.segmentHashes || !reference?.canonicalization?.startsWith("vid:v1")) {
      return res.status(400).json({ 
        error: "reference must include vid:v1 segmentHashes and canonicalization" 
      });
    }
    
    // 3) run worker on candidate
    const cand = await runWorker(inputPath);
    
    const refMap = segMap(reference.segmentHashes);
    const candMap = segMap(cand.segmentHashes);
    
    let matched = 0;
    let compared = 0;
    const diffs = [];
    
    for (const [id, hex] of candMap.entries()) {
      if (!refMap.has(id)) continue;
      compared++;
      if (hex === refMap.get(id)) {
        matched++;
      } else {
        diffs.push(id);
      }
    }
    
    const coverage = compared ? matched / compared : 0;
    
    const out = {
      verdict: verdictFromCoverage(coverage),
      coverage: Number(coverage.toFixed(4)),
      segmentsMatched: matched,
      segmentsCompared: compared,
      candidateSegmentsTotal: cand.segmentHashes.length,
      referenceSegmentsTotal: reference.segmentHashes.length,
      canonicalization: cand.canonicalization,
      firstMismatches: diffs.slice(0, 5),
      notes: ["VFR→CFR resample", "De-interlaced"]
    };
    
    return res.json(out);
    
  } catch (e) {
    console.error("Verification error:", e);
    return res.status(500).json({ 
      error: e.message || String(e) 
    });
  } finally {
    // Best-effort cleanup
    if (req.file?.path) {
      try { 
        fs.unlinkSync(req.file.path); 
      } catch (err) {
        console.error("Cleanup error:", err);
      }
    }
    if (downloadedFile) {
      try { 
        fs.unlinkSync(downloadedFile); 
      } catch (err) {
        console.error("Cleanup error:", err);
      }
    }
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Verifier API listening on :${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Verify endpoint: POST http://localhost:${PORT}/verify`);
});
