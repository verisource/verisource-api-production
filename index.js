require('dotenv').config();
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();

app.use(express.json());
app.set('trust proxy', true);

const upload = multer({ 
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

let canonicalizeImage, runVideoWorker, runAudioWorker;
try { ({ canonicalizeImage } = require('./imageCanonicalize.cjs')); } catch(e) {}
try { ({ runWorker: runVideoWorker } = require('./videoWorker.cjs')); } catch(e) {}
try { ({ runWorker: runAudioWorker } = require('./audioWorker.cjs')); } catch(e) {}

app.post("/verify", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    
    let wp = req.file.path;
    const buf = fs.readFileSync(req.file.path);
    const isImg = /^image\//i.test(req.file.mimetype);
    const isVid = /^video\//i.test(req.file.mimetype);
    const isAud = /^audio\//i.test(req.file.mimetype);
    
    if (isVid || isAud) {
      wp = req.file.path + (path.extname(req.file.originalname) || (isVid?'.mp4':'.mp3'));
      fs.copyFileSync(req.file.path, wp);
    }
    
    let r = { 
      kind: isImg ? 'image' : (isVid ? 'video' : 'audio'),
      filename: req.file.originalname,
      size_bytes: req.file.size
    };
    
    // Process file and generate fingerprint
    if (isImg && canonicalizeImage) {
      const canonBuf = await canonicalizeImage(buf);
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(canonBuf).digest('hex');
      r.canonical = {
        algorithm: 'sha256',
        fingerprint: hash,
        version: 'img:v2'
      };
    } else if (isVid && runVideoWorker) {
      const vidResult = runVideoWorker(wp);
      r.canonical = vidResult.canonical;
    } else if (isAud && runAudioWorker) {
      const audResult = runAudioWorker(wp);
      r.canonical = audResult.canonical;
    }
    
    
    // FALLBACK: If no specialized processing, hash raw file
    if (!r.canonical) {
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      r.canonical = {
        algorithm: 'sha256',
        fingerprint: hash,
        version: 'raw:v1'
      };
      console.log('Generated fallback fingerprint');
    }
    
    // Mock verification history (database being configured)
    r.verification_history = {
      internal: { 
        found: false, 
        is_first_verification: true,
        message: 'Verification successful - database being configured'
      }
    };
    
    res.json(r);
    
  } catch (e) {
    console.error('Verification error:', e);
    res.status(500).json({ error: e.message });
  } finally {
    try {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      if (wp && wp !== req.file.path && fs.existsSync(wp)) fs.unlinkSync(wp);
    } catch(cleanupErr) {
      console.error('Cleanup error:', cleanupErr);
    }
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/stats", (req, res) => {
  res.json({ message: 'Database being configured', total_verifications: 0 });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ VeriSource API running on port ${PORT}`);
});
