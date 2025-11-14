/**
 * Hugging Face AI Detection Service
 * Uses the "umm-maybe/AI-image-detector" model
 * Free tier: 1000 requests/day
 */

const fs = require('fs');
const fetch = require('node-fetch');

const HF_API_URL = 'https://router.huggingface.co/hf-inference/models/Nahrawy/AIorNot';
const HF_TOKEN = process.env.HUGGINGFACE_TOKEN;

/**
 * Detect if image is AI-generated using Hugging Face
 * @param {string} imagePath - Path to image file
 * @returns {Promise<Object>} Detection result
 */
async function detectAI(imagePath) {
  if (!HF_TOKEN) {
    console.warn('⚠️ HUGGINGFACE_TOKEN not set - skipping HF detection');
    return null;
  }

  try {
    const imageBuffer = fs.readFileSync(imagePath);
    
    // Increase timeout to 30 seconds and add retry logic
    let lastError;
    const maxRetries = 2;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🤖 HuggingFace attempt ${attempt}/${maxRetries}...`);
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        const response = await fetch(HF_API_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${HF_TOKEN}`,
            'Content-Type': 'application/octet-stream'
          },
          body: imageBuffer,
          signal: controller.signal
        });
        
        clearTimeout(timeout);

        if (!response.ok) {
          const error = await response.text();
          console.error(`HuggingFace API error (attempt ${attempt}):`, response.status, error);
          
          // If model is loading, wait and retry
          if (response.status === 503 && error.includes('loading')) {
            console.log('⏳ Model is loading, waiting 20 seconds...');
            await new Promise(resolve => setTimeout(resolve, 20000));
            continue;
          }
          
          lastError = new Error(`HTTP ${response.status}: ${error}`);
          continue;
        }

        const result = await response.json();
        
        // Result format: [{ label: "artificial", score: 0.85 }, { label: "human", score: 0.15 }]
        const artificialScore = result.find(r => r.label === 'artificial')?.score || 0;
        const humanScore = result.find(r => r.label === 'human')?.score || 0;
        
        const aiConfidence = Math.round(artificialScore * 100);
        
        console.log(`🤖 HuggingFace AI detection: ${aiConfidence}% (artificial: ${artificialScore.toFixed(2)}, human: ${humanScore.toFixed(2)})`);
        
        return {
          ai_confidence: aiConfidence,
          likely_ai_generated: artificialScore > 0.5,
          source: 'Hugging Face AI-or-Not',
          scores: {
            artificial: artificialScore,
            human: humanScore
          }
        };
        
      } catch (err) {
        if (err.name === 'AbortError') {
          console.error(`⚠️ HuggingFace timeout (attempt ${attempt}/${maxRetries})`);
          lastError = new Error('Request timeout');
        } else {
          console.error(`⚠️ HuggingFace error (attempt ${attempt}/${maxRetries}):`, err.message);
          lastError = err;
        }
        
        if (attempt < maxRetries) {
          console.log('⏳ Retrying in 5 seconds...');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }
    
    throw lastError;
    
  } catch (error) {
    console.error('HuggingFace detection failed after retries:', error.message);
    return null;
  }
}

/**
 * Check if HuggingFace detector is configured
 */
function isConfigured() {
  return !!HF_TOKEN;
}

module.exports = {
  detectAI,
  isConfigured
};
