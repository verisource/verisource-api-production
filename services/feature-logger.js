

/**
 * Feature Logger Service
 * Collects technical features for ML model training
 * - Screenshot detection
 * - Provenance inference
 * - Platform fingerprinting
 * - Compression analysis
 * - Camera vs AI heuristics
 * 
 * Stores in PostgreSQL for persistence across deploys
 */

const fs = require('fs');
const path = require('path');
const db = require('../db-minimal');

class FeatureLogger {
  constructor() {
    this.logDir = process.env.FEATURE_LOG_DIR || './ml-training-data';
    this.logFile = path.join(this.logDir, 'features.jsonl');
    this.csvFile = path.join(this.logDir, 'features.csv');
    this.enabled = process.env.FEATURE_LOGGING_ENABLED !== 'false';
    this.dbInitialized = false;
    
    // Initialize database table
    this.initDatabase();
    
    // Ensure log directory exists (for backup file logging)
    if (this.enabled && !fs.existsSync(this.logDir)) {
      try {
        fs.mkdirSync(this.logDir, { recursive: true });
        console.log('📊 Feature logging directory created:', this.logDir);
      } catch (err) {
        console.error('⚠️ Could not create feature log directory:', err.message);
      }
    }
    
    // Initialize CSV with headers if it doesn't exist
    if (this.enabled && !fs.existsSync(this.csvFile)) {
      this.writeCsvHeaders();
    }
  }

  async initDatabase() {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ml_features (
          id SERIAL PRIMARY KEY,
          logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          sample_id VARCHAR(64),
          media_kind VARCHAR(20),
          source_env VARCHAR(20),
          sha256 VARCHAR(64),
          perceptual_hash VARCHAR(128),
          quantization_hash VARCHAR(128),
          width INTEGER,
          height INTEGER,
          aspect_ratio DECIMAL(10,4),
          orientation VARCHAR(20),
          total_pixels INTEGER,
          file_size_bytes INTEGER,
          file_size_per_pixel DECIMAL(10,6),
          mime_type VARCHAR(100),
          has_exif BOOLEAN,
          exif_field_count INTEGER,
          has_make BOOLEAN,
          has_model BOOLEAN,
          has_software BOOLEAN,
          has_gps BOOLEAN,
          has_datetime BOOLEAN,
          jpeg_quality_est INTEGER,
          quality_bucket VARCHAR(20),
          chroma_subsampling VARCHAR(20),
          double_compressed BOOLEAN,
          ela_score DECIMAL(10,4),
          ghost_score DECIMAL(10,4),
          recompression_source VARCHAR(50),
          sharpness_score DECIMAL(10,4),
          edge_density DECIMAL(10,4),
          entropy_score DECIMAL(10,4),
          noise_level DECIMAL(10,4),
          sensor_confidence INTEGER,
          ai_anomalies INTEGER,
          status_bar_detected BOOLEAN,
          screenshot_confidence INTEGER,
          detected_device VARCHAR(100),
          is_screenshot BOOLEAN,
          common_screenshot_width BOOLEAN,
          common_screenshot_height BOOLEAN,
          exact_screenshot_dimension BOOLEAN,
          encoder_name VARCHAR(100),
          encoder_confidence INTEGER,
          platform_signature VARCHAR(100),
          camera_match BOOLEAN,
          camera_score INTEGER,
          firmware_valid BOOLEAN,
          ai_confidence INTEGER,
          ai_verdict VARCHAR(50),
          local_ai_score INTEGER,
          jpeg_ai_score INTEGER,
          ensemble_score INTEGER,
          vision_label_count INTEGER,
          vision_web_entities INTEGER
        )
      `);
      
      // Create index on logged_at for efficient date queries
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_ml_features_logged_at ON ml_features(logged_at)
      `);
      
      // Create index on sha256 for deduplication checks
      await db.query(`
        CREATE INDEX IF NOT EXISTS idx_ml_features_sha256 ON ml_features(sha256)
      `);
      
      this.dbInitialized = true;
      console.log('📊 ML features database table initialized');
    } catch (err) {
      console.error('⚠️ ML features DB init error:', err.message);
    }
  }

  /**
   * Extract and log features from verification data
   * @param {Object} data - All available verification data
   */
  async logFeatures(data) {
    if (!this.enabled) return;

    try {
      const features = this.extractFeatures(data);
      
      // Save to PostgreSQL (primary storage)
      await this.saveToDatabase(features);
      
      // Also write to local files as backup
      try {
        fs.appendFileSync(this.logFile, JSON.stringify(features) + '\n');
        this.appendCsvRow(features);
      } catch (fileErr) {
        // File logging is optional, don't fail if it doesn't work
      }
      
      console.log('📊 Features logged for ML training');
    } catch (err) {
      console.error('⚠️ Feature logging error:', err.message);
    }
  }

  /**
   * Save features to PostgreSQL database
   */
  async saveToDatabase(features) {
    if (!db.isAvailable()) {
      console.log('⚠️ Database not available for feature logging');
      return;
    }

    const query = `
      INSERT INTO ml_features (
        logged_at, sample_id, media_kind, source_env, sha256, perceptual_hash,
        quantization_hash, width, height, aspect_ratio, orientation, total_pixels,
        file_size_bytes, file_size_per_pixel, mime_type, has_exif, exif_field_count,
        has_make, has_model, has_software, has_gps, has_datetime, jpeg_quality_est,
        quality_bucket, chroma_subsampling, double_compressed, ela_score, ghost_score,
        recompression_source, sharpness_score, edge_density, entropy_score, noise_level,
        sensor_confidence, ai_anomalies, status_bar_detected, screenshot_confidence,
        detected_device, is_screenshot, common_screenshot_width, common_screenshot_height,
        exact_screenshot_dimension, encoder_name, encoder_confidence, platform_signature,
        camera_match, camera_score, firmware_valid, ai_confidence, ai_verdict,
        local_ai_score, jpeg_ai_score, ensemble_score, vision_label_count, vision_web_entities
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32,
        $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47,
        $48, $49, $50, $51, $52, $53, $54, $55
      )
    `;

    const values = [
      features.logged_at,
      features.sample_id,
      features.media_kind,
      features.source_env,
      features.sha256,
      features.perceptual_hash,
      features.quantization_hash,
      features.width,
      features.height,
      features.aspect_ratio,
      features.orientation,
      features.total_pixels,
      features.file_size_bytes,
      features.file_size_per_pixel,
      features.mime_type,
      features.has_exif,
      features.exif_field_count,
      features.has_make,
      features.has_model,
      features.has_software,
      features.has_gps,
      features.has_datetime,
      features.jpeg_quality_est,
      features.quality_bucket,
      features.chroma_subsampling,
      features.double_compressed,
      features.ela_score,
      features.ghost_score,
      features.recompression_source,
      features.sharpness_score,
      features.edge_density,
      features.entropy_score,
      features.noise_level,
      features.sensor_confidence,
      features.ai_anomalies,
      features.status_bar_detected,
      features.screenshot_confidence,
      features.detected_device,
      features.is_screenshot,
      features.common_screenshot_width,
      features.common_screenshot_height,
      features.exact_screenshot_dimension,
      features.encoder_name,
      features.encoder_confidence,
      features.platform_signature,
      features.camera_match,
      features.camera_score,
      features.firmware_valid,
      features.ai_confidence,
      features.ai_verdict,
      features.local_ai_score,
      features.jpeg_ai_score,
      features.ensemble_score,
      features.vision_label_count,
      features.vision_web_entities
    ];

    await db.query(query, values);
  }

  /**
   * Extract all relevant features from verification data
   */
  extractFeatures(data) {
    const {
      fingerprint,
      filePath,
      fileStats,
      mimeType,
      imageMetadata,
      exifData,
      jpegForensics,
      sensorNoise,
      aiDetection,
      screenshotDetection,
      googleVision,
      phash,
      encoderFingerprint,
      compressionSignature,
      cameraVerification
    } = data;

    // Basic dimensions
    const width = imageMetadata?.width || null;
    const height = imageMetadata?.height || null;
    const aspectRatio = width && height ? parseFloat((width / height).toFixed(4)) : null;
    const orientation = width && height ? (width > height ? 'landscape' : width < height ? 'portrait' : 'square') : null;
    const totalPixels = width && height ? width * height : null;

    // File metrics
    const fileSizeBytes = fileStats?.size || null;
    const fileSizePerPixel = fileSizeBytes && totalPixels ? parseFloat((fileSizeBytes / totalPixels).toFixed(6)) : null;

    // EXIF analysis
    const hasExif = !!(exifData && Object.keys(exifData).length > 0);
    const exifFieldCount = hasExif ? Object.keys(exifData).length : 0;
    const hasMake = !!(exifData?.Make);
    const hasModel = !!(exifData?.Model);
    const hasSoftware = !!(exifData?.Software);
    const hasGps = !!(exifData?.GPSLatitude || exifData?.GPSLongitude);
    const hasDateTime = !!(exifData?.DateTimeOriginal || exifData?.CreateDate);

    // JPEG forensics
    const jpegQualityEst = jpegForensics?.quality_estimate || jpegForensics?.quality || null;
    const chromaSubsampling = jpegForensics?.chroma_subsampling || null;
    const quantizationHash = jpegForensics?.quantization_hash || jpegForensics?.dqt_hash || null;
    const doubleCompressed = jpegForensics?.double_compressed || false;
    const elaScore = jpegForensics?.ela_score || null;
    const ghostScore = jpegForensics?.ghost_score || null;

    // Image quality metrics
    const sharpnessScore = imageMetadata?.sharpness || sensorNoise?.sharpness || null;
    const edgeDensity = imageMetadata?.edge_density || null;
    const entropyScore = imageMetadata?.entropy || null;
    const noiseLevel = sensorNoise?.noise_level || null;
    const sensorConfidence = sensorNoise?.confidence || null;
    const aiAnomalies = sensorNoise?.ai_anomalies || null;

    // Hashes and fingerprints
    const sha256 = fingerprint || null;
    const perceptualHash = phash || null;

    // Screenshot detection features
    const statusBarDetected = screenshotDetection?.status_bar_detected || false;
    const screenshotConfidence = screenshotDetection?.confidence || null;
    const detectedDevice = screenshotDetection?.detected_device || null;
    const isScreenshot = screenshotDetection?.is_screenshot || false;

    // Platform/encoder fingerprinting
    const encoderName = encoderFingerprint?.encoder || null;
    const encoderConfidence = encoderFingerprint?.confidence || null;
    const platformSignature = compressionSignature?.platform || null;

    // Camera verification
    const cameraMatch = cameraVerification?.camera_match || false;
    const cameraScore = cameraVerification?.authenticity_score || null;
    const firmwareValid = cameraVerification?.firmware_valid || null;

    // AI detection results (for labeling)
    const aiConfidence = aiDetection?.confidence || null;
    const aiVerdict = aiDetection?.verdict || null;
    const localAiScore = aiDetection?.local_score || null;
    const jpegAiScore = aiDetection?.jpeg_score || null;
    const ensembleScore = aiDetection?.ensemble_score || null;

    // Google Vision features
    const visionLabelCount = googleVision?.results?.labels?.length || 0;
    const visionSafeSearch = googleVision?.results?.safe_search || null;
    const visionWebEntities = googleVision?.results?.web_entities?.length || 0;

    // Common screenshot dimensions (for training)
    const commonScreenshotWidth = this.isCommonScreenshotWidth(width);
    const commonScreenshotHeight = this.isCommonScreenshotHeight(height);
    const exactScreenshotDimension = this.isExactScreenshotDimension(width, height);

    // Compression analysis features
    const recompressionSource = jpegForensics?.recompression_source || null;
    const qualityBucket = this.getQualityBucket(jpegQualityEst);

      // Context fields
    const mediaKind = data.mediaKind || data.kind || null;
    const sourceEnv = process.env.NODE_ENV === 'production' ? 'prod' : (process.env.NODE_ENV === 'development' ? 'dev' : 'beta');
    const sampleId = data.verificationId || data.sample_id || fingerprint?.substring(0, 16) || null;
  return {
     // Timestamp
      logged_at: new Date().toISOString(),
      
      // Context
      sample_id: sampleId,
      media_kind: mediaKind,
      source_env: sourceEnv,

      // Identifiers (hashed, no raw content)
      sha256,
      perceptual_hash: perceptualHash,
      quantization_hash: quantizationHash,

      // Dimensions
      width,
      height,
      aspect_ratio: aspectRatio,
      orientation,
      total_pixels: totalPixels,

      // File metrics
      file_size_bytes: fileSizeBytes,
      file_size_per_pixel: fileSizePerPixel,
      mime_type: mimeType,

      // EXIF features
      has_exif: hasExif,
      exif_field_count: exifFieldCount,
      has_make: hasMake,
      has_model: hasModel,
      has_software: hasSoftware,
      has_gps: hasGps,
      has_datetime: hasDateTime,

      // JPEG forensics
      jpeg_quality_est: jpegQualityEst,
      quality_bucket: qualityBucket,
      chroma_subsampling: chromaSubsampling,
      double_compressed: doubleCompressed,
      ela_score: elaScore,
      ghost_score: ghostScore,
      recompression_source: recompressionSource,

      // Image quality
      sharpness_score: sharpnessScore,
      edge_density: edgeDensity,
      entropy_score: entropyScore,
      noise_level: noiseLevel,
      sensor_confidence: sensorConfidence,
      ai_anomalies: aiAnomalies,

      // Screenshot features
      status_bar_detected: statusBarDetected,
      screenshot_confidence: screenshotConfidence,
      detected_device: detectedDevice,
      is_screenshot: isScreenshot,
      common_screenshot_width: commonScreenshotWidth,
      common_screenshot_height: commonScreenshotHeight,
      exact_screenshot_dimension: exactScreenshotDimension,

      // Platform/encoder
      encoder_name: encoderName,
      encoder_confidence: encoderConfidence,
      platform_signature: platformSignature,

      // Camera verification
      camera_match: cameraMatch,
      camera_score: cameraScore,
      firmware_valid: firmwareValid,

      // AI detection (labels for training)
      ai_confidence: aiConfidence,
      ai_verdict: aiVerdict,
      local_ai_score: localAiScore,
      jpeg_ai_score: jpegAiScore,
      ensemble_score: ensembleScore,

      // Google Vision
      vision_label_count: visionLabelCount,
      vision_web_entities: visionWebEntities
    };
  }

  /**
   * Check if width matches common screenshot widths
   */
  isCommonScreenshotWidth(width) {
    if (!width) return false;
    const screenshotWidths = [
      320, 375, 390, 393, 414, 428, 430, // iPhone widths
      360, 384, 412, 480, // Android widths
      768, 810, 820, 834, 1024, 1080, 1112, 1194, 1366, // Tablet widths
      1280, 1366, 1440, 1536, 1920, 2560, 3840, // Desktop widths
      1170, 1284, 1290, // iPhone Pro Max
      1179, 1242, 1125, // iPhone Plus/Max retina
    ];
    return screenshotWidths.includes(width);
  }

  /**
   * Check if height matches common screenshot heights
   */
  isCommonScreenshotHeight(height) {
    if (!height) return false;
    const screenshotHeights = [
      568, 667, 736, 812, 844, 852, 896, 926, 932, // iPhone heights
      640, 800, 854, 960, 1280, 1440, 1920, 2160, 2400, // Android heights
      1024, 1080, 1112, 1180, 1194, 1366, 1620, 2048, 2224, 2388, 2732, // Tablet heights
      720, 768, 900, 1080, 1440, 2160, // Desktop heights
      2532, 2556, 2622, 2688, 2778, 2796, // iPhone retina
    ];
    return screenshotHeights.includes(height);
  }

  /**
   * Check if dimensions exactly match known screenshot sizes
   */
  isExactScreenshotDimension(width, height) {
    if (!width || !height) return false;
    const exactDimensions = [
      // iPhones
      '1170x2532', '1284x2778', '1290x2796', // iPhone 12-15 Pro
      '1179x2556', '1242x2688', // iPhone Pro Max
      '1125x2436', '828x1792', '750x1334', // Older iPhones
      // Android common
      '1080x1920', '1080x2340', '1080x2400', '1440x2560', '1440x3200',
      // Tablets
      '2048x2732', '1668x2388', '1620x2160', // iPad Pro
      '1536x2048', '768x1024', // iPad
      // Desktop
      '1920x1080', '2560x1440', '3840x2160',
    ];
    return exactDimensions.includes(`${width}x${height}`) || exactDimensions.includes(`${height}x${width}`);
  }

  /**
   * Bucket quality scores for categorical analysis
   */
  getQualityBucket(quality) {
    if (quality === null || quality === undefined) return null;
    if (quality >= 95) return 'original';
    if (quality >= 85) return 'high';
    if (quality >= 70) return 'medium';
    if (quality >= 50) return 'low';
    return 'very_low';
  }

  /**
   * Write CSV headers
   */
  writeCsvHeaders() {
    const headers = [
      'logged_at',
      'sample_id',
      'media_kind',
      'source_env',
      'sha256',
      'perceptual_hash',
      'quantization_hash',
      'width',
      'height',
      'aspect_ratio',
      'orientation',
      'total_pixels',
      'file_size_bytes',
      'file_size_per_pixel',
      'mime_type',
      'has_exif',
      'exif_field_count',
      'has_make',
      'has_model',
      'has_software',
      'has_gps',
      'has_datetime',
      'jpeg_quality_est',
      'quality_bucket',
      'chroma_subsampling',
      'double_compressed',
      'ela_score',
      'ghost_score',
      'recompression_source',
      'sharpness_score',
      'edge_density',
      'entropy_score',
      'noise_level',
      'sensor_confidence',
      'ai_anomalies',
      'status_bar_detected',
      'screenshot_confidence',
      'detected_device',
      'is_screenshot',
      'common_screenshot_width',
      'common_screenshot_height',
      'exact_screenshot_dimension',
      'encoder_name',
      'encoder_confidence',
      'platform_signature',
      'camera_match',
      'camera_score',
      'firmware_valid',
      'ai_confidence',
      'ai_verdict',
      'local_ai_score',
      'jpeg_ai_score',
      'ensemble_score',
      'vision_label_count',
      'vision_web_entities'
    ];
    
    fs.writeFileSync(this.csvFile, headers.join(',') + '\n');
  }

  /**
   * Append a row to CSV
   */
  appendCsvRow(features) {
    const values = [
      features.logged_at,
      features.sample_id,
      features.media_kind,
      features.source_env,
      features.sha256,
      features.perceptual_hash,
      features.quantization_hash,
      features.width,
      features.height,
      features.aspect_ratio,
      features.orientation,
      features.total_pixels,
      features.file_size_bytes,
      features.file_size_per_pixel,
      features.mime_type,
      features.has_exif,
      features.exif_field_count,
      features.has_make,
      features.has_model,
      features.has_software,
      features.has_gps,
      features.has_datetime,
      features.jpeg_quality_est,
      features.quality_bucket,
      features.chroma_subsampling,
      features.double_compressed,
      features.ela_score,
      features.ghost_score,
      features.recompression_source,
      features.sharpness_score,
      features.edge_density,
      features.entropy_score,
      features.noise_level,
      features.sensor_confidence,
      features.ai_anomalies,
      features.status_bar_detected,
      features.screenshot_confidence,
      features.detected_device,
      features.is_screenshot,
      features.common_screenshot_width,
      features.common_screenshot_height,
      features.exact_screenshot_dimension,
      features.encoder_name,
      features.encoder_confidence,
      features.platform_signature,
      features.camera_match,
      features.camera_score,
      features.firmware_valid,
      features.ai_confidence,
      features.ai_verdict,
      features.local_ai_score,
      features.jpeg_ai_score,
      features.ensemble_score,
      features.vision_label_count,
      features.vision_web_entities
    ].map(v => {
      if (v === null || v === undefined) return '';
      if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    });

    fs.appendFileSync(this.csvFile, values.join(',') + '\n');
  }

  /**
   * Export all data as CSV from database
   */
  async exportCsv(options = {}) {
    const { startDate, endDate, limit } = options;
    
    try {
      if (!db.isAvailable()) {
        // Fallback to file
        if (fs.existsSync(this.csvFile)) {
          return fs.readFileSync(this.csvFile, 'utf8');
        }
        return null;
      }
      
      let query = 'SELECT * FROM ml_features';
      const conditions = [];
      const values = [];
      let paramIndex = 1;
      
      if (startDate) {
        conditions.push(`logged_at >= $${paramIndex++}`);
        values.push(startDate);
      }
      if (endDate) {
        conditions.push(`logged_at <= $${paramIndex++}`);
        values.push(endDate);
      }
      
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      
      query += ' ORDER BY logged_at DESC';
      
      if (limit) {
        query += ` LIMIT $${paramIndex}`;
        values.push(limit);
      }
      
      const result = await db.query(query, values);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      // Convert to CSV
      const headers = Object.keys(result.rows[0]);
      const csvRows = [headers.join(',')];
      
      for (const row of result.rows) {
        const values = headers.map(h => {
          const val = row[h];
          if (val === null || val === undefined) return '';
          if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
            return `"${val.replace(/"/g, '""')}"`;
          }
          if (val instanceof Date) {
            return val.toISOString();
          }
          return val;
        });
        csvRows.push(values.join(','));
      }
      
      return csvRows.join('\n');
    } catch (err) {
      console.error('⚠️ Error exporting ML features:', err.message);
      // Fallback to file
      if (fs.existsSync(this.csvFile)) {
        return fs.readFileSync(this.csvFile, 'utf8');
      }
      return null;
    }
  }

  /**
   * Get feature count
   */
 async getStats() {
    const dirExists = fs.existsSync(this.logDir);
    const jsonlExists = fs.existsSync(this.logFile);
    const csvExists = fs.existsSync(this.csvFile);
    
    let fileCount = 0;
    if (jsonlExists) {
      const content = fs.readFileSync(this.logFile, 'utf8');
      const lines = content.trim().split('\n').filter(l => l.length > 0);
      fileCount = lines.length;
    }
    
    // Get database count
    let dbCount = 0;
    let oldestEntry = null;
    let newestEntry = null;
    try {
      if (db.isAvailable()) {
        const countResult = await db.query('SELECT COUNT(*) as count FROM ml_features');
        dbCount = parseInt(countResult.rows[0].count) || 0;
        
        if (dbCount > 0) {
          const rangeResult = await db.query(`
            SELECT 
              MIN(logged_at) as oldest,
              MAX(logged_at) as newest
            FROM ml_features
          `);
          oldestEntry = rangeResult.rows[0].oldest;
          newestEntry = rangeResult.rows[0].newest;
        }
      }
    } catch (err) {
      console.error('⚠️ Error getting ML features stats:', err.message);
    }
    
    return {
      enabled: this.enabled,
      database: {
        connected: db.isAvailable(),
        count: dbCount,
        oldest_entry: oldestEntry,
        newest_entry: newestEntry
      },
      files: {
        log_dir: this.logDir,
        dir_exists: dirExists,
        jsonl_exists: jsonlExists,
        csv_exists: csvExists,
        file_count: fileCount
      }
    };
  } 
}

module.exports = new FeatureLogger();