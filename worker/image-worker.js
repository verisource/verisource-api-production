#!/usr/bin/env node
/**
 * Image worker — outputs a JSON fingerprint for a local image file.
 * Usage: node worker/image-worker.js /path/to/image
 */

"use strict";

/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Try to use your project's canonicalization logic if present
let fingerprintImage;
try {
  ({ fingerprintImage } = require("../canonicalization.js"));
} catch {
  // no-op; we'll fall back below
}

/**
 * Fallback: simple SHA-256 over raw bytes + basic metadata
 */
function fallbackFingerprintImage(buffer, absPath) {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const ext = path.extname(absPath).toLowerCase();
  const mime =
    ext === ".png" ? "image/png" :
    ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
    ext === ".webp" ? "image/webp" :
    ext === ".gif" ? "image/gif" :
    "application/octet-stream";

  return {
    kind: "image",
    path: absPath,
    filename: path.basename(absPath),
    size_bytes: buffer.length,
    sha256_hex: hash,
    mime_type: mime,
  };
}

(async function main() {
  try {
    const inputPath = process.argv[2];
    if (!inputPath) {
      console.error("Usage: node worker/image-worker.js /path/to/image");
      process.exit(1);
    }

    const absPath = path.resolve(inputPath);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      console.error(`File not found: ${absPath}`);
      process.exit(1);
    }

    const data = fs.readFileSync(absPath);

    let result;
    if (typeof fingerprintImage === "function") {
      result = await fingerprintImage(data, {
        path: absPath,
        filename: path.basename(absPath),
      });
    } else {
      result = fallbackFingerprintImage(data, absPath);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e && e.stack ? e.stack : String(e));
    process.exit(1);
  }
})();
