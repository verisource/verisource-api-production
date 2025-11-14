/**
 * AI Content Generator Detection Service
 * Combined detector for both images and videos
 * Identifies specific generators: Sora, Sora 2, Runway, Pika, Kling, Midjourney, DALL-E, Stable Diffusion, Firefly
 */

const sharp = require('sharp');
const path = require('path');

class AIGeneratorDetector {
  constructor() {
    this.indicators = [];
    this.confidence = 0;
    this.contentType = null; // 'image' or 'video'
  }

  /**
   * Main entry point - automatically detects content type and analyzes
   * @param {string} filePath - Path to image or video
   * @param {Object} options - Additional options
   * @param {Object} options.existingAnalysis - Results from your current AI detection
   * @param {Array} options.videoFrames - For videos: array of frame analysis results
   * @param {Object} options.temporalAnalysis - For videos: temporal consistency data
   * @param {Object} options.metadata - File metadata
   * @returns {Object} Generator detection results
   */
  async analyze(filePath, options = {}) {
    const ext = path.extname(filePath).toLowerCase();
    const videoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.m4v'];
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];

    if (videoExtensions.includes(ext)) {
      this.contentType = 'video';
      return this.analyzeVideo(options.videoFrames, options.temporalAnalysis, options.metadata);
    } else if (imageExtensions.includes(ext)) {
      this.contentType = 'image';
      return this.analyzeImage(filePath, options.existingAnalysis, options.metadata);
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }
  }

  /**
   * Analyze video for AI generator signatures
   */
  async analyzeVideo(frames, temporalAnalysis, metadata) {
    this.indicators = [];
    let scores = this.initializeScores();
    let totalScore = 0;
    const maxScore = 150;

    if (!frames || frames.length === 0) {
      return this.createEmptyResult('video', 'No frames available for analysis');
    }

    // 1. Temporal morphing analysis
    const morphingScore = this.detectTemporalMorphing(frames);
    totalScore += morphingScore.score;
    this.mergeVideoScores(scores, morphingScore, 'morphing');
    if (morphingScore.detected) {
      this.indicators.push(...morphingScore.indicators);
    }

    // 2. Physics/consistency violations
    const physicsScore = this.detectPhysicsViolations(frames);
    totalScore += physicsScore.score;
    this.mergeVideoScores(scores, physicsScore, 'physics');
    if (physicsScore.detected) {
      this.indicators.push(...physicsScore.indicators);
    }

    // 3. Frame hash patterns
    const hashScore = this.analyzeHashPatterns(frames);
    totalScore += hashScore.score;
    this.mergeVideoScores(scores, hashScore, 'hash');
    if (hashScore.detected) {
      this.indicators.push(...hashScore.indicators);
    }

    // 4. Video format analysis
    const formatScore = this.analyzeVideoFormat(metadata);
    totalScore += formatScore.score;
    this.mergeVideoScores(scores, formatScore, 'format');
    if (formatScore.detected) {
      this.indicators.push(...formatScore.indicators);
    }

    // 5. Smoothness patterns
    const smoothnessScore = this.detectVideoSmoothness(frames);
    totalScore += smoothnessScore.score;
    this.mergeVideoScores(scores, smoothnessScore, 'smoothness');
    if (smoothnessScore.detected) {
      this.indicators.push(...smoothnessScore.indicators);
    }

    // 6. Camera motion analysis (Sora 2 specific)
    const cameraScore = this.analyzeCameraMotion(frames, temporalAnalysis);
    totalScore += cameraScore.score;
    this.mergeVideoScores(scores, cameraScore, 'camera');
    if (cameraScore.detected) {
      this.indicators.push(...cameraScore.indicators);
    }

    // 7. Lighting consistency (Sora 2 specific)
    const lightingScore = this.analyzeLightingConsistency(frames);
    totalScore += lightingScore.score;
    this.mergeVideoScores(scores, lightingScore, 'lighting');
    if (lightingScore.detected) {
      this.indicators.push(...lightingScore.indicators);
    }

    // 8. Compression patterns
    const compressionScore = this.analyzeCompressionPatterns(frames);
    totalScore += compressionScore.score;
    if (compressionScore.detected) {
      this.indicators.push(...compressionScore.indicators);
    }

    this.confidence = Math.min(100, Math.round((totalScore / maxScore) * 100));
    const probabilities = this.calculateVideoProbabilities(scores);
    const likelyGenerator = this.getLikelyGenerator(probabilities);
    const verdict = this.getVideoVerdict(this.confidence, likelyGenerator);

    return {
      contentType: 'video',
      isAIGenerated: this.confidence >= 50,
      confidence: this.confidence,
      likelyGenerator: likelyGenerator,
      likelyVersion: this.detectSoraVersion(metadata, scores),
      verdict: verdict,
      probabilities: probabilities,
      indicators: this.indicators,
      analysisDetails: {
        temporalMorphing: morphingScore,
        physicsViolations: physicsScore,
        hashPatterns: hashScore,
        formatAnalysis: formatScore,
        smoothnessAnalysis: smoothnessScore,
        cameraMotion: cameraScore,
        lightingConsistency: lightingScore,
        compressionPatterns: compressionScore
      }
    };
  }

  /**
   * Analyze image for AI generator signatures
   */
  async analyzeImage(imagePath, existingAnalysis = {}, providedMetadata = {}) {
    this.indicators = [];
    let scores = this.initializeScores();

    try {
      const image = sharp(imagePath);
      const metadata = providedMetadata.width ? providedMetadata : await image.metadata();
      const stats = await image.stats();

      // 1. Resolution/Aspect Ratio Analysis
      const aspectScore = this.analyzeAspectRatio(metadata);
      this.mergeScores(scores, aspectScore.scores);
      if (aspectScore.indicators.length) {
        this.indicators.push(...aspectScore.indicators);
      }

      // 2. Color Profile Analysis
      const colorScore = this.analyzeColorProfile(stats, metadata);
      this.mergeScores(scores, colorScore.scores);
      if (colorScore.indicators.length) {
        this.indicators.push(...colorScore.indicators);
      }

      // 3. Noise Pattern Analysis
      const noiseScore = await this.analyzeNoisePatterns(imagePath);
      this.mergeScores(scores, noiseScore.scores);
      if (noiseScore.indicators.length) {
        this.indicators.push(...noiseScore.indicators);
      }

      // 4. Edge Characteristics
      const edgeScore = await this.analyzeEdgeCharacteristics(imagePath);
      this.mergeScores(scores, edgeScore.scores);
      if (edgeScore.indicators.length) {
        this.indicators.push(...edgeScore.indicators);
      }

      // 5. Texture Analysis
      const textureScore = await this.analyzeTexturePatterns(imagePath);
      this.mergeScores(scores, textureScore.scores);
      if (textureScore.indicators.length) {
        this.indicators.push(...textureScore.indicators);
      }

      // 6. Metadata Signatures
      const metaScore = this.analyzeMetadataSignatures(metadata);
      this.mergeScores(scores, metaScore.scores);
      if (metaScore.indicators.length) {
        this.indicators.push(...metaScore.indicators);
      }

      // 7. Incorporate existing AI detection
      if (existingAnalysis && existingAnalysis.ai_confidence) {
        const existingScore = this.incorporateExistingAnalysis(existingAnalysis);
        this.mergeScores(scores, existingScore.scores);
      }

      const probabilities = this.calculateImageProbabilities(scores);
      const likelyGenerator = this.getLikelyGenerator(probabilities);
      this.confidence = Math.max(...Object.values(probabilities));
      const verdict = this.getImageVerdict(this.confidence, likelyGenerator);

      return {
        contentType: 'image',
        isAIGenerated: this.confidence > 50,
        confidence: this.confidence,
        likelyGenerator: likelyGenerator,
        verdict: verdict,
        probabilities: probabilities,
        indicators: this.indicators,
        analysisDetails: {
          aspectRatio: aspectScore,
          colorProfile: colorScore,
          noisePatterns: noiseScore,
          edgeCharacteristics: edgeScore,
          texturePatterns: textureScore,
          metadataSignatures: metaScore
        }
      };

    } catch (error) {
      console.error('AI generator detection error:', error);
      return this.createEmptyResult('image', error.message);
    }
  }

  // ========== VIDEO ANALYSIS METHODS ==========

  detectTemporalMorphing(frames) {
    if (!frames || frames.length < 3) {
      return { detected: false, score: 0, indicators: [], microMorphingRatio: 0 };
    }

    let morphingCount = 0;
    let microMorphingCount = 0;
    const indicators = [];

    for (let i = 1; i < frames.length; i++) {
      const prevHash = frames[i-1].phash;
      const currHash = frames[i].phash;
      
      if (prevHash && currHash) {
        const similarity = this.calculateHashSimilarity(prevHash, currHash);
        
        if (similarity > 0.98 && similarity < 1.0) {
          morphingCount++;
        }
        
        if (similarity > 0.995 && similarity < 1.0) {
          microMorphingCount++;
        }
        
        if (similarity < 0.7 && i < frames.length - 1) {
          const nextSimilarity = this.calculateHashSimilarity(currHash, frames[i+1].phash);
          if (nextSimilarity > 0.9) {
            indicators.push(`Sudden visual jump at frame ${i}`);
            morphingCount += 2;
          }
        }
      }
    }

    const morphingRatio = morphingCount / frames.length;
    const microMorphingRatio = microMorphingCount / frames.length;
    const detected = morphingRatio > 0.3 || microMorphingRatio > 0.5;
    let score = Math.min(25, Math.round(morphingRatio * 50));
    
    if (microMorphingRatio > 0.5) {
      score += 8;
      indicators.push(`Sora 2 micro-morphing: ${(microMorphingRatio * 100).toFixed(1)}%`);
    }

    if (morphingRatio > 0.3) {
      indicators.push(`Temporal morphing: ${(morphingRatio * 100).toFixed(1)}%`);
    }

    return { detected, score, indicators, microMorphingRatio, morphingRatio };
  }

  detectPhysicsViolations(frames) {
    if (!frames || frames.length < 2) {
      return { detected: false, score: 0, indicators: [], avgConfidence: 0, stdDev: 0 };
    }

    const aiConfidences = frames
      .filter(f => f.aiDetection)
      .map(f => f.aiDetection.ai_confidence);

    if (aiConfidences.length < 2) {
      return { detected: false, score: 0, indicators: [], avgConfidence: 0, stdDev: 0 };
    }

    const avg = aiConfidences.reduce((a, b) => a + b, 0) / aiConfidences.length;
    const variance = aiConfidences.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / aiConfidences.length;
    const stdDev = Math.sqrt(variance);

    const indicators = [];
    let score = 0;

    if (stdDev < 2 && avg > 70) {
      indicators.push(`Consistent AI detection (σ=${stdDev.toFixed(2)})`);
      score += 15;
    }

    if (stdDev < 1 && avg > 60) {
      indicators.push(`Ultra-consistent (Sora 2 pattern)`);
      score += 12;
    }

    const allAI = aiConfidences.every(c => c > 70);
    if (allAI) {
      indicators.push('All frames flagged as AI');
      score += 10;
    }

    const range = Math.max(...aiConfidences) - Math.min(...aiConfidences);
    if (range < 5 && aiConfidences.length > 5) {
      indicators.push('Perfect AI confidence distribution');
      score += 8;
    }

    return { detected: score > 0, score, indicators, avgConfidence: avg, stdDev };
  }

  analyzeHashPatterns(frames) {
    if (!frames || frames.length < 5) {
      return { detected: false, score: 0, indicators: [] };
    }

    const indicators = [];
    let score = 0;

    const hashPrefixes = frames.map(f => f.phash?.substring(0, 8) || '');
    const uniquePrefixes = new Set(hashPrefixes).size;
    const repetitionRatio = 1 - (uniquePrefixes / hashPrefixes.length);

    if (repetitionRatio > 0.3) {
      indicators.push(`Hash repetition: ${(repetitionRatio * 100).toFixed(1)}%`);
      score += 12;
    }

    let tooSimilarCount = 0;
    for (let i = 1; i < frames.length; i++) {
      const similarity = this.calculateHashSimilarity(frames[i-1].phash || '', frames[i].phash || '');
      if (similarity > 0.95) {
        tooSimilarCount++;
      }
    }

    const smoothnessRatio = tooSimilarCount / (frames.length - 1);
    if (smoothnessRatio > 0.6) {
      indicators.push(`Smooth transitions: ${(smoothnessRatio * 100).toFixed(1)}%`);
      score += 12;
    }

    return { detected: score > 0, score, indicators };
  }

  analyzeVideoFormat(metadata) {
    if (!metadata) {
      return { detected: false, score: 0, indicators: [], likelyVersion: 'unknown' };
    }

    const indicators = [];
    let score = 0;
    let likelyVersion = 'unknown';

    const duration = metadata.duration || 0;
    
    // Sora 1: 5-20 seconds
    // Sora 2: up to 60+ seconds
    // Runway: 4-16 seconds
    // Pika: 3-15 seconds
    // Kling: up to 5 minutes
    
    if (duration > 25 && duration <= 120) {
      indicators.push(`Duration ${duration.toFixed(1)}s (Sora 2/Kling range)`);
      score += 10;
      likelyVersion = 'sora2';
    } else if (duration > 0 && duration <= 20) {
      indicators.push(`Duration ${duration.toFixed(1)}s (Sora 1/Runway/Pika range)`);
      score += 8;
      likelyVersion = 'sora1';
    }

    const width = metadata.width || 0;
    const height = metadata.height || 0;
    
    if (width >= 3840 || height >= 2160) {
      indicators.push(`4K resolution (Sora 2)`);
      score += 12;
      likelyVersion = 'sora2';
    } else if (width === 1920 && height === 1080) {
      indicators.push('1080p (standard AI output)');
      score += 8;
    } else if (width === 1280 && height === 720) {
      indicators.push('720p (common AI resolution)');
      score += 8;
    }

    if (metadata.codec === 'h265') {
      indicators.push('H.265 codec (Sora 2)');
      score += 5;
      likelyVersion = 'sora2';
    } else if (metadata.codec === 'h264') {
      indicators.push('H.264 codec');
      score += 3;
    }

    if (metadata.size && duration) {
      const bitrateKbps = (metadata.size * 8) / (duration * 1000);
      if (bitrateKbps > 10000) {
        indicators.push(`High bitrate ${Math.round(bitrateKbps)} kbps`);
        score += 6;
      }
    }

    return { detected: score > 5, score, indicators, likelyVersion };
  }

  detectVideoSmoothness(frames) {
    if (!frames || frames.length < 2) {
      return { detected: false, score: 0, indicators: [] };
    }

    const indicators = [];
    let smoothnessIssues = 0;

    frames.forEach(frame => {
      if (frame.aiDetection?.indicators) {
        const smoothIndicators = frame.aiDetection.indicators.filter(i =>
          i.toLowerCase().includes('smooth') ||
          i.toLowerCase().includes('low noise') ||
          i.toLowerCase().includes('texture')
        );
        if (smoothIndicators.length >= 2) {
          smoothnessIssues++;
        }
      }
    });

    const smoothnessRatio = smoothnessIssues / frames.length;
    const score = Math.min(18, Math.round(smoothnessRatio * 24));
    const detected = smoothnessRatio > 0.7;

    if (detected) {
      indicators.push(`${(smoothnessRatio * 100).toFixed(0)}% frames unnaturally smooth`);
    }

    return { detected, score, indicators };
  }

  analyzeCameraMotion(frames, temporalAnalysis) {
    const indicators = [];
    let score = 0;

    if (temporalAnalysis) {
      if (temporalAnalysis.is_consistent && temporalAnalysis.variance_percent === 0) {
        indicators.push('Perfect frame rate (AI stabilization)');
        score += 12;
      }

      if (!temporalAnalysis.inconsistencies_detected) {
        indicators.push('No temporal inconsistencies');
        score += 10;
      }
    }

    if (frames && frames.length > 5) {
      let perfectTransitions = 0;
      for (let i = 2; i < frames.length; i++) {
        const sim1 = this.calculateHashSimilarity(frames[i-2].phash || '', frames[i-1].phash || '');
        const sim2 = this.calculateHashSimilarity(frames[i-1].phash || '', frames[i].phash || '');
        
        if (Math.abs(sim1 - sim2) < 0.01) {
          perfectTransitions++;
        }
      }
      
      const perfectionRatio = perfectTransitions / (frames.length - 2);
      if (perfectionRatio > 0.7) {
        indicators.push(`Uniform camera motion: ${(perfectionRatio * 100).toFixed(1)}%`);
        score += 10;
      }
    }

    return { detected: score > 0, score, indicators };
  }

  analyzeLightingConsistency(frames) {
    if (!frames || frames.length < 3) {
      return { detected: false, score: 0, indicators: [] };
    }

    const indicators = [];
    let score = 0;

    const colorDistributions = frames.map(f => {
      const inds = f.aiDetection?.indicators || [];
      return inds.some(i => i.includes('color distribution') || i.includes('saturation'));
    });

    const consistentColorIssues = colorDistributions.filter(Boolean).length;
    const colorConsistencyRatio = consistentColorIssues / frames.length;

    if (colorConsistencyRatio > 0.9) {
      indicators.push(`Lighting consistency: ${(colorConsistencyRatio * 100).toFixed(0)}%`);
      score += 12;
    }

    if (colorConsistencyRatio === 1) {
      indicators.push('Perfect lighting (Sora 2 signature)');
      score += 8;
    }

    return { detected: score > 0, score, indicators };
  }

  analyzeCompressionPatterns(frames) {
    if (!frames || frames.length < 3) {
      return { detected: false, score: 0, indicators: [] };
    }

    const indicators = [];
    let score = 0;

    const formats = frames.map(f => f.aiDetection?.metadata_check?.format).filter(Boolean);
    const uniqueFormats = new Set(formats).size;

    if (uniqueFormats === 1 && formats.length > 5) {
      indicators.push('Identical compression');
      score += 6;
    }

    const dimensions = frames.map(f => f.aiDetection?.metadata_check?.dimensions).filter(Boolean);
    const uniqueDimensions = new Set(dimensions).size;

    if (uniqueDimensions === 1 && dimensions.length > 5) {
      score += 6;
    }

    return { detected: score > 0, score, indicators };
  }

  // ========== IMAGE ANALYSIS METHODS ==========

  analyzeAspectRatio(metadata) {
    const { width, height } = metadata;
    if (!width || !height) {
      return { scores: this.initializeScores(), indicators: [] };
    }

    const aspectRatio = width / height;
    const indicators = [];
    const scores = this.initializeScores();

    // Check common AI generator resolutions
    const resolutionSignatures = [
      { w: 1920, h: 1080, gens: ['sora', 'runway', 'kling'], points: 10, name: '1080p' },
      { w: 1280, h: 720, gens: ['sora', 'pika', 'runway'], points: 10, name: '720p' },
      { w: 3840, h: 2160, gens: ['sora'], points: 15, name: '4K (Sora 2)' },
      { w: 1024, h: 1024, gens: ['midjourney', 'dalle', 'stableDiffusion'], points: 12, name: 'Square' },
      { w: 1456, h: 816, gens: ['midjourney'], points: 15, name: 'Midjourney v6' },
      { w: 1792, h: 1024, gens: ['dalle'], points: 18, name: 'DALL-E 3 landscape' },
      { w: 1024, h: 1792, gens: ['dalle'], points: 18, name: 'DALL-E 3 portrait' },
      { w: 512, h: 512, gens: ['stableDiffusion'], points: 15, name: 'SD 1.x' },
      { w: 768, h: 768, gens: ['stableDiffusion'], points: 12, name: 'SD medium' }
    ];

    resolutionSignatures.forEach(sig => {
      if ((width === sig.w && height === sig.h) || (width === sig.h && height === sig.w)) {
        indicators.push(`${sig.name} resolution (${sig.gens.join('/')})`);
        sig.gens.forEach(gen => {
          if (scores[gen] !== undefined) scores[gen] += sig.points;
        });
      }
    });

    // Check aspect ratios
    const aspectSignatures = [
      { ratio: 16/9, gens: ['sora', 'runway', 'kling'], points: 8 },
      { ratio: 9/16, gens: ['sora', 'pika'], points: 8 },
      { ratio: 1, gens: ['midjourney', 'dalle', 'stableDiffusion'], points: 10 },
      { ratio: 21/9, gens: ['sora'], points: 12 }
    ];

    aspectSignatures.forEach(sig => {
      if (Math.abs(aspectRatio - sig.ratio) < 0.02) {
        sig.gens.forEach(gen => {
          if (scores[gen] !== undefined) scores[gen] += sig.points;
        });
      }
    });

    return { scores, indicators };
  }

  analyzeColorProfile(stats, metadata) {
    const indicators = [];
    const scores = this.initializeScores();

    const channels = stats.channels;
    if (!channels || channels.length < 3) {
      return { scores, indicators };
    }

    const [r, g, b] = channels;

    // Cinematic color grading (Sora)
    const liftedBlacks = r.min > 10 && g.min > 10 && b.min > 10;
    const compressedHighlights = r.max < 250 && g.max < 250 && b.max < 250;
    if (liftedBlacks && compressedHighlights) {
      scores.sora += 12;
      scores.runway += 8;
      indicators.push('Cinematic color grading');
    }

    // Saturation analysis
    const maxVal = Math.max(r.mean, g.mean, b.mean);
    const minVal = Math.min(r.mean, g.mean, b.mean);
    const saturation = maxVal > 0 ? (maxVal - minVal) / maxVal : 0;

    if (saturation > 0.7) {
      scores.pika += 10;
      scores.midjourney += 8;
      indicators.push('High saturation (Pika/Midjourney)');
    } else if (saturation < 0.4 && saturation > 0.2) {
      scores.kling += 8;
      scores.firefly += 6;
      indicators.push('Natural tones (Kling/Firefly)');
    }

    // Color balance
    const colorBalance = Math.abs(r.mean - g.mean) + Math.abs(g.mean - b.mean);
    if (colorBalance < 20) {
      scores.dalle += 8;
      indicators.push('Balanced colors (DALL-E)');
    }

    // Contrast
    const contrast = (r.max - r.min + g.max - g.min + b.max - b.min) / 3;
    if (contrast > 200) {
      scores.midjourney += 10;
      indicators.push('High contrast (Midjourney)');
    }

    return { scores, indicators };
  }

  async analyzeNoisePatterns(imagePath) {
    const indicators = [];
    const scores = this.initializeScores();

    try {
      const { data } = await sharp(imagePath).grayscale().raw().toBuffer({ resolveWithObject: true });

      let noiseSum = 0;
      for (let i = 1; i < data.length; i++) {
        noiseSum += Math.abs(data[i] - data[i-1]);
      }
      const avgNoise = noiseSum / data.length;

      if (avgNoise < 5) {
        scores.sora += 8;
        scores.dalle += 10;
        scores.runway += 6;
        indicators.push('Extremely low noise');
      } else if (avgNoise < 10) {
        scores.midjourney += 8;
        scores.pika += 6;
        scores.kling += 6;
        indicators.push('Low noise levels');
      }

      if (avgNoise > 3 && avgNoise < 8) {
        scores.sora += 4;
        indicators.push('Subtle film grain (Sora 2)');
      }
    } catch (error) {
      // Continue without noise analysis
    }

    return { scores, indicators };
  }

  async analyzeEdgeCharacteristics(imagePath) {
    const indicators = [];
    const scores = this.initializeScores();

    try {
      const edgeData = await sharp(imagePath)
        .grayscale()
        .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
        .raw()
        .toBuffer();

      let edgeSum = 0;
      let strongEdges = 0;
      for (let i = 0; i < edgeData.length; i++) {
        edgeSum += edgeData[i];
        if (edgeData[i] > 100) strongEdges++;
      }
      const avgEdge = edgeSum / edgeData.length;
      const strongEdgeRatio = strongEdges / edgeData.length;

      if (avgEdge < 15 && strongEdgeRatio < 0.05) {
        scores.dalle += 12;
        scores.firefly += 10;
        indicators.push('Very clean edges (DALL-E/Firefly)');
      }

      if (avgEdge > 10 && avgEdge < 25) {
        scores.midjourney += 8;
        indicators.push('Artistic edge softness (Midjourney)');
      }

      if (avgEdge > 15 && avgEdge < 30) {
        scores.sora += 6;
        scores.runway += 6;
        indicators.push('Cinematic edge quality');
      }
    } catch (error) {
      // Continue
    }

    return { scores, indicators };
  }

  async analyzeTexturePatterns(imagePath) {
    const indicators = [];
    const scores = this.initializeScores();

    try {
      const { data } = await sharp(imagePath)
        .resize(256, 256)
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const blockSize = 16;
      const variances = [];
      
      for (let y = 0; y < 256; y += blockSize) {
        for (let x = 0; x < 256; x += blockSize) {
          const blockPixels = [];
          for (let dy = 0; dy < blockSize; dy++) {
            for (let dx = 0; dx < blockSize; dx++) {
              const idx = (y + dy) * 256 + (x + dx);
              if (idx < data.length) blockPixels.push(data[idx]);
            }
          }
          if (blockPixels.length > 0) {
            const mean = blockPixels.reduce((a, b) => a + b, 0) / blockPixels.length;
            const variance = blockPixels.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / blockPixels.length;
            variances.push(variance);
          }
        }
      }

      if (variances.length > 0) {
        const avgVariance = variances.reduce((a, b) => a + b, 0) / variances.length;
        const varianceOfVariances = variances.reduce((sum, val) => sum + Math.pow(val - avgVariance, 2), 0) / variances.length;

        if (varianceOfVariances < 100) {
          scores.dalle += 8;
          scores.sora += 6;
          indicators.push('Uniform texture (AI pattern)');
        }

        if (varianceOfVariances > 500 && varianceOfVariances < 2000) {
          scores.midjourney += 10;
          indicators.push('Artistic texture (Midjourney)');
        }
      }
    } catch (error) {
      // Continue
    }

    return { scores, indicators };
  }

  analyzeMetadataSignatures(metadata) {
    const indicators = [];
    const scores = this.initializeScores();

    if (!metadata.exif) {
      indicators.push('No EXIF data');
      Object.keys(scores).forEach(key => scores[key] += 3);
    }

    if (metadata.space === 'srgb') {
      scores.dalle += 3;
      scores.midjourney += 3;
    }

    return { scores, indicators };
  }

  incorporateExistingAnalysis(existingAnalysis) {
    const scores = this.initializeScores();
    const confidence = existingAnalysis.ai_confidence || 0;

    if (confidence > 70) {
      Object.keys(scores).forEach(key => scores[key] += 8);
    } else if (confidence > 50) {
      Object.keys(scores).forEach(key => scores[key] += 4);
    }

    const indicators = existingAnalysis.indicators || [];
    indicators.forEach(ind => {
      const indLower = ind.toLowerCase();
      if (indLower.includes('smooth') || indLower.includes('texture')) {
        scores.dalle += 2;
        scores.midjourney += 2;
      }
      if (indLower.includes('saturation')) {
        scores.pika += 2;
        scores.midjourney += 2;
      }
    });

    return { scores };
  }

  // ========== UTILITY METHODS ==========

  initializeScores() {
    return {
      sora: 0,
      runway: 0,
      pika: 0,
      kling: 0,
      midjourney: 0,
      dalle: 0,
      stableDiffusion: 0,
      firefly: 0
    };
  }

  mergeScores(target, source) {
    Object.keys(source).forEach(key => {
      if (target[key] !== undefined) {
        target[key] += source[key];
      }
    });
  }

  mergeVideoScores(scores, analysisResult, type) {
    // Sora/Runway/Kling for videos primarily
    if (analysisResult.score > 10) {
      scores.sora += analysisResult.score * 0.4;
      scores.runway += analysisResult.score * 0.3;
      scores.kling += analysisResult.score * 0.2;
      scores.pika += analysisResult.score * 0.1;
    }
  }

  calculateHashSimilarity(hash1, hash2) {
    if (!hash1 || !hash2 || hash1.length !== hash2.length) return 0;
    let matches = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] === hash2[i]) matches++;
    }
    return matches / hash1.length;
  }

  calculateVideoProbabilities(scores) {
    // For videos, focus on video-capable generators
    const videoScores = {
      sora: scores.sora,
      runway: scores.runway,
      pika: scores.pika,
      kling: scores.kling
    };

    const total = Object.values(videoScores).reduce((a, b) => a + b, 0) || 1;
    const probabilities = {};
    
    Object.keys(videoScores).forEach(key => {
      probabilities[key] = Math.round((videoScores[key] / total) * 100);
    });

    return probabilities;
  }

  calculateImageProbabilities(scores) {
    const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
    const probabilities = {};
    
    Object.keys(scores).forEach(key => {
      probabilities[key] = Math.round((scores[key] / total) * 100);
    });

    return probabilities;
  }

  getLikelyGenerator(probabilities) {
    let maxProb = 0;
    let likely = 'unknown';

    Object.entries(probabilities).forEach(([gen, prob]) => {
      if (prob > maxProb) {
        maxProb = prob;
        likely = gen;
      }
    });

    return likely;
  }

  detectSoraVersion(metadata, scores) {
    if (!metadata) return 'unknown';

    let sora1Points = 0;
    let sora2Points = 0;

    const duration = metadata.duration || 0;
    if (duration > 25) sora2Points += 3;
    else if (duration <= 20) sora1Points += 2;

    const width = metadata.width || 0;
    if (width >= 3840) sora2Points += 4;
    else if (width >= 1920) sora2Points += 1;

    if (metadata.codec === 'h265') sora2Points += 2;

    if (sora2Points > sora1Points) return 'sora2';
    if (sora1Points > sora2Points) return 'sora1';
    return 'unknown';
  }

  getVideoVerdict(confidence, likelyGenerator) {
    if (confidence >= 85) return `HIGHLY_LIKELY_${likelyGenerator.toUpperCase()}`;
    if (confidence >= 70) return `LIKELY_${likelyGenerator.toUpperCase()}`;
    if (confidence >= 55) return 'PROBABLE_AI_VIDEO';
    if (confidence >= 40) return 'POSSIBLE_AI_GENERATED';
    if (confidence >= 25) return 'LOW_AI_INDICATORS';
    return 'UNLIKELY_AI_GENERATED';
  }

  getImageVerdict(confidence, likelyGenerator) {
    if (confidence >= 80) return `HIGHLY_LIKELY_${likelyGenerator.toUpperCase()}`;
    if (confidence >= 65) return `LIKELY_${likelyGenerator.toUpperCase()}`;
    if (confidence >= 50) return 'PROBABLE_AI_IMAGE';
    if (confidence >= 35) return 'POSSIBLE_AI_GENERATED';
    if (confidence >= 20) return 'LOW_AI_INDICATORS';
    return 'UNLIKELY_AI_GENERATED';
  }

  createEmptyResult(contentType, error) {
    return {
      contentType: contentType,
      isAIGenerated: false,
      confidence: 0,
      likelyGenerator: 'unknown',
      verdict: 'ANALYSIS_FAILED',
      probabilities: {},
      indicators: [],
      error: error
    };
  }
}

module.exports = AIGeneratorDetector;
