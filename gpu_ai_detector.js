/**
 * VeriSource GPU AI Detector
 * ==========================
 * Calls the RunPod GPU inference service for:
 *   1. Binary AI detection (AI vs authentic) — CLIP + Frequency CNN ensemble
 *   2. Generator classification — which AI tool produced the image
 *
 * The GPU service runs on RunPod at the URL stored in RUNPOD_ENDPOINT.
 * Falls back gracefully if the service is unavailable.
 *
 * OOD Thresholds for generator classification:
 *   > 80% confidence  → specific generator label
 *   50-80% confidence → "possibly_[generator]"
 *   < 50% confidence  → "unknown_generator"
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const RUNPOD_ENDPOINT = process.env.RUNPOD_ENDPOINT || '';
const RUNPOD_TIMEOUT = parseInt(process.env.RUNPOD_TIMEOUT || '30000', 10);

// OOD confidence thresholds
const OOD_HIGH_THRESHOLD   = 0.80;
const OOD_MEDIUM_THRESHOLD = 0.50;

const GENERATOR_DISPLAY_NAMES = {
  'authentic':        'Authentic Photo',
  'stable_diffusion': 'Stable Diffusion',
  'sdxl_realistic':   'SDXL / Realistic Vision',
  'flux':             'Flux.1',
  'dall_e_3':         'DALL-E 3',
  'grok':             'Grok (xAI)',
  'gemini_flash':     'Gemini Flash Image (Nano Banana)',
  'unknown_generator':'Unknown Generator',
};

class GPUAIDetector {

  /**
   * Check if the RunPod GPU service is configured and reachable.
   */
  static isAvailable() {
    return !!(RUNPOD_ENDPOINT && RUNPOD_ENDPOINT.startsWith('http'));
  }

  /**
   * Detect if an image is AI-generated using the GPU ensemble classifier.
   * Uses CLIP ViT-L/14 + Frequency CNN trained on 100K+ images.
   *
   * @param {string} imagePath - Local path to image file
   * @returns {Object} { isAI, confidence, ai_confidence, provider, score, details }
   */
  static async detectAI(imagePath) {
    if (!this.isAvailable()) {
      return {
        isAI: false,
        confidence: 0,
        ai_confidence: 0,
        provider: 'gpu_unavailable',
        score: 0,
        details: 'GPU service not configured',
        error: true,
      };
    }

    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(imagePath));

      const response = await axios.post(
        `${RUNPOD_ENDPOINT}/detect`,
        form,
        {
          headers: form.getHeaders(),
          timeout: RUNPOD_TIMEOUT,
        }
      );

      const { is_ai, confidence, clip_score, freq_score, ensemble_score } = response.data;
      const aiConfidence = Math.round((confidence || ensemble_score || 0) * 100 * 10) / 10;

      return {
        isAI: is_ai,
        confidence: confidence || ensemble_score || 0,
        ai_confidence: aiConfidence,
        likely_ai_generated: is_ai,
        provider: 'gpu_ensemble',
        score: ensemble_score || confidence || 0,
        details: {
          clip_score: clip_score || null,
          freq_score: freq_score || null,
          ensemble_score: ensemble_score || null,
        },
      };

    } catch (err) {
      console.warn(`⚠️  GPU AI detection failed: ${err.message}`);
      return {
        isAI: false,
        confidence: 0,
        ai_confidence: 0,
        provider: 'gpu_error',
        score: 0,
        details: err.message,
        error: true,
      };
    }
  }

  /**
   * Classify which AI generator produced an image.
   * Only call this when detectAI() returns isAI=true.
   *
   * @param {string} imagePath - Local path to image file
   * @returns {Object} { generator, display_name, verdict_message, confidence, ood_level, top_candidates }
   */
  static async classifyGenerator(imagePath) {
    if (!this.isAvailable()) {
      return this._formatGeneratorResult('unknown_generator', 0, 'unavailable', {});
    }

    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(imagePath));

      const response = await axios.post(
        `${RUNPOD_ENDPOINT}/classify-generator`,
        form,
        {
          headers: form.getHeaders(),
          timeout: RUNPOD_TIMEOUT,
        }
      );

      const { generator, confidence, raw_scores } = response.data;
      return this._formatGeneratorResult(generator, confidence, 'ok', raw_scores || {});

    } catch (err) {
      console.warn(`⚠️  Generator classification failed: ${err.message}`);
      return this._formatGeneratorResult('unknown_generator', 0, 'error', {});
    }
  }

  /**
   * Run both AI detection and generator classification in one call.
   * More efficient than two separate calls when the GPU service supports it.
   *
   * @param {string} imagePath - Local path to image file
   * @returns {Object} { aiDetection, generatorDetection }
   */
  static async analyzeImage(imagePath) {
    if (!this.isAvailable()) {
      return {
        aiDetection: await this.detectAI(imagePath),
        generatorDetection: null,
      };
    }

    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(imagePath));

      // Try combined endpoint first
      const response = await axios.post(
        `${RUNPOD_ENDPOINT}/analyze`,
        form,
        {
          headers: form.getHeaders(),
          timeout: RUNPOD_TIMEOUT,
        }
      );

      const data = response.data;

      const aiDetection = {
        isAI: data.is_ai,
        confidence: data.confidence || data.ensemble_score || 0,
        ai_confidence: Math.round((data.confidence || data.ensemble_score || 0) * 100 * 10) / 10,
        likely_ai_generated: data.is_ai,
        provider: 'gpu_ensemble',
        score: data.ensemble_score || data.confidence || 0,
        details: {
          clip_score: data.clip_score || null,
          freq_score: data.freq_score || null,
          ensemble_score: data.ensemble_score || null,
        },
      };

      let generatorDetection = null;
      if (data.is_ai && data.generator) {
        generatorDetection = this._formatGeneratorResult(
          data.generator,
          data.generator_confidence || 0,
          'ok',
          data.generator_scores || {}
        );
      }

      return { aiDetection, generatorDetection };

    } catch (err) {
      // Fall back to separate calls
      console.warn(`⚠️  Combined analyze failed, falling back: ${err.message}`);
      const aiDetection = await this.detectAI(imagePath);
      const generatorDetection = aiDetection.isAI
        ? await this.classifyGenerator(imagePath)
        : null;
      return { aiDetection, generatorDetection };
    }
  }

  /**
   * Format generator classification result with OOD thresholds applied.
   * @private
   */
  static _formatGeneratorResult(generator, confidence, status, rawScores) {
    let oodLevel, finalGenerator;

    if (status === 'unavailable' || status === 'error') {
      oodLevel = status;
      finalGenerator = 'unknown_generator';
      confidence = 0;
    } else if (confidence >= OOD_HIGH_THRESHOLD) {
      oodLevel = 'confident';
      finalGenerator = generator;
    } else if (confidence >= OOD_MEDIUM_THRESHOLD) {
      oodLevel = 'uncertain';
      finalGenerator = `possibly_${generator}`;
    } else {
      oodLevel = 'unknown';
      finalGenerator = 'unknown_generator';
    }

    const baseGenerator = finalGenerator.replace('possibly_', '');
    const displayName = GENERATOR_DISPLAY_NAMES[baseGenerator] || baseGenerator;

    let verdictMessage;
    switch (oodLevel) {
      case 'confident':
        verdictMessage = `Generated by ${displayName}`;
        break;
      case 'uncertain':
        verdictMessage = `Possibly generated by ${displayName}`;
        break;
      default:
        verdictMessage = 'Unknown AI generator';
        break;
    }

    // Top 3 candidates
    const topCandidates = Object.entries(rawScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([gen, score]) => ({
        generator: gen,
        display_name: GENERATOR_DISPLAY_NAMES[gen] || gen,
        confidence: Math.round(score * 1000) / 10,
      }));

    return {
      detected_generator: finalGenerator,
      raw_generator: generator,
      display_name: displayName,
      verdict_message: verdictMessage,
      confidence: Math.round(confidence * 1000) / 10,
      ood_level: oodLevel,
      top_candidates: topCandidates,
    };
  }

  /**
   * Health check for the GPU service.
   * @returns {boolean} Whether the service is healthy
   */
  static async healthCheck() {
    if (!this.isAvailable()) return false;
    try {
      const response = await axios.get(`${RUNPOD_ENDPOINT}/health`, { timeout: 5000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}

module.exports = GPUAIDetector;