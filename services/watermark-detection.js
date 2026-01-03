/**
 * Visible Watermark Detection for AI Videos
 * Detects logos and text from AI generation tools
 * 
 * Common watermarks:
 * - Runway: "runway" logo in corner
 * - Pika: "pika" text
 * - Kling: "Kling AI" or Chinese text
 * - Sora: "Sora" text (when released publicly)
 * - Free tier badges: "Made with X", "Created with X"
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Known AI tool watermark patterns
const AI_WATERMARK_PATTERNS = {
  text: [
    // English
    { pattern: /runway/i, tool: 'Runway', confidence: 95 },
    { pattern: /pika\s*(labs)?/i, tool: 'Pika', confidence: 95 },
    { pattern: /kling/i, tool: 'Kling', confidence: 95 },
    { pattern: /sora/i, tool: 'Sora', confidence: 95 },
    { pattern: /luma\s*(ai)?/i, tool: 'Luma AI', confidence: 95 },
    { pattern: /stable\s*video/i, tool: 'Stable Video', confidence: 90 },
    { pattern: /gen-?2/i, tool: 'Runway Gen-2', confidence: 95 },
    { pattern: /gen-?3/i, tool: 'Runway Gen-3', confidence: 95 },
    { pattern: /heygen/i, tool: 'HeyGen', confidence: 95 },
    { pattern: /synthesia/i, tool: 'Synthesia', confidence: 95 },
    { pattern: /d-?id/i, tool: 'D-ID', confidence: 90 },
    { pattern: /invideo\s*ai/i, tool: 'InVideo AI', confidence: 90 },
    
    // Generic AI indicators
    { pattern: /made\s*with\s*ai/i, tool: 'Unknown AI', confidence: 85 },
    { pattern: /created\s*(with|by)\s*ai/i, tool: 'Unknown AI', confidence: 85 },
    { pattern: /ai\s*generated/i, tool: 'Unknown AI', confidence: 90 },
    { pattern: /generated\s*by\s*ai/i, tool: 'Unknown AI', confidence: 90 },
    
    // Chinese (common for Kling)
    { pattern: /可灵/i, tool: 'Kling', confidence: 95 },
    { pattern: /快手/i, tool: 'Kuaishou/Kling', confidence: 85 },
  ],
  
  // Corner regions to check (as fraction of image dimensions)
  cornerRegions: [
    { name: 'bottom-right', x: 0.70, y: 0.85, w: 0.30, h: 0.15 },
    { name: 'bottom-left', x: 0.00, y: 0.85, w: 0.30, h: 0.15 },
    { name: 'top-right', x: 0.70, y: 0.00, w: 0.30, h: 0.15 },
    { name: 'top-left', x: 0.00, y: 0.00, w: 0.30, h: 0.15 },
    { name: 'bottom-center', x: 0.30, y: 0.90, w: 0.40, h: 0.10 },
  ]
};

/**
 * Extract corner regions from a frame for analysis
 */
async function extractCornerRegions(framePath) {
  const image = sharp(framePath);
  const metadata = await image.metadata();
  const { width, height } = metadata;
  
  const regions = [];
  
  for (const region of AI_WATERMARK_PATTERNS.cornerRegions) {
    const x = Math.floor(width * region.x);
    const y = Math.floor(height * region.y);
    const w = Math.floor(width * region.w);
    const h = Math.floor(height * region.h);
    
    try {
      const buffer = await sharp(framePath)
        .extract({ left: x, top: y, width: w, height: h })
        .toBuffer();
      
      regions.push({
        name: region.name,
        buffer,
        x, y, w, h
      });
    } catch (err) {
      // Skip if extraction fails
    }
  }
  
  return regions;
}

/**
 * Analyze corner region for semi-transparent overlay (watermark characteristic)
 */
async function detectOverlay(regionBuffer) {
  try {
    const { data, info } = await sharp(regionBuffer)
      .resize(100, 50, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    const pixels = new Uint8Array(data);
    
    // Calculate statistics
    let sum = 0;
    let min = 255;
    let max = 0;
    
    for (const p of pixels) {
      sum += p;
      if (p < min) min = p;
      if (p > max) max = p;
    }
    
    const avg = sum / pixels.length;
    const range = max - min;
    
    // Watermarks often have:
    // - Low contrast text on semi-transparent background
    // - Consistent gray overlay
    // - Values clustered in narrow range
    
    let variance = 0;
    for (const p of pixels) {
      variance += Math.pow(p - avg, 2);
    }
    variance = variance / pixels.length;
    const stdDev = Math.sqrt(variance);
    
    // Detect semi-transparent overlay characteristics
    const hasOverlay = (
      (avg > 180 && stdDev < 40) || // Light watermark on content
      (avg < 80 && stdDev < 30) ||  // Dark watermark on content
      (range < 100 && stdDev < 35)  // Low contrast region (overlay)
    );
    
    return {
      hasOverlay,
      avg: Math.round(avg),
      stdDev: Math.round(stdDev),
      range
    };
  } catch {
    return { hasOverlay: false };
  }
}

/**
 * Run OCR on a region using Tesseract (if available)
 */
async function runOCR(regionBuffer, regionName) {
  return new Promise(async (resolve) => {
    try {
      // Save buffer to temp file
      const tempPath = `/tmp/ocr-region-${Date.now()}-${regionName}.png`;
      
      // Preprocess for better OCR: increase contrast, resize
      await sharp(regionBuffer)
        .resize(400, 200, { fit: 'fill' })
        .normalize()
        .sharpen()
        .toFile(tempPath);
      
      // Run tesseract
      exec(`tesseract "${tempPath}" stdout -l eng 2>/dev/null`, { timeout: 5000 }, (error, stdout, stderr) => {
        try { fs.unlinkSync(tempPath); } catch (e) { /* ignore */ }
        
        if (error) {
          resolve({ success: false, text: '' });
          return;
        }
        
        const text = stdout.trim();
        resolve({ success: true, text });
      });
    } catch {
      resolve({ success: false, text: '' });
    }
  });
}

/**
 * Check text for AI watermark patterns
 */
function matchWatermarkPatterns(text) {
  if (!text || text.length < 2) return null;
  
  const cleanText = text.replace(/[\n\r]+/g, ' ').trim();
  
  for (const pattern of AI_WATERMARK_PATTERNS.text) {
    if (pattern.pattern.test(cleanText)) {
      return {
        matched: true,
        tool: pattern.tool,
        confidence: pattern.confidence,
        matchedText: cleanText.match(pattern.pattern)?.[0] || cleanText
      };
    }
  }
  
  return null;
}

/**
 * Analyze a frame for visible watermarks
 */
async function analyzeFrameForWatermarks(framePath) {
  const results = {
    watermarkDetected: false,
    tool: null,
    confidence: 0,
    location: null,
    matchedText: null,
    overlayDetected: false,
    details: []
  };
  
  try {
    const regions = await extractCornerRegions(framePath);
    
    for (const region of regions) {
      // Check for overlay
      const overlay = await detectOverlay(region.buffer);
      if (overlay.hasOverlay) {
        results.overlayDetected = true;
        results.details.push({
          region: region.name,
          type: 'overlay',
          stats: overlay
        });
      }
      
      // Run OCR
      const ocr = await runOCR(region.buffer, region.name);
      if (ocr.success && ocr.text) {
        const match = matchWatermarkPatterns(ocr.text);
        
        if (match) {
          results.watermarkDetected = true;
          results.tool = match.tool;
          results.confidence = match.confidence;
          results.location = region.name;
          results.matchedText = match.matchedText;
          results.details.push({
            region: region.name,
            type: 'text',
            text: ocr.text,
            match: match
          });
          
          // Found definitive match, can stop
          if (match.confidence >= 90) break;
        }
      }
    }
  } catch (err) {
    results.error = err.message;
  }
  
  return results;
}

/**
 * Analyze video for watermarks (check first and last frames)
 */
async function analyzeVideoWatermarks(videoPath, framePaths = null) {
  console.log('🔍 Checking for visible watermarks...');
  
  const results = {
    success: true,
    watermarkDetected: false,
    tool: null,
    confidence: 0,
    aiScore: 0,
    authenticScore: 0,
    location: null,
    details: [],
    framesChecked: 0
  };
  
  try {
    let framesToCheck = [];
    
    if (framePaths && framePaths.length > 0) {
      // Use first, middle, and last frames
      framesToCheck = [
        framePaths[0],
        framePaths[Math.floor(framePaths.length / 2)],
        framePaths[framePaths.length - 1]
      ].filter(Boolean);
    } else {
      // Extract frames ourselves
      const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'watermark-'));
      
      await new Promise((resolve, reject) => {
        exec(
          `ffmpeg -i "${videoPath}" -vf "select='eq(n,0)+eq(n,30)+gt(n,0)*not(mod(n,100))'" -frames:v 3 -q:v 2 "${tempDir}/frame-%02d.jpg" 2>/dev/null`,
          { timeout: 10000 },
          (error) => {
            if (error) reject(error);
            else resolve();
          }
        );
      });
      
      framesToCheck = fs.readdirSync(tempDir)
        .filter(f => f.endsWith('.jpg'))
        .map(f => path.join(tempDir, f));
      
      results._tempDir = tempDir;
    }
    
    results.framesChecked = framesToCheck.length;
    
    // Analyze each frame
    for (const framePath of framesToCheck) {
      const frameResult = await analyzeFrameForWatermarks(framePath);
      
      if (frameResult.watermarkDetected) {
        results.watermarkDetected = true;
        results.tool = frameResult.tool;
        results.confidence = Math.max(results.confidence, frameResult.confidence);
        results.location = frameResult.location;
        results.details.push(...frameResult.details);
        
        // High confidence match - no need to check more
        if (frameResult.confidence >= 95) break;
      }
      
      if (frameResult.overlayDetected && !results.watermarkDetected) {
        results.details.push(...frameResult.details);
      }
    }
    
    // Cleanup temp dir if we created one
    if (results._tempDir) {
      fs.rmSync(results._tempDir, { recursive: true, force: true });
      delete results._tempDir;
    }
    
    // Set scores
    if (results.watermarkDetected) {
      results.aiScore = results.confidence;
      results.authenticScore = 0;
      console.log(`   ⚠️ Watermark detected: "${results.tool}" in ${results.location}`);
    } else {
      results.aiScore = 0;
      results.authenticScore = 10; // Slight bonus for no watermark
      console.log('   ✅ No AI watermarks detected');
    }
    
  } catch (err) {
    results.success = false;
    results.error = err.message;
    console.log('   Watermark detection error:', err.message);
  }
  
  return results;
}

/**
 * Get watermark summary
 */
function getWatermarkSummary(result) {
  if (!result.success) return 'unavailable';
  if (result.watermarkDetected) {
    return `${result.tool} watermark (${result.confidence}%)`;
  }
  return 'none detected';
}

module.exports = {
  analyzeVideoWatermarks,
  analyzeFrameForWatermarks,
  matchWatermarkPatterns,
  getWatermarkSummary,
  AI_WATERMARK_PATTERNS
};
