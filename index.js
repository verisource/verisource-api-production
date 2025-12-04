require('dotenv').config();
const express = require('express');
const mime = require('mime-types');
const sharp = require('sharp');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./db-minimal');
const { searchByFingerprint, saveVerification } = require('./search');
const c2paVerification = require('./services/c2pa-verification');
const shadowPhysics = require('./services/shadow-physics-verification');
const reverseImageSearch = require('./services/reverse-image-search');
const deepfakeDetection = require('./services/deepfake-detection');
const stockPhotoDetection = require('./services/stock-photo-detection');
const CameraValidation = require('./services/camera-validation');
const AudioSpectralAnalysis = require('./services/audio-spectral-analysis');
const EnhancedAIDetector = require('./services/enhanced-ai-detector');
const JPEGForensics = require('./services/jpeg-forensics');
const BlockchainService = require('./services/opentimestamps-service');
const PolygonService = require('./services/polygon-timestamp');
const sightengineDetector = require('./services/sightengine-ai-detection');
const PlatformDetection = require('./services/platform-signature-detection');
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
const { loadFaceModels } = require("./deepfake-detector");
const { analyzeImage } = require('./google-vision-search');
const { AudioAIDetection } = require('./services/audio-ai-detection');
const { detectAIGeneration } = require('./services/ensemble-ai-detection');
const { generatePHash, searchSimilarImages } = require('./phash-module');
const ConfidenceScoring = require('./services/confidence-scoring');
const ChromaprintService = require('./services/chromaprint');
const acoustid = require('./acoustid-integration');
const WeatherVerification = require('./services/weather-verification');
const LandmarkVerification = require('./services/landmark-verification');
const PortraitModeDetection = require('./services/enhanced-portrait-detection');
const { verifyCameraModel } = require('./services/camera-model-verification');
const AIGeneratorDetector = require('./services/ai-generator-detector');
// View engine for batch dashboard
const HEICDetection = require('./services/heic-detection');
const SensorNoiseAnalysis = require('./services/sensor-noise-analysis');
const LivePhotoValidator = require('./services/live-photo-validator');
const CompressionSignature = require('./services/compression-signature-detector');
const { detectScreenshot, getScreenshotVerdictAdjustment } = require('./screenshot-detection');

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
app.use('/api', batchRoutes);

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
let dbReady = false;

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
        phash VARCHAR(64),
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
  
  // Weather API test endpoint
app.get('/test/weather', async (req, res) => {
  const result = await WeatherVerification.getHistoricalWeather(
    { lat: 36.1699, lon: -115.1398 }, // Las Vegas
    '2024-10-15'
  );
  res.json({ 
    configured: WeatherVerification.isConfigured(),
    weather_data: result 
  });
});

// Check blockchain verification status
app.get('/blockchain/verify/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const verification = await BlockchainService.verify(hash);
    res.json(verification);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

  // Initialize database before starting server
  await initializeDatabase();
  
  // Preload face detection models for faster video analysis
  console.log("🎭 Preloading face detection models...");
  try {
    await loadFaceModels();
    console.log("✅ Face detection models preloaded");
  } catch (err) {
    console.warn("⚠️ Face model preload failed:", err.message);
  }

  // Start server
  app.listen(PORT, () => {
    console.log(`✅ VeriSource API running on port ${PORT}`);
    console.log(`📊 Database status: ${dbReady ? "READY" : "NOT AVAILABLE"}`);
  });
})();

// ============================================
// SINGLE FILE VERIFY ENDPOINT
// ============================================
app.post('/verify', upload.single('file'), async (req, res) => {
  const requestId = Date.now();
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  let weatherVerification = null;
  let landmarkVerification = null;
  let exifData = null; 
  let cameraVerification = null;
  let platformDetection = null;
  let shadowPhysicsResult = null;
  let audioAIDetection = null;
  let videoAnalysis = null;
  let deepfakeAnalysis = null;
  let screenshotDetection = null;

  try {
    const buf = fs.readFileSync(req.file.path);
    const crypto = require('crypto');
    const fingerprint = crypto.createHash('sha256').update(buf).digest('hex');

    // Search database FIRST for existing verifications
    let searchResults = { found: false, is_first_verification: true };
    try {
      searchResults = await searchByFingerprint(fingerprint);
      if (searchResults.found) {
        console.log(`✅ Previously verified: ${searchResults.total_verifications} times`);
      }
    } catch (err) {
      console.error('⚠️ Database search error:', err.message);
    }

    // Only timestamp if NEW (not previously verified)
    let blockchainVerification = null;
    let polygonVerification = null;
    
    // Start blockchain submissions in parallel (dont await yet - will resolve before response)
    let blockchainPromise = null;
    let polygonPromise = null;
    
    if (!searchResults.found) {
      console.log("📦 Timestamping to Bitcoin blockchain (async)...");
      blockchainPromise = BlockchainService.timestamp(fingerprint, req.file.originalname)
        .then(result => {
          console.log(`✅ Blockchain: ${result.status}`);
          return result;
        })
        .catch(error => {
          console.error("⚠️ Blockchain timestamping failed:", error.message);
          return { success: false, error: error.message };
        });
      
      console.log("🔷 Timestamping to Polygon blockchain (async)...");
      polygonPromise = PolygonService.timestamp(fingerprint, req.file.originalname)
        .then(result => {
          if (result.success) console.log(`✅ Polygon: Block: ${result.block_number}`);
          return result;
        })
        .catch(error => {
          console.error("⚠️ Polygon timestamping failed:", error.message);
          return { success: false, error: error.message };
        });
    } else {
      console.log("⏭️ Skipping blockchain - already timestamped");
      // Return existing proof info from database
      const proofPath = `blockchain-stamps/${fingerprint}.ots`;
      const proofExists = require('fs').existsSync(proofPath);
      blockchainVerification = { 
        success: true, 
        status: 'previously_timestamped', 
        skipped: true,
        hash: fingerprint,
        proof_file: proofExists ? proofPath : null,
        first_timestamped: searchResults.first_seen,
        submitted_at: searchResults.bitcoin_submitted_at,
        message: 'File was previously timestamped. Original proof preserved.'
      };
      polygonVerification = { 
        success: true, 
        status: 'previously_timestamped', 
        skipped: true,
        block_number: searchResults.polygon_block_number,
        transaction_hash: searchResults.polygon_tx_hash,
        timestamp: searchResults.polygon_timestamp,
        first_timestamped: searchResults.first_seen,
        message: 'File was previously timestamped on Polygon.'
      };
    }

    const dm = req.file.mimetype || mime.lookup(req.file.originalname) || 'application/octet-stream';
    const isImg = /^image\//i.test(dm) || /\.(png|jpe?g|gif|webp)$/i.test(req.file.originalname);
    const isVid = /^video\//i.test(dm) || /\.(mp4|mov|avi|mkv)$/i.test(req.file.originalname);
    const isAud = /^audio\//i.test(dm) || /\.(mp3|wav|m4a|flac)$/i.test(req.file.originalname);
    const kind = isImg ? 'image' : (isVid ? 'video' : (isAud ? 'audio' : 'unknown'));
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

      // Audio Spectral Analysis for AI voice detection
      let audioSpectralAnalysis = null;
      if (kind === 'audio') {
        try {
          console.log('🔊 Running audio spectral analysis...');
          audioSpectralAnalysis = await AudioSpectralAnalysis.analyze(req.file.path);
          
          if (audioSpectralAnalysis.is_likely_ai_voice) {
            console.log(`⚠️ AI voice detected: ${audioSpectralAnalysis.ai_confidence}% confidence`);
          } else {
            console.log(`✅ Audio analysis: ${audioSpectralAnalysis.verdict}`);
          }
        } catch (err) {
          console.error('⚠️ Audio spectral analysis error:', err.message);
          audioSpectralAnalysis = { error: err.message };
        }
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

   // Detect AI-generated images with smart routing (local + Sightengine)
let aiDetection = null;
if (kind === 'image') {
  try {
   console.log('🤖 Running local AI detection...');
    const localResult = await detectAIGeneration(req.file.path);
    
    // Smart routing: decide if we need Sightengine
    let needsExternalCheck = false;
    let confidenceLevel = 'high';
    
    // Trigger Sightengine for uncertain cases
    if (localResult.ai_confidence > 20 && localResult.ai_confidence < 80) {
      needsExternalCheck = true;
      confidenceLevel = 'uncertain';
      console.log(`⚠️ Local confidence: ${localResult.ai_confidence}% - calling Sightengine for verification`);
    }
    
    let finalResult = localResult;
    
    // Call Sightengine if needed
    if (needsExternalCheck && process.env.SIGHTENGINE_API_USER) {
      try {
        // Create temporary accessible URL or use file path
        const sightengineResult = await sightengineDetector.detectAI(req.file.path);
        
        console.log(`✅ Sightengine result: ${sightengineResult.isAI ? 'AI' : 'Authentic'} (${(sightengineResult.confidence * 100).toFixed(1)}%)`);
        
        // Use Sightengine result (more accurate)
        finalResult = {
          ...localResult,
          ai_confidence: sightengineResult.confidence * 100,
          likely_ai_generated: sightengineResult.isAI,
          external_verification: {
            provider: 'sightengine',
            confidence: sightengineResult.confidence,
            isAI: sightengineResult.isAI,
            score: sightengineResult.score
          },
          local_result: {
            confidence: localResult.ai_confidence,
            likely_ai: localResult.likely_ai_generated
          },
          routing_decision: 'external_used',
          confidence_source: 'sightengine'
        };
      } catch (sightengineError) {
        console.warn('⚠️ Sightengine failed, using local result:', sightengineError.message);
        finalResult.routing_decision = 'external_failed';
        finalResult.confidence_source = 'local';
      }
    } else {
      finalResult.routing_decision = needsExternalCheck ? 'external_not_configured' : 'local_confident';
      finalResult.confidence_source = 'local';
    }
    
    // Map to expected format
    aiDetection = {
      likely_ai_generated: finalResult.likely_ai_generated,
      ai_confidence: finalResult.ai_confidence,
      ai_confidence_raw: finalResult.ai_confidence, // Store for portrait adjustment
      indicators: finalResult.indicators || [],
      warnings: [],
      recommendations: [],
      
      // Add ensemble-specific data
      ensemble_results: finalResult.individual_results || null,
      ensemble_agreement: finalResult.agreement || null,
      detector_count: finalResult.detector_count || 1,
      
      forensic_analysis: {
        manipulation_detected: finalResult.ai_confidence >= 50,
        manipulation_confidence: finalResult.ai_confidence,
        ela_performed: false, // ELA not part of ensemble yet
        compression_quality: finalResult.individual_results?.jpeg?.details?.quality || 0,
        double_compressed: finalResult.individual_results?.jpeg?.details?.doubleCompressed || false,
        noise_level: finalResult.individual_results?.jpeg?.details?.noise || 'unknown'
      },
      
 verdict: finalResult.likely_ai_generated ? 'AI-GENERATED' : 'LIKELY AUTHENTIC',
      analysis_time_ms: 0,
      
      // Smart routing metadata
      routing_decision: finalResult.routing_decision || 'unknown',
      confidence_source: finalResult.confidence_source || 'local',
      external_verification: finalResult.external_verification || null,
      local_result: finalResult.local_result || null
    };     
    
    
    console.log(`✅ Ensemble detection: ${aiDetection.verdict} (${aiDetection.ai_confidence}%)`);
    
    console.log(`✅ Ensemble detection: ${finalResult.likely_ai_generated ? 'AI-GENERATED' : 'AUTHENTIC'} (${finalResult.ai_confidence}%)`);
    
  } catch (err) {
    console.error('⚠️ AI detection error:', err.message);
    aiDetection = { error: err.message };
  }
}

  // Calculate camera authenticity score based on multiple signals
function calculateCameraAuthenticityScore(data) {
  let score = 0;
  const indicators = [];
  
  // 1. Valid camera EXIF with recognized manufacturer
  if (data.cameraVerification?.camera_found || data.cameraVerification?.details?.make) {
    const make = (data.cameraVerification?.details?.make || '').toUpperCase();
    const knownManufacturers = ['SONY', 'CANON', 'NIKON', 'FUJIFILM', 'PANASONIC', 'OLYMPUS', 'LEICA', 'APPLE', 'SAMSUNG', 'GOOGLE'];
    
    if (knownManufacturers.some(m => make.includes(m))) {
      score += 25;
      indicators.push(`Known camera manufacturer: ${make}`);
    }
    
    // Professional camera models get extra trust
    const model = (data.cameraVerification?.details?.model || '').toUpperCase();
    const proCameras = ['ILCE-1', 'ILCE-7', 'EOS R', 'EOS 5D', 'EOS 1D', 'D850', 'D6', 'Z9', 'GFX', 'X-T', 'X-H'];
    if (proCameras.some(p => model.includes(p))) {
      score += 15;
      indicators.push(`Professional camera model: ${model}`);
    }
  }
  
  // 2. Sensor noise analysis shows camera-like patterns
  if (data.sensorNoiseAnalyzed && data.sensorNoiseConfidence > 0) {
    // High spatial correlation = real camera sensor
    if (data.noiseIndicators?.some(i => i.toLowerCase().includes('sensor pattern') || i.toLowerCase().includes('camera'))) {
      score += 20;
      indicators.push(`Sensor noise matches camera pattern (${data.sensorNoiseConfidence}%)`);
    }
    
    // Low AI anomalies in noise
    if (data.aiNoiseAnomalies !== undefined && data.aiNoiseAnomalies < 20) {
      score += 10;
      indicators.push(`Low AI noise anomalies: ${data.aiNoiseAnomalies}%`);
    }
  }
  
  // 3. Compression signature matches known manufacturer
  if (data.compressionAnalyzed && data.manufacturerSignature) {
    const sig = data.manufacturerSignature.toLowerCase();
    const make = (data.cameraVerification?.details?.make || '').toLowerCase();
    
    // Signature matches camera make
    if (make && sig.includes(make.split(' ')[0])) {
      score += 20;
      indicators.push(`Compression signature matches camera: ${sig}`);
    } else if (sig !== 'generic' && sig !== 'unknown') {
      score += 10;
      indicators.push(`Known manufacturer compression: ${sig}`);
    }
  }
  
  // 4. Found on credible news/stock sources (Google Vision)
  if (data.googleVision?.results?.web_detection?.pages_with_matching_images?.length > 0) {
    const pages = data.googleVision.results.web_detection.pages_with_matching_images;
    const credibleDomains = ['reuters.com', 'apnews.com', 'gettyimages.com', 'alamy.com', 
                            'shutterstock.com', 'nytimes.com', 'bbc.com', 'cnn.com',
                            'theguardian.com', 'washingtonpost.com', 'euronews.com'];
    
    const foundOnCredible = pages.some(p => 
      credibleDomains.some(d => p.url?.toLowerCase().includes(d))
    );
    
    if (foundOnCredible) {
      score += 15;
      indicators.push('Found on credible news/stock photo source');
    }
  }
  
  // 5. Multiple real faces detected (not deepfake)
  if (data.deepfakeDetection?.face_analysis?.faces_detected > 0 && 
      !data.deepfakeDetection?.is_deepfake) {
    score += 5;
    indicators.push(`${data.deepfakeDetection.face_analysis.faces_detected} real faces detected`);
  }
  
  return { score, indicators, maxScore: 95 };
}

// Main hybrid rescue function
async function applyHybridCameraRescue(aiDetection, verificationData, callExternalAPI) {
  const originalConfidence = aiDetection.ai_confidence;
  
  // Only apply if local detector says AI-generated
  if (originalConfidence < 50) {
    return aiDetection; // No rescue needed
  }
  
  // Calculate camera authenticity score
  const cameraScore = calculateCameraAuthenticityScore({
    cameraVerification: verificationData.camera_verification,
    sensorNoiseAnalyzed: aiDetection.sensor_noise_analyzed,
    sensorNoiseConfidence: aiDetection.sensor_noise_confidence,
    noiseIndicators: aiDetection.noise_indicators,
    aiNoiseAnomalies: aiDetection.ai_noise_anomalies,
    compressionAnalyzed: aiDetection.compression_analyzed,
    manufacturerSignature: aiDetection.manufacturer_signature,
    googleVision: verificationData.google_vision,
    deepfakeDetection: verificationData.deepfake_detection
  });
  
  console.log(`📸 Camera authenticity score: ${cameraScore.score}/${cameraScore.maxScore}`);
  console.log(`   Indicators: ${cameraScore.indicators.join(', ')}`);
  
  // If camera score is high, we have conflicting signals
  if (cameraScore.score >= 40) {
    // Apply reduction based on camera score
    // score 40 = -25%, score 60 = -40%, score 80+ = -60%, score 95+ = -70%
    let reduction;
    if (cameraScore.score >= 95) {
      reduction = 70; // Overwhelming evidence of real camera
    } else if (cameraScore.score >= 80) {
      reduction = 60;
    } else if (cameraScore.score >= 60) {
      reduction = 45;
    } else {
      reduction = Math.floor(cameraScore.score * 0.6);
    }
    let adjustedConfidence = Math.max(0, originalConfidence - reduction);
    
    console.log(`   🔧 Hybrid rescue: ${originalConfidence}% → ${adjustedConfidence}% (camera score: ${cameraScore.score})`);
    
    aiDetection.hybrid_rescue_applied = true;
    aiDetection.camera_authenticity_score = cameraScore.score;
    aiDetection.camera_indicators = cameraScore.indicators;
    aiDetection.pre_rescue_confidence = originalConfidence;
    
    // If still above 50% after reduction, call external API as tiebreaker
    if (adjustedConfidence > 50 && typeof callExternalAPI === 'function') {
      console.log(`   🌐 Confidence still ${adjustedConfidence}% - calling external API for tiebreaker...`);
      
      try {
        const externalResult = await callExternalAPI();
        
        if (externalResult && externalResult.confidence !== undefined) {
          const externalConfidence = externalResult.confidence * 100; // Normalize to 0-100
          
          console.log(`   🌐 External API result: ${externalResult.isAI ? 'AI' : 'Authentic'} (${externalConfidence.toFixed(1)}%)`);
          
          aiDetection.external_tiebreaker = {
            provider: externalResult.provider || 'sightengine',
            confidence: externalConfidence,
            result: externalResult.isAI ? 'ai_generated' : 'authentic',
            used_as_tiebreaker: true
          };
          
          // External API gets significant weight as tiebreaker
          if (!externalResult.isAI && externalConfidence < 50) {
            // External says authentic - trust it more
            adjustedConfidence = Math.min(adjustedConfidence, externalConfidence);
            console.log(`   ✅ External confirms authentic - final: ${adjustedConfidence}%`);
          } else if (externalResult.isAI && externalConfidence > 70) {
            // External also says AI with high confidence - trust local more
            adjustedConfidence = Math.max(adjustedConfidence, originalConfidence - 10);
            console.log(`   ⚠️ External confirms AI - final: ${adjustedConfidence}%`);
          } else {
            // Ambiguous - average the signals
            adjustedConfidence = Math.round((adjustedConfidence + externalConfidence) / 2);
            console.log(`   🔄 Ambiguous - averaged: ${adjustedConfidence}%`);
          }
        }
      } catch (err) {
        console.error(`   ❌ External API error: ${err.message}`);
        aiDetection.external_tiebreaker = {
          error: err.message,
          used_as_tiebreaker: false
        };
      }
    }
    
    // Apply final adjusted confidence
    aiDetection.ai_confidence = adjustedConfidence;
    aiDetection.likely_ai_generated = adjustedConfidence >= 50;
    aiDetection.verdict = adjustedConfidence >= 70 ? 'AI-GENERATED' : 
                          adjustedConfidence >= 50 ? 'LIKELY_AI' :
                          adjustedConfidence >= 30 ? 'UNCERTAIN' : 'AUTHENTIC';
    
    // Update adjustments array
    if (!aiDetection.adjustments) aiDetection.adjustments = [];
    aiDetection.adjustments.push(
      `Hybrid camera rescue: ${originalConfidence}% → ${aiDetection.ai_confidence}% ` +
      `(camera score: ${cameraScore.score}, indicators: ${cameraScore.indicators.length})`
    );
    
    if (aiDetection.external_tiebreaker?.used_as_tiebreaker) {
      aiDetection.adjustments.push(
        `External tiebreaker (${aiDetection.external_tiebreaker.provider}): ${aiDetection.external_tiebreaker.result}`
      );
    }
  }
  
  return aiDetection;
}

module.exports = { applyHybridCameraRescue, calculateCameraAuthenticityScore };

      // Adjust AI detection for portrait mode / computational photography
      if (aiDetection && !aiDetection.error && exifData) {
        const portraitDetection = PortraitModeDetection.detectPortraitMode(exifData);
        
        if (portraitDetection.isComputationalPhotography) {
          console.log(`📸 Computational photography detected: ${portraitDetection.confidence}% confidence`);
          console.log(`   Indicators: ${portraitDetection.indicators.slice(0, 3).join(", ")}`);
          
          aiDetection = PortraitModeDetection.adjustAIDetectionResults(aiDetection, portraitDetection);
          
          if (aiDetection.portrait_mode_adjustment?.applied) {
            console.log(`   ✅ AI confidence adjusted: ${aiDetection.ai_confidence_raw}% → ${aiDetection.ai_confidence}%`);
          }
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

      // Enhanced deepfake detection for images
      
      if (kind === 'image' && googleVisionResult) {
        try {
          console.log('🎭 Running deepfake detection...');
          deepfakeAnalysis = deepfakeDetection.analyzeImage(googleVisionResult);
          if (deepfakeAnalysis.is_deepfake) {
            console.log(`⚠️ Deepfake indicators detected: ${deepfakeAnalysis.confidence}% confidence`);
          }
        } catch (err) {
          console.error('⚠️ Deepfake detection error:', err.message);
        }
      }

      // Authority figure detection (deepfake risk for public figures)
      let authorityResult = null;
      if (kind === "image" && googleVisionResult) {
        try {
          console.log("👤 Checking for authority figures...");
          const { checkAuthorityInVisionResults, getAuthorityAdjustment } = require("./services/authority-integration");
          authorityResult = await checkAuthorityInVisionResults(googleVisionResult);
          if (authorityResult.authorityDetected) {
            console.log("   ⚠️ Authority detected: " + authorityResult.authorities[0].name + " (" + authorityResult.highestRisk + " risk)");
          } else {
            console.log("   No authority figures detected");
          }
        } catch (err) {
          console.error("⚠️ Authority detection error:", err.message);
        }
      }

      // Apply authority figure adjustment to AI score
      if (authorityResult && authorityResult.authorityDetected && aiDetection) {
        const { getAuthorityAdjustment } = require("./services/authority-integration");
        const aiSignals = {
          highFrameAI: aiDetection.ai_confidence > 50,
          noDeviceMetadata: !exifData || Object.keys(exifData).length < 3,
          aiEncoder: false,
          noAudio: false,
          authenticDevice: exifData && (exifData.Make || exifData.Model),
          authenticGOP: false,
          authenticAudio: false
        };
        const authAdj = getAuthorityAdjustment(authorityResult, aiSignals);
        if (authAdj.adjustment > 0) {
          aiDetection.ai_confidence = Math.min(100, aiDetection.ai_confidence + authAdj.adjustment);
          aiDetection.adjustments = aiDetection.adjustments || [];
          aiDetection.adjustments.push(...authAdj.adjustments);
          aiDetection.authority_alerts = authAdj.alerts;
          console.log("   ⚠️ " + authAdj.alerts[0]);
        }
      }
      
      // Extract EXIF data for weather and landmark verification

      // Extract EXIF data for weather and landmark verification
      if (kind === 'image') {
        try {
          console.log('📍 Extracting GPS and date from EXIF...');
          const ExifParser = require('exif-parser');
          const exifBuffer = fs.readFileSync(req.file.path);
          
          // Validate file is large enough for EXIF
          if (exifBuffer.length < 12) {
            console.log('ℹ️ File too small for EXIF data');
          } 
          // Check for JPEG magic bytes (0xFF 0xD8)
          else if (exifBuffer[0] !== 0xFF || exifBuffer[1] !== 0xD8) {
            console.log('ℹ️ Not a JPEG file - skipping EXIF extraction');
          } 
          // Valid JPEG, attempt EXIF parsing
          else {
            try {
              const parser = ExifParser.create(exifBuffer);
              exifData = parser.parse().tags;

              // Adjust AI detection for portrait mode
              if (aiDetection && !aiDetection.error) {
                const portraitDetection = PortraitModeDetection.detectPortraitMode(exifData);
                if (portraitDetection.isPortraitMode) {
                  console.log(`📸 Portrait mode detected: ${portraitDetection.confidence}% confidence`);
                  console.log(`   Indicators: ${portraitDetection.indicators.join(", ")}`);
                  aiDetection = PortraitModeDetection.adjustForPortraitMode(aiDetection, portraitDetection);
                  console.log(`   AI confidence adjusted: ${aiDetection.original_ai_confidence}% → ${aiDetection.ai_confidence}%`);
                }
              }
              
              // Verify camera model (for all images with EXIF)

              // 1. HEIC/HEVC Format Detection
              try {
                console.log('📱 Checking for HEIC/HEVC format...');
                const heicDetection = await HEICDetection.detectHEIC(req.file.path, exifData);
                if (heicDetection.wasHEIC) {
                  console.log(`✅ HEIC detected: ${heicDetection.confidence}% confidence`);
                  console.log(`   Format: ${heicDetection.format_conversion}`);
                  aiDetection = HEICDetection.adjustForHEIC(aiDetection, heicDetection);
                  console.log(`   AI confidence adjusted: ${aiDetection.original_ai_confidence}% → ${aiDetection.ai_confidence}%`);
                }
              } catch (err) {
                console.error('⚠️ HEIC detection error:', err.message);
              }

              // 2. Sensor Noise Analysis (Near-PRNU)
              try {
                console.log('🔬 Analyzing sensor noise patterns...');
                const noiseAnalysis = await SensorNoiseAnalysis.analyzeSensorNoise(req.file.path);
                if (noiseAnalysis.has_sensor_noise || noiseAnalysis.ai_likelihood > 40) {
                  console.log(`✅ Noise analysis complete:`);
                  console.log(`   Camera sensor: ${noiseAnalysis.confidence}% | AI anomalies: ${noiseAnalysis.ai_likelihood}%`);
                  aiDetection = SensorNoiseAnalysis.adjustForSensorNoise(aiDetection, noiseAnalysis);
                  console.log(`   AI confidence adjusted: ${aiDetection.original_ai_confidence}% → ${aiDetection.ai_confidence}%`);
                }
              } catch (err) {
                console.error('⚠️ Sensor noise analysis error:', err.message);
              }

              // 3. Live Photo Validation (iPhone only)
              try {
                console.log('🎬 Checking for Live Photo pairing...');
                const livePhotoValidation = await LivePhotoValidator.validateLivePhoto(req.file.path, exifData);
                if (livePhotoValidation.is_live_photo) {
                  console.log(`✅ Live Photo detected: ${livePhotoValidation.confidence}% confidence`);
                  if (livePhotoValidation.pairing_valid) {
                    console.log(`   ✓ Video pairing validated (${livePhotoValidation.temporal_consistency ? 'temporal consistency confirmed' : 'partial validation'})`);
                  }
                  aiDetection = LivePhotoValidator.adjustForLivePhoto(aiDetection, livePhotoValidation);
                  console.log(`   AI confidence adjusted: ${aiDetection.original_ai_confidence}% → ${aiDetection.ai_confidence}%`);
                }
              } catch (err) {
                console.error('⚠️ Live Photo validation error:', err.message);
              }

              // 4. Manufacturer Compression Signature
              try {
                console.log('🔍 Analyzing JPEG compression signature...');
                const compressionAnalysis = await CompressionSignature.analyzeCompressionSignature(req.file.path, exifData);
                if (compressionAnalysis.manufacturer_detected || compressionAnalysis.ai_likelihood > 40) {
                  console.log(`✅ Compression signature analyzed:`);
                  console.log(`   Manufacturer: ${compressionAnalysis.manufacturer_detected || 'Generic'} (${compressionAnalysis.confidence}% match)`);
                  if (compressionAnalysis.ai_likelihood > 40) {
                    console.log(`   ⚠️ AI-like compression detected: ${compressionAnalysis.ai_likelihood}%`);
                  }
                  aiDetection = CompressionSignature.adjustForCompressionSignature(aiDetection, compressionAnalysis);
                  console.log(`   AI confidence adjusted: ${aiDetection.original_ai_confidence}% → ${aiDetection.ai_confidence}%`);
                }
              } catch (err) {
                console.error('⚠️ Compression signature analysis error:', err.message);
              }

              console.log(`\n📊 FINAL AI CONFIDENCE: ${aiDetection.ai_confidence}% (started at ${aiDetection.ai_confidence_raw || aiDetection.original_ai_confidence || 'unknown'}%)\n`);
              // Get image dimensions for resolution validation
              const imgMeta = await sharp(req.file.path).metadata();
              cameraVerification = verifyCameraModel(exifData, { width: imgMeta.width, height: imgMeta.height });
              if (cameraVerification.camera_found) {
                console.log(`📷 Camera: ${cameraVerification.details.manufacturer} ${cameraVerification.details.recognized_model}`);
              }
              if (cameraVerification.warnings.length > 0) {
                console.log('⚠️ Camera warnings:', cameraVerification.warnings);
              }
              

              // Camera EXIF Validation Rescue - reduce AI false positives for validated cameras
              if (cameraVerification.camera_found && cameraVerification.is_valid && aiDetection) {
                const camConf = cameraVerification.confidence || 0;
                
                if (camConf >= 80) {
                  const originalAI = aiDetection.ai_confidence;
                  // Camera confidence 100% = -25%, 80-99% = -15%
                  const reduction = camConf === 100 ? 25 : 15;
                  
                  aiDetection.ai_confidence = Math.max(0, aiDetection.ai_confidence - reduction);
                  aiDetection.adjustments = aiDetection.adjustments || [];
                  aiDetection.adjustments.push(`Camera EXIF rescue: ${cameraVerification.details.recognized_model} validated (${camConf}% confidence, -${reduction}%)`);
                  
                  console.log(`📷 Camera EXIF rescue: ${cameraVerification.details.recognized_model} @ ${camConf}% confidence, AI ${originalAI}% → ${aiDetection.ai_confidence}%`);
                  
                  // Update verdict if confidence dropped below threshold
                  if (aiDetection.ai_confidence < 50 && aiDetection.verdict === 'AI-GENERATED') {
                    aiDetection.verdict = 'UNCERTAIN';
                    aiDetection.adjustments.push('Verdict changed: AI-GENERATED → UNCERTAIN');
                  }
                }
              }
              try {
                platformDetection = await PlatformDetection.detectPlatform(req.file.path, {
                  width: imgMeta.width,
                  height: imgMeta.height,
                  jpegQuality: null,
                  hasExif: !!(exifData?.Make || exifData?.Model || exifData?.DateTimeOriginal),
                  exifData: exifData,
                  iptcData: imgMeta.iptc
                });
                
                if (platformDetection.detected) {
                  console.log(`📱 Platform detected: ${platformDetection.platform} (${platformDetection.confidence}%)`);
                  
                  // Apply rescue if confidence >= 70
                  if (platformDetection.confidence >= 70 && aiDetection) {
                    const originalAI = aiDetection.ai_confidence;
                    const reduction = platformDetection.confidence >= 85 ? 25 : 20;
                    
                    aiDetection.ai_confidence = Math.max(0, aiDetection.ai_confidence - reduction);
                    aiDetection.adjustments = aiDetection.adjustments || [];
                    aiDetection.adjustments.push(`Platform rescue: ${PlatformDetection.getPlatformDisplayName(platformDetection.platform)} signature (-${reduction}%)`);
                    
                    console.log(`📱 Platform rescue: AI ${originalAI}% → ${aiDetection.ai_confidence}%`);
                    
                    if (aiDetection.ai_confidence < 50 && aiDetection.verdict === 'AI-GENERATED') {
                      aiDetection.verdict = 'UNCERTAIN';
                      aiDetection.adjustments.push('Verdict changed: AI-GENERATED → UNCERTAIN');
                    }
                  }
                }
              } catch (err) {
                console.error('⚠️ Platform detection error:', err.message);
              }

      // ========== HYBRID CAMERA RESCUE ==========
      if (aiDetection && !aiDetection.error && aiDetection.ai_confidence > 40) {
        try {
          console.log('📷 Running hybrid camera rescue...');
          aiDetection = await applyHybridCameraRescue(
            aiDetection,
            {
              camera_verification: cameraVerification,
              google_vision: googleVisionResult,
              deepfake_detection: deepfakeAnalysis
            },
            async () => {
              const result = await sightengineDetector.detectAI(req.file.path);
              return { provider: 'sightengine', isAI: result.isAI, confidence: result.confidence * 100 };
            }
          );
          if (aiDetection.hybrid_rescue_applied) {
            console.log(`📷 Hybrid rescue applied: Camera score ${aiDetection.camera_authenticity_score}, AI ${aiDetection.pre_rescue_confidence}% → ${aiDetection.ai_confidence}%`);
          }
        } catch (err) {
          console.error('⚠️ Hybrid camera rescue error:', err.message);
        }
      }
      // ========== END HYBRID CAMERA RESCUE ==========


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
                
                // Shadow physics verification
                if (gpsAndDate.gps && gpsAndDate.date) {
                  console.log('☀️ Verifying shadow physics...');
                  shadowPhysicsResult = shadowPhysics.verifyShadowPhysics(
                    exifData,
                    gpsAndDate.gps,
                    new Date(gpsAndDate.date),
                    null
                  );
            
                  if (shadowPhysicsResult.violations && shadowPhysicsResult.violations.length > 0) {
                    console.log(`⚠️ Shadow physics violations: ${shadowPhysicsResult.violations.length}`);
                  } else {
                    console.log('✅ Shadow physics: VALID');
                  }
                }
              } else {
                console.log('ℹ️ No GPS or date in EXIF - skipping weather/landmark verification');
              }
              
            } catch (exifParseError) {
              console.log('ℹ️ JPEG file has invalid/corrupted EXIF data');
            }
          }
          
        } catch (err) {
          console.error('⚠️ EXIF extraction error:', err.message);
        }
      }
      // Landmark verification for images without GPS data
      if (kind === 'image' && (!exifData || !exifData.GPSLatitude) && googleVisionResult?.results?.landmarks?.length > 0) {
        try {
          console.log('🗺️ Verifying landmarks (no GPS available)...');
          landmarkVerification = LandmarkVerification.verifyLandmarkLocation(
            googleVisionResult.results.landmarks,
            null  // No GPS data available
          );
          console.log(`✅ Landmark verification: ${landmarkVerification.landmarks_detected} landmarks detected`);
        } catch (landmarkErr) {
          console.error('⚠️ Landmark verification error:', landmarkErr.message);
        }
      }
            // ========== ADD REVERSE IMAGE SEARCH HERE ==========
      let reverseSearchResults = null;
      if (kind === 'image') {
        try {
          console.log('🔍 Running reverse image search...');
          reverseSearchResults = await reverseImageSearch.search(buf, {
            services: ['tineye', 'bing'],
            includeAnalysis: true
          });
          
          if (reverseSearchResults.combined_analysis) {
            const analysis = reverseSearchResults.combined_analysis;
            console.log(`✅ Reverse search: Found ${analysis.total_matches_found} matches online`);
            
            if (analysis.is_original) {
              console.log('   Status: LIKELY ORIGINAL (not found online)');
            } else {
              console.log(`   Status: Found on ${analysis.total_matches_found} sites`);
              if (analysis.age_analysis?.is_very_old) {
                console.log(`   ⚠️ WARNING: Image is ${analysis.age_analysis.age_readable}`);
              }
              if (analysis.content_type === 'stock_photo') {
                console.log('   ⚠️ WARNING: Stock photo detected');
              }
            }
          }
        } catch (err) {
          console.error('⚠️ Reverse image search error:', err.message);
          reverseSearchResults = { 
            search_performed: false, 
            error: err.message 
          };
        }
      }

      // Stock Photo Rescue Logic - reduce AI false positives
      if (reverseSearchResults?.tineye?.is_stock_photo && aiDetection) {
        const stockSites = reverseSearchResults.tineye.domain_breakdown?.stock_photo_sites || 0;
        const totalMatches = reverseSearchResults.tineye.total_matches || 0;
        
        if (stockSites >= 3) {
          const originalAI = aiDetection.ai_confidence;
          // More stock sites = more confidence it's real
          // 3 sites = -30%, 5+ sites = -40%, 10+ sites = -50%
          let reduction = 30;
          if (stockSites >= 10) reduction = 50;
          else if (stockSites >= 5) reduction = 40;
          
          aiDetection.ai_confidence = Math.max(0, aiDetection.ai_confidence - reduction);
          aiDetection.adjustments = aiDetection.adjustments || [];
          aiDetection.adjustments.push(`Stock photo rescue: found on ${stockSites} stock sites (-${reduction}%)`);
          
          console.log(`📸 Stock photo rescue: ${stockSites} stock sites, AI confidence ${originalAI}% → ${aiDetection.ai_confidence}%`);
          
          // Update verdict if confidence dropped below threshold
          if (aiDetection.ai_confidence < 50 && aiDetection.verdict === 'AI-GENERATED') {
            aiDetection.verdict = 'UNCERTAIN';
            aiDetection.adjustments.push('Verdict changed: AI-GENERATED → UNCERTAIN');
          }
        }
      }
      
      // Analyze video for AI detection
      videoAnalysis = null;
      if (kind === 'video') {
        try {
          console.log('🎥 Analyzing video frames...');
          videoAnalysis = await analyzeVideo(req.file.path, {
            fps: 1,
            maxFrames: 30
          });
          console.log('✅ Video analysis complete:', videoAnalysis.frames_analyzed, 'frames analyzed');
          
     // Apply video authenticity rescue for device-recorded videos
          if (videoAnalysis && videoAnalysis.success) {

              // 0. Apply frame analysis fix FIRST (video compression artifacts cause false positives)
              const { adjustFrameAnalysisForVideo } = require('./services/video-frame-analysis-fix');
              videoAnalysis = adjustFrameAnalysisForVideo(videoAnalysis);
            try {
              const { getVideoMetadata } = require('./video-analyzer');
              const { applyVideoAuthenticityRescue } = require('./services/video-authenticity-rescue');
              const { analyzeEncoderSignature, getEncoderVerdict } = require('./services/encoder-fingerprinting');
              const { analyzeVideoAudio } = require('./services/video-audio-analysis');
              const { applyEnhancedVideoScoring } = require('./services/enhanced-video-scoring');
              
              const videoMeta = await getVideoMetadata(req.file.path);
              
              // 1. Device signature rescue (existing)
              if (videoMeta && videoMeta.format && videoMeta.format.tags) {
                videoAnalysis = applyVideoAuthenticityRescue(videoAnalysis, videoMeta.format.tags);
              }
              
              // 2. Encoder fingerprinting
              let encoderAnalysis = null;
              if (videoMeta) {
                console.log('🔍 Analyzing encoder signature...');
                encoderAnalysis = analyzeEncoderSignature(videoMeta);
                encoderAnalysis.verdict = getEncoderVerdict(encoderAnalysis);
                console.log('   Encoder: ' + (encoderAnalysis.encoderDetected || 'unknown') + ' - ' + encoderAnalysis.verdict.verdict);
                if (encoderAnalysis.isLikelyAI) {
                  console.log('   ⚠️ AI tool indicators: ' + encoderAnalysis.indicators.join(', '));
                }
              }
              
              // 3. Audio analysis
              console.log('🔊 Analyzing audio track...');
              const audioAnalysis = await analyzeVideoAudio(req.file.path);
              if (!audioAnalysis.hasAudio) {
                console.log('   ⚠️ No audio track - suspicious for device recording');
              } else {
                console.log('   Audio: ' + audioAnalysis.verdict + ' (AI: ' + audioAnalysis.aiScore + '%, Auth: ' + audioAnalysis.authenticScore + '%)');
              }
              
              // 4. Bitrate anomaly detection
              console.log('📊 Analyzing bitrate patterns...');
              const { analyzeBitrate } = require('./services/bitrate-anomaly-detection');
              const { analyzeGOP, getGOPSummary } = require("./services/gop-structure-analysis");
              const bitrateAnalysis = await analyzeBitrate(req.file.path);
              if (bitrateAnalysis.success) {
                console.log('   Bitrate CV: ' + bitrateAnalysis.stats.cv + '% - ' + bitrateAnalysis.verdict);
                if (bitrateAnalysis.indicators.length > 0) {
                  console.log('   ' + bitrateAnalysis.indicators[0]);
                }
              }
              
              // 5. GOP structure analysis
              console.log('🎞️ Analyzing GOP structure...');
              const gopAnalysis = await analyzeGOP(req.file.path);
              if (gopAnalysis.success) {
                const summary = getGOPSummary(gopAnalysis);
                console.log('   GOP: ' + summary);
                if (gopAnalysis.indicators.length > 0) {
                  console.log('   ' + gopAnalysis.indicators.slice(0, 2).join(', '));
                }
                if (gopAnalysis.deviceMatch && gopAnalysis.deviceMatch.matched) {
                  console.log('   ✅ Device match: ' + gopAnalysis.deviceMatch.device);
                }
              } else {
                console.log('   GOP analysis: ' + (gopAnalysis.error || 'unavailable'));
              }

              // 6. Resolution analysis
              console.log('📐 Analyzing resolution...');
              const { analyzeResolution } = require('./services/resolution-analysis');
              const resolutionAnalysis = analyzeResolution(videoMeta);
              if (resolutionAnalysis.aiToolMatch && resolutionAnalysis.aiToolMatch.matched) {
                console.log('   ⚠️ AI resolution detected: ' + resolutionAnalysis.aiToolMatch.tool + ' (' + resolutionAnalysis.width + 'x' + resolutionAnalysis.height + ')');
              } else if (resolutionAnalysis.verdict === 'LIKELY_AI') {
                console.log('   ⚠️ Unusual resolution: ' + resolutionAnalysis.width + 'x' + resolutionAnalysis.height);
              } else {
                console.log('   Resolution: ' + resolutionAnalysis.width + 'x' + resolutionAnalysis.height + ' (' + resolutionAnalysis.verdict + ')');
              }

              // 7. Motion analysis + Watermark detection
              console.log('🎬 Analyzing motion patterns...');
              const { analyzeMotion } = require('./services/motion-analysis');
              const { analyzeVideoWatermarks } = require('./services/watermark-detection');
              let motionAnalysis = null;
              let watermarkAnalysis = null;
              try {
                const motionTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'));
                const ffmpeg = require('fluent-ffmpeg');
                await new Promise((resolve, reject) => {
                  ffmpeg(req.file.path)
                    .on('end', resolve)
                    .on('error', reject)
                    .outputOptions(['-vf', 'fps=2', '-q:v', '2', '-frames:v', '30'])
                    .output(path.join(motionTempDir, 'frame-%04d.jpg'))
                    .run();
                });
                const motionFrames = fs.readdirSync(motionTempDir)
                  .filter(f => f.endsWith('.jpg'))
                  .map(f => path.join(motionTempDir, f))
                  .sort();
                if (motionFrames.length >= 3) {
                  motionAnalysis = await analyzeMotion(req.file.path, motionFrames);
                  if (motionAnalysis.success) {
                    console.log('   Motion: ' + motionAnalysis.verdict + ' (AI:' + motionAnalysis.aiScore + ' Auth:' + motionAnalysis.authenticScore + ')');
                    console.log('   Flicker: ' + (motionAnalysis.correlation.flickerRatio * 100).toFixed(0) + '% of expected');
                  }
                  
                  // 8. Watermark detection
                  watermarkAnalysis = await analyzeVideoWatermarks(req.file.path, motionFrames);
                  if (watermarkAnalysis.watermarkDetected) {
                    console.log('   🏷️ AI Watermark: ' + watermarkAnalysis.tool + ' (' + watermarkAnalysis.confidence + '%)');
                  }
                }
                fs.rmSync(motionTempDir, { recursive: true, force: true });
              } catch (motionErr) {
                console.log('   Motion analysis error:', motionErr.message);
              }
              
              // 9. Audio content analysis
              console.log('🔊 Analyzing audio content...');
              const { analyzeAudioContent } = require('./services/audio-content-analysis');
              let audioContentAnalysis = null;
              try {
                audioContentAnalysis = await analyzeAudioContent(req.file.path);
                if (audioContentAnalysis.success && audioContentAnalysis.hasAudio) {
                  console.log('   Audio content: ' + audioContentAnalysis.verdict + ' (AI:' + audioContentAnalysis.aiScore + ' Auth:' + audioContentAnalysis.authenticScore + ')');
                }
              } catch (audioContentErr) {
                console.log('   Audio content analysis error:', audioContentErr.message);
              }

              // 10. Apply enhanced combined scoring (all 9 signals)
              console.log('📊 Applying enhanced video scoring...');
              videoAnalysis = applyEnhancedVideoScoring(videoAnalysis, encoderAnalysis, audioAnalysis, bitrateAnalysis, gopAnalysis, motionAnalysis, watermarkAnalysis, audioContentAnalysis, resolutionAnalysis);
              
              console.log('   Final: ' + videoAnalysis.ai_confidence_original + '% → ' + videoAnalysis.ai_confidence + '% (' + videoAnalysis.verdict + ')');
              
              if (videoAnalysis.ai_adjustments && videoAnalysis.ai_adjustments.length > 0) {
                console.log('   Adjustments: ' + videoAnalysis.ai_adjustments.join(', '));
              }
              
            } catch (rescueErr) {
              console.error('⚠️ Video analysis enhancement error:', rescueErr.message);
            }
          }
        } catch (err) {
          console.error('⚠️ Video analysis error:', err.message);
          videoAnalysis = { error: err.message };
        }
      }

      // AI Generator Detection (Sora, Runway, Pika, Kling, Midjourney, DALL-E, etc.)

     
      let generatorDetection = null;
      try {
        console.log('🔍 Running AI generator detection...');
        const generatorDetector = new AIGeneratorDetector();
        
        if (kind === 'video' && videoAnalysis && videoAnalysis.success) {
          generatorDetection = await generatorDetector.analyzeVideo(
            videoAnalysis.frames || [],
            videoAnalysis.analysis?. temporalAnalysis || null,
            videoAnalysis.metadata || {}
          );
          console.log(`✅ Generator detection: ${generatorDetection.likelyGenerator} (${generatorDetection.confidence}%)`);
        } else if (kind === 'image' && aiDetection) {
          generatorDetection = await generatorDetector.analyzeImage(
            req.file.path,
            aiDetection,
            {}
          );
          console.log(`✅ Generator detection: ${generatorDetection.likelyGenerator} (${generatorDetection.confidence}%)`);
        }
      } catch (err) {
        console.error('⚠️ Generator detection error:', err.message);
        generatorDetection = { error: err.message };
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
        ip_address: ipAddress,
        polygon_block_number: polygonVerification?.block_number || null,
        polygon_tx_hash: polygonVerification?.transaction_hash || null,
        polygon_timestamp: polygonVerification?.timestamp || null,
        bitcoin_proof_status: blockchainVerification?.status || null,
        bitcoin_submitted_at: blockchainVerification?.submitted_at || null
      });
    } catch (err) {
      console.error('⚠️ Database save error:', err.message);
    }

    // ============================================================================
    // SCREENSHOT DETECTION - Runs for ALL images (moved outside EXIF block)
    // ============================================================================
    if (kind === 'image' && !screenshotDetection) {
      try {
        console.log('📱 Checking for screenshot...');
        const imgMeta = await sharp(req.file.path).metadata();
        screenshotDetection = detectScreenshot({
          width: imgMeta.width,
          height: imgMeta.height,
          format: imgMeta.format,
          exif: exifData,
          colorProfile: imgMeta.icc ? 'sRGB' : null,
          noiseLevel: null,
          filename: req.file.originalname
        });

        if (screenshotDetection.is_screenshot) {
          console.log(`📱 Screenshot detected: ${screenshotDetection.detected_device || 'Unknown device'} (${screenshotDetection.confidence}%)`);
          console.log(`   Indicators: ${screenshotDetection.indicators.slice(0, 2).join(', ')}`);
          
          // Add screenshot caveat to AI detection
          if (aiDetection && !aiDetection.error) {
            const adjustment = getScreenshotVerdictAdjustment(screenshotDetection);
            
            aiDetection.screenshot_caveat = true;
            aiDetection.screenshot_severity = adjustment.severity;
            aiDetection.adjustments = aiDetection.adjustments || [];
            aiDetection.adjustments.push(
              `Screenshot detected (${screenshotDetection.confidence}% confidence, ${adjustment.severity} severity): ` +
              `AI detection analyzes the screenshot, not original content`
            );
            
            aiDetection.warnings = aiDetection.warnings || [];
            if (adjustment.add_warning) {
              aiDetection.warnings.push(adjustment.add_warning);
            }
            
            console.log(`📱 Screenshot caveat added (severity: ${adjustment.severity})`);
          }
        } else {
          console.log('📱 Not a screenshot');
        }
      } catch (err) {
        console.error('⚠️ Screenshot detection error:', err.message);
      }
    }
    // ============================================================================

    // Await blockchain results before sending response
    if (blockchainPromise) {
      blockchainVerification = await blockchainPromise;
    }
    if (polygonPromise) {
      polygonVerification = await polygonPromise;
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
      blockchain_verification: blockchainVerification,  
      polygon_verification: polygonVerification,
      ai_detection: aiDetection,
      ...(screenshotDetection && { screenshot_detection: screenshotDetection }),
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
          ...(audioAIDetection && { audio_ai_detection: audioAIDetection }),
          ...(audioSpectralAnalysis && { audio_spectral_analysis: audioSpectralAnalysis })
      }),  
      ...(kind === 'image' && phash && {
        phash: phash,
        similar_images: similarImages,
      }),
      ...(kind === 'video' && videoAnalysis && {
        video_analysis: videoAnalysis
      }),
      ...(generatorDetection && { generator_detection: generatorDetection }),
      ...(kind === 'image' && googleVisionResult && { google_vision: googleVisionResult }),
      ...(kind === 'image' && weatherVerification && { weather_verification: weatherVerification }),
      ...(kind === 'image' && landmarkVerification && { landmark_verification: landmarkVerification }),
      ...(cameraVerification && { camera_verification: cameraVerification }),
      ...(shadowPhysicsResult && { shadow_physics: shadowPhysicsResult }),
      ...(platformDetection && { platform_detection: platformDetection }),
      ...(deepfakeAnalysis && { deepfake_detection: deepfakeAnalysis }),
      ...(authorityResult && authorityResult.authorityDetected && { authority_detection: authorityResult }),
      ...(reverseSearchResults && { reverse_image_search: reverseSearchResults }),
      //...(stockPhotoResult && { stock_photo_detection: stockPhotoResult }),
      // C2PA/Blockchain verification (Phase 1 Step 3)
      c2pa_verification: await (async () => {
        try {
          console.log('🔐 Running C2PA verification...');
          const c2paResult = await c2paVerification.verifyContent(
            req.file.path,
            kind  // 'image', 'video', or 'audio'
          );
          
          if (c2paResult.has_c2pa_credentials) {
            console.log(`✅ C2PA credentials found: ${c2paResult.credentials_valid ? 'VALID' : 'INVALID'} (+${c2paResult.confidence_boost}%)`);
          } else {
            console.log('ℹ️ No C2PA credentials found');
          }
          
          return c2paResult;
        } catch (err) {
          console.error('⚠️ C2PA verification error:', err.message);
          return {
            has_c2pa_credentials: false,
            credentials_valid: false,
            confidence_boost: 0,
            error: err.message,
            errors: []
          };
        }
      })(),
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
              ...(shadowPhysicsResult && { shadow_physics: shadowPhysicsResult }),
              ...(reverseSearchResults && { reverse_image_search: reverseSearchResults }),
            };
          console.log('📊 Calculating confidence score...');
          const score = ConfidenceScoring.calculateConfidenceScore(confidenceData);
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
    // Add blockchain columns
    console.log('🔨 Adding blockchain columns...');
    await db.query(`
      ALTER TABLE verifications 
      ADD COLUMN IF NOT EXISTS polygon_block_number INTEGER,
      ADD COLUMN IF NOT EXISTS polygon_tx_hash VARCHAR(66),
      ADD COLUMN IF NOT EXISTS polygon_timestamp TIMESTAMP,
      ADD COLUMN IF NOT EXISTS bitcoin_proof_status VARCHAR(50),
      ADD COLUMN IF NOT EXISTS bitcoin_submitted_at TIMESTAMP
    `);
    await db.query(`ALTER TABLE verifications ALTER COLUMN bitcoin_proof_status TYPE VARCHAR(50)`);
    await db.query(`ALTER TABLE verifications ALTER COLUMN phash TYPE VARCHAR(64)`);
    console.log('✅ Blockchain columns added');
    
    res.json({ success: true, message: 'Migration complete!' });
  } catch (err) {
    console.error('❌ Migration failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
// Force redeploy to pick up new API key