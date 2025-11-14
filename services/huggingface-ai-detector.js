/**
 * Hugging Face AI Detection Service
 * Uses the "umm-maybe/AI-image-detector" model
 * Free tier: 1000 requests/day
 */

const fs = require('fs');
const fetch = require('node-fetch');

const HF_API_URL = 'https://api-inference.huggingface.co/models/umm-maybe/AI-image-detector';
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
    
    const response = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/octet-stream'
      },
      body: imageBuffer,
      timeout: 10000 // 10 second timeout
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('HuggingFace API error:', response.status, error);
      return null;
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
    
  } catch (error) {
    console.error('HuggingFace detection error:', error.message);
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
