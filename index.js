require('dotenv').config();
const express = require('express');
const mime = require('mime-types');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const os = require('os');
// View engine for batch dashboard
const app = express();

// View engine for batch dashboard
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Configure trust proxy for Railway deployment
// Only trust Railway's proxy, not arbitrary proxies
if (process.env.RAILWAY_ENVIRONMENT) {
  // Railway deployment - trust the Railway proxy
  app.set('trust proxy', 1);
} else {
  // Local development - no proxy
  app.set('trust proxy', false);
}


app.use(express.json());

// --- CORS ---
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});



const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 100 * 1024 * 1024 } });

const limiter = rateLimit({
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Batch upload routes
const batchRoutes = require('./routes/batch');
app.use('/api', batchRoutes);
app.use('/', batchRoutes);

const { analyzeVideo } = require('./video-analyzer');
const db = require('./db-minimal');
const ConfidenceScoring = require('./services/confidence-scoring');
const ChromaprintService = require('./services/chromaprint');
const { analyzeImage } = require('./google-vision-search');
const { generatePHash, searchSimilarImages } = require('./phash-module');
const { detectAIGeneration } = require('./ai-image-detector');
const { calculateConfidenceScore } = require('./confidence-scoring');

// Track database readiness
let dbReady = false;

// --- Database initialization ---
async function initializeDatabase() {
  try {
    console.log('🔌 Initializing database connection...');
    
    // Test connection
    const testResult = await db.query('SELECT NOW() as time, version() as version');
    console.log('✅ Database connected:', testResult.rows[0].time);
    console.log('📊 PostgreSQL version:', testResult.rows[0].version);
    
    // Create tables (split into separate queries)
    console.log('🔨 Creating verifications table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS verifications (
        id SERIAL PRIMARY KEY,
        fingerprint VARCHAR(64) NOT NULL,
        fingerprint_algorithm VARCHAR(20) DEFAULT 'sha256',
        original_filename VARCHAR(255),
        file_size INTEGER,
        file_type VARCHAR(50),
        media_kind VARCHAR(20),
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45)
      )
    `);
    
    console.log('🔨 Creating indexes...');
    // Add pHash column if it doesn't exist (for similar image detection)
    await db.query(`
      ALTER TABLE verifications 
      ADD COLUMN IF NOT EXISTS phash VARCHAR(64)
    `);
    
    console.log('🔨 Creating pHash index...');
    await db.query('CREATE INDEX IF NOT EXISTS idx_phash ON verifications(phash) WHERE phash IS NOT NULL');
    // Add pHash column if it doesn't exist (for similar image detection)
    await db.query(`
      ALTER TABLE verifications 
      ADD COLUMN IF NOT EXISTS phash VARCHAR(64)
    `);
    
    console.log('🔨 Creating pHash index...');
    await db.query('CREATE INDEX IF NOT EXISTS idx_phash ON verifications(phash) WHERE phash IS NOT NULL');
    
    await db.query('CREATE INDEX IF NOT EXISTS idx_fingerprint ON verifications(fingerprint)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_upload_date ON verifications(upload_date DESC)');
    
    // Get record count
    const countResult = await db.query('SELECT COUNT(*) as count FROM verifications');
    console.log(`✅ Database initialized successfully. Current records: ${countResult.rows[0].count}`);
    
    dbReady = true;
    return true;
  } catch (err) {
    console.error('❌ Database initialization error:', err.message);
    console.error('⚠️ Application will continue without database features');
    dbReady = false;
    return false;
  }
}

// --- Helper function to search database ---
async function searchByFingerprint(fingerprint) {
  if (!dbReady) {
    return { found: false, is_first_verification: true, message: 'Database not available' };
  }
  
  try {
    const result = await db.query(
      'SELECT * FROM verifications WHERE fingerprint = $1 ORDER BY upload_date',
      [fingerprint]
    );
    
    if (result.rows.length === 0) {
      return { found: false, is_first_verification: true };
    }
    
    const firstVerification = result.rows[0];
    const allVerifications = result.rows.map(row => ({
      date: row.upload_date,
      filename: row.original_filename,
      size: row.file_size,
      ip: row.ip_address
    }));
    
    return {
      found: true,
      is_first_verification: false,
      first_seen: firstVerification.upload_date,
      verification_count: result.rows.length,
      verifications: allVerifications
    };
  } catch (err) {
    console.error('Database search error:', err.message);
    return { found: false, is_first_verification: true, message: 'Database search failed' };
  }
}

// --- Helper function to save verification ---
async function saveVerification(fingerprint, filename, fileSize, mediaKind, ipAddress, phash = null) {
  if (!dbReady) {
    console.log('⚠️ Skipping database save - database not ready');
    return null;
  }
  
  try {
    const result = await db.query(
      `INSERT INTO verifications (fingerprint, original_filename, file_size, media_kind, ip_address, phash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, upload_date`,
      [fingerprint, filename, fileSize, mediaKind, ipAddress, phash]
    );
    
    console.log(`✅ Saved verification to database: ID ${result.rows[0].id}`);
    return result.rows[0];
  } catch (err) {
    console.error('Database save error:', err.message);
    return null;
  }
}

// --- File verification endpoint ---
let canonicalizeImage, runVideoWorker, runAudioWorker;
try { ({ canonicalizeImage } = require('./imageCanonicalize.cjs')); } catch {}
try { ({ runWorker: runVideoWorker } = require('./videoWorker.cjs')); } catch {}
try { ({ runWorker: runAudioWorker } = require('./audioWorker.cjs')); } catch {}

app.post("/verify", upload.single("file"), async (req, res) => {
    let kind = "unknown";

  let wp = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    
    const buf = fs.readFileSync(req.file.path);
    const dm = req.file.mimetype === "application/octet-stream" ? (mime.lookup(req.file.originalname) || req.file.mimetype) : req.file.mimetype;
    const isImg = /^image\//i.test(dm);
    const isVid = dm.startsWith("video/") || ['.mp4','.mov','.avi','.webm'].some(e => req.file.originalname.toLowerCase().endsWith(e));
    const isAud = /^audio\//i.test(dm);
    kind = isImg ? "image" : (isVid ? "video" : (isAud ? "audio" : "unknown"));
                
    if (isVid || isAud) {
      wp = req.file.path + (path.extname(req.file.originalname) || (isVid ? '.mp4' : '.mp3'));
      fs.copyFileSync(req.file.path, wp);
    }
    
    let r = { 
      kind: kind, 
      filename: req.file.originalname, 
      size_bytes: req.file.size 
    };
    
    const crypto = require('crypto');
    
    // Generate fingerprint
    if (isImg && canonicalizeImage) {
      const canonBuf = await canonicalizeImage(buf);
      r.canonical = { 
        algorithm: 'sha256', 
        fingerprint: crypto.createHash('sha256').update(canonBuf).digest('hex'), 
        version: 'img:v2' 
      };
      
      // Search for similar images in database
      if (r.phash && dbReady) {
        try {
          console.log('🔎 Searching for similar images...');
          const similarImages = await searchSimilarImages(r.phash, db);
          r.similar_images = {
            found: similarImages.length > 0,
            count: similarImages.length,
            matches: similarImages.slice(0, 10) // Limit to top 10
          };
          console.log(`✅ Similar image search complete: ${similarImages.length} matches found`);
        } catch (err) {
          console.error('⚠️ Similar image search failed:', err.message);
        }
      }
      
      // Search for similar images in database
      if (r.phash && dbReady) {
        try {
          console.log('🔎 Searching for similar images...');
          const similarImages = await searchSimilarImages(r.phash, db);
          r.similar_images = {
            found: similarImages.length > 0,
            count: similarImages.length,
            matches: similarImages.slice(0, 10) // Limit to top 10
          };
          console.log(`✅ Similar image search complete: ${similarImages.length} matches found`);
        } catch (err) {
          console.error('⚠️ Similar image search failed:', err.message);
        }
      }
    } else if (isVid && runVideoWorker) {
      const vidResult = runVideoWorker(wp);
      r.canonical = vidResult.canonical;
    } else if (isAud && runAudioWorker) {
      const audResult = runAudioWorker(wp);
      r.canonical = audResult.canonical;
    } else {
      r.canonical = { 
        algorithm: 'sha256', 
        fingerprint: crypto.createHash('sha256').update(buf).digest('hex'), 
        version: 'raw:v1' 
      };
      console.log('Generated fallback fingerprint');
    }
    
    // Search database for existing verifications
    const fingerprint = r.canonical.fingerprint;
    const searchResults = await searchByFingerprint(fingerprint);

    // Analyze video if file is video
    if (kind === 'video') {
      try {
        console.log('🎥 Analyzing video file...');
        r.video_analysis = await analyzeVideo(req.file.path, {
          fps: 1,
          maxFrames: 30
        });
        console.log('✅ Video analysis complete:', r.video_analysis.analysis?.verdict);
      } catch (err) {
        console.error('⚠️ Video analysis error:', err.message);
        r.video_analysis = {
          success: false,
          error: err.message
        };
      }
    }
    
    // Generate pHash for images (BEFORE saving to database)
    if (r.kind === 'image' && req.file && req.file.path) {
      try {
        console.log('🔍 Generating pHash...');
        const phashResult = await generatePHash(req.file.path);
        if (phashResult.success) {
          r.phash = phashResult.phash;
          console.log('✅ pHash generated:', r.phash);
        }
      } catch (err) {
        console.error('⚠️ pHash error:', err.message);
      }
    }
    
    // Generate Chromaprint for audio (BEFORE saving to database)
    if (r.kind === 'audio' && req.file && req.file.path) {
      try {
        console.log('🎵 Generating Chromaprint...');
        const chromaprintResult = await ChromaprintService.generateFingerprint(wp);
        if (chromaprintResult.success) {
          r.chromaprint = chromaprintResult.fingerprint;
          r.audio_duration = chromaprintResult.duration;
          console.log('✅ Chromaprint generated:', r.chromaprint.substring(0, 20) + '...');
        }
      } catch (err) {
        console.error('⚠️ Chromaprint error:', err.message);
      }
    }
    
    // Save this verification to database
    const ipAddress = req.ip || req.connection.remoteAddress;
    await saveVerification(fingerprint, req.file.originalname, req.file.size, r.kind, ipAddress, r.phash || null, r.chromaprint || null);
    
    // Search for similar images in database
    if (r.phash && dbReady) {
      try {
        console.log('🔎 Searching for similar images...');
        const similarImages = await searchSimilarImages(r.phash, db);
        r.similar_images = {
          found: similarImages.length > 0,
          count: similarImages.length,
          matches: similarImages.slice(0, 10)
        };
        console.log(`✅ Similar search: ${similarImages.length} matches`);
      } catch (err) {
        console.error('⚠️ Similar search error:', err.message);
      }
    }
    
    // Search for similar audio in database
    if (r.chromaprint && dbReady) {
      try {
        console.log('🎵 Searching for similar audio...');
        const similarAudio = await ChromaprintService.searchSimilarAudio(r.chromaprint, db);
        r.similar_audio = {
          found: similarAudio.length > 0,
          count: similarAudio.length,
          matches: similarAudio.slice(0, 10)
        };
        console.log(`✅ Similar audio search: ${similarAudio.length} matches`);
      } catch (err) {
        console.error('⚠️ Similar audio search error:', err.message);
      }
    }
    
    // Add verification history to response
    r.verification_history = { internal: searchResults };
    
    // Add external search if we have a fingerprint
    if (r.canonical && r.canonical.fingerprint) {
      try {
        console.log('🔍 Searching VirusTotal for:', r.canonical.fingerprint);
        r.external_search = await searchVirusTotal(r.canonical.fingerprint);
        console.log('✅ VirusTotal search complete:', r.external_search.found ? 'FOUND' : 'NOT FOUND');
    
    
        // Add Google Vision analysis for images
    if (r.kind === 'image' && req.file && req.file.path) {
      try {
        console.log('🔍 Analyzing with Google Vision...');
        const fs = require('fs');
        const imageBuffer = fs.readFileSync(req.file.path);
        r.google_vision = await analyzeImage(imageBuffer);
        console.log('✅ Google Vision analysis complete');
      } catch (err) {
        console.error('❌ Google Vision error:', err);
        r.google_vision = {
          enabled: false,
          error: 'Google Vision analysis failed: ' + err.message
        };
      }
    }
      } catch (err) {
        console.error('❌ External search error:', err);
        r.external_search = {
          enabled: false,
          error: 'External search failed: ' + err.message
        };
      }
    }
    
// Calculate confidence score
    // Run AI detection for images
    if (r.kind === 'image' && req.file && req.file.path) {
      try {
        console.log('🤖 Running AI detection...');
        r.ai_detection = await detectAIGeneration(req.file.path);
        console.log('✅ AI detection:', r.ai_detection.likely_ai_generated ? 'LIKELY AI' : 'LIKELY REAL');
      } catch (err) {
        console.error('⚠️ AI detection error:', err.message);
      }
    }
    
    // Calculate confidence score with modification detection
    try {
      console.log('📊 Calculating confidence score...');
      r.confidence = ConfidenceScoring.calculate(r);
      console.log('✅ Confidence:', r.confidence.level, '-', r.confidence.percentage + '%');
      if (r.confidence.is_modified) {
        console.log('📝 Modification detected:', r.confidence.modification_details.similarity + '% similarity');
      }
    } catch (err) {
      console.error('⚠️ Confidence calculation error:', err.message);
      // Fallback to simple confidence
      r.confidence = {
        level: 'MEDIUM',
        label: 'LIKELY AUTHENTIC',
        percentage: 50,
        message: 'Basic verification complete'
      };
    }
    
        res.json(r);
  } catch (e) {
    console.error('Verification error:', e);
    res.status(500).json({ error: e.message });
  } finally {
    try {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      if (req.file && wp && wp !== req.file.path && fs.existsSync(wp)) fs.unlinkSync(wp);
    } catch (cleanupErr) { console.error('Cleanup error:', cleanupErr); }
  }
});

// --- Database test endpoints ---
app.get("/db-test", async (req, res) => {
  try {
    const result = await db.query('SELECT NOW() as time, version() as version');
    res.json({ 
      success: true, 
      connected: true, 
      time: result.rows[0].time, 
      version: result.rows[0].version 
    });
  } catch (error) {
    res.json({ success: false, connected: false, error: error.message });
  }
});

app.post("/db-create-tables", async (req, res) => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS verifications (
        id SERIAL PRIMARY KEY,
        fingerprint VARCHAR(64) NOT NULL,
        fingerprint_algorithm VARCHAR(20) DEFAULT 'sha256',
        original_filename VARCHAR(255),
        file_size INTEGER,
        file_type VARCHAR(50),
        media_kind VARCHAR(20),
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45)
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_fingerprint ON verifications(fingerprint)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_upload_date ON verifications(upload_date DESC)');
    
    const count = await db.query('SELECT COUNT(*) as count FROM verifications');
    res.json({ success: true, message: 'Tables created', records: count.rows[0].count });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.post("/db-save-test", async (req, res) => {
  try {
    const { fingerprint, filename } = req.body;
    const result = await db.query(
      `INSERT INTO verifications (fingerprint, original_filename, file_size, media_kind)
       VALUES ($1, $2, $3, $4)
       RETURNING id, upload_date`,
      [fingerprint || 'test123', filename || 'test.txt', 100, 'test']
    );
    res.json({ 
      success: true, 
      saved: true, 
      id: result.rows[0].id, 
      date: result.rows[0].upload_date 
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

app.get("/db-search-test/:fingerprint", async (req, res) => {
  try {
    const { fingerprint } = req.params;
    const result = await db.query(
      'SELECT * FROM verifications WHERE fingerprint = $1 ORDER BY upload_date',
      [fingerprint]
    );
    res.json({ 
      success: true, 
      found: result.rows.length > 0, 
      count: result.rows.length, 
      matches: result.rows 
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// --- Stats endpoint ---
app.get("/stats", async (req, res) => {
  if (!dbReady) {
    return res.json({ message: 'Database being configured', total_verifications: 0 });
  }
  
  try {
    const result = await db.query('SELECT COUNT(*) as count FROM verifications');
    res.json({ 
      total_verifications: parseInt(result.rows[0].count),
      database_status: 'connected'
    });
  } catch (error) {
    res.json({ message: 'Database error', total_verifications: 0, error: error.message });
  }
});

// --- Misc endpoints ---


// ============================================================================
// VIRUSTOTAL EXTERNAL SEARCH
// ============================================================================

/**
 * Search for a file hash on VirusTotal
 * @param {string} sha256 - SHA256 hash of the file
 * @returns {Object} Search results
 */
async function searchVirusTotal(sha256) {
  const apiKey = process.env.VIRUSTOTAL_API_KEY;
  
  if (!apiKey) {
    return {
      enabled: false,
      service: 'VirusTotal',
      error: 'API key not configured. Set VIRUSTOTAL_API_KEY environment variable.'
    };
  }

  try {
    const axios = require('axios');
    const response = await axios.get(
      `https://www.virustotal.com/api/v3/files/${sha256}`,
      {
        headers: { 'x-apikey': apiKey },
        timeout: 5000
      }
    );
    
    const data = response.data.data;
    const attrs = data.attributes;
    
    return {
      enabled: true,
      found: true,
      service: 'VirusTotal',
      results: {
        sha256: sha256,
        file_names: attrs.names || [],
        file_type: attrs.type_description,
        file_size: attrs.size,
        first_seen: attrs.first_submission_date 
          ? new Date(attrs.first_submission_date * 1000).toISOString() 
          : null,
        last_seen: attrs.last_submission_date 
          ? new Date(attrs.last_submission_date * 1000).toISOString() 
          : null,
        times_submitted: attrs.times_submitted,
        malware_detections: {
          malicious: attrs.last_analysis_stats?.malicious || 0,
          suspicious: attrs.last_analysis_stats?.suspicious || 0,
          undetected: attrs.last_analysis_stats?.undetected || 0,
          harmless: attrs.last_analysis_stats?.harmless || 0,
          total_scanners: attrs.last_analysis_stats?.total || 0
        },
        view_url: `https://www.virustotal.com/gui/file/${sha256}`,
        reputation: attrs.reputation || 0,
        tags: attrs.tags || []
      }
    };
    
  } catch (error) {
    if (error.response?.status === 404) {
      return {
        enabled: true,
        found: false,
        service: 'VirusTotal',
        message: 'File hash not found in VirusTotal database'
      };
    }
    
    if (error.response?.status === 429) {
      return {
        enabled: true,
        found: false,
        service: 'VirusTotal',
        error: 'Rate limit exceeded. Free tier: 500 requests/day, 4 requests/minute.'
      };
    }
    
    if (error.response?.status === 401 || error.response?.status === 403) {
      return {
        enabled: true,
        found: false,
        service: 'VirusTotal',
        error: 'Invalid API key. Check your VIRUSTOTAL_API_KEY.'
      };
    }
    
    return {
      enabled: true,
      found: false,
      service: 'VirusTotal',
      error: error.message
    };
  }
}

app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

app.get("/debug-env", (req, res) => res.json({
  has_database_url: !!process.env.DATABASE_URL,
  database_url_format: process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 20) + '...' : 'NOT SET',
  node_env: process.env.NODE_ENV,
  port: process.env.PORT,
  database_ready: dbReady
}));

app.post("/init-database", async (req, res) => {
  try {
    const result = await initializeDatabase();
    res.json({ 
      success: result, 
      message: result ? 'Database tables created successfully' : 'Database initialization failed', 
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, stack: error.stack });
  }
});

// --- Start server with proper async initialization ---
const PORT = process.env.PORT || 3000;

(async () => {
  console.log('🚀 Starting VeriSource API...');
  
  // Initialize database before starting server
  await initializeDatabase();
  
  // Start server
  app.listen(PORT, () => {
    console.log(`✅ VeriSource API running on port ${PORT}`);
    console.log(`📊 Database status: ${dbReady ? 'READY' : 'NOT AVAILABLE'}`);
  });
})();