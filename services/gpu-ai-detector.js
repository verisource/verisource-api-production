/**
 * VeriSource GPU Service Client
 * ==============================
 * Drop into: services/gpu-ai-detector.js
 * 
 * Calls the GPU FastAPI service running on RunPod for neural
 * network-based AI detection. Replaces the broken local heuristic.
 * 
 * NOTE: This class handles GPU detection only. Fallback to
 * Sightengine when GPU is unavailable must be handled by the
 * caller in the main verification flow.
 */

const fs = require('fs');
const path = require('path');

class GPUAIDetector {
  constructor() {
    // Normalize URL: strip trailing slash, validate scheme
    let rawUrl = (process.env.GPU_SERVICE_URL || '').trim();
    if (rawUrl && !rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
      rawUrl = `https://${rawUrl}`;
    }
    this.gpuServiceUrl = rawUrl.replace(/\/+$/, '');

    this.gpuApiKey = process.env.GPU_SERVICE_API_KEY || '';

    // Parse timeout with NaN guard
    const parsed = parseInt(process.env.GPU_TIMEOUT_MS, 10);
    this.timeout = Number.isFinite(parsed) ? parsed : 15000;

    this.enabled = !!this.gpuServiceUrl;

    if (this.enabled) {
      // Log hostname only — never log full URL in case keys are embedded
      try {
        const hostname = new URL(this.gpuServiceUrl).hostname;
        console.log(`🔥 GPU AI detector enabled: ${hostname}`);
      } catch {
        console.log('🔥 GPU AI detector enabled (could not parse hostname)');
      }
    } else {
      console.log('⚠️ GPU AI detector disabled (GPU_SERVICE_URL not set)');
    }
  }

  /**
   * Create an AbortController that auto-aborts after the configured timeout.
   * @returns {{ controller: AbortController, clear: Function }}
   */
  _createTimeout() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    return {
      controller,
      clear: () => clearTimeout(timer),
    };
  }

  /**
   * Detect AI-generated content using GPU neural models.
   * 
   * @param {string} filePath - Path to the image file
   * @returns {Object} Detection result with ai_score, label, confidence, models
   */
  async detect(filePath) {
    if (!this.enabled) {
      return {
        success: false,
        source: 'gpu_disabled',
        reason: 'GPU_SERVICE_URL not configured',
        fallback_recommended: true,
      };
    }

    const startTime = Date.now();

    // Validate file exists before attempting upload
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
    } catch {
      return {
        success: false,
        source: 'gpu_error',
        error: `File not readable: ${filePath}`,
        fallback_recommended: true,
        elapsed_ms: Date.now() - startTime,
      };
    }

    const { controller, clear } = this._createTimeout();

    try {
      // Build multipart form using built-in Node fetch (18+)
      const { Blob } = require('buffer');
      const sharp = require('sharp');
      const ext = path.extname(filePath).toLowerCase();
      const needsConversion = ['.avif', '.heif', '.heic', '.webp'].includes(ext);

      let fileBuffer;
      let fileName;

      if (needsConversion) {
        // Convert to JPEG for GPU service compatibility
        fileBuffer = await sharp(filePath).jpeg({ quality: 95 }).toBuffer();
        fileName = path.basename(filePath, ext) + '.jpg';
      } else {
        fileBuffer = await fs.promises.readFile(filePath);
        fileName = path.basename(filePath);
      }

      const file = new Blob([fileBuffer]);
      const form = new FormData();
      form.append('file', file, fileName);

      const headers = {};
      if (this.gpuApiKey) {
        headers['Authorization'] = `Bearer ${this.gpuApiKey}`;
      }

      const response = await fetch(`${this.gpuServiceUrl}/analyze`, {
        method: 'POST',
        headers,
        body: form,
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorDetail;
        try {
          errorDetail = await response.text();
        } catch {
          errorDetail = `HTTP ${response.status}`;
        }
        throw new Error(`GPU service returned ${response.status}: ${errorDetail}`);
      }

      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error('GPU service returned non-JSON response');
      }

      const elapsed = Date.now() - startTime;

      return {
        success: true,
        source: 'gpu_neural',

        // Primary results
        ai_score: result.ai_score,
        label: result.label,
        confidence: result.confidence,

        // Model breakdown
        models: result.models,
        ensemble: result.ensemble,

        // Meta
        device: result.device,
        gpu_inference_ms: result.total_ms,
        total_round_trip_ms: elapsed,
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const isTimeout = error.name === 'AbortError';

      console.error(`GPU detector ${isTimeout ? 'timeout' : 'error'} (${elapsed}ms): ${error.message}`);

      return {
        success: false,
        source: isTimeout ? 'gpu_timeout' : 'gpu_error',
        error: isTimeout ? `Request timed out after ${this.timeout}ms` : error.message,
        fallback_recommended: true,
        elapsed_ms: elapsed,
      };
    } finally {
      clear();
    }
  }

  /**
   * Check if GPU service is healthy and responsive.
   */
  async healthCheck() {
    if (!this.enabled) return { healthy: false, reason: 'disabled' };

    const { controller, clear } = this._createTimeout();

    try {
      const response = await fetch(`${this.gpuServiceUrl}/health`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail;
        try {
          detail = await response.text();
        } catch {
          detail = `HTTP ${response.status}`;
        }
        return { healthy: false, error: `HTTP ${response.status}: ${detail}` };
      }

      let data;
      try {
        data = await response.json();
      } catch {
        return { healthy: false, error: 'Non-JSON response from health endpoint' };
      }

      return { healthy: true, ...data };
    } catch (error) {
      const isTimeout = error.name === 'AbortError';
      return {
        healthy: false,
        error: isTimeout ? `Health check timed out after ${this.timeout}ms` : error.message,
      };
    } finally {
      clear();
    }
  }
}

module.exports = GPUAIDetector;