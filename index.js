require('dotenv').config();
const express = require('express');
const mime = require('mime-types');
const sharp = require('sharp');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const db = require('./db-minimal');
const { searchByFingerprint, saveVerification } = require('./search');
const c2paVerification = require('./services/c2pa-verification');
const shadowPhysics = require('./services/shadow-physics-verification');
const reverseImageSearch = require('./services/reverse-image-search');
const videoReverseSearch = require('./services/video-reverse-search');
const deepfakeDetection = require('./services/deepfake-detection');
const stockPhotoDetection = require('./services/stock-photo-detection');
const CameraValidation = require('./services/camera-validation');
const AudioSpectralAnalysis = require('./services/audio-spectral-analysis');
const EnhancedAIDetector = require('./services/enhanced-ai-detector');
const JPEGForensics = require('./services/jpeg-forensics');
// REMOVED: const BlockchainService = require('./services/opentimestamps-service');
const PolygonService = require('./services/polygon-timestamp');
const BaseService = require('./services/base-timestamp');
const EthereumService = require('./services/ethereum-timestamp');
const sightengineDetector = require('./services/sightengine-ai-detection');
const PlatformDetection = require('./services/platform-signature-detection');
const FeatureLogger = require('./services/feature-logger');
const ProvenanceService = require('./services/provenance-service');
const VoiceEmbeddingService = require('./services/voice-embedding-service');
const VideoThumbnailService = require('./services/video-thumbnail-service');
const tvCorroboration = require('./services/tv-corroboration');
const { buildProvenanceTimeline } = require('./services/provenance-timeline');
const FingerprintDBService = require('./services/fingerprint-db-service');
const { searchInternal, shouldSearchExternal } = require('./services/privacy-safe-search');
const { authenticateApiKey, getUserAccountId } = require('./api-key-middleware');
const { searchNewsDatabase, formatNewsSourceResponse, getNewsStats } = require('./services/news-source-search');
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
const { analyzeCrossReference, analyzeTemporalConsistency, cacheExternalSearchResults, analyzeExternalSources, getCachedSearchBySha256 } = require('./services/fingerprint-index');
const FingerprintCachePG = require('./services/fingerprint-cache-pg');
const ConfidenceScoring = require('./services/confidence-scoring');
const ChromaprintService = require('./services/chromaprint');
const VideoAudioFingerprint = require('./services/video-audio-fingerprint');
const acoustid = require('./acoustid-integration');
const WeatherVerification = require('./services/weather-verification');
const LandmarkVerification = require('./services/landmark-verification');
const PortraitModeDetection = require('./services/enhanced-portrait-detection');
const { verifyCameraModel, detectHistoricalPhoto } = require('./services/camera-model-verification');
const AIGeneratorDetector = require('./services/ai-generator-detector');
// View engine for batch dashboard
const HEICDetection = require('./services/heic-detection');
const SensorNoiseAnalysis = require('./services/sensor-noise-analysis');
const LivePhotoValidator = require('./services/live-photo-validator');
const CompressionSignature = require('./services/compression-signature-detector');
const { detectScreenshot, getScreenshotVerdictAdjustment } = require('./screenshot-detection');

const app = express();
// ============================================
// TIER-BASED BLOCKCHAIN TIMESTAMPING
// ============================================
// Tiers: standard (Polygon), premium (Base), enterprise (ETH L1)
async function timestampByTier(fingerprint, filename, tier = 'standard', accountTier = 'standard') {
  // Use account tier if no explicit tier specified
  const effectiveTier = tier || accountTier;
  
  const results = {
    polygon: null,
    base: null,
    ethereum: null
  };
  
  // Standard tier: Polygon only (default)
  console.log("🔷 Timestamping to Polygon...");
  try {
    results.polygon = await PolygonService.timestamp(fingerprint, filename);
    if (results.polygon.success) {
      console.log(`✅ Polygon: Block ${results.polygon.block_number}`);
    }
  } catch (err) {
    console.error("⚠️ Polygon failed:", err.message);
    results.polygon = { success: false, error: err.message };
  }
  
  // Premium tier: Also timestamp to Base
  if (effectiveTier === 'premium' || effectiveTier === 'enterprise') {
    console.log("🔵 Timestamping to Base...");
    try {
      results.base = await BaseService.timestamp(fingerprint, filename);
      if (results.base.success) {
        console.log(`✅ Base: Block ${results.base.block_number}`);
      }
    } catch (err) {
      console.error("⚠️ Base failed:", err.message);
      results.base = { success: false, error: err.message };
    }
  }
  
  // Enterprise tier: Also timestamp to Ethereum L1
  if (effectiveTier === 'enterprise') {
    console.log("⟠ Timestamping to Ethereum L1...");
    try {
      results.ethereum = await EthereumService.timestamp(fingerprint, filename);
      if (results.ethereum.success) {
        console.log(`✅ Ethereum L1: Block ${results.ethereum.block_number}`);
      }
    } catch (err) {
      console.error("⚠️ Ethereum L1 failed:", err.message);
      results.ethereum = { success: false, error: err.message };
    }
  }
  
  return results;
}

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

app.get("/health", async (req, res) => {
  let polygonStatus = { enabled: false };
  
  try {
    const PolygonService = require('./services/polygon-timestamp');
    if (PolygonService.enabled) {
      const balance = await PolygonService.getBalance();
      const balanceNum = parseFloat(balance) || 0;
      polygonStatus = {
        enabled: true,
        wallet: PolygonService.wallet?.address || 'unknown',
        balance_matic: balanceNum.toFixed(4),
        balance_usd: (balanceNum * 0.45).toFixed(2),
        status: balanceNum < 0.1 ? 'LOW_BALANCE' : 'ok',
        warning: balanceNum < 0.1 ? 'Polygon wallet balance is low. Please add MATIC.' : null
      };
    }
  } catch (error) {
    polygonStatus = { enabled: false, error: error.message };
  }
  
  let baseStatus = { enabled: false };
  
  try {
    if (BaseService.enabled) {
      const balance = await BaseService.getBalance();
      const balanceNum = parseFloat(balance) || 0;
      baseStatus = {
        enabled: true,
        wallet: BaseService.wallet?.address || 'unknown',
        balance_eth: balanceNum.toFixed(6),
        balance_usd: (balanceNum * 3500).toFixed(2),
        status: balanceNum < 0.001 ? 'LOW_BALANCE' : 'ok',
        warning: balanceNum < 0.001 ? 'Base wallet balance is low. Please add ETH.' : null
      };
    }
  } catch (error) {
    baseStatus = { enabled: false, error: error.message };
  }

  let ethereumStatus = { enabled: false };
  
  try {
    if (EthereumService.enabled) {
      const balance = await EthereumService.getBalance();
      const balanceNum = parseFloat(balance) || 0;
      const gasCost = await EthereumService.estimateGasCost();
      ethereumStatus = {
        enabled: true,
        wallet: EthereumService.wallet?.address || 'unknown',
        balance_eth: balanceNum.toFixed(6),
        balance_usd: (balanceNum * 3500).toFixed(2),
        estimated_tx_cost: gasCost ? {
          eth: gasCost.estimated_eth,
          usd: gasCost.estimated_usd,
          gas_price_gwei: gasCost.gas_price_gwei
        } : null,
        status: balanceNum < 0.01 ? 'LOW_BALANCE' : 'ok',
        warning: balanceNum < 0.01 ? 'Ethereum wallet balance is low. Please add ETH for enterprise timestamping.' : null
      };
    }
  } catch (error) {
    ethereumStatus = { enabled: false, error: error.message };
  }

  res.json({ 
    status: "ok", 
    uptime: process.uptime(),
    polygon: polygonStatus,
    base: baseStatus,
    ethereum: ethereumStatus,
    timestamp: new Date().toISOString()
  });
});

app.get('/my-account', authenticateApiKey, getUserAccountId);

app.get("/ml-features/stats", async (req, res) => {
  try {
    const stats = await FeatureLogger.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/ml-features/export", async (req, res) => {
  try {
    const { start_date, end_date, limit } = req.query;
    const csv = await FeatureLogger.exportCsv({
      startDate: start_date,
      endDate: end_date,
      limit: limit ? parseInt(limit) : null
    });
    if (!csv) {
      return res.status(404).json({ error: 'No feature data available' });
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=ml-features.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// PROVENANCE ENDPOINTS
// ============================================================================
app.get("/provenance/stats", async (req, res) => {
  try {
    const stats = await ProvenanceService.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/provenance/:hash", async (req, res) => {
  try {
    const { hash } = req.params;
    if (!hash || hash.length < 16) {
      return res.status(400).json({ error: 'Invalid hash' });
    }
    const timeline = await ProvenanceService.getTimeline(hash);
    res.json(timeline);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/provenance/:hash/similar", async (req, res) => {
  try {
    const { hash } = req.params;
    const threshold = parseInt(req.query.threshold) || 85;
    
    // Get the pHash for this fingerprint
    const result = await db.query(
      'SELECT phash FROM verifications WHERE fingerprint = $1 LIMIT 1',
      [hash]
    );
    
    if (result.rows.length === 0 || !result.rows[0].phash) {
      return res.status(404).json({ error: 'Fingerprint not found or no pHash available' });
    }
    
    const similar = await ProvenanceService.findSimilarContent(
      result.rows[0].phash,
      hash,
      threshold
    );
    
    res.json({
      fingerprint: hash,
      threshold,
      matches: similar.length,
      similar_content: similar
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ============================================================================
// CONTRIBUTE ENDPOINT - Chrome Extension Fingerprint Collection
// ============================================================================
app.post('/contribute', async (req, res) => {
  try {
    const { fingerprints, source, version } = req.body;
    
    if (!fingerprints || !Array.isArray(fingerprints)) {
      return res.status(400).json({ success: false, error: 'Invalid fingerprints array' });
    }
    
    if (fingerprints.length === 0) {
      return res.json({ success: true, saved: 0, received: 0 });
    }
    
    if (fingerprints.length > 100) {
      return res.status(400).json({ success: false, error: 'Maximum 100 fingerprints per request' });
    }
    
    let saved = 0;
    let duplicates = 0;
    
    for (const fp of fingerprints) {
      if (!fp.phash || typeof fp.phash !== 'string' || fp.phash.length < 16) continue;
      
      const platform = (fp.platform || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '');
      
      // Generate source_id from URL or create unique ID
      const sourceId = fp.source_url 
        ? fp.source_url.split('/').pop().substring(0, 250) 
        : `ext_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      try {
        const result = await db.query(`
          INSERT INTO media_hashes (phash, source, source_id, source_url, author_handle, post_created_at, ingested_at)
          VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
          ON CONFLICT (source, source_id) DO NOTHING
          RETURNING id
        `, [fp.phash, platform, sourceId, fp.source_url || null, fp.author_handle || null]);
        
        if (result.rowCount > 0) saved++;
        else duplicates++;
      } catch (err) {
        console.error('Contribute insert error:', err.message);
      }
    }
    
    console.log(`[Contribute] source=${source} version=${version} received=${fingerprints.length} saved=${saved} duplicates=${duplicates}`);
    
    res.json({ success: true, saved, duplicates, received: fingerprints.length });
    
  } catch (err) {
    console.error('Contribute endpoint error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

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
    
    // Create external search cache table (PostgreSQL - replaces SQLite)
    console.log('🔨 Creating external search cache table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS external_search_cache (
        id SERIAL PRIMARY KEY,
        fingerprint VARCHAR(64) NOT NULL,
        service VARCHAR(20) NOT NULL,
        total_matches INTEGER DEFAULT 0,
        match_urls JSONB,
        raw_response JSONB,
        queried_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        UNIQUE(fingerprint, service)
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_esc_fingerprint ON external_search_cache(fingerprint)');

    // Create content labels table
    console.log('🔨 Creating content labels table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS content_labels (
        id SERIAL PRIMARY KEY,
        fingerprint VARCHAR(64) NOT NULL,
        label VARCHAR(255) NOT NULL,
        confidence REAL DEFAULT 0,
        source VARCHAR(50) DEFAULT 'google_vision',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(fingerprint, label, source)
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_cl_fingerprint ON content_labels(fingerprint)');

    // Create external matches table
    console.log('🔨 Creating external matches table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS external_matches (
        id SERIAL PRIMARY KEY,
        fingerprint VARCHAR(64) NOT NULL,
        service VARCHAR(20),
        match_url TEXT,
        match_domain VARCHAR(255),
        match_title TEXT,
        match_date TIMESTAMP,
        domain_type VARCHAR(50),
        discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(fingerprint, service, match_url)
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_em_fingerprint ON external_matches(fingerprint)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_em_domain_type ON external_matches(domain_type)');
    
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
// HYBRID CAMERA RESCUE FUNCTIONS
// ============================================
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
    if (data.noiseIndicators?.some(i => i.toLowerCase().includes('sensor pattern') || i.toLowerCase().includes('camera'))) {
      score += 20;
      indicators.push(`Sensor noise matches camera pattern (${data.sensorNoiseConfidence}%)`);
    }
    
    if (data.aiNoiseAnomalies !== undefined && data.aiNoiseAnomalies < 20) {
      score += 10;
      indicators.push(`Low AI noise anomalies: ${data.aiNoiseAnomalies}%`);
    }
  }
  
  // 3. Compression signature matches known manufacturer
  if (data.compressionAnalyzed && data.manufacturerSignature) {
    const sig = data.manufacturerSignature.toLowerCase();
    const make = (data.cameraVerification?.details?.make || '').toLowerCase();
    
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

async function applyHybridCameraRescue(aiDetection, verificationData, callExternalAPI) {
  const originalConfidence = aiDetection.ai_confidence;
  
  if (originalConfidence < 50) {
    return aiDetection;
  }
  
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
  
  if (cameraScore.score >= 40) {
    let reduction;
    if (cameraScore.score >= 95) {
      reduction = 70;
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
    
    if (adjustedConfidence > 50 && typeof callExternalAPI === 'function') {
      console.log(`   🌐 Confidence still ${adjustedConfidence}% - calling external API for tiebreaker...`);
      
      try {
        const externalResult = await callExternalAPI();
        
        if (externalResult && externalResult.confidence !== undefined) {
          const externalConfidence = externalResult.confidence;
          
          console.log(`   🌐 External API result: ${externalResult.isAI ? 'AI' : 'Authentic'} (${externalConfidence.toFixed(1)}%)`);
          
          aiDetection.external_tiebreaker = {
            provider: externalResult.provider || 'sightengine',
            confidence: externalConfidence,
            result: externalResult.isAI ? 'ai_generated' : 'authentic',
            used_as_tiebreaker: true
          };
          
          if (!externalResult.isAI && externalConfidence < 50) {
            adjustedConfidence = Math.min(adjustedConfidence, externalConfidence);
            console.log(`   ✅ External confirms authentic - final: ${adjustedConfidence}%`);
          } else if (externalResult.isAI && externalConfidence > 70) {
            adjustedConfidence = Math.max(adjustedConfidence, originalConfidence - 10);
            console.log(`   ⚠️ External confirms AI - final: ${adjustedConfidence}%`);
          } else {
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
    
    aiDetection.ai_confidence = adjustedConfidence;
    aiDetection.likely_ai_generated = adjustedConfidence >= 50;
    aiDetection.verdict = adjustedConfidence >= 70 ? 'AI-GENERATED IMAGE' : 
                          adjustedConfidence >= 50 ? 'LIKELY AI-GENERATED IMAGE' :
                          adjustedConfidence >= 30 ? 'UNCERTAIN IMAGE' : 'VERIFIED IMAGE';
    
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

// ============================================
// REMOTE FILE VERIFY ENDPOINT (Full Featured)
// ============================================
// ============================================
// REMOTE FILE VERIFY ENDPOINT (for Base44, Bubble, etc.)
// ============================================
// ============================================
// REMOTE FILE VERIFY ENDPOINT (Full Featured)
// Identical analysis to /verify endpoint
// ============================================
app.post('/verify-remote', authenticateApiKey, async (req, res) => {
  const requestId = Date.now();
  console.log(`\n📡 [${requestId}] Remote File Verification Request`);
  
  const { file_url } = req.body;
  
  if (!file_url) {
    return res.status(400).json({ error: 'No file_url provided' });
  }
  
  console.log(`🔗 File URL: ${file_url}`);
  
  // Initialize all variables that will be used throughout
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
  let tempFilePath = null;
  let jpegForensics = null;
  let softwareAnalysis = null;
  let imgMeta = null;
  let phash = null;
  let phashRegions = null;
  let videoAudioFingerprint = null;
  let videoAudioMatches = null;
  let voiceEmbedding = null;
  let voiceMatches = null;
  
  try {
    // ============================================
    // STEP 1: Download file from URL
    // ============================================
    const tempDir = '/tmp';
    const urlObj = new URL(file_url);
    const ext = path.extname(urlObj.pathname) || '.jpg';
    const tempFileName = `remote_${requestId}${ext}`;
    tempFilePath = path.join(tempDir, tempFileName);
    
    console.log(`📥 Downloading to: ${tempFilePath}`);
    
    // Download the file with redirect support
    await new Promise((resolve, reject) => {
      const protocol = file_url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(tempFilePath);
      
      const makeRequest = (url) => {
        protocol.get(url, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            const redirectUrl = response.headers.location;
            makeRequest(redirectUrl);
          } else {
            response.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
          }
        }).on('error', (err) => {
          fs.unlink(tempFilePath, () => {});
          reject(err);
        });
      };
      
      makeRequest(file_url);
    });
    
    const stats = fs.statSync(tempFilePath);
    console.log(`✅ Downloaded: ${tempFileName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    
    // Create mock file object to match /verify's req.file structure
    const mockFile = {
      path: tempFilePath,
      originalname: tempFileName,
      size: stats.size,
      mimetype: mime.lookup(tempFileName) || 'application/octet-stream'
    };
    
    // ============================================
    // STEP 2: Generate fingerprint and check history
    // ============================================
    const buf = fs.readFileSync(tempFilePath);
    const fingerprint = crypto.createHash('sha256').update(buf).digest('hex');
    
    // Search database for existing verifications
    let searchResults = { found: false, is_first_verification: true };
    try {
      searchResults = await searchByFingerprint(fingerprint);
      if (searchResults.found) {
        console.log(`✅ Previously verified: ${searchResults.total_verifications} times`);
      }
    } catch (err) {
      console.error('⚠️ Database search error:', err.message);
    }
// ============================================
    // STEP 2.1: Privacy-Safe Internal Search
    // ============================================
    let internalSearchResults = null;
    let externalSearchRecommendation = { recommended: true, skip_tineye: false, skip_google: false };
    try {
      console.log('🔍 Running privacy-safe internal search...');
      const currentAccountId = req.account?.id || null;
      internalSearchResults = await searchInternal(fingerprint, null, currentAccountId);
      externalSearchRecommendation = shouldSearchExternal(internalSearchResults);
      
      if (internalSearchResults.found_in_database) {
        console.log('   ✅ Found in internal database');
        if (internalSearchResults.exact_match) {
          console.log('   📊 Verified ' + internalSearchResults.exact_match.times_verified + ' times');
        }
        if (internalSearchResults.crawled_sources?.total_matches > 0) {
          console.log('   🌐 Found on ' + internalSearchResults.crawled_sources.platforms_found + ' platforms');
        }
      }
      
      if (!externalSearchRecommendation.recommended) {
        console.log('   ⏭️ Skipping external search: ' + externalSearchRecommendation.reason);
      }
    } catch (err) {
      console.error('⚠️ Privacy-safe search error:', err.message);
    }
// ============================================
 // STEP 2.5: Provenance check - MOVED to after pHash generation (Step 17C)
    // The proper provenance check with pHash comparison happens later in the flow
    let provenanceResult = null;
    // Note: provenanceResult is populated in Step 17C after pHash is generated
   
    // STEP 3: Blockchain timestamping (if new)
    // ============================================
    let polygonVerification = null;
    let baseVerification = null;
    let ethereumVerification = null;
    let blockchainResults = null;
    
    if (!searchResults.found) {
      // Get account tier (default to standard)
      const accountTier = req.headers['x-account-tier'] || req.account?.tier || 'standard';
      blockchainResults = await timestampByTier(fingerprint, tempFileName, null, accountTier);
      polygonVerification = blockchainResults.polygon;
      baseVerification = blockchainResults.base;
      ethereumVerification = blockchainResults.ethereum; 
    } else {
      console.log("⏭️ Skipping blockchain - already timestamped");
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
      // Check for existing Base verification
      if (searchResults.base_block_number) {
        baseVerification = {
          success: true,
          status: 'previously_timestamped',
          skipped: true,
          block_number: searchResults.base_block_number,
          transaction_hash: searchResults.base_tx_hash,
          timestamp: searchResults.base_timestamp
        };
      }
      // Check for existing Ethereum verification
      if (searchResults.ethereum_block_number) {
        ethereumVerification = {
          success: true,
          status: 'previously_timestamped',
          skipped: true,
          block_number: searchResults.ethereum_block_number,
          transaction_hash: searchResults.ethereum_tx_hash,
          timestamp: searchResults.ethereum_timestamp
        };
      }
    }

    // ============================================
    // STEP 4: Determine file type
    // ============================================
    const dm = mockFile.mimetype || mime.lookup(mockFile.originalname) || 'application/octet-stream';
    const isImg = /^image\//i.test(dm) || /\.(png|jpe?g|gif|webp)$/i.test(mockFile.originalname);
    const isVid = /^video\//i.test(dm) || /\.(mp4|mov|avi|mkv)$/i.test(mockFile.originalname);
    const isAud = /^audio\//i.test(dm) || /\.(mp3|wav|m4a|flac)$/i.test(mockFile.originalname);
    const kind = isImg ? 'image' : (isVid ? 'video' : (isAud ? 'audio' : 'unknown'));

    // ============================================
// THUMBNAIL EXTRACTION FOR VIDEOS
// ============================================
let videoThumbnail = null;
if (kind === 'video') {
  try {
    console.log('🖼️ Extracting video thumbnail...');
    videoThumbnail = await VideoThumbnailService.extractThumbnail(tempFilePath, {
      width: 480,
      quality: 85
    });
    if (videoThumbnail.success) {
      console.log(`✅ Thumbnail extracted: ${videoThumbnail.dimensions.width}x${videoThumbnail.dimensions.height}`);
    }
  } catch (err) {
    console.error('⚠️ Thumbnail extraction error:', err.message);
  }
}
    // ============================================
    // STEP 2B: Start Reverse Image Search (async - runs in parallel)
    // ============================================
    let reverseSearchPromise = null;
    if (kind === 'image' && !externalSearchRecommendation.skip_tineye) {
      console.log('🔍 Starting reverse image search (async)...');
      reverseSearchPromise = reverseImageSearch.search(buf, {
        services: ['tineye', 'bing'],
        includeAnalysis: true
     }).catch(err => {
        console.error('⚠️ Reverse image search error:', err.message);
        return { search_performed: false, error: err.message };
      });
    } else if (kind === 'image' && externalSearchRecommendation.skip_tineye) {
      console.log('⏭️ Skipping reverse image search (sufficient internal results)');
      // Try to get cached external results
      const cachedExternal = await FingerprintCachePG.getCachedExternalSearch(fingerprint);
      if (cachedExternal) {
        console.log('📦 Using cached external search results');
        reverseSearchPromise = Promise.resolve({ 
          search_performed: true, 
          from_cache: true,
          reason: externalSearchRecommendation.reason,
          ...cachedExternal
        });
      } else {
        reverseSearchPromise = Promise.resolve({ 
          search_performed: false, 
          skipped: true, 
          reason: externalSearchRecommendation.reason 
        });
      }
    }
    // ============================================
    // Start Google Vision Analysis (async - runs in parallel)
    // ============================================
    let googleVisionPromise = null;
    if (kind === 'image') {
      console.log('👁️ Starting Google Vision analysis (async)...');
      googleVisionPromise = analyzeImage(tempFilePath).catch(err => {
        console.error('⚠️ Google Vision error:', err.message);
        return { error: err.message };
      });
    }

    // ============================================
    // STEP 5: Audio processing (if audio file)
    // ============================================
    let chromaprint = null;
    let audioDuration = null;
    let musicIdentification = null;
    let audioSpectralAnalysis = null;
    
    if (kind === 'audio') {
      try {
        console.log('🎵 Generating Chromaprint for audio...');
        const chromaprintResult = await ChromaprintService.generateFingerprint(tempFilePath);
        if (chromaprintResult.success) {
          chromaprint = chromaprintResult.fingerprint;
          audioDuration = chromaprintResult.duration;
          console.log('✅ Chromaprint generated');
        }
      } catch (err) {
        console.error('⚠️ Chromaprint error:', err.message);
      }

      // Music identification
      if (chromaprint && acoustid.isConfigured()) {
        try {
          console.log('🎵 Attempting music identification...');
          musicIdentification = await acoustid.identifyAudio(tempFilePath);
          if (musicIdentification.identified) {
            console.log(`✅ Identified: ${musicIdentification.recording.title} - ${musicIdentification.recording.artist}`);
          } else {
            console.log('ℹ️ Music not identified in database');
          }
        } catch (err) {
          console.error('⚠️ Music identification error:', err.message);
          musicIdentification = { identified: false, error: err.message };
        }
      }

      // Audio spectral analysis
      try {
        console.log('🔊 Running audio spectral analysis...');
        audioSpectralAnalysis = await AudioSpectralAnalysis.analyze(tempFilePath);
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

    // ============================================
    // STEP 6: Generate pHash for images
    // ============================================
    // phash variable declared at outer scope (line 874)
    let similarImages = null;
    
    if (kind === 'image') {
      try {
        console.log('🔍 Generating pHash for image...');
        const phashResult = await generatePHash(tempFilePath);
        if (phashResult.success) {
          phash = phashResult.phash;
          console.log('✅ pHash generated:', phash);
    // Generate multi-region pHashes for crop-resistant matching
    try {
    phashRegions = await ProvenanceService.generateAllRegionHashes(tempFilePath);
    } catch (regionErr) {
    console.log(`⚠️ Region pHash generation failed: ${regionErr.message}`);
    }
          // Search for similar images
          if (db) {
            const similar = await searchSimilarImages(phash, db);
            if (similar.length > 0) {
              similarImages = {
                found: true,
                count: similar.length,
                matches: similar.slice(0, 5)
              };
              console.log(`✅ Found ${similar.length} similar images`);
            }
          }
        }
      } catch (err) {
        console.error('⚠️ pHash error:', err.message);
      }
    }

    // ============================================
    // STEP 7: AI Detection for images
    // ============================================
    let aiDetection = null;
    
    if (kind === 'image') {
      try {
        console.log('🤖 Running local AI detection...');
        const localResult = await detectAIGeneration(tempFilePath);
        
        // Smart routing: decide if we need Sightengine
        let needsExternalCheck = false;
        let confidenceLevel = 'high';
        
        if (localResult.ai_confidence >= 20 && localResult.ai_confidence < 80) {
          needsExternalCheck = true;
          confidenceLevel = 'uncertain';
          console.log(`⚠️ Local confidence: ${localResult.ai_confidence}% - calling Sightengine for verification`);
        }
        
        let finalResult = localResult;
        
        // Call Sightengine if needed
        if (needsExternalCheck && process.env.SIGHTENGINE_API_USER) {
          try {
            const sightengineResult = await sightengineDetector.detectAI(tempFilePath);
            console.log(`✅ Sightengine result: ${sightengineResult.isAI ? 'AI' : 'Authentic'} (${(sightengineResult.confidence * 100).toFixed(1)}%)`);
            
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
          ai_confidence_raw: finalResult.ai_confidence_raw || finalResult.ai_confidence,
          indicators: finalResult.indicators || [],
          warnings: [],
          recommendations: [],
          ensemble_results: finalResult.individual_results || null,
          ensemble_agreement: finalResult.agreement || null,
          detector_count: finalResult.detector_count || 1,
          forensic_analysis: {
            manipulation_detected: finalResult.ai_confidence >= 50,
            manipulation_confidence: finalResult.ai_confidence,
            ela_performed: finalResult.forensic_signals?.ela_performed || false,
            compression_quality: finalResult.forensic_signals?.compression_quality || finalResult.individual_results?.jpeg?.details?.quality || 0,
            double_compressed: finalResult.forensic_signals?.double_compressed || finalResult.individual_results?.jpeg?.details?.doubleCompressed || false,
            noise_level: finalResult.forensic_signals?.noise_level || finalResult.individual_results?.jpeg?.details?.noise || 'unknown'
          },
          forensic_signals: finalResult.forensic_signals || null,
          verdict: finalResult.likely_ai_generated ? 'AI-GENERATED IMAGE' : 'LIKELY REAL IMAGE',
          analysis_time_ms: 0,
          routing_decision: finalResult.routing_decision || 'unknown',
          confidence_source: finalResult.confidence_source || 'local',
          external_verification: finalResult.external_verification || null,
          local_result: finalResult.local_result || null
        };
        console.log(`✅ Ensemble detection: ${aiDetection.verdict} (${aiDetection.ai_confidence}%)`);
        
      } catch (err) {
        console.error('⚠️ AI detection error:', err.message);
        aiDetection = { error: err.message };
      }
    }
// ============================================
    // STEP 7B: JPEG Forensics Analysis
    // DISABLED: Now runs inside ensemble-ai-detection.js
    // ============================================
    // Forensics data comes from aiDetection.forensic_signals
    if (aiDetection && aiDetection.forensic_signals) {
      jpegForensics = {
        ela_analysis: { performed: aiDetection.forensic_signals.ela_performed },
        compression_analysis: { 
          double_compressed: aiDetection.forensic_signals.double_compressed,
          quality_estimate: aiDetection.forensic_signals.compression_quality
        },
        noise_analysis: { noise_level: aiDetection.forensic_signals.noise_level },
        clone_detection: { detected: aiDetection.forensic_signals.clone_detected },
        verdict: aiDetection.likely_ai_generated ? 'AI-GENERATED' : 'LIKELY AUTHENTIC'
      };
    }
   // ============================================
    // STEP 8: Google Vision Analysis (await async result)
    // ============================================
    let googleVisionResult = null;
    if (kind === 'image' && googleVisionPromise) {
      console.log('👁️ Awaiting Google Vision results...');
      googleVisionResult = await googleVisionPromise;
      console.log('✅ Google Vision analysis complete');
    }

     // STEP 7: TV Corroboration (NEW)
    // ============================================
    let tvCorroborationResult = null;
    const { location, date, description, eventType } = req.body;
    
    const hasContext = location || description || eventType || 
                       (videoAnalysis && videoAnalysis.labels) ||
                       (googleVisionResult && googleVisionResult.labels);
    
    if (hasContext) {
      try {
        console.log(`📺 [${requestId}] Running TV corroboration...`);
        tvCorroborationResult = await tvCorroboration.search({
          claimedLocation: location || landmarkVerification?.location || null,
          claimedDate: date || exifData?.DateTimeOriginal || null,
          description: description || null,
          eventType: eventType || null,
          visualLabels: videoAnalysis?.labels || 
                        googleVisionResult?.labels || 
                        [],
          ocrText: googleVisionResult?.text || null,
          metadata: { exif: exifData }
        });
        
        if (tvCorroborationResult.found) {
          console.log(`📺 [${requestId}] Found ${tvCorroborationResult.resultCount} broadcast sources`);
        } else {
          console.log(`📺 [${requestId}] No broadcast coverage found`);
        }
      } catch (tvErr) {
        console.error(`⚠️ [${requestId}] TV corroboration error:`, tvErr.message);
        tvCorroborationResult = { 
          searched: false, 
          error: tvErr.message,
          note: 'Broadcast archive search failed'
        };
      }
    }

    // ============================================
    // STEP 9: Deepfake Detection
    // ============================================
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

    // ============================================
    // STEP 10: Authority Figure Detection
    // ============================================
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
      try {
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
      } catch (err) {
        console.error("⚠️ Authority adjustment error:", err.message);
      }
    }

    // ============================================
    // STEP 11: EXIF Extraction and Advanced Analysis
    // ============================================
    if (kind === 'image') {
      // Capture image metadata for ALL image formats (not just JPEG)
      try {
        imgMeta = await sharp(tempFilePath).metadata();
        const imgStats = await sharp(tempFilePath).stats();
        imgMeta.sharpness = imgStats.sharpness;
        imgMeta.entropy = imgStats.entropy;
        console.log(`📐 Image dimensions: ${imgMeta.width}x${imgMeta.height} (${imgMeta.format})`);
      } catch (metaErr) {
        console.log('⚠️ Could not get image metadata:', metaErr.message);
      }

      try {
        console.log('📍 Extracting GPS and date from EXIF...');
        const ExifParser = require('exif-parser');
        const exifBuffer = fs.readFileSync(tempFilePath);
        
        if (exifBuffer.length >= 12 && exifBuffer[0] === 0xFF && exifBuffer[1] === 0xD8) {
          try {
            const parser = ExifParser.create(exifBuffer);
            exifData = parser.parse().tags;

            // Portrait mode detection
            if (aiDetection && !aiDetection.error) {
              const portraitDetection = PortraitModeDetection.detectPortraitMode(exifData);
              if (portraitDetection.isPortraitMode || portraitDetection.isComputationalPhotography) {
                console.log(`📸 Computational photography detected: ${portraitDetection.confidence}% confidence`);
                console.log(`   Indicators: ${portraitDetection.indicators.slice(0, 3).join(", ")}`);
                aiDetection = PortraitModeDetection.adjustAIDetectionResults(aiDetection, portraitDetection);
                if (aiDetection.portrait_mode_adjustment?.applied) {
                  console.log(`   ✅ AI confidence adjusted: ${aiDetection.ai_confidence_raw}% → ${aiDetection.ai_confidence}%`);
                }
              }
            }

            // HEIC/HEVC Format Detection
            try {
              console.log('📱 Checking for HEIC/HEVC format...');
              const HEICDetection = require('./services/heic-detection');
              const heicDetection = await HEICDetection.detectHEIC(tempFilePath, exifData);
              if (heicDetection.wasHEIC) {
                console.log(`✅ HEIC detected: ${heicDetection.confidence}% confidence`);
                aiDetection = HEICDetection.adjustForHEIC(aiDetection, heicDetection);
              }
            } catch (err) {
              console.error('⚠️ HEIC detection error:', err.message);
            }

            // Sensor Noise Analysis
            try {
              console.log('🔬 Analyzing sensor noise patterns...');
              const SensorNoiseAnalysis = require('./services/sensor-noise-analysis');
              const noiseAnalysis = await SensorNoiseAnalysis.analyzeSensorNoise(tempFilePath);
              if (noiseAnalysis.has_sensor_noise || noiseAnalysis.ai_likelihood > 40) {
                console.log(`✅ Noise analysis complete:`);
                console.log(`   Camera sensor: ${noiseAnalysis.confidence}% | AI anomalies: ${noiseAnalysis.ai_likelihood}%`);
                aiDetection = SensorNoiseAnalysis.adjustForSensorNoise(aiDetection, noiseAnalysis, exifData);
              }
            } catch (err) {
              console.error('⚠️ Sensor noise analysis error:', err.message);
            }

            // Live Photo Validation
            try {
              console.log('🎬 Checking for Live Photo pairing...');
              const LivePhotoValidator = require('./services/live-photo-validation');
              const livePhotoValidation = await LivePhotoValidator.validateLivePhoto(tempFilePath, exifData);
              if (livePhotoValidation.is_live_photo) {
                console.log(`✅ Live Photo detected: ${livePhotoValidation.confidence}% confidence`);
                aiDetection = LivePhotoValidator.adjustForLivePhoto(aiDetection, livePhotoValidation);
              }
            } catch (err) {
              console.error('⚠️ Live Photo validation error:', err.message);
            }

            // Manufacturer Compression Signature
            try {
              console.log('🔍 Analyzing JPEG compression signature...');
              const CompressionSignature = require('./services/compression-signature-analysis');
              const compressionAnalysis = await CompressionSignature.analyzeCompressionSignature(tempFilePath, exifData);
              if (compressionAnalysis.manufacturer_detected || compressionAnalysis.ai_likelihood > 40) {
                console.log(`✅ Compression signature analyzed:`);
                console.log(`   Manufacturer: ${compressionAnalysis.manufacturer_detected || 'Generic'} (${compressionAnalysis.confidence}% match)`);
                aiDetection = CompressionSignature.adjustForCompressionSignature(aiDetection, compressionAnalysis);
              }
            } catch (err) {
              console.error('⚠️ Compression signature analysis error:', err.message);
            }

            console.log(`\n📊 FINAL AI CONFIDENCE: ${aiDetection.ai_confidence}% (started at ${aiDetection.ai_confidence_raw || 'unknown'}%)\n`);

           // Camera Model Verification
            try {
              imgMeta = await sharp(tempFilePath).metadata();
              // Also get stats for sharpness and entropy
              try {
                const imgStats = await sharp(tempFilePath).stats();
                imgMeta.sharpness = imgStats.sharpness;
                imgMeta.entropy = imgStats.entropy;
              } catch (statsErr) {
                console.log('⚠️ Could not get image stats:', statsErr.message);
              }
              cameraVerification = verifyCameraModel(exifData, { width: imgMeta.width, height: imgMeta.height });
              if (cameraVerification.camera_found) {
                console.log(`📷 Camera: ${cameraVerification.details.manufacturer} ${cameraVerification.details.recognized_model}`);
              }
              if (cameraVerification.warnings.length > 0) {
                console.log('⚠️ Camera warnings:', cameraVerification.warnings);
              }
              
              // Camera EXIF Validation Rescue
              if (cameraVerification.camera_found && cameraVerification.is_valid && aiDetection) {
                const camConf = cameraVerification.confidence || 0;
                if (camConf >= 80) {
                  const originalAI = aiDetection.ai_confidence;
                  const reduction = camConf === 100 ? 25 : 15;
                  aiDetection.ai_confidence = Math.max(0, aiDetection.ai_confidence - reduction);
                  aiDetection.adjustments = aiDetection.adjustments || [];
                  aiDetection.adjustments.push(`Camera EXIF rescue: ${cameraVerification.details.recognized_model} validated (${camConf}% confidence, -${reduction}%)`);
                  console.log(`📷 Camera EXIF rescue: ${cameraVerification.details.recognized_model} @ ${camConf}% confidence, AI ${originalAI}% → ${aiDetection.ai_confidence}%`);
                  
                  if (aiDetection.ai_confidence < 50 && aiDetection.verdict === 'AI-GENERATED IMAGE') {
                    aiDetection.verdict = 'UNCERTAIN IMAGE';
                    aiDetection.adjustments.push('Verdict changed: AI-GENERATED → UNCERTAIN');
                  }
                }
              }
              // Camera EXIF Validation Rescue
              if (cameraVerification.camera_found && cameraVerification.is_valid && aiDetection) {
                // ... existing code stays the same ...
              }

              // Samsung Firmware Decoder
              softwareAnalysis = null;
              try {
                const { analyzeSoftwareField, decodeSamsungFirmware } = require('./services/samsung-firmware-decoder');
                softwareAnalysis = analyzeSoftwareField(exifData.Software, exifData.Make);
                
                // If Samsung firmware decoded a device but camera not found, use it
                if (softwareAnalysis.decoded_device && !cameraVerification?.camera_found) {
                  const firmwareInfo = decodeSamsungFirmware(exifData.Software);
                  if (firmwareInfo.decoded) {
                    cameraVerification = cameraVerification || { warnings: [] };
                    cameraVerification.camera_found = true;
                    cameraVerification.confidence = 90;
                    cameraVerification.is_valid = true;
                    cameraVerification.details = cameraVerification.details || {};
                    cameraVerification.details.recognized_model = firmwareInfo.device;
                    cameraVerification.details.manufacturer = 'Samsung';
                    cameraVerification.details.decoded_from_firmware = true;
                    cameraVerification.details.firmware_version = exifData.Software;
                    console.log(`📱 Samsung device decoded from firmware: ${firmwareInfo.device}`);
                  }
                }
                
                if (softwareAnalysis.is_edited) {
                  console.log(`✏️ Editing software detected: ${softwareAnalysis.display_value}`);
                } else if (softwareAnalysis.is_firmware) {
                  console.log(`📱 Device firmware detected: Original (unedited)`);
                }
              } catch (err) {
                console.error('⚠️ Software analysis error:', err.message);
              }

              // Historical photo detection
              if (exifData && aiDetection) {
                const historicalCheck = detectHistoricalPhoto(exifData);
                if (historicalCheck.isHistorical && historicalCheck.aiScoreReduction > 0) {
                  const originalAI = aiDetection.ai_confidence;
                  aiDetection.ai_confidence = Math.max(0, aiDetection.ai_confidence - historicalCheck.aiScoreReduction);
                  aiDetection.adjustments = aiDetection.adjustments || [];
                  aiDetection.adjustments.push("Historical photo: " + historicalCheck.reasons.join(", ") + " (-" + historicalCheck.aiScoreReduction + "%)");
                  console.log("📅 Historical photo detected: " + historicalCheck.reasons.join(", ") + ", AI " + originalAI + "% → " + aiDetection.ai_confidence + "%");
                }
              }

              // AI Content Categorization
              if (aiDetection && aiDetection.ai_confidence > 0) {
                const aiCategory = ConfidenceScoring.categorizeAIContent(
                  { exif: exifData },
                  aiDetection.ai_confidence,
                  cameraVerification
                );
                aiDetection.ai_category = aiCategory;
                
                if ((aiCategory.verdict === "AI-ENHANCED IMAGE" || aiCategory.verdict === "EDITED IMAGE") && aiDetection.verdict === "AI-GENERATED IMAGE") {
                  aiDetection.verdict = aiCategory.verdict;
                  aiDetection.adjustments = aiDetection.adjustments || [];
                  aiDetection.adjustments.push("Recategorized: " + aiCategory.explanation);
                  console.log("🎨 AI-ENHANCED detected: " + aiCategory.explanation);
                }
              }

              // Platform Detection
              try {
                platformDetection = await PlatformDetection.detectPlatform(tempFilePath, {
                  width: imgMeta.width,
                  height: imgMeta.height,
                  jpegQuality: null,
                  hasExif: !!(exifData?.Make || exifData?.Model || exifData?.DateTimeOriginal),
                  exifData: exifData,
                  iptcData: imgMeta.iptc
                });
                
                if (platformDetection.detected) {
                  console.log(`📱 Platform detected: ${platformDetection.platform} (${platformDetection.confidence}%)`);
                  
                  if (platformDetection.confidence >= 70 && aiDetection) {
                    const originalAI = aiDetection.ai_confidence;
                    const reduction = platformDetection.confidence >= 85 ? 25 : 20;
                    aiDetection.ai_confidence = Math.max(0, aiDetection.ai_confidence - reduction);
                    aiDetection.adjustments = aiDetection.adjustments || [];
                    aiDetection.adjustments.push(`Platform rescue: ${PlatformDetection.getPlatformDisplayName(platformDetection.platform)} signature (-${reduction}%)`);
                    console.log(`📱 Platform rescue: AI ${originalAI}% → ${aiDetection.ai_confidence}%`);
                    
                    if (aiDetection.ai_confidence < 50 && aiDetection.verdict === 'AI-GENERATED IMAGE') {
                      aiDetection.verdict = 'UNCERTAIN IMAGE';
                    }
                  }
                }
              } catch (err) {
                console.error('⚠️ Platform detection error:', err.message);
              }

            } catch (err) {
              console.error('⚠️ Image metadata error:', err.message);
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
                    const result = await sightengineDetector.detectAI(tempFilePath);
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

            // Weather and Landmark Verification
            const gpsAndDate = LandmarkVerification.extractGPSAndDate(exifData);
            
            if (gpsAndDate.gps || gpsAndDate.date) {
              console.log(`📍 Found GPS: ${gpsAndDate.gps ? 'Yes' : 'No'}, Date: ${gpsAndDate.date || 'No'}`);
              
              if (WeatherVerification.isConfigured()) {
                console.log('🌤️ Verifying weather conditions...');
                weatherVerification = await WeatherVerification.verifyWeatherConditions(
                  gpsAndDate,
                  googleVisionResult?.results?.labels || []
                );
                console.log(`✅ Weather verification: ${weatherVerification.verified ? 'MATCHED' : 'NOT VERIFIED'}`);
              }
              
              if (googleVisionResult?.results?.landmarks) {
                console.log('🗺️ Verifying landmark locations...');
                landmarkVerification = LandmarkVerification.verifyLandmarkLocation(
                  googleVisionResult.results.landmarks,
                  gpsAndDate.gps
                );
                console.log(`✅ Landmark verification: ${landmarkVerification.landmarks_detected} landmarks detected`);
              }
              
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
            }

          } catch (exifParseError) {
            console.log('ℹ️ Could not parse EXIF data:', exifParseError.message);
          }
        } else {
          console.log('ℹ️ Not a JPEG file or too small for EXIF');
        }
      } catch (err) {
        console.error('⚠️ EXIF extraction error:', err.message);
      }
    }

    // Landmark verification without GPS
    if (kind === 'image' && (!exifData || !exifData.GPSLatitude) && googleVisionResult?.results?.landmarks?.length > 0) {
      try {
        console.log('🗺️ Verifying landmarks (no GPS available)...');
        landmarkVerification = LandmarkVerification.verifyLandmarkLocation(
          googleVisionResult.results.landmarks,
          null
        );
        console.log(`✅ Landmark verification: ${landmarkVerification.landmarks_detected} landmarks detected`);
      } catch (err) {
        console.error('⚠️ Landmark verification error:', err.message);
      }
    }

    // ============================================
    // STEP 12: Reverse Image Search (await async result)
    // ============================================
    let reverseSearchResults = null;
    if (kind === 'image' && reverseSearchPromise) {
      try {
        console.log('🔍 Awaiting reverse image search results...');
        reverseSearchResults = await reverseSearchPromise;
        
        if (reverseSearchResults.combined_analysis) {
          const analysis = reverseSearchResults.combined_analysis;
          console.log(`✅ Reverse search: Found ${analysis.total_matches_found} matches online`);
          
          if (analysis.is_original) {
            console.log('   Status: LIKELY ORIGINAL (not found online)');
          } else {
            console.log(`   Status: Found on ${analysis.total_matches_found} sites`);
            if (analysis.content_type === 'stock_photo') {
              console.log('   ⚠️ WARNING: Stock photo detected');
            }
          }
        }
      } catch (err) {
        console.error('⚠️ Reverse image search error:', err.message);
        reverseSearchResults = { search_performed: false, error: err.message };
      }
    }
    // ============================================
    // CACHE EXTERNAL SEARCH RESULTS (PostgreSQL)
    // ============================================
    if (reverseSearchResults && fingerprint && !reverseSearchResults.from_cache) {
      try {
        if (reverseSearchResults.tineye && reverseSearchResults.tineye.status !== 'error') {
          await FingerprintCachePG.cacheExternalSearch(fingerprint, 'tineye', reverseSearchResults.tineye);
          console.log('📦 Cached TinEye results');
        }
        if (reverseSearchResults.google && reverseSearchResults.google.status !== 'error') {
          await FingerprintCachePG.cacheExternalSearch(fingerprint, 'google', reverseSearchResults.google);
          console.log('📦 Cached Google results');
        }
        if (reverseSearchResults.bing && reverseSearchResults.bing.status !== 'error') {
          await FingerprintCachePG.cacheExternalSearch(fingerprint, 'bing', reverseSearchResults.bing);
          console.log('📦 Cached Bing results');
        }
      } catch (err) {
        console.error('⚠️ External cache error:', err.message);
      }
    }
    // ============================================
    // STEP 12B: Persist Earliest Online Date
    // ============================================
    if (reverseSearchResults?.tineye?.first_appearance?.date) {
      try {
       const tineyeOldest = reverseSearchResults.tineye.first_appearance;
       const newDate = new Date(tineyeOldest.date); 
        
        // Check if we have existing metadata for this fingerprint
        const existingMeta = await db.query(`
          SELECT earliest_online_date, earliest_online_url, earliest_online_domain
          FROM fingerprint_metadata WHERE fingerprint = $1
        `, [fingerprint]);
        
        if (existingMeta.rows.length === 0) {
          // First time seeing this fingerprint - insert new record
          await db.query(`
            INSERT INTO fingerprint_metadata (fingerprint, earliest_online_date, earliest_online_url, earliest_online_domain, first_verified_at, times_verified)
            VALUES ($1, $2, $3, $4, NOW(), 1)
          `, [fingerprint, tineyeOldest.date, tineyeOldest.source_url || null, tineyeOldest.source_domain || null]);
          console.log(`📅 Stored earliest online date: ${tineyeOldest.date}`);
        } else {
          const stored = existingMeta.rows[0];
          const storedDate = stored.earliest_online_date ? new Date(stored.earliest_online_date) : null;
          
          // Update if this TinEye result is earlier than stored
          if (!storedDate || newDate < storedDate) {
            await db.query(`
              UPDATE fingerprint_metadata 
              SET earliest_online_date = $1, earliest_online_url = $2, earliest_online_domain = $3, updated_at = NOW(), times_verified = times_verified + 1
              WHERE fingerprint = $4
            `,[tineyeOldest.date, tineyeOldest.source_url || null, tineyeOldest.source_domain || null, fingerprint]);
            console.log(`📅 Updated earliest online date: ${tineyeOldest.date} (earlier than stored)`);
          } else {
            // Just increment times_verified
            await db.query(`
              UPDATE fingerprint_metadata SET times_verified = times_verified + 1, updated_at = NOW() WHERE fingerprint = $1
            `, [fingerprint]);
          }
          
          // Attach the persisted earliest date to results for timeline
          reverseSearchResults.earliest_known_online = {
            date: storedDate && storedDate < newDate ? stored.earliest_online_date : tineyeOldest.date,
            url: storedDate && storedDate < newDate ? stored.earliest_online_url : tineyeOldest.source_url,
            domain: storedDate && storedDate < newDate ? stored.earliest_online_domain : tineyeOldest.source_domain,
            source: 'persisted'
          };
        }
      } catch (err) {
        console.error('⚠️ Fingerprint metadata update error:', err.message);
      }
    }
    // Stock Photo Rescue
    if (reverseSearchResults?.tineye?.is_stock_photo && aiDetection) {
      const stockSites = reverseSearchResults.tineye.domain_breakdown?.stock_photo_sites || 0;
      if (stockSites >= 3) {
        const originalAI = aiDetection.ai_confidence;
        let reduction = 30;
        if (stockSites >= 10) reduction = 50;
        else if (stockSites >= 5) reduction = 40;
        
        aiDetection.ai_confidence = Math.max(0, aiDetection.ai_confidence - reduction);
        aiDetection.adjustments = aiDetection.adjustments || [];
        aiDetection.adjustments.push(`Stock photo rescue: found on ${stockSites} stock sites (-${reduction}%)`);
        console.log(`📸 Stock photo rescue: ${stockSites} stock sites, AI confidence ${originalAI}% → ${aiDetection.ai_confidence}%`);
        
        if (aiDetection.ai_confidence < 50 && aiDetection.verdict === 'AI-GENERATED IMAGE') {
          aiDetection.verdict = 'UNCERTAIN IMAGE';
        }
      }
    }

    // ============================================
    // STEP 13: Video Analysis (if video)
    // ============================================
    if (kind === 'video') {
      try {
        console.log('🎥 Analyzing video frames...');
        videoAnalysis = await analyzeVideo(tempFilePath, { fps: 1, maxFrames: 30 });
        console.log('✅ Video analysis complete:', videoAnalysis.frames_analyzed, 'frames analyzed');
        
        if (videoAnalysis && videoAnalysis.success) {
          const { adjustFrameAnalysisForVideo } = require('./services/video-frame-analysis-fix');
          videoAnalysis = adjustFrameAnalysisForVideo(videoAnalysis);
          
          try {
            const { getVideoMetadata } = require('./video-analyzer');
            const { applyVideoAuthenticityRescue } = require('./services/video-authenticity-rescue');
            const { analyzeEncoderSignature, getEncoderVerdict } = require('./services/encoder-fingerprinting');
            const { analyzeVideoAudio } = require('./services/video-audio-analysis');
            const { applyEnhancedVideoScoring } = require('./services/enhanced-video-scoring');
            const { analyzeBitrate } = require('./services/bitrate-anomaly-detection');
            const { analyzeGOP, getGOPSummary } = require('./services/gop-structure-analysis');
            const { analyzeResolution } = require('./services/resolution-analysis');
            const { analyzeMotion } = require('./services/motion-analysis');
            const { analyzeVideoWatermarks } = require('./services/watermark-detection');
            const { analyzeAudioContent } = require('./services/audio-content-analysis');
            
            const videoMeta = await getVideoMetadata(tempFilePath);
            
            if (videoMeta && videoMeta.format && videoMeta.format.tags) {
              videoAnalysis = applyVideoAuthenticityRescue(videoAnalysis, videoMeta.format.tags);
            }
            
            let encoderAnalysis = null;
            if (videoMeta) {
              console.log('🔍 Analyzing encoder signature...');
              encoderAnalysis = analyzeEncoderSignature(videoMeta);
              encoderAnalysis.verdict = getEncoderVerdict(encoderAnalysis);
              console.log('   Encoder: ' + (encoderAnalysis.encoderDetected || 'unknown') + ' - ' + encoderAnalysis.verdict.verdict);
            }
            
            console.log('🔊 Analyzing audio track...');
            const audioAnalysis = await analyzeVideoAudio(tempFilePath);
            if (!audioAnalysis.hasAudio) {
              console.log('   ⚠️ No audio track');
            } else {
              console.log('   Audio: ' + audioAnalysis.verdict);
            }
            
            console.log('📊 Analyzing bitrate patterns...');
            const bitrateAnalysis = await analyzeBitrate(tempFilePath);
            if (bitrateAnalysis.success) {
              console.log('   Bitrate: ' + bitrateAnalysis.verdict);
            }
            
            console.log('🎞️ Analyzing GOP structure...');
            const gopAnalysis = await analyzeGOP(tempFilePath);
            if (gopAnalysis.success) {
              const summary = getGOPSummary(gopAnalysis);
              console.log('   GOP: ' + summary);
            }
            
            console.log('📐 Analyzing resolution...');
            const resolutionAnalysis = analyzeResolution(videoMeta);
            
            console.log('🎬 Analyzing motion patterns...');
            let motionAnalysis = null;
            let watermarkAnalysis = null;
            try {
              const motionTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'));
              const ffmpeg = require('fluent-ffmpeg');
              await new Promise((resolve, reject) => {
                ffmpeg(tempFilePath)
                  .on('end', resolve)
                  .on('error', reject)
                  .outputOptions(['-vf', 'scale=1280:-2,fps=2', '-q:v', '5', '-frames:v', '30'])
                  .output(path.join(motionTempDir, 'frame-%04d.jpg'))
                  .run();
              });
              const motionFrames = fs.readdirSync(motionTempDir)
                .filter(f => f.endsWith('.jpg'))
                .map(f => path.join(motionTempDir, f))
                .sort();
              if (motionFrames.length >= 3) {
                motionAnalysis = await analyzeMotion(tempFilePath, motionFrames);
                if (motionAnalysis.success) {
                  console.log('   Motion: ' + motionAnalysis.verdict);
                }
                watermarkAnalysis = await analyzeVideoWatermarks(tempFilePath, motionFrames);
                if (watermarkAnalysis.watermarkDetected) {
                  console.log('   🏷️ AI Watermark: ' + watermarkAnalysis.tool);
                }
              }
              fs.rmSync(motionTempDir, { recursive: true, force: true });
            } catch (motionErr) {
              console.log('   Motion analysis error:', motionErr.message);
            }
            
            console.log('🔊 Analyzing audio content...');
            let audioContentAnalysis = null;
            try {
              audioContentAnalysis = await analyzeAudioContent(tempFilePath);
              if (audioContentAnalysis.success && audioContentAnalysis.hasAudio) {
                console.log('   Audio content: ' + audioContentAnalysis.verdict);
              }
            } catch (audioContentErr) {
              console.log('   Audio content error:', audioContentErr.message);
            }
            
            // ============================================
            // VIDEO AUDIO FINGERPRINTING
            // ============================================
            
            if (audioAnalysis && audioAnalysis.hasAudio) {
              try {
                console.log('🎵 Running video audio fingerprint analysis...');
                
                const audioFpResult = await VideoAudioFingerprint.analyzeVideoAudio(
                  tempFilePath,
                  db,
                  { 
                    requestId: requestId,
                    excludeFingerprint: fingerprint,
                    threshold: 85
                  }
                );
                
                if (audioFpResult.success && audioFpResult.fingerprint) {
                  videoAudioFingerprint = {
                    fingerprint: audioFpResult.fingerprint,
                    duration: audioFpResult.duration,
                    extracted_from: audioFpResult.extracted_from,
                    fingerprint_length: audioFpResult.fingerprint_length
                  };
                  
                  videoAudioMatches = audioFpResult.matches;
                  
                  if (videoAudioMatches && videoAudioMatches.found) {
                    console.log('   ⚠️ Audio match found: ' + videoAudioMatches.count + ' previous submissions');
                  } else {
                    console.log('   ✅ Audio is unique (not found in database)');
                  }

                    // AcoustID music identification for video audio
              if (acoustid.isConfigured()) {
                try {
                  console.log('🎵 Checking for known music in video audio...');
                  const musicResult = await acoustid.identifyAudio(tempFilePath);
                  
                  if (musicResult.identified) {
                    videoAudioFingerprint.music_identified = true;
                    videoAudioFingerprint.music = {
                      title: musicResult.recording.title,
                      artist: musicResult.recording.artist,
                      album: musicResult.recording.album || null,
                      confidence: musicResult.confidence
                    };
                    console.log('   🎵 Music identified: ' + musicResult.recording.title + ' - ' + musicResult.recording.artist);
                    
                    // Flag as potential stock/known audio
                    if (!videoAudioMatches) {
                      videoAudioMatches = { found: false, flags: [] };
                    }
                    videoAudioMatches.music_detected = true;
                    videoAudioMatches.music_info = videoAudioFingerprint.music;
                  } else {
                    console.log('   ✅ No known music detected (likely original audio)');
                    videoAudioFingerprint.music_identified = false;
                  }
                  
               } catch (musicErr) {
                  console.log('   ⚠️ Music identification skipped: ' + musicErr.message);
                }
              }
              
            } else if (!audioFpResult.has_audio) {
              console.log('   ℹ️ Video has no audio track to fingerprint');
            }
            
          } catch (audioFpErr) {
            console.error('⚠️ Video audio fingerprint error:', audioFpErr.message);
          }
        }

            // ============================================
            // VOICE EMBEDDING EXTRACTION
            // ============================================
            // ============================================
             
            if (audioAnalysis && audioAnalysis.hasAudio) {
              try {
                console.log('🎤 Extracting voice embedding...');
                
                const embeddingResult = await VoiceEmbeddingService.extractEmbedding(
                  tempFilePath,
                  { requestId: requestId }
                );
                
                if (embeddingResult.success) {
                  voiceEmbedding = {
                    embedding: embeddingResult.embedding,
                    embedding_size: embeddingResult.embedding_size,
                    method: embeddingResult.method,
                    duration: embeddingResult.duration
                  };
                  console.log('   ✅ Voice embedding extracted (' + embeddingResult.method + ')');
                  
                  // Search for matching voices in database
                  if (db) {
                    console.log('🔍 Searching for voice matches...');
                    voiceMatches = await VoiceEmbeddingService.searchVoiceMatches(
                      embeddingResult.embedding,
                      db,
                      req.account.id,
                      { threshold: 0.88, limit: 5 }
                    );
                    
                    if (voiceMatches.found) {
                      console.log('   ⚠️ Voice match found: ' + voiceMatches.count + ' similar voices');
                      // Note: Fraud indicators will be added in cross-reference step
                      
                      
                      
                    } else {
                      console.log('   ✅ No matching voices found (unique speaker)');
                    }
                  }
                  
                  // Store voice embedding in database
                  if (db && voiceEmbedding) {
                    try {
                      // Sanitize filename using hash (no PII stored)
                      const ext = path.extname(tempFileName).toLowerCase() || '.bin';
                      const sanitizedFilename = 'audio_' + fingerprint.substring(0, 8) + ext;
                      
                      await db.query(`
                        INSERT INTO voice_prints (
                          verification_id,
                          source_type,
                          source_file_hash,
                          original_filename,
                          voice_embedding,
                          embedding_method,
                          embedding_size,
                          segment_duration_seconds,
                          account_id,
                          created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                      `, [
                        null, // Will be updated after verification is saved
                        kind === 'video' ? 'video_extracted' : 'audio_file',
                        fingerprint,
                        sanitizedFilename,  // Hash-based filename, no PII
                        JSON.stringify(voiceEmbedding.embedding),
                        voiceEmbedding.method,
                        voiceEmbedding.embedding_size,
                        voiceEmbedding.duration,
                        req.account.id
                      ]);
                      console.log('   💾 Voice embedding saved to database');
                    } catch (dbErr) {
                      console.log('   ⚠️ Voice embedding save error:', dbErr.message);
                    }
                  }
                  
                } else {
                  console.log('   ⚠️ Voice embedding failed:', embeddingResult.error);
                }
                
              } catch (voiceErr) {
                console.error('⚠️ Voice embedding error:', voiceErr.message);
              }
            }

            console.log('📊 Applying enhanced video scoring...');
            videoAnalysis = applyEnhancedVideoScoring(
              videoAnalysis, encoderAnalysis, audioAnalysis, bitrateAnalysis,
              gopAnalysis, motionAnalysis, watermarkAnalysis, audioContentAnalysis,
              resolutionAnalysis, null
            );
            
            console.log('   Final: ' + (videoAnalysis.ai_confidence_original || 'N/A') + '% → ' + videoAnalysis.ai_confidence + '%');
            
          } catch (rescueErr) {
            console.error('⚠️ Video analysis enhancement error:', rescueErr.message);
          }
        }
      } catch (err) {
        console.error('⚠️ Video analysis error:', err.message);
        videoAnalysis = { error: err.message };
      }
    }

    // ============================================
    // STEP 14: AI Generator Detection
    // ============================================
    let generatorDetection = null;
    try {
      console.log('🔍 Running AI generator detection...');
      const generatorDetector = new AIGeneratorDetector();
      
      if (kind === 'video' && videoAnalysis && videoAnalysis.success) {
        generatorDetection = await generatorDetector.analyzeVideo(
          videoAnalysis.frames || [],
          videoAnalysis.analysis?.temporalAnalysis || null,
          videoAnalysis.metadata || {}
        );
      } else if (kind === 'image' && aiDetection) {
        generatorDetection = await generatorDetector.analyzeImage(
          tempFilePath,
          aiDetection,
          {}
        );
      }
      if (generatorDetection) {
        console.log(`✅ Generator detection: ${generatorDetection.likelyGenerator} (${generatorDetection.confidence}%)`);
      }
    } catch (err) {
      console.error('⚠️ Generator detection error:', err.message);
      generatorDetection = { error: err.message };
    }

    // ============================================
    // STEP 15: Save to Database
    // ============================================
    let savedVerification = null;
    try {
      savedVerification = await saveVerification({  
        fingerprint: fingerprint,
        algorithm: 'sha256',
        filename: tempFileName,
        file_size: stats.size,
        file_type: mockFile.mimetype,
        media_kind: kind,
        ip_address: req.ip || req.connection?.remoteAddress,
        polygon_block_number: polygonVerification?.block_number || null,
        polygon_tx_hash: polygonVerification?.transaction_hash || null,
        polygon_timestamp: polygonVerification?.timestamp || null,
        phash: phash || null,
        phash_regions: phashRegions || null,
        google_vision_labels: googleVisionResult?.results?.labels || [],
        audio_fingerprint: videoAudioFingerprint?.fingerprint || null,
        account_id: req.account.id
      });
      console.log('💾 Verification saved to database');
    } catch (err) {
      console.error('⚠️ Database save error:', err.message);
    }

    // ============================================
    // STEP 16: Cross-Reference Analysis
    // ============================================

    let crossReference = null;
    try {
      console.log('🔍 Running cross-reference analysis...');
      crossReference = analyzeCrossReference(
        fingerprint,
        phash,
        googleVisionResult?.results?.labels || [],
        req.headers['x-customer-id'] || null
      );
      if (crossReference.similar_content_found) {
        console.log(`   ⚠️ Related content found: ${crossReference.fraud_indicators.risk_level} risk`);
      } else {
        console.log('   ✅ No related content in index');
      }
    } catch (err) {
      console.error('⚠️ Cross-reference error:', err.message);
    }

    // ============================================
    // STEP 17: Screenshot Detection
    // ============================================
    if (kind === 'image' && !screenshotDetection) {
      try {
        console.log('📱 Checking for screenshot...');
        const { detectScreenshot, getScreenshotVerdictAdjustment } = require('./screenshot-detection');
        const imgMeta = await sharp(tempFilePath).metadata();
        screenshotDetection = detectScreenshot({
          width: imgMeta.width,
          height: imgMeta.height,
          format: imgMeta.format,
          exif: exifData,
          colorProfile: imgMeta.icc ? 'sRGB' : null,
          noiseLevel: null,
          filename: tempFileName
        });

        if (screenshotDetection.is_screenshot) {
          console.log(`📱 Screenshot detected: ${screenshotDetection.detected_device || 'Unknown device'} (${screenshotDetection.confidence}%)`);
          console.log(`   Indicators: ${screenshotDetection.indicators.slice(0, 2).join(', ')}`);
          
          if (aiDetection && !aiDetection.error) {
            const adjustment = getScreenshotVerdictAdjustment(screenshotDetection);
            aiDetection.screenshot_caveat = true;
            aiDetection.screenshot_severity = adjustment.severity;
            aiDetection.adjustments = aiDetection.adjustments || [];
            aiDetection.adjustments.push(
              `Screenshot detected (${screenshotDetection.confidence}% confidence, ${adjustment.severity} severity)`
            );
          }
          
          // Add separate screenshot verdict (does not override AI detection)
          screenshotDetection.verdict = 'SCREENSHOT_DETECTED';
          screenshotDetection.verdict_message = `This appears to be a screenshot${screenshotDetection.detected_device ? ` from ${screenshotDetection.detected_device}` : ''}. AI detection analyzes the visible content, not the original source.`;
          screenshotDetection.interpretation_note = 'Screenshot detection provides capture context. AI detection results reflect analysis of the screenshot content, which may differ from the original media.';
        } else {
          console.log('📱 Not a screenshot');
          screenshotDetection.verdict = 'NOT_SCREENSHOT';
          screenshotDetection.verdict_message = null;
          screenshotDetection.interpretation_note = null;
        }
        
        
    } catch (err) {
        console.error('⚠️ Screenshot detection error:', err.message);
      }
    }

    // ============================================
    // STEP 17A: Screenshot Text Analysis (OCR)
    // ============================================
    let screenshotTextAnalysis = null;
    if (kind === 'image') {
      try {
        const { analyzeScreenshotText, serpApiWebSearch } = require('./services/screenshot-text-analysis');
        console.log('📝 Running screenshot text analysis...');
        
        // Pass the web search function for online verification
        screenshotTextAnalysis = await analyzeScreenshotText(tempFilePath, serpApiWebSearch);
        
        if (screenshotTextAnalysis.success && screenshotTextAnalysis.extracted_text) {
          const wordCount = screenshotTextAnalysis.extracted_text.word_count;
          console.log('✅ OCR extracted ' + wordCount + ' words');
          if (screenshotTextAnalysis.extracted_text.key_phrases?.length > 0) {
            console.log('   Key phrases: ' + screenshotTextAnalysis.extracted_text.key_phrases.slice(0, 2).join(', '));
          }
          if (screenshotTextAnalysis.web_verification) {
            const wv = screenshotTextAnalysis.web_verification;
            console.log('🔍 Web verification: ' + (wv.exact_matches?.length || 0) + ' matches, ' + (wv.fact_checks?.length || 0) + ' fact-checks');
          }
        } else {
          console.log('ℹ️ No text found in image');
        }
      } catch (err) {
        console.error('⚠️ Screenshot text analysis error:', err.message);
      }
    }

    // ============================================
    // STEP 17B: Log Features for ML Training
    // ============================================
    try {
      FeatureLogger.logFeatures({
        fingerprint,
        filePath: tempFilePath,
        fileStats: stats,
        mimeType: mockFile.mimetype,
        mediaKind: kind,
        imageMetadata: imgMeta || null,
        exifData,
        jpegForensics: jpegForensics || null,
        sensorNoise: aiDetection?.sensor_noise_analysis || null,
        aiDetection,
        screenshotDetection,
        googleVision: googleVisionResult,
        phash,
        cameraVerification
      });
     } catch (err) {
      console.error('⚠️ Feature logging error:', err.message);
    }

    // ============================================
    // STEP 17C: Provenance Check
    // ============================================
    
    try {
      console.log('🔗 Checking content provenance...');
      const isScreenshot = screenshotDetection?.is_screenshot || false;
      provenanceResult = await ProvenanceService.checkAndRecordProvenance(
        fingerprint,
        phash,
        phashRegions,
        isScreenshot
      );
      
      if (provenanceResult.is_original) {
        console.log('   ✅ Original content (no similar content found)');
      } else {
        console.log(`   🔀 Similar content found: ${provenanceResult.similar_content.length} matches`);
        if (provenanceResult.most_similar) {
          console.log(`   📎 Most similar: ${provenanceResult.most_similar.similarity}% match`);
        }
      }
    } catch (err) {
      console.error('⚠️ Provenance check error:', err.message);
    }

    // ============================================
    // STEP 17D: Fingerprint Database Check
    // ============================================
    let fingerprintMatches = null;
    try {
      console.log('🔍 Checking fingerprint database...');
      fingerprintMatches = await FingerprintDBService.search(fingerprint, phash);
      if (fingerprintMatches.total_matches > 0) {
        console.log(`   ⚠️ Found ${fingerprintMatches.total_matches} prior appearances`);
        console.log(`   📍 Earliest: ${fingerprintMatches.summary.earliest_source} (${fingerprintMatches.summary.age_label})`);
      } else {
        console.log('   ✅ No prior appearances in fingerprint database');
      }
    } catch (err) {
      console.error('⚠️ Fingerprint database error:', err.message);
    }
    // ============================================
    // STEP 18: C2PA Verification
    // ============================================
    let c2paResult = null;
    try {
      console.log('🔐 Running C2PA verification...');
      c2paResult = await c2paVerification.verifyContent(tempFilePath, kind);
      if (c2paResult.has_c2pa_credentials) {
        console.log(`✅ C2PA credentials found: ${c2paResult.credentials_valid ? 'VALID' : 'INVALID'}`);
      } else {
        console.log('ℹ️ No C2PA credentials found');
      }
    } catch (err) {
      console.error('⚠️ C2PA verification error:', err.message);
      c2paResult = { has_c2pa_credentials: false, error: err.message };
    }

    // ============================================
    // STEP 19: VirusTotal Check
    // ============================================
    let virusTotalResult = null;
    try {
      console.log('🔍 Checking VirusTotal...');
      const { searchVirusTotal } = require('./services/virustotal');
      virusTotalResult = await searchVirusTotal(fingerprint);
      console.log('✅ VirusTotal check complete:', virusTotalResult.found ? 'FOUND' : 'NOT FOUND');
    } catch (err) {
      console.error('⚠️ VirusTotal error:', err.message);
      virusTotalResult = { found: false, error: err.message };
    }

    // ============================================
    // STEP 20: Save blockchain results to database
    // ============================================
    // Update database with Polygon data (fire and forget - don't block response)
    if (polygonVerification?.success && polygonVerification?.transaction_hash) {
      db.query(`
        UPDATE verifications 
        SET polygon_block_number = $1, polygon_tx_hash = $2, polygon_timestamp = $3
        WHERE fingerprint = $4 
        AND polygon_tx_hash IS NULL
      `, [
        polygonVerification.block_number,
        polygonVerification.transaction_hash,
        polygonVerification.timestamp,
        fingerprint
      ]).then(() => {
        console.log('✅ Polygon data saved to database');
      }).catch(err => console.error('⚠️ Polygon DB update error:', err.message));
    }
    // Update database with Base data
    if (baseVerification?.success && baseVerification?.transaction_hash) {
      db.query(`
        UPDATE verifications 
        SET base_block_number = $1, base_tx_hash = $2, base_timestamp = $3
        WHERE fingerprint = $4 
        AND base_tx_hash IS NULL
      `, [
        baseVerification.block_number,
        baseVerification.transaction_hash,
        baseVerification.timestamp,
        fingerprint
      ]).then(() => {
        console.log('✅ Base data saved to database');
      }).catch(err => console.error('⚠️ Base DB update error:', err.message));
    }
    // ADD THIS - Update database with Ethereum data
    if (ethereumVerification?.success && ethereumVerification?.transaction_hash) {
      db.query(`
       UPDATE verifications 
       SET ethereum_block_number = $1, ethereum_tx_hash = $2, ethereum_timestamp = $3
       WHERE fingerprint = $4 
       AND ethereum_tx_hash IS NULL
      `, [
       ethereumVerification.block_number,
       ethereumVerification.transaction_hash,
       ethereumVerification.timestamp,
       fingerprint
     ]).then(() => {
      console.log('✅ Ethereum data saved to database');
     }).catch(err => console.error('⚠️ Ethereum DB update error:', err.message));
    }
    // ============================================
    // STEP 21: Calculate Confidence Score
    // ============================================
    let confidence = null;
    let newsSourceMatch = null;
    try {
      const confidenceData = {
        kind: kind,
        size_bytes: stats.size,
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
        ...(newsSourceMatch && { news_source_match: newsSourceMatch }),
        ...(cameraVerification && { camera_verification: cameraVerification }),
        ...(exifData && { metadata: { has_exif: true, exif: exifData } }),
        ...(softwareAnalysis && { software_analysis: softwareAnalysis }),
        ...(screenshotTextAnalysis && { screenshot_text_analysis: screenshotTextAnalysis }),
      };
      console.log('📊 Calculating confidence score...');
      confidence = ConfidenceScoring.calculateConfidenceScore(confidenceData);
      console.log(`✅ Confidence: ${confidence.level} (${confidence.percentage}%)`);
    } catch (err) {
      console.error('⚠️ Confidence calculation error:', err.message);
      confidence = {
        level: 'UNKNOWN',
        percentage: 0,
        label: 'Unable to calculate',
        message: 'Confidence scoring temporarily unavailable'
      };
    }

    // ============================================
    // STEP 22: Build and Send Response
    // Build provenance timeline
    const provenanceTimeline = buildProvenanceTimeline({
      exif: exifData ? {
        date_taken: (() => {
          const ts = exifData.DateTimeOriginal || exifData.CreateDate || exifData.DateTime;
          if (!ts) return null;
          if (typeof ts === "number") return new Date(ts * 1000).toISOString();
          return ts;
        })(),
        camera_make: exifData.Make || null,
        camera_model: exifData.Model || null,
        gps: (exifData.GPSLatitude && exifData.GPSLongitude) ? {
          latitude: exifData.GPSLatitude,
          longitude: exifData.GPSLongitude
        } : null
      } : null,
      platform_detection: platformDetection,
      tv_corroboration: tvCorroborationResult,
      verification: {
        status: searchResults.found ? "PREVIOUSLY_VERIFIED" : "NEW_UPLOAD",
        first_seen: searchResults.found ? searchResults.first_seen : null,
        times_verified: searchResults.found ? searchResults.total_verifications : 1
      },
      blockchain_verification: null, // Bitcoin removed
      polygon_verification: polygonVerification,
      base_verification: baseVerification,
      ethereum_verification: ethereumVerification,
      reverse_image_search: reverseSearchResults,
      verified_at: new Date().toISOString(),
      fingerprint_matches: fingerprintMatches
    });

    // ============================================
    const response = {
      verification_id: savedVerification?.verification_id || null,
      kind: kind,
      source: 'remote_url',
      file_url: file_url,
      filename: tempFileName,
      size_bytes: stats.size,
      thumbnail: videoThumbnail?.success ? videoThumbnail.thumbnail_base64 : null,
      fingerprint: {
        algorithm: 'sha256',
        hash: fingerprint,
        version: 'v1'
      },
      blockchain_verification: null, // Bitcoin removed
      polygon_verification: polygonVerification,
      base_verification: baseVerification,
      ethereum_verification: ethereumVerification,
      ai_detection: aiDetection,
      ...(screenshotDetection && { screenshot_detection: screenshotDetection }),
      ...(screenshotTextAnalysis && { screenshot_text_analysis: screenshotTextAnalysis }),
      ...(provenanceResult && { provenance: provenanceResult }),
      ...(crossReference && { cross_reference: crossReference }),
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

      video_audio_fingerprint: videoAudioFingerprint || null,
      video_audio_matches: videoAudioMatches || null,
      voice_embedding: voiceEmbedding ? {
        method: voiceEmbedding.method,
        embedding_size: voiceEmbedding.embedding_size,
        duration: voiceEmbedding.duration
      } : null,
      voice_matches: voiceMatches || null,

      ...(generatorDetection && { generator_detection: generatorDetection }),
      ...(kind === 'image' && googleVisionResult && { google_vision: googleVisionResult }),
      ...(kind === 'image' && weatherVerification && { weather_verification: weatherVerification }),
      ...(kind === 'image' && landmarkVerification && { landmark_verification: landmarkVerification }),
      ...(cameraVerification && { camera_verification: cameraVerification }),
      ...(exifData && {
        exif: {
          date_taken: (() => {
            const ts = exifData.DateTimeOriginal || exifData.CreateDate || exifData.DateTime;
            if (!ts) return null;
            if (typeof ts === 'number') return new Date(ts * 1000).toISOString();
            return ts;
          })(),
          camera_make: exifData.Make || null,
          camera_model: exifData.Model || null,
          software: exifData.Software || null,
          gps: (exifData.GPSLatitude && exifData.GPSLongitude) ? {
            latitude: exifData.GPSLatitude,
            longitude: exifData.GPSLongitude
          } : null
        }
      }),
      ...(shadowPhysicsResult && { shadow_physics: shadowPhysicsResult }),
      ...(platformDetection && { platform_detection: platformDetection }),
      ...(deepfakeAnalysis && { deepfake_detection: deepfakeAnalysis }),
      ...(authorityResult && authorityResult.authorityDetected && { authority_detection: authorityResult }),
      ...(reverseSearchResults && { reverse_image_search: reverseSearchResults }),
      ...(newsSourceMatch && { news_source_match: newsSourceMatch }),
      c2pa_verification: c2paResult,
      virustotal: virusTotalResult,
      ...(tvCorroborationResult && { tv_corroboration: tvCorroborationResult }),
      confidence: confidence,
      fingerprint_database: fingerprintMatches?.summary || null,
      internal_search: internalSearchResults || null,
      provenance_timeline: provenanceTimeline,
      verified_at: new Date().toISOString()
    };

    console.log(`✅ [${requestId}] Remote verification complete: ${confidence.label} (${confidence.percentage}%)`);
    res.json(response);

  } catch (err) {
    console.error(`❌ [${requestId}] Remote verification error:`, err.message);
    res.status(500).json({
      error: 'Remote verification failed',
      message: err.message,
      file_url: file_url
    });
  } finally {
    // Clean up temp file
    try {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log('🧹 Cleaned up temp file');
      }
    } catch (e) {
      console.error('⚠️ Cleanup error:', e.message);
    }
  }
});
// ============================================
// URL VERIFY ENDPOINT
// ============================================
const UrlVerification = require('./services/url-verification');

app.post('/verify-url', authenticateApiKey, async (req, res) => {
  const requestId = Date.now();
  console.log(`\n🌐 [${requestId}] URL Verification Request`);
  
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'No URL provided' });
  }
  
  console.log(`🔗 URL: ${url}`);
  
  // Download media from URL
  const download = await UrlVerification.downloadMedia(url, '/tmp');
  
  if (!download.success) {
    return res.status(400).json({ 
      error: download.error,
      platform: download.platform,
      url: url
    });
  }
  
  let filePath = download.file_path;
  
  try {
    console.log(`✅ Downloaded: ${download.filename} (${download.media_type})`);
    console.log(`📋 Platform: ${download.platform}`);
    
    const fs = require('fs');
    const stats = fs.statSync(filePath);
    const kind = download.media_type; // 'video' or 'image'
    
    // 1. Generate fingerprint
    console.log('🔐 Generating fingerprint...');
    const fileBuffer = fs.readFileSync(filePath);
    const fingerprint = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    
    // 2. Check database for existing verification
    console.log('🔍 Checking verification history...');
    const searchResults = await searchByFingerprint(fingerprint);
    
    // 2b. Check fingerprint database
    let fingerprintMatches = null;
    try {
      console.log('🔍 Checking fingerprint database...');
      fingerprintMatches = await FingerprintDBService.search(fingerprint, null);
      if (fingerprintMatches.total_matches > 0) {
        console.log(`   ⚠️ Found ${fingerprintMatches.total_matches} prior appearances`);
        console.log(`   📍 Earliest: ${fingerprintMatches.summary.earliest_source} (${fingerprintMatches.summary.age_label})`);
      } else {
        console.log('   ✅ No prior appearances in fingerprint database');
      }
    } catch (err) {
      console.error('⚠️ Fingerprint database error:', err.message);
    }

    // 3. Run AI detection
    let aiDetection = null;
    if (kind === 'video') {
      console.log('🎬 Running video AI detection...');
      try {
        let videoAnalysis = await analyzeVideo(filePath);
        
        // Apply frame analysis fix (compression artifacts cause false positives)
        const { adjustFrameAnalysisForVideo } = require('./services/video-frame-analysis-fix');
        videoAnalysis = adjustFrameAnalysisForVideo(videoAnalysis, download.platform);
        
        try {
          const { getVideoMetadata } = require('./video-analyzer');
          const { applyVideoAuthenticityRescue } = require('./services/video-authenticity-rescue');
          const { analyzeEncoderSignature, getEncoderVerdict } = require('./services/encoder-fingerprinting');
          const { analyzeVideoAudio } = require('./services/video-audio-analysis');
          const { applyEnhancedVideoScoring } = require('./services/enhanced-video-scoring');
          const { analyzeBitrate } = require('./services/bitrate-anomaly-detection');
          const { analyzeGOP, getGOPSummary } = require('./services/gop-structure-analysis');
          const { analyzeResolution } = require('./services/resolution-analysis');
          const { analyzeMotion } = require('./services/motion-analysis');
          const { analyzeVideoWatermarks } = require('./services/watermark-detection');
          const { analyzeAudioContent } = require('./services/audio-content-analysis');
          
          const videoMeta = await getVideoMetadata(filePath);
          
          // 1. Device signature rescue
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
          }
          
          // 3. Audio analysis
          console.log('🔊 Analyzing audio track...');
          const audioAnalysis = await analyzeVideoAudio(filePath);
          if (!audioAnalysis.hasAudio) {
            console.log('   ⚠️ No audio track');
          } else {
            console.log('   Audio: ' + audioAnalysis.verdict);
          }
          
          // 4. Bitrate anomaly detection
          console.log('📊 Analyzing bitrate patterns...');
          const bitrateAnalysis = await analyzeBitrate(filePath);
          if (bitrateAnalysis.success) {
            console.log('   Bitrate: ' + bitrateAnalysis.verdict);
          }
          
          // 5. GOP structure analysis
          console.log('🎞️ Analyzing GOP structure...');
          const gopAnalysis = await analyzeGOP(filePath);
          if (gopAnalysis.success) {
            const summary = getGOPSummary(gopAnalysis);
            console.log('   GOP: ' + summary);
          }
          
          // 6. Resolution analysis
          console.log('📐 Analyzing resolution...');
          const resolutionAnalysis = analyzeResolution(videoMeta);
          
          // 7. Motion analysis + Watermark detection
          console.log('🎬 Analyzing motion patterns...');
          let motionAnalysis = null;
          let watermarkAnalysis = null;
          try {
            const os = require('os');
            const motionTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'));
            const ffmpeg = require('fluent-ffmpeg');
            await new Promise((resolve, reject) => {
              ffmpeg(filePath)
                .on('end', resolve)
                .on('error', reject)
                .outputOptions(['-vf', 'fps=2', '-q:v', '5', '-frames:v', '30'])
                .output(path.join(motionTempDir, 'frame-%04d.jpg'))
                .run();
            });
            const motionFrames = fs.readdirSync(motionTempDir)
              .filter(f => f.endsWith('.jpg'))
              .map(f => path.join(motionTempDir, f))
              .sort();
            if (motionFrames.length >= 3) {
              motionAnalysis = await analyzeMotion(filePath, motionFrames);
              if (motionAnalysis.success) {
                console.log('   Motion: ' + motionAnalysis.verdict);
              }
              watermarkAnalysis = await analyzeVideoWatermarks(filePath, motionFrames);
              if (watermarkAnalysis.watermarkDetected) {
                console.log('   🏷️ AI Watermark: ' + watermarkAnalysis.tool);
              }
            }
            fs.rmSync(motionTempDir, { recursive: true, force: true });
          } catch (motionErr) {
            console.log('   Motion analysis error:', motionErr.message);
          }
          
          // 8. Audio content analysis
          console.log('🔊 Analyzing audio content...');
          let audioContentAnalysis = null;
          try {
            audioContentAnalysis = await analyzeAudioContent(filePath);
            if (audioContentAnalysis.success && audioContentAnalysis.hasAudio) {
              console.log('   Audio content: ' + audioContentAnalysis.verdict);
            }
          } catch (audioContentErr) {
            console.log('   Audio content error:', audioContentErr.message);
          }
          
          // ============================================
              // VIDEO AUDIO FINGERPRINTING
              // ============================================
          
              if (audioAnalysis && audioAnalysis.hasAudio) {
                try {
                  console.log('🎵 Running video audio fingerprint analysis...');
                  
                  const audioFpResult = await VideoAudioFingerprint.analyzeVideoAudio(
                    req.file.path,
                    db,
                    { 
                      requestId: requestId,
                      excludeFingerprint: fingerprint,
                      threshold: 85
                    }
                  );
                  
                  if (audioFpResult.success && audioFpResult.fingerprint) {
                    videoAudioFingerprint = {
                      fingerprint: audioFpResult.fingerprint,
                      duration: audioFpResult.duration,
                      extracted_from: audioFpResult.extracted_from,
                      fingerprint_length: audioFpResult.fingerprint_length
                    };
                    
                    videoAudioMatches = audioFpResult.matches;
                    
                    if (videoAudioMatches && videoAudioMatches.found) {
                      console.log('   ⚠️ Audio match found: ' + videoAudioMatches.count + ' previous submissions');
                    } else {
                      console.log('   ✅ Audio is unique (not found in database)');
                    }
                    
                      // AcoustID music identification for video audio
              if (acoustid.isConfigured()) {
                try {
                  console.log('🎵 Checking for known music in video audio...');
                  const musicResult = await acoustid.identifyAudio(tempFilePath);
                  
                  if (musicResult.identified) {
                    videoAudioFingerprint.music_identified = true;
                    videoAudioFingerprint.music = {
                      title: musicResult.recording.title,
                      artist: musicResult.recording.artist,
                      album: musicResult.recording.album || null,
                      confidence: musicResult.confidence
                    };
                    console.log('   🎵 Music identified: ' + musicResult.recording.title + ' - ' + musicResult.recording.artist);
                    
                    // Flag as potential stock/known audio
                    if (!videoAudioMatches) {
                      videoAudioMatches = { found: false, flags: [] };
                    }
                    videoAudioMatches.music_detected = true;
                    videoAudioMatches.music_info = videoAudioFingerprint.music;
                  } else {
                    console.log('   ✅ No known music detected (likely original audio)');
                    videoAudioFingerprint.music_identified = false;
                  }
                } catch (musicErr) {
                  console.log('   ⚠️ Music identification skipped: ' + musicErr.message);
                }
              }
                  } else if (!audioFpResult.has_audio) {
                    console.log('   ℹ️ Video has no audio track to fingerprint');
                  }
                  
                } catch (audioFpErr) {
                  console.error('⚠️ Video audio fingerprint error:', audioFpErr.message);
                }
              }

          // 9. Apply enhanced combined scoring (all signals)
          console.log('📊 Applying enhanced video scoring...');
          videoAnalysis = applyEnhancedVideoScoring(
            videoAnalysis, 
            encoderAnalysis, 
            audioAnalysis, 
            bitrateAnalysis, 
            gopAnalysis, 
            motionAnalysis, 
            watermarkAnalysis, 
            audioContentAnalysis, 
            resolutionAnalysis,
            download.platform
          );
          
          console.log('   Final: ' + (videoAnalysis.ai_confidence_original || 'N/A') + '% → ' + videoAnalysis.ai_confidence + '%');
          
        } catch (enhancedErr) {
          console.log('Enhanced analysis error:', enhancedErr.message);
        }
        // Sightengine verification for platform content
let sightengineVerification = null;
if (download.platform && download.platform !== 'Direct URL') {
  try {
    console.log('🔍 Running Sightengine verification...');
    
    // Extract and resize a frame for Sightengine (it only accepts images, not video)
    const sightengineFramePath = `/tmp/sightengine-frame-${Date.now()}.jpg`;
    const ffmpeg = require('fluent-ffmpeg');
    const sharp = require('sharp');
    
    // Extract middle frame
    const middleTime = (download.duration || 10) / 2;
    await new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .on('end', resolve)
        .on('error', reject)
        .screenshots({
          timestamps: [middleTime],
          filename: 'temp-frame.jpg',
          folder: '/tmp'
        });
    });
    
    // Resize to max 1024px to avoid 413 error
    await sharp('/tmp/temp-frame.jpg')
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(sightengineFramePath);
    
    const sightengineResult = await sightengineDetector.detectAI(sightengineFramePath);
    
    // Cleanup
    try { fs.unlinkSync('/tmp/temp-frame.jpg'); } catch(e) {}
    try { fs.unlinkSync(sightengineFramePath); } catch(e) {}
    
    sightengineVerification = {
      checked: true,
      isAI: sightengineResult.isAI,
      confidence: sightengineResult.confidence * 100,
      local_confidence: videoAnalysis.ai_confidence || 0,
      agreement: sightengineResult.isAI === ((videoAnalysis.ai_confidence || 0) >= 50)
    };
    console.log(`   Sightengine: ${sightengineResult.isAI ? 'AI' : 'Authentic'} (${(sightengineResult.confidence * 100).toFixed(1)}%)`);
    
    // If Sightengine says authentic but local says AI, trust Sightengine for platform content
    if (!sightengineResult.isAI && sightengineVerification.local_confidence >= 50) {
      console.log('   ⚠️ Platform override: Sightengine says authentic, reducing local score');
      videoAnalysis.ai_confidence = sightengineResult.confidence * 100;
      videoAnalysis.analysis.sightengine_override = true;
      videoAnalysis.analysis.verdict = 'LIKELY_AUTHENTIC';
    }
  } catch (sightengineErr) {
    console.warn('   Sightengine error:', sightengineErr.message);
    sightengineVerification = { checked: false, error: sightengineErr.message };
  }
}
        aiDetection = {
          ai_confidence: videoAnalysis.ai_confidence || videoAnalysis.analysis?.aiPercentage || 0,
          likely_ai_generated: (videoAnalysis.ai_confidence || 0) >= 50 || videoAnalysis.analysis?.verdict === 'LIKELY_AI_GENERATED',
          method: 'video_frame_analysis',
          details: videoAnalysis.analysis,
          adjustments: videoAnalysis.ai_adjustments || []
        };
      } catch (err) {
        console.error('Video analysis error:', err.message);
      }
    }
    // Video reverse search (find if content exists online)
        let videoReverseSearchResults = null;
        if (kind === 'video') {
          try {
            console.log('🔎 Running video reverse search...');
            videoReverseSearchResults = await videoReverseSearch.searchVideo(filePath, {
              maxFrames: 5,
              duration: download.metadata?.duration,
              platform: download.platform
            });
            if (videoReverseSearchResults.success) {
              console.log(`   Found ${videoReverseSearchResults.matches_found} matches across ${videoReverseSearchResults.frames_analyzed} frames`);
              if (videoReverseSearchResults.earliest_appearance) {
                console.log(`   Earliest appearance: ${videoReverseSearchResults.earliest_appearance}`);
              }
            }
          } catch (reverseErr) {
            console.warn('   Video reverse search error:', reverseErr.message);
            videoReverseSearchResults = { success: false, error: reverseErr.message };
          }
        }
       // 3.5 TV/News Corroboration
    let tvCorroborationResult = null;
    if (kind === 'video' && download.metadata?.title) {
      try {
        console.log('📺 Running news corroboration...');
       tvCorroborationResult = await tvCorroboration.search({
  description: download.metadata.title,
  timeframe: '7d',
  maxResults: 10
});
        if (tvCorroborationResult.found) {
          console.log(`   Found ${tvCorroborationResult.resultCount} news sources`);
        }
      } catch (tvErr) {
        console.warn('   TV corroboration error:', tvErr.message);
        tvCorroborationResult = { found: false, error: tvErr.message };
      }
    } 
    // 4. Blockchain timestamping (tier-based)
    let polygonVerification = null;
    let baseVerification = null;
    
    if (!searchResults.found) {
      console.log('⛓️ Submitting to blockchain...');
      const accountTier = req.headers['x-account-tier'] || req.account?.tier || 'standard';
      const blockchainResults = await timestampByTier(fingerprint, download.filename, null, accountTier);
      polygonVerification = blockchainResults.polygon;
      baseVerification = blockchainResults.base;
    }
    
    // 5. Save to database
    console.log('💾 Saving verification...');
    await saveVerification({
      fingerprint,
      filename: download.filename,
      size_bytes: stats.size,
      kind,
      source_url: url,
      platform: download.platform,
      audio_fingerprint: videoAudioFingerprint?.fingerprint || chromaprint || null,
    });
    
    // 6. Calculate confidence score
    const confidenceData = {
      kind,
      ai_detection: aiDetection,
      verification: searchResults
    };
    const confidence = ConfidenceScoring.calculateConfidenceScore(confidenceData);
    console.log('DEBUG confidenceData:', JSON.stringify({ kind: confidenceData.kind, mediaType: confidenceData.mediaType }));
    console.log(`✅ Confidence: ${confidence.level} (${confidence.percentage}%)`);
    
    // 8. Build provenance timeline
    const provenanceTimeline = buildProvenanceTimeline({
      verification: {
        status: searchResults.found ? 'PREVIOUSLY_VERIFIED' : 'NEW_UPLOAD',
        first_seen: searchResults.found ? searchResults.first_seen : null,
        times_verified: searchResults.found ? searchResults.total_verifications : 1
      },
      reverse_search: videoReverseSearchResults,
      tv_corroboration: tvCorroborationResult,
      blockchain_verification: null, // Bitcoin removed
      polygon_verification: polygonVerification,
      base_verification: baseVerification,
      ethereum_verification: ethereumVerification,
      verified_at: new Date().toISOString(),
      fingerprint_matches: fingerprintMatches
    });

    // 7. Return response
    res.json({
      kind,
      source: {
        url: url,
        platform: download.platform,
        title: download.metadata.title,
        uploader: download.metadata.uploader,
        upload_date: download.metadata.upload_date,
        duration: download.metadata.duration,
        view_count: download.metadata.view_count,
        thumbnail: download.metadata.thumbnail
      },
      fingerprint: {
        algorithm: 'sha256',
        hash: fingerprint
      },
      verification: {
        status: searchResults.found ? 'PREVIOUSLY_VERIFIED' : 'NEW_UPLOAD',
        is_first: searchResults.is_first_verification,
        first_seen: searchResults.found ? searchResults.first_seen : new Date().toISOString(),
        times_verified: searchResults.found ? searchResults.total_verifications : 1
      },
      ai_detection: aiDetection,
      blockchain_verification: null, // Bitcoin removed
      polygon_verification: polygonVerification,
      base_verification: baseVerification,
      ethereum_verification: ethereumVerification,
      reverse_search: videoReverseSearchResults,
      tv_corroboration: tvCorroborationResult,
      fingerprint_database: fingerprintMatches?.summary || null,
      internal_search: internalSearchResults || null,
      provenance_timeline: provenanceTimeline,
      confidence
    });
    
  } catch (err) {
    console.error('❌ URL verification error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    // Clean up downloaded file
    UrlVerification.cleanupFile(filePath);
  }

});

app.get('/verify-url/platforms', (req, res) => {
  res.json({
    supported_platforms: UrlVerification.getSupportedPlatforms()
  });
});
// ============================================
// SINGLE FILE VERIFY ENDPOINT
// ============================================
app.post('/verify', upload.single('file'), authenticateApiKey, async (req, res) => {
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
  let videoAudioFingerprint = null;
  let videoAudioMatches = null;
  let voiceEmbedding = null;
  let voiceMatches = null;
  let generatorDetection = null;

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
// Provenance check
    let provenanceResult = null;
    try {
      provenanceResult = await ProvenanceService.checkAndRecordProvenance(
        fingerprint,
        'file_upload',
        req.file.originalname
      );
    } catch (err) {
      console.error('⚠️ Provenance check error:', err.message);
    }
    // Fingerprint database check
    let fingerprintMatches = null;
    try {
      console.log('🔍 Checking fingerprint database...');
      fingerprintMatches = await FingerprintDBService.search(fingerprint, phash);
      if (fingerprintMatches.total_matches > 0) {
        console.log(`   ⚠️ Found ${fingerprintMatches.total_matches} prior appearances`);
        console.log(`   📍 Earliest: ${fingerprintMatches.summary.earliest_source} (${fingerprintMatches.summary.age_label})`);
      } else {
        console.log('   ✅ No prior appearances in fingerprint database');
      }
    } catch (err) {
      console.error('⚠️ Fingerprint database error:', err.message);
    }
    // Only timestamp if NEW (not previously verified)
    let polygonVerification = null;
    let baseVerification = null;
    let blockchainResults = null;
    
    if (!searchResults.found) {
      // Get account tier (default to standard)
      const accountTier = req.headers['x-account-tier'] || req.account?.tier || 'standard';
      blockchainResults = await timestampByTier(fingerprint, req.file.originalname, null, accountTier);
      polygonVerification = blockchainResults.polygon;
      baseVerification = blockchainResults.base;
    } else {
      console.log("⏭️ Skipping blockchain - already timestamped");
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
      if (searchResults.base_block_number) {
        baseVerification = {
          success: true,
          status: 'previously_timestamped',
          skipped: true,
          block_number: searchResults.base_block_number,
          transaction_hash: searchResults.base_tx_hash,
          timestamp: searchResults.base_timestamp
        };
      // Check for existing Ethereum verification
      if (searchResults.ethereum_block_number) {
        ethereumVerification = {
        success: true,
        status: 'previously_timestamped',
        skipped: true,
        block_number: searchResults.ethereum_block_number,
        transaction_hash: searchResults.ethereum_tx_hash,
        timestamp: searchResults.ethereum_timestamp
        };
      }  
        }
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
      // ============================================
    // NEWS DATABASE SEARCH - Verified News Source Matching
    // ============================================
    let newsSourceMatch = null;
    if (kind === 'image' && (phash || fingerprint)) {
      try {
        console.log('📰 Searching news database...');
        
        // Generate MD5 for exact matching
        const md5Hash = crypto.createHash('md5').update(buf).digest('hex');
        
        // Get dHash if available (you may need to generate this)
        let dhash = null;
        try {
          const sharp = require('sharp');
          const dHashBuffer = await sharp(req.file.path)
            .resize(9, 8, { fit: 'fill' })
            .grayscale()
            .raw()
            .toBuffer();
          
          // Generate dHash
          const pixels = Array.from(dHashBuffer);
          let hashBits = '';
          for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
              const left = pixels[y * 9 + x];
              const right = pixels[y * 9 + x + 1];
              hashBits += left > right ? '1' : '0';
            }
          }
          dhash = '';
          for (let i = 0; i < hashBits.length; i += 4) {
            dhash += parseInt(hashBits.substr(i, 4), 2).toString(16);
          }
        } catch (e) {
          console.log('⚠️ dHash generation failed:', e.message);
        }
        
        const newsResults = await searchNewsDatabase({
          phash: phash,
          dhash: dhash,
          md5: md5Hash
        });
        
        if (newsResults.found) {
          newsSourceMatch = formatNewsSourceResponse(newsResults);
          console.log(`📰 News match found: ${newsSourceMatch.verified_attribution.source} (${newsSourceMatch.match_type})`);
          console.log(`   Published: ${newsSourceMatch.verified_attribution.published_at}`);
          console.log(`   Total sources: ${newsSourceMatch.sources_found.length}`);
        } else {
          console.log('📰 No news database match');
        }
      } catch (err) {
        console.error('⚠️ News database search error:', err.message);
      }
    }    
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
    if (localResult.ai_confidence >= 20 && localResult.ai_confidence < 80) {
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
            ela_performed: finalResult.forensic_signals?.ela_performed || false,
            compression_quality: finalResult.forensic_signals?.compression_quality || finalResult.individual_results?.jpeg?.details?.quality || 0,
            double_compressed: finalResult.forensic_signals?.double_compressed || finalResult.individual_results?.jpeg?.details?.doubleCompressed || false,
            noise_level: finalResult.forensic_signals?.noise_level || finalResult.individual_results?.jpeg?.details?.noise || 'unknown'
          },
      
 verdict: finalResult.likely_ai_generated ? 'AI-GENERATED IMAGE' : 'LIKELY REAL IMAGE',
      analysis_time_ms: 0,
      
      // Smart routing metadata
      routing_decision: finalResult.routing_decision || 'unknown',
      confidence_source: finalResult.confidence_source || 'local',
      external_verification: finalResult.external_verification || null,
      local_result: finalResult.local_result || null
    };     
    
    
    console.log(`✅ Ensemble detection: ${aiDetection.verdict} (${aiDetection.ai_confidence}%)`);
    
    console.log(`✅ Ensemble detection: ${finalResult.likely_ai_generated ? 'AI-GENERATED IMAGE' : 'VERIFIED IMAGE'} (${finalResult.ai_confidence}%)`);
    
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
    aiDetection.verdict = adjustedConfidence >= 70 ? 'AI-GENERATED IMAGE' : 
                          adjustedConfidence >= 50 ? 'LIKELY AI-GENERATED IMAGE' :
                          adjustedConfidence >= 30 ? 'UNCERTAIN IMAGE' : 'VERIFIED IMAGE';
    
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
                  aiDetection = SensorNoiseAnalysis.adjustForSensorNoise(aiDetection, noiseAnalysis, exifData);  
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
                  if (aiDetection.ai_confidence < 50 && aiDetection.verdict === 'AI-GENERATED IMAGE') {
                    aiDetection.verdict = 'UNCERTAIN IMAGE';
                    aiDetection.adjustments.push('Verdict changed: AI-GENERATED → UNCERTAIN');
                  }
                }
              }
              
              // Historical photo detection - reduce AI false positives for old photos
              if (exifData && aiDetection) {
                const historicalCheck = detectHistoricalPhoto(exifData);
                if (historicalCheck.isHistorical && historicalCheck.aiScoreReduction > 0) {
                  const originalAI = aiDetection.ai_confidence;
                  aiDetection.ai_confidence = Math.max(0, aiDetection.ai_confidence - historicalCheck.aiScoreReduction);
                  aiDetection.adjustments = aiDetection.adjustments || [];
                  aiDetection.adjustments.push("Historical photo: " + historicalCheck.reasons.join(", ") + " (-" + historicalCheck.aiScoreReduction + "%)");
                  console.log("📅 Historical photo detected: " + historicalCheck.reasons.join(", ") + ", AI " + originalAI + "% → " + aiDetection.ai_confidence + "%");
                  
                  if (aiDetection.ai_confidence < 50 && aiDetection.verdict === "AI-GENERATED IMAGE") {
                    aiDetection.verdict = "UNCERTAIN";
                    aiDetection.adjustments.push("Verdict changed: AI-GENERATED → UNCERTAIN (historical photo)");
                  }
                }
              }
              
              // Categorize AI content: AI-GENERATED vs AI-ENHANCED
              if (aiDetection && aiDetection.ai_confidence > 0) {
                const aiCategory = ConfidenceScoring.categorizeAIContent(
                  { exif: exifData },
                  aiDetection.ai_confidence,
                  cameraVerification
                );
                aiDetection.ai_category = aiCategory;
                
                if ((aiCategory.verdict === "AI-ENHANCED IMAGE" || aiCategory.verdict === "EDITED IMAGE") && aiDetection.verdict === "AI-GENERATED IMAGE") {
                  aiDetection.verdict = aiCategory.verdict;
                  aiDetection.adjustments = aiDetection.adjustments || [];
                  aiDetection.adjustments.push("Recategorized: " + aiCategory.explanation);
                  console.log("🎨 AI-ENHANCED detected: " + aiCategory.explanation);
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
                    
                    if (aiDetection.ai_confidence < 50 && aiDetection.verdict === 'AI-GENERATED IMAGE') {
                      aiDetection.verdict = 'UNCERTAIN IMAGE';
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
          if (aiDetection.ai_confidence < 50 && aiDetection.verdict === 'AI-GENERATED IMAGE') {
            aiDetection.verdict = 'UNCERTAIN IMAGE';
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
              } else if (resolutionAnalysis.verdict === 'LIKELY AI-GENERATED IMAGE') {
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
                    .outputOptions(['-vf', 'fps=2', '-q:v', '5', '-frames:v', '30'])
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
              videoAnalysis = applyEnhancedVideoScoring(videoAnalysis, encoderAnalysis, audioAnalysis, bitrateAnalysis, gopAnalysis, motionAnalysis, watermarkAnalysis, audioContentAnalysis, resolutionAnalysis, null);
              
              console.log('   Final: ' + videoAnalysis.ai_confidence_original + '% → ' + videoAnalysis.ai_confidence + '% (' + videoAnalysis.verdict + ')');
              
              if (videoAnalysis.ai_adjustments && videoAnalysis.ai_adjustments.length > 0) {
                console.log('   Adjustments: ' + videoAnalysis.ai_adjustments.join(', '));
              }
             // Sightengine second opinion for edge cases (very high or very low confidence)
              const videoAiConf = videoAnalysis.ai_confidence || 0;
              if (process.env.SIGHTENGINE_API_USER && (videoAiConf >= 80 || videoAiConf <= 20)) {
                try {
                  console.log(`🔍 Sightengine verification (edge case: ${videoAiConf}%)...`);
                  
                  // Extract a frame for Sightengine analysis
                  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sightengine-frame-'));
                  const framePath = path.join(frameDir, 'frame.jpg');
                  
                  await new Promise((resolve, reject) => {
                    const ffmpeg = require('fluent-ffmpeg');
                    ffmpeg(req.file.path)
                      .on('end', resolve)
                      .on('error', reject)
                      .outputOptions(['-vf', 'select=eq(n\\,30)', '-frames:v', '1', '-q:v', '5'])
                      .output(framePath)
                      .run();
                  });
                  
                  if (fs.existsSync(framePath)) {
                    const sightengineResult = await sightengineDetector.detectAI(framePath);
                    const seConfidence = sightengineResult.confidence * 100;
                    const seIsAI = sightengineResult.isAI;
                    
                    console.log(`   Sightengine: ${seIsAI ? 'AI' : 'Authentic'} (${seConfidence.toFixed(1)}%)`);
                    
                    videoAnalysis.sightengine_verification = {
                      checked: true,
                      isAI: seIsAI,
                      confidence: seConfidence,
                      local_confidence: videoAiConf,
                      agreement: (seIsAI && videoAiConf >= 50) || (!seIsAI && videoAiConf < 50)
                    };
                    
                    // If major disagreement, log warning but trust combined signals
                    if (!videoAnalysis.sightengine_verification.agreement) {
                      console.log(`   ⚠️ Disagreement: Local=${videoAiConf}% vs Sightengine=${seConfidence}% (${seIsAI ? 'AI' : 'Authentic'})`);
                      
                      // Blend scores for disagreement cases
                      const blendedConfidence = Math.round((videoAiConf + seConfidence) / 2);
                      console.log(`   Blending: ${videoAiConf}% + ${seConfidence}% → ${blendedConfidence}%`);
                      videoAnalysis.ai_confidence_pre_blend = videoAiConf;
                      videoAnalysis.ai_confidence = blendedConfidence;
                    }
                    
                    fs.rmSync(frameDir, { recursive: true, force: true });
                  }
                } catch (seErr) {
                  console.log(`   Sightengine error: ${seErr.message}`);
                  videoAnalysis.sightengine_verification = { checked: false, error: seErr.message };
                }
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
       filename: tempFileName,
       file_size: stats.size,
       file_type: mockFile.mimetype,
       media_kind: kind,
       ip_address: req.ip || req.connection?.remoteAddress,
       polygon_block_number: polygonVerification?.block_number || null,
       polygon_tx_hash: polygonVerification?.transaction_hash || null,
       polygon_timestamp: polygonVerification?.timestamp || null,
       phash: phash || null,
        phash_regions: phashRegions || null,
       phash_regions: phashRegions || null,
       google_vision_labels: googleVisionResult?.results?.labels || []
   });
    } catch (err) {
      console.error('⚠️ Database save error:', err.message);
    }
    // ============================================================================
    // CROSS-REFERENCE ANALYSIS - Check index for related content
    // ============================================================================
    let crossReference = null;
    try {
      console.log('🔍 Running cross-reference analysis...');
      crossReference = analyzeCrossReference(
        fingerprint,
        phash,
        googleVisionResult?.results?.labels || [],
        req.headers['x-customer-id'] || null
      );
      if (crossReference.similar_content_found) {
        console.log(`   ⚠️ Related content found: ${crossReference.fraud_indicators.risk_level} risk`);
        if (crossReference.fraud_indicators.flags.length > 0) {
          crossReference.fraud_indicators.flags.forEach(f => console.log(`   - ${f}`));
        }
      } else {
        console.log('   ✅ No related content in index');
      }
    } catch (err) {
      console.error('⚠️ Cross-reference error:', err.message);
    }
    // Add temporal validation to cross-reference
    if (crossReference) {
      try {
        const exifDateRaw = exifData?.DateTimeOriginal || exifData?.CreateDate || exifData?.DateTime;
        const claimedDate = req.headers['x-claimed-date'] || null;
        
        crossReference.temporal_analysis = analyzeTemporalConsistency(
          exifDateRaw,
          crossReference.exact_match?.first_seen,
          claimedDate
        );
        
        if (crossReference.temporal_analysis.flags.length > 0) {
          console.log('📅 Temporal analysis:');
          crossReference.temporal_analysis.flags.forEach(f => console.log(`   - ${f}`));
          
          // Elevate risk level if temporal issues found
          if (crossReference.temporal_analysis.risk_level === 'high' && 
              crossReference.fraud_indicators.risk_level !== 'critical') {
            crossReference.fraud_indicators.risk_level = 'high';
            crossReference.fraud_indicators.recommendation = 'Review required - temporal inconsistencies detected';
          }
          // Add temporal flags to main fraud indicators
          crossReference.fraud_indicators.flags.push(...crossReference.temporal_analysis.flags);
        }
      } catch (err) {
        console.error('⚠️ Temporal validation error:', err.message);
      }
    }
    // ============================================================================
    // CACHE EXTERNAL SEARCH RESULTS
    // ============================================================================
    if (reverseSearchResults && fingerprint) {
      try {
        if (reverseSearchResults.tineye && reverseSearchResults.tineye.status !== 'error') {
          await FingerprintCachePG.cacheExternalSearch(fingerprint, 'tineye', reverseSearchResults.tineye);
          console.log('📦 Cached TinEye results');
        }
        if (reverseSearchResults.google && reverseSearchResults.google.status !== 'error') {
          await FingerprintCachePG.cacheExternalSearch(fingerprint, 'google', reverseSearchResults.google);
          console.log('📦 Cached Google results');
        }
        if (reverseSearchResults.bing && reverseSearchResults.bing.status !== 'error') {
          await FingerprintCachePG.cacheExternalSearch(fingerprint, 'bing', reverseSearchResults.bing);
          console.log('📦 Cached Bing results');
        }
        // Add source analysis to cross-reference
        const externalSources = await FingerprintCachePG.analyzeExternalSources(fingerprint);
        if (externalSources && externalSources.total_external_matches > 0) {
          crossReference = crossReference || {};
          crossReference.external_sources = externalSources;
          console.log('📊 External sources: ' + externalSources.total_external_matches + ' matches indexed');
        }
      } catch (err) {
        console.error('⚠️ External cache error:', err.message);
      }
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
          
          if (aiDetection && !aiDetection.error) {
            const adjustment = getScreenshotVerdictAdjustment(screenshotDetection);
            aiDetection.screenshot_caveat = true;
            aiDetection.screenshot_severity = adjustment.severity;
            aiDetection.adjustments = aiDetection.adjustments || [];
            aiDetection.adjustments.push(
              `Screenshot detected (${screenshotDetection.confidence}% confidence, ${adjustment.severity} severity)`
            );
          }
          
          // Add separate screenshot verdict (does not override AI detection)
          screenshotDetection.verdict = 'SCREENSHOT_DETECTED';
          screenshotDetection.verdict_message = `This appears to be a screenshot${screenshotDetection.detected_device ? ` from ${screenshotDetection.detected_device}` : ''}. AI detection analyzes the visible content, not the original source.`;
          screenshotDetection.interpretation_note = 'Screenshot detection provides capture context. AI detection results reflect analysis of the screenshot content, which may differ from the original media.';
      } else {
          console.log('📱 Not a screenshot');
          screenshotDetection.verdict = 'NOT_SCREENSHOT';
          screenshotDetection.verdict_message = null;
          screenshotDetection.interpretation_note = null;
        }
      } catch (err) {
        console.error('⚠️ Screenshot detection error:', err.message);
      }
    }

    // ============================================================================

    res.json({
      kind: kind,
      filename: req.file.originalname,
      size_bytes: req.file.size,
      fingerprint: {
        algorithm: 'sha256',
        hash: fingerprint,
        version: 'v1'
      },
      blockchain_verification: null, // Bitcoin removed
      polygon_verification: polygonVerification,
      base_verification: baseVerification,
      ethereum_verification: ethereumVerification,
      ai_detection: aiDetection,
      ...(screenshotDetection && { screenshot_detection: screenshotDetection }),
      ...(provenanceResult && { provenance: provenanceResult }),
      ...(crossReference && { cross_reference: crossReference }),
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

      video_audio_fingerprint: videoAudioFingerprint || null,
      video_audio_matches: videoAudioMatches || null,
      voice_embedding: voiceEmbedding ? {
        method: voiceEmbedding.method,
        embedding_size: voiceEmbedding.embedding_size,
        duration: voiceEmbedding.duration
      } : null,
      voice_matches: voiceMatches || null,
      ...(generatorDetection && { generator_detection: generatorDetection }),
      ...(kind === 'image' && googleVisionResult && { google_vision: googleVisionResult }),
      ...(kind === 'image' && weatherVerification && { weather_verification: weatherVerification }),
      ...(kind === 'image' && landmarkVerification && { landmark_verification: landmarkVerification }),
      ...(cameraVerification && { camera_verification: cameraVerification }),
      ...(exifData && {
        exif: {
          date_taken: (() => {
            const ts = exifData.DateTimeOriginal || exifData.CreateDate || exifData.DateTime;
            if (!ts) return null;
            if (typeof ts === 'number') return new Date(ts * 1000).toISOString();
            return ts;
          })(),
          camera_make: exifData.Make || null,
          camera_model: exifData.Model || null,
          software: exifData.Software || null,
          gps: (exifData.GPSLatitude && exifData.GPSLongitude) ? {
            latitude: exifData.GPSLatitude,
            longitude: exifData.GPSLongitude
          } : null
        }
      }),
      ...((() => {
        const editingSoftware = ConfidenceScoring.checkForEditingSoftwareInExif({ exif: exifData });
        return editingSoftware ? { editing_software: editingSoftware } : {};
      })()),
      ...(shadowPhysicsResult && { shadow_physics: shadowPhysicsResult }),
      ...(platformDetection && { platform_detection: platformDetection }),
      ...(deepfakeAnalysis && { deepfake_detection: deepfakeAnalysis }),
      ...(authorityResult && authorityResult.authorityDetected && { authority_detection: authorityResult }),
      ...(reverseSearchResults && { reverse_image_search: reverseSearchResults }),
      ...(newsSourceMatch && { news_source_match: newsSourceMatch }),
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
      fingerprint_database: fingerprintMatches?.summary || null,
      internal_search: internalSearchResults || null,
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
            ...(newsSourceMatch && { news_source_match: newsSourceMatch }),
            ...(cameraVerification && { camera_verification: cameraVerification }),
            ...(exifData && { metadata: { has_exif: true, exif: exifData } }),
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
      ADD COLUMN IF NOT EXISTS base_block_number INTEGER,
      ADD COLUMN IF NOT EXISTS base_tx_hash VARCHAR(66),
      ADD COLUMN IF NOT EXISTS base_timestamp TIMESTAMP
    `);
   await db.query('ALTER TABLE verifications ALTER COLUMN phash TYPE VARCHAR(64)');
    console.log('✅ Blockchain columns added');
    
    res.json({ success: true, message: 'Migration complete!' });
  } catch (err) {
    console.error('❌ Migration failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// PROVENANCE MIGRATION
// ============================================================================
app.get('/admin/migrate-provenance', async (req, res) => {
  try {
    console.log('🔄 Running provenance migration...');
    
    // Create content_relationships table
    await db.query(`
      CREATE TABLE IF NOT EXISTS content_relationships (
        id SERIAL PRIMARY KEY,
        parent_fingerprint VARCHAR(64) NOT NULL,
        child_fingerprint VARCHAR(64) NOT NULL,
        relationship_type VARCHAR(30),
        similarity_score INTEGER,
        detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(parent_fingerprint, child_fingerprint)
      )
    `);
    console.log('✅ content_relationships table created');
    
    // Create indexes
    await db.query('CREATE INDEX IF NOT EXISTS idx_rel_parent ON content_relationships(parent_fingerprint)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_rel_child ON content_relationships(child_fingerprint)');
    console.log('✅ Indexes created');
    
    // Add provenance columns to verifications
    await db.query(`
      ALTER TABLE verifications 
      ADD COLUMN IF NOT EXISTS is_derivative BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS parent_fingerprint VARCHAR(64),
      ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMP
    `);
    console.log('✅ Provenance columns added to verifications');
    
    // Backfill first_seen_at for existing records
    await db.query(`
        FROM verifications 
        WHERE fingerprint = v.fingerprint
      )
      WHERE first_seen_at IS NULL
    `);
    console.log('✅ Backfilled first_seen_at');
    
    res.json({ success: true, message: 'Provenance migration complete!' });
  } catch (err) {
    console.error('❌ Provenance migration failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}); 

app.get('/admin/migrate-provenance', async (req, res) => {
  // ... existing provenance migration code ...
}); 

// ============================================================================
// ETHEREUM L1 DATABASE MIGRATION
// ============================================================================
app.get('/admin/migrate-ethereum', async (req, res) => {
  try {
    console.log('🔄 Running Ethereum L1 migration...');
    
    // Add Ethereum columns to verifications table
    await db.query(`
      ALTER TABLE verifications 
      ADD COLUMN IF NOT EXISTS ethereum_block_number INTEGER,
      ADD COLUMN IF NOT EXISTS ethereum_tx_hash VARCHAR(66),
      ADD COLUMN IF NOT EXISTS ethereum_timestamp TIMESTAMP
    `);
    console.log('✅ Ethereum columns added to verifications');
    
    // Create index for ethereum_tx_hash lookups
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_ethereum_tx_hash 
      ON verifications(ethereum_tx_hash) 
      WHERE ethereum_tx_hash IS NOT NULL
    `);
    console.log('✅ Ethereum transaction hash index created');
    
    res.json({ 
      success: true, 
      message: 'Ethereum L1 migration complete!',
      columns_added: ['ethereum_block_number', 'ethereum_tx_hash', 'ethereum_timestamp']
    });
  } catch (err) {
    console.error('❌ Ethereum migration failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
// ============================================================================
// MULTI-REGION PHASH MIGRATION
// ============================================================================
app.get('/admin/migrate-region-phash', async (req, res) => {
  try {
    console.log('🔄 Running multi-region pHash migration...');
    
    // Add phash_regions column to verifications table
    await db.query(`
      ALTER TABLE verifications 
      ADD COLUMN IF NOT EXISTS phash_regions JSONB
    `);
    console.log('✅ phash_regions column added');
    
    // Create index for JSONB queries
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_phash_regions 
      ON verifications USING GIN (phash_regions)
    `);
    console.log('✅ JSONB index created');
    
    res.json({ success: true, message: 'Multi-region pHash migration complete!' });
  } catch (err) {
    console.error('❌ Migration failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
// Force redeploy to pick up new API key
// ============================================================================
// FINGERPRINT INDEX API ENDPOINTS
// ============================================================================

const fingerprintIndex = require('./services/fingerprint-index');

// Fingerprint database stats (crawlers: Bluesky, Reddit, Wikimedia)
app.get('/fingerprint/stats', async (req, res) => {
  try {
    const stats = await FingerprintDBService.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Get index stats
app.get('/index/stats', (req, res) => {
  try {
    const stats = fingerprintIndex.getIndexStats();
    res.json({
      success: true,
      ...stats
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Search by label
app.get('/index/search/label/:label', (req, res) => {
  try {
    const { label } = req.params;
    const minConfidence = parseFloat(req.query.confidence) || 0.7;
    const limit = parseInt(req.query.limit) || 50;
    
    const results = fingerprintIndex.findByLabel(label, minConfidence, limit);
    
    res.json({
      success: true,
      query: { label, minConfidence, limit },
      total: results.length,
      results: results.map(r => ({
        fingerprint_id: r.id,
        sha256: r.sha256,
        phash: r.phash,
        source_type: r.source_type,
        label: r.label,
        confidence: r.confidence,
        first_seen: r.first_seen,
        occurrence_count: r.occurrence_count
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Check if content exists in index (by SHA256)
app.get('/index/check/:sha256', (req, res) => {
  try {
    const { sha256 } = req.params;
    const result = fingerprintIndex.checkLocalIndex(sha256);
    
    res.json({
      success: true,
      sha256,
      found: result.exactMatch !== null,
      exact_match: result.exactMatch ? {
        fingerprint_id: result.exactMatch.id,
        first_seen: result.exactMatch.first_seen,
        occurrence_count: result.exactMatch.occurrence_count,
        labels: result.exactMatch.labels
      } : null,
      similar_count: result.similarMatches.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get labels for a fingerprint
app.get('/index/fingerprint/:id/labels', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const labels = fingerprintIndex.getLabels(id);
    
    res.json({
      success: true,
      fingerprint_id: id,
      total: labels.length,
      labels
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Find related content (same labels as given fingerprint)
app.get('/index/fingerprint/:id/related', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const limit = parseInt(req.query.limit) || 20;
    const related = fingerprintIndex.findRelatedContent(id, limit);
    
    res.json({
      success: true,
      fingerprint_id: id,
      total: related.length,
      related: related.map(r => ({
        fingerprint_id: r.id,
        sha256: r.sha256,
        matching_label: r.matching_label,
        confidence: r.confidence,
        first_seen: r.first_seen
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// List all unique labels in index
app.get('/index/labels', (req, res) => {
  try {
    const stats = fingerprintIndex.getIndexStats();
    res.json({
      success: true,
      unique_labels: stats.uniqueLabels,
      top_labels: stats.topLabels
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get external matches for a fingerprint
app.get('/index/fingerprint/:id/external', (req, res) => {
  try {
    const { getExternalMatches, analyzeExternalSources } = require('./services/fingerprint-index');
    const id = parseInt(req.params.id);
    
    const matches = getExternalMatches(id);
    const analysis = analyzeExternalSources(id);
    
    res.json({
      success: true,
      fingerprint_id: id,
      ...matches,
      analysis
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Search external matches by domain
app.get('/index/search/domain/:domain', (req, res) => {
  try {
    const { searchExternalMatchesByDomain } = require('./services/fingerprint-index');
    const { domain } = req.params;
    
    const matches = searchExternalMatchesByDomain(domain);
    
    res.json({
      success: true,
      query: { domain },
      total: matches.length,
      matches
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

