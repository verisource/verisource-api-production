require('dotenv').config();
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();

app.use(express.json());

// CORS configuration - MUST be before other middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.set('trust proxy', true);

const upload = multer({ 
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 }
});

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy: false,
    xForwardedForHeader: false
  }
});
app.use(limiter);




let canonicalizeImage, runVideoWorker, runAudioWorker;
try { ({ canonicalizeImage } = require('./imageCanonicalize.cjs')); } catch(e) {}
try { ({ runWorker: runVideoWorker } = require('./videoWorker.cjs')); } catch(e) {}
try { ({ runWorker: runAudioWorker } = require('./audioWorker.cjs')); } catch(e) {}

app.post("/verify", upload.single("file"), async (req, res) => {
  let wp = req.file?.path;
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


// Debug endpoint to check DATABASE_URL
app.get("/debug-env", (req, res) => {
  res.json({
    has_database_url: !!process.env.DATABASE_URL,
    database_url_format: process.env.DATABASE_URL ? 
      process.env.DATABASE_URL.substring(0, 20) + '...' : 
      'NOT SET',
    node_env: process.env.NODE_ENV,
    port: process.env.PORT
  });
});

// Manual database initialization
app.post("/init-database", async (req, res) => {
  try {
    const { initDatabase } = require('./init-db');
    const result = await initDatabase();
    
    res.json({ 
      success: result,
      message: result ? 'Database tables created successfully' : 'Database not available or initialization failed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ VeriSource API running on port ${PORT}`);
});


// Start server after database initializes
async function startServer() {
  const db = require('./db');
  const { initDatabase } = require('./init-db');
  
  // Wait for database
  const dbReady = await db.initialize();
  if (dbReady) {
    console.log('✅ Database ready, creating tables...');
    await initDatabase();
  } else {
    console.log('⚠️ Database not available, continuing without it');
  }
  
  // Start Express server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ VeriSource API running on port ${PORT}`);
    console.log(`📊 Database available: ${db.isAvailable()}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
