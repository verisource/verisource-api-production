/**
 * Test script for JPEG Artifact Analysis + Ensemble Detection
 * Tests the new 3-detector ensemble system
 */

const fs = require('fs');
const path = require('path');
const ensembleDetector = require('./services/ensemble-ai-detection');

async function testEnsemble() {
  console.log('='.repeat(60));
  console.log('JPEG ARTIFACT ANALYSIS + ENSEMBLE DETECTOR TEST');
  console.log('='.repeat(60));
  console.log('');

  // Test image path - UPDATE THIS to your test image
  const testImagePath = process.argv[2] || './test-images/sample.jpg';
  
  console.log(`📁 Test image: ${testImagePath}`);
  
  // Check if file exists
  if (!fs.existsSync(testImagePath)) {
    console.error('❌ Error: Test image not found!');
    console.log('');
    console.log('Usage: node test-jpeg-ensemble.js <path-to-image>');
    console.log('Example: node test-jpeg-ensemble.js ./my-test-image.jpg');
    console.log('');
    console.log('Please provide a JPEG image to test.');
    process.exit(1);
  }
  
  // Check if it's a JPEG
  const ext = path.extname(testImagePath).toLowerCase();
  if (!['.jpg', '.jpeg'].includes(ext)) {
    console.warn('⚠️  Warning: File is not a JPEG. JPEG artifact analysis will be skipped.');
  }
  
  console.log('');
  console.log('🔍 Running ensemble detection...');
  console.log('');
  
  try {
    const startTime = Date.now();
    const result = await ensembleDetector.detectAIGeneration(testImagePath);
    const duration = Date.now() - startTime;
    
    console.log('');
    console.log('='.repeat(60));
    console.log('RESULTS');
    console.log('='.repeat(60));
    console.log('');
    
    // Main verdict
    console.log(`🎯 VERDICT: ${result.likely_ai_generated ? '🤖 AI-GENERATED' : '📷 REAL PHOTO'}`);
    console.log(`📊 Confidence: ${result.ai_confidence}%`);
    console.log(`⏱️  Processing time: ${duration}ms`);
    console.log(`🔧 Detectors used: ${result.detector_count}/3`);
    console.log(`🤝 Ensemble: ${result.ensemble_used ? 'YES' : 'NO'}`);
    console.log('');
    
    // Individual detector results
    if (result.individual_results) {
      console.log('INDIVIDUAL DETECTOR RESULTS:');
      console.log('-'.repeat(60));
      
      if (result.individual_results.jpeg) {
        const jpeg = result.individual_results.jpeg;
        console.log(`\n📐 JPEG Artifact Analysis (Weight: 40%)`);
        console.log(`   Confidence: ${jpeg.confidence}%`);
        console.log(`   Verdict: ${jpeg.verdict ? 'AI' : 'Real'}`);
        
        if (jpeg.details) {
          console.log(`\n   Detailed Analysis:`);
          
          if (jpeg.details.quantizationTables) {
            const qt = jpeg.details.quantizationTables;
            console.log(`   - Q-Table Standard Match: ${(qt.standardMatch * 100).toFixed(1)}%`);
            console.log(`   - Camera Signature: ${qt.cameraMatch ? qt.cameraManufacturer : 'None detected'}`);
            console.log(`   - Q-Table Variance: ${qt.variance?.toFixed(2) || 'N/A'}`);
          }
          
          if (jpeg.details.dctCoefficients) {
            const dct = jpeg.details.dctCoefficients;
            console.log(`   - High-Freq Energy: ${(dct.highFreqEnergy * 100).toFixed(1)}%`);
            console.log(`   - Uniformity: ${(dct.uniformity * 100).toFixed(1)}%`);
          }
          
          if (jpeg.details.blockBoundaries) {
            const bb = jpeg.details.blockBoundaries;
            console.log(`   - Avg Block Discontinuity: ${bb.avgDiscontinuity?.toFixed(2) || 'N/A'}`);
            console.log(`   - Smooth Boundary Ratio: ${(bb.smoothRatio * 100).toFixed(1)}%`);
          }
          
          if (jpeg.details.compressionPattern) {
            const cp = jpeg.details.compressionPattern;
            console.log(`   - Double Compression: ${cp.doubleCompression ? 'Yes' : 'No'}`);
          }
        }
      }
      
      if (result.individual_results.local) {
        const local = result.individual_results.local;
        console.log(`\n🔍 Local Heuristic Detector (Weight: 30%)`);
        console.log(`   Confidence: ${local.confidence}%`);
        console.log(`   Verdict: ${local.verdict ? 'AI' : 'Real'}`);
      }
      
      if (result.individual_results.huggingface) {
        const hf = result.individual_results.huggingface;
        console.log(`\n🤗 HuggingFace AI-or-Not (Weight: 30%)`);
        console.log(`   Confidence: ${hf.confidence}%`);
        console.log(`   Verdict: ${hf.verdict ? 'AI' : 'Real'}`);
      }
      
      console.log('');
    }
    
    // Agreement metrics
    if (result.agreement) {
      console.log('AGREEMENT ANALYSIS:');
      console.log('-'.repeat(60));
      console.log(`Agreement Level: ${result.agreement.level.toUpperCase()}`);
      if (result.agreement.max_deviation) {
        console.log(`Max Deviation: ${result.agreement.max_deviation}%`);
      }
      if (result.agreement.average_confidence) {
        console.log(`Average Confidence: ${result.agreement.average_confidence}%`);
      }
      console.log('');
    }
    
    // Indicators
    if (result.indicators && result.indicators.length > 0) {
      console.log('KEY INDICATORS:');
      console.log('-'.repeat(60));
      result.indicators.forEach((indicator, idx) => {
        console.log(`${idx + 1}. ${indicator}`);
      });
      console.log('');
    }
    
    // Weights used
    if (result.weights_used) {
      console.log('WEIGHTS USED:');
      console.log('-'.repeat(60));
      Object.entries(result.weights_used).forEach(([detector, weight]) => {
        console.log(`${detector}: ${(weight * 100).toFixed(0)}%`);
      });
      console.log('');
    }
    
    console.log('='.repeat(60));
    console.log('');
    
    // Full JSON output (optional)
    if (process.argv.includes('--json')) {
      console.log('FULL JSON OUTPUT:');
      console.log(JSON.stringify(result, null, 2));
    }
    
  } catch (error) {
    console.error('');
    console.error('❌ ERROR during detection:');
    console.error(error);
    console.error('');
    console.error('Stack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

// Run test
testEnsemble().then(() => {
  console.log('✅ Test completed successfully!');
  process.exit(0);
}).catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});