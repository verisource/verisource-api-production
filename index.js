require('dotenv').config();
const express = require('express');
const mime = require('mime-types');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./db-minimal');
const { searchByFingerprint, saveVerification } = require('./search');
// Import canonicalization only (workers not needed for minimal endpoint)
let canonicalizeImage;
try { 
  const canon = require('./canonicalization');
  canonicalizeImage = canon.canonicalizeImage;
} catch(e) {
  console.log('⚠️ Canonicalization not available:', e.message);
}

// Import analysis and detection services
const { analyzeVideo } = require('./video-analyzer');
const { analyzeImage } = require('./google-vision-search');
const { detectAIGeneration } = require('./ai-image-detector');
const { generatePHash, searchSimilarImages } = require('./phash-module');
const ConfidenceScoring = require('./services/confidence-scoring');
const ChromaprintService = require('./services/chromaprint');
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
app.use(express.urlencoded({ extended: true })); // For parsing form data

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


// --- Database initialization ---
async function initializeDatabase() {
  if (!db) {
    console.log('⚠️ Database not configured - skipping initialization');
    return;
  }
  
  try {
    console.log('🔌 Initializing database connection...');
    
    // Test connection
    const result = await db.query('SELECT NOW() as current_time, version() as pg_version');
    console.log('✅ Database connected:', result.rows[0].current_time);
    console.log('📊 PostgreSQL version:', result.rows[0].pg_version);
    
    // Create tables
    console.log('🔨 Creating verifications table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS verifications (
        id SERIAL PRIMARY KEY,
        fingerprint VARCHAR(64) NOT NULL,
        original_filename TEXT,
        file_size INTEGER,
        media_kind VARCHAR(20),
        ip_address VARCHAR(45),
        phash VARCHAR(16),
        audio_fingerprint TEXT,
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create indexes
    console.log('🔨 Creating indexes...');
    await db.query('CREATE INDEX IF NOT EXISTS idx_fingerprint ON verifications(fingerprint)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_upload_date ON verifications(upload_date)');
    
    console.log('🔨 Creating pHash index...');
    await db.query('CREATE INDEX IF NOT EXISTS idx_phash ON verifications(phash) WHERE phash IS NOT NULL');
    
    console.log('🔨 Creating audio fingerprint index...');
    await db.query('CREATE INDEX IF NOT EXISTS idx_audio_fingerprint ON verifications(audio_fingerprint) WHERE audio_fingerprint IS NOT NULL');
    
    // Get record count
    const countResult = await db.query('SELECT COUNT(*) as count FROM verifications');
    const recordCount = countResult.rows[0].count;
    
    dbReady = true;
    console.log(`✅ Database initialized successfully. Current records: ${recordCount}`);
    
  } catch (err) {
    console.error('❌ Database initialization failed:', err.message);
    dbReady = false;
  }
}

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

// ============================================
// SINGLE FILE VERIFY ENDPOINT
// ============================================
app.post('/verify', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const buf = fs.readFileSync(req.file.path);
    const crypto = require('crypto');
    const fingerprint = crypto.createHash('sha256').update(buf).digest('hex');
    
    res.json({
      kind: 'file',
      filename: req.file.originalname,
      size_bytes: req.file.size,
      fingerprint: {
        algorithm: 'sha256',
        hash: fingerprint,
        version: 'v1'
      }
    });
    
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    try {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    } catch(e) {}
  }
});

app.get('/admin/migrate-audio', async (req, res) => {
  try {
    console.log('🔄 Running audio_fingerprint migration...');
    
    await db.query(`
      ALTER TABLE verifications 
      ADD COLUMN IF NOT EXISTS audio_fingerprint TEXT
    `);
    console.log('✅ Column added');
    
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_audio_fingerprint 
      ON verifications(audio_fingerprint) 
      WHERE audio_fingerprint IS NOT NULL
    `);
    console.log('✅ Index created');
    
    res.json({ success: true, message: 'Migration complete!' });
  } catch (err) {
    console.error('❌ Migration failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
