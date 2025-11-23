/**
 * Comprehensive Accuracy Test Suite
 * Tests API against known ground truth to calculate actual accuracy
 */

const fs = require('fs');
const FormData = require('form-data');
const fetch = require('node-fetch');

const API_URL = 'http://localhost:3000/verify';

// Ground truth dataset
const TEST_CASES = {
  authentic: [
    { file: './test-images/authentic/IMG_20251113_212647.jpg', expected: 'AUTHENTIC' },
    { file: './test-images/authentic/My Real Photo 1.jpg', expected: 'AUTHENTIC' },
    { file: './test-images/authentic/lik photo with jannet.jpg', expected: 'AUTHENTIC' },
    { file: './test-images/authentic/raw photo 1.jpg', expected: 'AUTHENTIC' },
    { file: './test-images/authentic/raw photo 2.jpg', expected: 'AUTHENTIC' },
  ],
  
  ai_generated: [
    { file: './test-images/dalle-1.png', expected: 'AI_GENERATED' },
    { file: './test-images/dalle-2.png', expected: 'AI_GENERATED' },
    { file: './test-images/dalle-3.png', expected: 'AI_GENERATED' },
    { file: './test-images/dalle-4.png', expected: 'AI_GENERATED' },
    { file: './test-images/dalle-elephant.png', expected: 'AI_GENERATED' },
    { file: './test-images/dalle-lion.png', expected: 'AI_GENERATED' },
    { file: './test-images/dalle-tiger.png', expected: 'AI_GENERATED' },
    { file: './test-images/ai-generated-1.jpg', expected: 'AI_GENERATED' },
    { file: './test-images/ai-generated-2.jpg', expected: 'AI_GENERATED' },
  ],
  
  adversarial_recompressed: [
    { file: './test-images/adversarial/recompressed_q50.jpg', expected: 'AI_GENERATED', note: 'Q50 recompression' },
    { file: './test-images/adversarial/recompressed_q70.jpg', expected: 'AI_GENERATED', note: 'Q70 recompression' },
    { file: './test-images/adversarial/recompressed_q85.jpg', expected: 'AI_GENERATED', note: 'Q85 recompression' },
    { file: './test-images/adversarial/recompressed_q95.jpg', expected: 'AI_GENERATED', note: 'Q95 recompression' },
  ],
  
  adversarial_resized: [
    { file: './test-images/adversarial/resized_1024x1024.jpg', expected: 'AI_GENERATED', note: 'Resized to 1024x1024' },
    { file: './test-images/adversarial/resized_256x256.jpg', expected: 'AI_GENERATED', note: 'Downscaled to 256x256' },
    { file: './test-images/adversarial/resized_800x600.jpg', expected: 'AI_GENERATED', note: 'Resized to 800x600' },
  ]
};

// Classification mapping
function classifyResult(apiResult) {
  const aiConfidence = apiResult.ai_detection?.ai_confidence || 0;
  const label = apiResult.confidence?.label || '';
  
  // AI-GENERATED if confidence >= 50% or label says so
  if (aiConfidence >= 50 || label.includes('AI-GENERATED')) {
    return 'AI_GENERATED';
  }
  
  // Otherwise authentic (VERIFIED, EDITED, LIKELY CAMERA-CAPTURED)
  return 'AUTHENTIC';
}

// Test a single image
async function testImage(testCase) {
  try {
    if (!fs.existsSync(testCase.file)) {
      return { success: false, error: 'File not found', testCase };
    }
    
    const formData = new FormData();
    formData.append('file', fs.createReadStream(testCase.file));
    
    const response = await fetch(API_URL, {
      method: 'POST',
      body: formData,
    });
    
    const result = await response.json();
    const classification = classifyResult(result);
    const correct = classification === testCase.expected;
    
    return {
      success: true,
      file: testCase.file.split('/').pop(),
      expected: testCase.expected,
      actual: classification,
      correct,
      aiConfidence: result.ai_detection?.ai_confidence || 0,
      label: result.confidence?.label || 'N/A',
      validation: result.camera_verification?.validation || null,
      note: testCase.note || null,
    };
  } catch (error) {
    return { success: false, error: error.message, testCase };
  }
}

// Run full test suite
async function runTests() {
  console.log('========================================');
  console.log('COMPREHENSIVE ACCURACY TEST');
  console.log('========================================\n');
  
  const results = {
    authentic: [],
    ai_generated: [],
    adversarial_recompressed: [],
    adversarial_resized: [],
  };
  
  // Test each category
  for (const [category, tests] of Object.entries(TEST_CASES)) {
    console.log(`\n📁 Testing: ${category.toUpperCase().replace(/_/g, ' ')}`);
    console.log('─'.repeat(60));
    
    for (const testCase of tests) {
      const result = await testImage(testCase);
      results[category].push(result);
      
      if (result.success) {
        const icon = result.correct ? '✅' : '❌';
        const status = result.correct ? 'PASS' : 'FAIL';
        console.log(`${icon} ${result.file}`);
        console.log(`   Expected: ${result.expected}, Got: ${result.actual} (${result.aiConfidence}% AI)`);
        if (result.note) console.log(`   Note: ${result.note}`);
        if (result.validation) {
          console.log(`   Validation: ${result.validation.valid ? 'PASSED' : 'FAILED'}`);
        }
      } else {
        console.log(`❌ ${testCase.file} - ERROR: ${result.error}`);
      }
    }
  }
  
  // Calculate statistics
  console.log('\n========================================');
  console.log('ACCURACY STATISTICS');
  console.log('========================================\n');
  
  const stats = {};
  let totalCorrect = 0;
  let totalTests = 0;
  
  for (const [category, categoryResults] of Object.entries(results)) {
    const successful = categoryResults.filter(r => r.success);
    const correct = successful.filter(r => r.correct);
    const accuracy = successful.length > 0 ? (correct.length / successful.length * 100).toFixed(1) : 0;
    
    stats[category] = {
      total: successful.length,
      correct: correct.length,
      incorrect: successful.length - correct.length,
      accuracy: parseFloat(accuracy),
    };
    
    totalCorrect += correct.length;
    totalTests += successful.length;
    
    console.log(`${category.toUpperCase().replace(/_/g, ' ')}:`);
    console.log(`  Total: ${successful.length}`);
    console.log(`  Correct: ${correct.length}`);
    console.log(`  Incorrect: ${successful.length - correct.length}`);
    console.log(`  Accuracy: ${accuracy}%\n`);
  }
  
  // Overall accuracy
  const overallAccuracy = totalTests > 0 ? (totalCorrect / totalTests * 100).toFixed(1) : 0;
  
  console.log('─'.repeat(60));
  console.log(`OVERALL ACCURACY: ${overallAccuracy}% (${totalCorrect}/${totalTests} correct)\n`);
  
  // Breakdown by type
  console.log('========================================');
  console.log('BREAKDOWN BY ERROR TYPE');
  console.log('========================================\n');
  
  // False Positives (Real photos flagged as AI)
  const falsePositives = results.authentic.filter(r => r.success && !r.correct);
  if (falsePositives.length > 0) {
    console.log(`❌ FALSE POSITIVES: ${falsePositives.length}`);
    falsePositives.forEach(fp => {
      console.log(`   ${fp.file}: ${fp.aiConfidence}% AI confidence`);
    });
  } else {
    console.log(`✅ FALSE POSITIVES: 0`);
  }
  
  console.log();
  
  // False Negatives (AI flagged as authentic)
  const allAI = [...results.ai_generated, ...results.adversarial_recompressed, ...results.adversarial_resized];
  const falseNegatives = allAI.filter(r => r.success && !r.correct);
  if (falseNegatives.length > 0) {
    console.log(`❌ FALSE NEGATIVES: ${falseNegatives.length}`);
    falseNegatives.forEach(fn => {
      console.log(`   ${fn.file}: ${fn.aiConfidence}% AI confidence (${fn.note || 'N/A'})`);
    });
  } else {
    console.log(`✅ FALSE NEGATIVES: 0`);
  }
  
  console.log('\n========================================');
  console.log('KEY METRICS');
  console.log('========================================\n');
  
  const truePositives = allAI.filter(r => r.success && r.correct).length;
  const trueNegatives = results.authentic.filter(r => r.success && r.correct).length;
  const fpCount = falsePositives.length;
  const fnCount = falseNegatives.length;
  
  const precision = truePositives + fpCount > 0 ? (truePositives / (truePositives + fpCount) * 100).toFixed(1) : 0;
  const recall = truePositives + fnCount > 0 ? (truePositives / (truePositives + fnCount) * 100).toFixed(1) : 0;
  const f1Score = parseFloat(precision) + parseFloat(recall) > 0 
    ? (2 * (parseFloat(precision) * parseFloat(recall)) / (parseFloat(precision) + parseFloat(recall))).toFixed(1) 
    : 0;
  
  console.log(`Precision (AI Detection): ${precision}%`);
  console.log(`Recall (AI Detection): ${recall}%`);
  console.log(`F1 Score: ${f1Score}%`);
  console.log(`False Positive Rate: ${results.authentic[0]?.success ? (fpCount / results.authentic.length * 100).toFixed(1) : 0}%`);
  console.log(`False Negative Rate: ${allAI.length > 0 ? (fnCount / allAI.length * 100).toFixed(1) : 0}%`);
  
  console.log('\n========================================');
  console.log('TEST COMPLETE');
  console.log('========================================\n');
  
  // Save results to file
  const reportFile = '/tmp/accuracy-report.json';
  fs.writeFileSync(reportFile, JSON.stringify({ stats, results, metrics: { overallAccuracy, precision, recall, f1Score } }, null, 2));
  console.log(`📊 Full report saved to: ${reportFile}\n`);
  
  return { overallAccuracy, stats };
}

// Run tests
runTests().catch(console.error);
