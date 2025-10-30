#!/usr/bin/env node
"use strict";
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");

function generateAudioFingerprint(inputPath) {
  const fpCalc = spawnSync("fpcalc", ["-json", inputPath], {
    encoding: "utf8", maxBuffer: 10 * 1024 * 1024
  });
  let chromaprintData = null;
  if (fpCalc.status === 0) {
    try { chromaprintData = JSON.parse(fpCalc.stdout); } catch (e) {}
  }
  const tempWav = `/tmp/audio_norm_${Date.now()}.wav`;
  const normalize = spawnSync("ffmpeg", [
    "-i", inputPath, "-ar", "16000", "-ac", "1", "-f", "wav", "-y", tempWav
  ], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  let sha256Hash = null;
  if (normalize.status === 0 && fs.existsSync(tempWav)) {
    sha256Hash = crypto.createHash("sha256").update(fs.readFileSync(tempWav)).digest("hex");
    try { fs.unlinkSync(tempWav); } catch (e) {}
  }
  const probe = spawnSync("ffprobe", [
    "-v", "error", "-show_format", "-show_streams", "-print_format", "json", inputPath
  ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  let duration = null, sampleRate = null, channels = null;
  if (probe.status === 0) {
    try {
      const meta = JSON.parse(probe.stdout);
      duration = parseFloat(meta.format?.duration);
      const audio = meta.streams?.find(s => s.codec_type === "audio");
      if (audio) { sampleRate = parseInt(audio.sample_rate); channels = parseInt(audio.channels); }
    } catch (e) {}
  }
  return {
    algorithm: "chromaprint+sha256",
    chromaprint: chromaprintData?.fingerprint || null,
    sha256_normalized: sha256Hash,
    duration, sample_rate: sampleRate, channels,
    canonicalization: "audio:v1:mono|16khz|wav"
  };
}

if (require.main === module) {
  const inputPath = process.argv[2];
  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error("Usage: audio-worker.js <input-file>");
    process.exit(1);
  }
  try {
    console.log(JSON.stringify(generateAudioFingerprint(inputPath), null, 2));
    process.exit(0);
  } catch (err) {
    console.error("Audio processing failed:", err.message);
    process.exit(1);
  }
}
