#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const inputPath = process.argv[2];
if (!inputPath) {
  console.error(JSON.stringify({ error: "No input path provided" }));
  process.exit(1);
}
if (!fs.existsSync(inputPath)) {
  console.error(JSON.stringify({ error: `Input file does not exist: ${inputPath}` }));
  process.exit(1);
}
try {
  require('ts-node/register');
} catch (err) {
  console.error(JSON.stringify({ error: "ts-node not available", message: err.message }));
  process.exit(1);
}
const videoCanonPath = path.join(__dirname, '..', 'video-canonicalization.ts');
try {
  const videoCanonicalization = require(videoCanonPath);
  const createFingerprint = videoCanonicalization.createVideoFingerprint;
  if (!createFingerprint) {
    throw new Error('createVideoFingerprint function not found');
  }
  (async () => {
    try {
      const result = await createFingerprint(inputPath);
      console.log(JSON.stringify(result));
      process.exit(0);
    } catch (error) {
      console.error(JSON.stringify({ error: error.message, stack: error.stack }));
      process.exit(1);
    }
  })();
} catch (err) {
  console.error(JSON.stringify({ error: "Failed to load video-canonicalization.ts", message: err.message, stack: err.stack }));
  process.exit(1);
}
