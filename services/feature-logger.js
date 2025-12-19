

/**
 * Feature Logger Service
 * Collects technical features for ML model training
 * - Screenshot detection
 * - Provenance inference
 * - Platform fingerprinting
 * - Compression analysis
 * - Camera vs AI heuristics
 */

const fs = require('fs');
const path = require('path');

class FeatureLogger {
  constructor() {
    this.logDir = process.env.FEATURE_LOG_DIR || './ml-training-data';
    this.logFile = path.join(this.logDir, 'features.jsonl');
    this.csvFile = path.join(this.logDir, 'features.csv');
    this.enabled = process.env.FEATURE_LOGGING_ENABLED !== 'false';
    
    // Ensure log directory exists
    if (this.enabled && !fs.existsSync(this.logDir)) {
      try {
        fs.mkdirSync(this.logDir, { recursive: true });
        console.log('📊 Feature logging directory created:', this.logDir);
      } catch (err) {
        console.error('⚠️ Could not create feature log directory:', err.message);
        this.enabled = false;
      }
    }
    
    // Initialize CSV with headers if it doesn't exist
    if (this.enabled && !fs.existsSync(this.csvFile)) {
      this.writeCsvHeaders();
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
      
      // Write to JSONL (one JSON object per line)
      fs.appendFileSync(this.logFile, JSON.stringify(features) + '\n');
      
      // Write to CSV
      this.appendCsvRow(features);
      
      console.log('📊 Features logged for ML training');
    } catch (err) {
      console.error('⚠️ Feature logging error:', err.message);
    }
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
   * Export all data as CSV (for manual download)
   */
  exportCsv() {
    if (!fs.existsSync(this.csvFile)) {
      return null;
    }
    return fs.readFileSync(this.csvFile, 'utf8');
  }

  /**
   * Get feature count
   */
  getStats() {
    const dirExists = fs.existsSync(this.logDir);
    const jsonlExists = fs.existsSync(this.logFile);
    const csvExists = fs.existsSync(this.csvFile);
    
    let count = 0;
    if (jsonlExists) {
      const content = fs.readFileSync(this.logFile, 'utf8');
      const lines = content.trim().split('\n').filter(l => l.length > 0);
      count = lines.length;
    }
    
    return {
      enabled: this.enabled,
      log_dir: this.logDir,
      dir_exists: dirExists,
      jsonl_file: this.logFile,
      jsonl_exists: jsonlExists,
      csv_file: this.csvFile,
      csv_exists: csvExists,
      count: count
    };
  } 
}

module.exports = new FeatureLogger();