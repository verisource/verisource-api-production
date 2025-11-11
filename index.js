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
const { AudioAIDetection } = require('./services/audio-ai-detection');
const { detectAIGeneration } = require('./ai-image-detector');
const { generatePHash, searchSimilarImages } = require('./phash-module');
const ConfidenceScoring = require('./services/confidence-scoring');
const ChromaprintService = require('./services/chromaprint');
const acoustid = require('./acoustid-integration');
const WeatherVerification = require('./services/weather-verification');
const LandmarkVerification = require('./services/landmark-verification');
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

  let weatherVerification = null;
  let landmarkVerification = null;
  let exifData = null; 

  try {
    const buf = fs.readFileSync(req.file.path);
    const crypto = require('crypto');
    const fingerprint = crypto.createHash('sha256').update(buf).digest('hex');
    
    // Detect file type
    const dm = req.file.mimetype || mime.lookup(req.file.originalname) || 'application/octet-stream';
    const isImg = /^image\//i.test(dm) || /\.(png|jpe?g|gif|webp)$/i.test(req.file.originalname);
    const isVid = /^video\//i.test(dm) || /\.(mp4|mov|avi|mkv)$/i.test(req.file.originalname);
    const isAud = /^audio\//i.test(dm) || /\.(mp3|wav|m4a|flac)$/i.test(req.file.originalname);
    const kind = isImg ? 'image' : (isVid ? 'video' : (isAud ? 'audio' : 'unknown'));
    
    // Search database for existing verifications
    let searchResults = { found: false, is_first_verification: true };
    try {
      searchResults = await searchByFingerprint(fingerprint);
    } catch (err) {
      console.error('⚠️ Database search error:', err.message);
    }
    
    // Generate Chromaprint for audio files
    let chromaprint = null;
    let audioDuration = null;
    if (kind === 'audio') {
      try {
        console.log('🎵 Generating Chromaprint for audio...');
        const chromaprintResult = await ChromaprintService.generateFingerprint(req.file.path);
        if (chromaprintResult.success) {
          chromaprint = chromaprintResult.fingerprint;
          audioDuration = chromaprintResult.duration;
          console.log('✅ Chromaprint generated');
        }
      } catch (err) {
        console.error('⚠️ Chromaprint error:', err.message);
      }
    }

      // Identify music with AcoustID/MusicBrainz (if audio and configured)
      let musicIdentification = null;
      if (kind === 'audio' && chromaprint && acoustid.isConfigured()) {
        try {
          console.log('🎵 Attempting music identification...');
          musicIdentification = await acoustid.identifyAudio(req.file.path);
          
          if (musicIdentification.identified) {
            console.log(`✅ Identified: ${musicIdentification.recording.title} - ${musicIdentification.recording.artist}`);
          } else {
            console.log('ℹ️ Music not identified in database');
          }
        } catch (err) {
          console.error('⚠️ Music identification error:', err.message);
          musicIdentification = {
            identified: false,
            error: err.message
          };
        }
      } else if (kind === 'audio' && !acoustid.isConfigured()) {
        console.log('⚠️ AcoustID not configured - skipping music identification');
      }
    
    // Generate pHash for images
    let phash = null;
    let similarImages = null;
    if (kind === 'image') {
      try {
        console.log('🔍 Generating pHash for image...');
        const phashResult = await generatePHash(req.file.path);
        if (phashResult.success) {
          phash = phashResult.phash;
          console.log('✅ pHash generated:', phash);
          
          // Search for similar images
          if (dbReady) {
            const similar = await searchSimilarImages(phash, db);
            if (similar.length > 0) {
              similarImages = {
                found: true,
                count: similar.length,
                matches: similar.slice(0, 5)  // Top 5 matches
              };
              console.log(`✅ Found ${similar.length} similar images`);
            }
          }
        }
      } catch (err) {
        console.error('⚠️ pHash error:', err.message);
      }
    }
    

      // Detect AI-generated images
      let aiDetection = null;
      if (kind === 'image') {
        try {
          console.log('🤖 Running AI generation detection...');
          aiDetection = await detectAIGeneration(req.file.path);
          console.log(`✅ AI detection complete: ${aiDetection.likely_ai_generated ? 'LIKELY AI' : 'LIKELY AUTHENTIC'} (${aiDetection.ai_confidence}%)`);
        } catch (err) {
          console.error('⚠️ AI detection error:', err.message);
          aiDetection = { error: err.message };
        }
      }

      // Get Google Vision results for confidence scoring
      let googleVisionResult = null;
      if (kind === 'image') {
        try {
          console.log('👁️ Running Google Vision analysis...');
          googleVisionResult = await analyzeImage(req.file.path);
          console.log('✅ Google Vision analysis complete');
        } catch (err) {
          console.error('⚠️ Google Vision error:', err.message);
          googleVisionResult = { error: err.message };
        }
      }

      // Extract EXIF data for weather and landmark verification
      if (kind === 'image') {
        try {
          console.log('📍 Extracting GPS and date from EXIF...');
          const ExifParser = require('exif-parser');
          const exifBuffer = fs.readFileSync(req.file.path);
          const parser = ExifParser.create(exifBuffer);
          exifData = parser.parse().tags;
          const gpsAndDate = LandmarkVerification.extractGPSAndDate(exifData);
          
          if (gpsAndDate.gps || gpsAndDate.date) {
            console.log(`📍 Found GPS: ${gpsAndDate.gps ? 'Yes' : 'No'}, Date: ${gpsAndDate.date || 'No'}`);
            
            // Weather verification
            if (WeatherVerification.isConfigured()) {
              console.log('🌤️ Verifying weather conditions...');
              weatherVerification = await WeatherVerification.verifyWeatherConditions(
                gpsAndDate,
                googleVisionResult?.results?.labels || []
              );
              console.log(`✅ Weather verification: ${weatherVerification.verified ? 'MATCHED' : 'NOT VERIFIED'}`);
            }
            
            // Landmark verification
            if (googleVisionResult?.results?.landmarks) {
              console.log('🗺️ Verifying landmark locations...');
              landmarkVerification = LandmarkVerification.verifyLandmarkLocation(
                googleVisionResult.results.landmarks,
                gpsAndDate.gps
              );
              console.log(`✅ Landmark verification: ${landmarkVerification.landmarks_detected} landmarks detected`);
            }
          } else {
            console.log('ℹ️ No GPS or date in EXIF - skipping weather/landmark verification');
          }
        } catch (err) {
          console.error('⚠️ EXIF extraction error:', err.message);
        }
      } 

      // Analyze audio for AI detection
      let audioAIDetection = null;
      if (kind === 'audio') {
        try {
          console.log('🎵 Running audio AI detection...');
          audioAIDetection = await AudioAIDetection.analyze(req.file.path);
          console.log(`✅ Audio AI detection complete: ${audioAIDetection.likely_ai_generated ? 'LIKELY AI' : 'LIKELY AUTHENTIC'} (${audioAIDetection.ai_confidence}%)`);
        } catch (err) {
          console.error('⚠️ Audio AI detection error:', err.message);
          audioAIDetection = { error: err.message };
        }
      }

      // Analyze video frames for AI detection
      let videoAnalysis = null;
      if (kind === 'video') {
        try {
          console.log('🎥 Analyzing video frames...');
          videoAnalysis = await analyzeVideo(req.file.path, {
            fps: 1,
            maxFrames: 30
          });
          console.log('✅ Video analysis complete:', videoAnalysis.frames_analyzed, 'frames analyzed');
        } catch (err) {
          console.error('⚠️ Video analysis error:', err.message);
          videoAnalysis = { error: err.message };
        }
      }
    // Save this verification to database
    try {
      const ipAddress = req.ip || req.connection.remoteAddress;
      await saveVerification({
        fingerprint: fingerprint,
        algorithm: 'sha256',
        filename: req.file.originalname,
        file_size: req.file.size,
        file_type: req.file.mimetype,
        media_kind: kind,
        ip_address: ipAddress
      });
    } catch (err) {
      console.error('⚠️ Database save error:', err.message);
    }
    
    res.json({
      kind: kind,
      filename: req.file.originalname,
      size_bytes: req.file.size,
      fingerprint: {
        algorithm: 'sha256',
        hash: fingerprint,
        version: 'v1'
      },
      verification: {
        status: searchResults.found ? 'PREVIOUSLY_VERIFIED' : 'NEW_UPLOAD',
        is_first: searchResults.is_first_verification,
        first_seen: searchResults.found ? searchResults.first_seen : new Date().toISOString(),
        times_verified: searchResults.found ? searchResults.total_verifications : 1,
        previous_uploads: searchResults.found ? searchResults.matches : []
      },
        ...(kind === 'audio' && chromaprint && {
          chromaprint: chromaprint,
          audio_duration: audioDuration,
          ...(musicIdentification && { music_identification: musicIdentification }),
          ...(audioAIDetection && { audio_ai_detection: audioAIDetection })
      }),
      ...(kind === 'image' && phash && {
        phash: phash,
        similar_images: similarImages,
          ...(aiDetection && { ai_detection: aiDetection }),
      }),
      ...(kind === 'video' && videoAnalysis && {
        video_analysis: videoAnalysis
      }),
      ...(kind === 'image' && googleVisionResult && { google_vision: googleVisionResult }),
      ...(kind === 'image' && weatherVerification && { weather_verification: weatherVerification }),
      ...(kind === 'image' && landmarkVerification && { landmark_verification: landmarkVerification }),
      virustotal: await (async () => {
        try {
          console.log('🔍 Checking VirusTotal...');
          const vtResult = await searchVirusTotal(fingerprint);
          console.log('✅ VirusTotal check complete:', vtResult.found ? 'FOUND' : 'NOT FOUND');
          return vtResult;
        } catch (err) {
          console.error('⚠️ VirusTotal error:', err.message);
          return { found: false, error: err.message };
        }
      })(),
      confidence: (() => {
        try {
          // Build data object for confidence calculation
          const confidenceData = {
            kind: kind,
            size_bytes: req.file.size,
            fingerprint: { hash: fingerprint },
            verification: searchResults,
            ...(chromaprint && { chromaprint }),
            ...(phash && { phash }),
            ...(similarImages && { similar_images: similarImages }),
              ...(aiDetection && { ai_detection: aiDetection }),
              ...(googleVisionResult && { google_vision: googleVisionResult }),
              ...(videoAnalysis && { video_analysis: videoAnalysis }),
              ...(audioAIDetection && { audio_ai_detection: audioAIDetection }),
          };
          

          console.log('📊 Calculating confidence score...');
          const score = ConfidenceScoring.calculate(confidenceData);
          console.log(`✅ Confidence: ${score.level} (${score.percentage}%)`);
          return score;
        } catch (err) {
          console.error('⚠️ Confidence calculation error:', err.message);
          return {
            level: 'UNKNOWN',
            percentage: 0,
            label: 'Unable to calculate',
            message: 'Confidence scoring temporarily unavailable'
          };
        }
      })()
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
