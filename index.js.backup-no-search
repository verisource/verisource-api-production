#!/usr/bin/env node
"use strict";
require('dotenv').config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const PORT = process.env.PORT || 8080;
let canonicalizeImage;
try { ({ canonicalizeImage } = require("./canonicalization.js")); } catch (e) {}
const { searchByFingerprint, saveVerification, getStats } = require('./search');
const { hybridSearch } = require('./search-hybrid');
function runVideoWorker(p) { const r = spawnSync("node", ["worker/video-worker.js", p], { encoding: "utf8", maxBuffer: 100*1024*1024 }); if (r.status !== 0) throw new Error(r.stderr || "failed"); return JSON.parse(r.stdout); }
function runAudioWorker(p) { const r = spawnSync("node", ["worker/audio-worker.js", p], { encoding: "utf8", maxBuffer: 100*1024*1024 }); if (r.status !== 0) throw new Error(r.stderr || "failed"); return JSON.parse(r.stdout); }
const app = express();

// Trust Railway proxy for accurate IP detection
app.set('trust proxy', 1);
app.use(helmet()); app.use(cors());
app.use('/verify', rateLimit({ windowMs: 15*60*1000, max: 100 }));
const upload = multer({ dest: "./uploads", limits: { fileSize: 100*1024*1024 } });
app.get("/", (req, res) => res.json({ status: "ok", service: "VeriSource", supports: ["image","video","audio"] }));
app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));
app.post("/verify", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file" });
  let wp = req.file.path;
  try {
    const buf = fs.readFileSync(req.file.path);
    const isImg = /^image\//i.test(req.file.mimetype) || /\.(png|jpe?g)$/i.test(req.file.originalname);
    const isVid = /^video\//i.test(req.file.mimetype) || /\.(mp4|mov)$/i.test(req.file.originalname);
    const isAud = /^audio\//i.test(req.file.mimetype) || /\.(mp3|wav)$/i.test(req.file.originalname);
    if (isVid || isAud) { wp = req.file.path + (path.extname(req.file.originalname) || (isVid?'.mp4':'.mp3')); fs.copyFileSync(req.file.path, wp); }
    let r = { kind: isImg?'image':(isVid?'video':(isAud?'audio':'unknown')), filename: req.file.originalname, size_bytes: req.file.size };
    if (isImg && canonicalizeImage) {
      const canonBuf = await canonicalizeImage(buf);
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(canonBuf).digest('hex');
      r.canonical = {
        algorithm: 'sha256',
        fingerprint: hash,
        version: 'img:v2'
      };
    }
    else if (isVid) r.canonical = runVideoWorker(wp);
    else if (isAud) r.canonical = runAudioWorker(wp);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
  finally { try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); if (wp !== req.file.path && fs.existsSync(wp)) fs.unlinkSync(wp); } catch(e){} }
});
app.listen(PORT, () => console.log("API on :" + PORT));

// Statistics endpoint
app.get("/stats", async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Direct search endpoint
app.post("/search", async (req, res) => {
  const { fingerprint } = req.body;
  
  if (!fingerprint) {
    return res.status(400).json({ error: "Fingerprint required" });
  }
  
  try {
    const results = await searchByFingerprint(fingerprint);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
