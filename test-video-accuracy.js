/**
 * Video Accuracy Benchmark Test - IMPROVED VERSION
 * Shows new metrics: weighted scores, dynamic thresholds
 */

const fs = require('fs');
const path = require('path');
const { analyzeVideo } = require('./video-analyzer');

const TEST_SETS = {
  aiGenerated: {
    directory: './test-videos/ai-generated',
    label: 'AI',
    description: 'AI-generated videos'
  },
  deepfakes: {
    directory: './test-videos/deepfakes',
    label: 'AI',
    description: 'Deepfake videos'
  },
  manipulated: {
    directory: './test-videos/manipulated',
    label: 'MANIPULATED',
    description: 'Manipulated/edited videos'
  },
  authentic: {
    directory: './test-videos/authentic',
    label: 'REAL',
    description: 'Authentic real videos'
  }
};

async function testVideo(videoPath, expectedLabel, category) {
  try {
    console.log(`\n📹 Testing: ${path.basename(videoPath)}`);
    console.log(`   Category: ${category}`);
    
    const startTime = Date.now();
    const result = await analyzeVideo(videoPath);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    if (!result.success) {
      console.log(`   ❌ Error: ${result.error}`);
      return {
        file: path.basename(videoPath),
        category: category,
        error: result.error,
        expectedLabel: expectedLabel,
        duration: duration
      };
    }
    
    const { verdict, videoConfidence, aiPercentage, suspiciousPercentage, weightedScore, thresholds } = result.analysis;
    
    // Determine predicted label
    let predictedLabel;
    if (verdict === 'LIKELY_AI_GENERATED' || videoConfidence <= 30) {
      predictedLabel = 'AI';
    } else if (verdict === 'SUSPICIOUS' || verdict === 'POSSIBLY_MANIPULATED' || videoConfidence <= 60) {
      predictedLabel = 'MANIPULATED';
    } else if (verdict === 'AUTHENTIC' && videoConfidence >= 70) {
      predictedLabel = 'REAL';
    } else {
      predictedLabel = 'UNCERTAIN';
    }
    
    const binaryExpected = expectedLabel === 'REAL' ? 'REAL' : 'AI';
    const binaryPredicted = predictedLabel === 'REAL' ? 'REAL' : 'AI';
    const correct = binaryPredicted === binaryExpected;
    
    console.log(`   Expected: ${expectedLabel} (binary: ${binaryExpected})`);
    console.log(`   Predicted: ${predictedLabel} (binary: ${binaryPredicted})`);
    console.log(`   Verdict: ${verdict}`);
    console.log(`   Confidence: ${videoConfidence}%`);
    console.log(`   AI Frames: ${aiPercentage}%`);
    console.log(`   Weighted Score: ${weightedScore?.toFixed(1) || 'N/A'}%`);
    console.log(`   Dynamic Thresholds: AI=${thresholds?.aiThreshold}%, Sus=${thresholds?.suspiciousThreshold}%`);
    console.log(`   Frames Analyzed: ${result.analysis.framesAnalyzed}/${result.analysis.totalFrames}`);
    console.log(`   Result: ${correct ? '✅ CORRECT' : '❌ INCORRECT'}`);
    console.log(`   Duration: ${duration}s`);
    
    return {
      file: path.basename(videoPath),
      category: category,
      expectedLabel: expectedLabel,
      binaryExpected: binaryExpected,
      predictedLabel: predictedLabel,
      binaryPredicted: binaryPredicted,
      verdict: verdict,
      confidence: videoConfidence,
      framesAnalyzed: result.analysis.framesAnalyzed,
      totalFrames: result.analysis.totalFrames,
      aiPercentage: aiPercentage,
      weightedScore: weightedScore,
      thresholds: thresholds,
      correct: correct,
      duration: parseFloat(duration)
    };
    
  } catch (err) {
    console.error(`❌ Error testing ${path.basename(videoPath)}:`, err.message);
    return {
      file: path.basename(videoPath),
      category: category,
      error: err.message,
      expectedLabel: expectedLabel
    };
  }
}

async function testSetFunction(testSet) {
  if (!fs.existsSync(testSet.directory)) {
    console.log(`⚠️ Directory not found: ${testSet.directory}`);
    return [];
  }
  
  const files = fs.readdirSync(testSet.directory)
    .filter(f => /\.(mp4|mov|avi|webm|mkv)$/i.test(f))
    .map(f => path.join(testSet.directory, f));
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📁 Testing: ${testSet.description}`);
  console.log(`   Directory: ${testSet.directory}`);
  console.log(`   Videos: ${files.length}`);
  console.log(`   Expected: ${testSet.label}`);
  console.log('='.repeat(60));
  
  const results = [];
  for (const file of files) {
    const result = await testVideo(file, testSet.label, testSet.description);
    results.push(result);
  }
  
  return results;
}

function calculateMetrics(results) {
  const validResults = results.filter(r => !r.error && r.binaryPredicted !== 'UNCERTAIN');
  
  if (validResults.length === 0) {
    return {
      totalTests: results.length,
      validTests: 0,
      errors: results.filter(r => r.error).length,
      uncertain: results.filter(r => r.binaryPredicted === 'UNCERTAIN').length
    };
  }
  
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  
  validResults.forEach(r => {
    if (r.binaryExpected === 'AI' && r.binaryPredicted === 'AI') {
      truePositive++;
    } else if (r.binaryExpected === 'REAL' && r.binaryPredicted === 'REAL') {
      trueNegative++;
    } else if (r.binaryExpected === 'REAL' && r.binaryPredicted === 'AI') {
      falsePositive++;
    } else if (r.binaryExpected === 'AI' && r.binaryPredicted === 'REAL') {
      falseNegative++;
    }
  });
  
  const correct = truePositive + trueNegative;
  const total = validResults.length;
  const accuracy = (correct / total) * 100;
  
  const precision = truePositive / (truePositive + falsePositive) || 0;
  const recall = truePositive / (truePositive + falseNegative) || 0;
  const f1Score = 2 * (precision * recall) / (precision + recall) || 0;
  const avgDuration = validResults.reduce((sum, r) => sum + (r.duration || 0), 0) / validResults.length;
  
  const byCategory = {};
  results.forEach(r => {
    if (!byCategory[r.category]) {
      byCategory[r.category] = { total: 0, correct: 0, errors: 0 };
    }
    byCategory[r.category].total++;
    if (r.correct) byCategory[r.category].correct++;
    if (r.error) byCategory[r.category].errors++;
  });
  
  return {
    totalTests: results.length,
    validTests: validResults.length,
    errors: results.filter(r => r.error).length,
    uncertain: results.filter(r => r.binaryPredicted === 'UNCERTAIN').length,
    confusionMatrix: {
      truePositive, trueNegative, falsePositive, falseNegative
    },
    accuracy: accuracy.toFixed(2),
    precision: (precision * 100).toFixed(2),
    recall: (recall * 100).toFixed(2),
    f1Score: (f1Score * 100).toFixed(2),
    avgProcessingTime: avgDuration.toFixed(1),
    byCategory: byCategory
  };
}

async function runBenchmark() {
  console.log('🎯 VeriSource Video Accuracy Benchmark - IMPROVED VERSION');
  console.log('========================================================');
  console.log('New Features:');
  console.log('  ✅ Blur filtering (sharp frames only)');
  console.log('  ✅ Weighted aggregation (confidence-based)');
  console.log('  ✅ Dynamic thresholds (video-length adaptive)');
  console.log('');
  console.log(`Started: ${new Date().toLocaleString()}\n`);
  
  const allResults = [];
  
  for (const [key, testSet] of Object.entries(TEST_SETS)) {
    const results = await testSetFunction(testSet);
    allResults.push(...results);
  }
  
  console.log('\n\n' + '='.repeat(60));
  console.log('📊 FINAL RESULTS');
  console.log('='.repeat(60) + '\n');
  
  const metrics = calculateMetrics(allResults);
  
  console.log('Overall Performance:');
  console.log(`   Total Tests: ${metrics.totalTests}`);
  console.log(`   Valid Tests: ${metrics.validTests}`);
  console.log(`   Errors: ${metrics.errors}`);
  console.log(`   Uncertain: ${metrics.uncertain}`);
  console.log('');
  console.log(`   ✅ Overall Accuracy: ${metrics.accuracy}%`);
  console.log(`   📊 Precision: ${metrics.precision}%`);
  console.log(`   🎯 Recall: ${metrics.recall}%`);
  console.log(`   ⚖️  F1 Score: ${metrics.f1Score}%`);
  console.log(`   ⏱️  Avg Processing Time: ${metrics.avgProcessingTime}s per video`);
  console.log('');
  
  console.log('Confusion Matrix (Binary: AI/Fake vs Real):');
  console.log(`   True Positives (AI/Fake → AI): ${metrics.confusionMatrix.truePositive}`);
  console.log(`   True Negatives (Real → Real): ${metrics.confusionMatrix.trueNegative}`);
  console.log(`   False Positives (Real → AI): ${metrics.confusionMatrix.falsePositive}`);
  console.log(`   False Negatives (AI/Fake → Real): ${metrics.confusionMatrix.falseNegative}`);
  console.log('');
  
  console.log('Performance by Category:');
  Object.entries(metrics.byCategory).forEach(([category, stats]) => {
    const accuracy = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(2) : '0.00';
    console.log(`   ${category}: ${stats.correct}/${stats.total} correct (${accuracy}%)`);
  });
  console.log('');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = `./benchmark-results-improved-${timestamp}.json`;
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    version: 'improved',
    features: ['blur-filtering', 'weighted-aggregation', 'dynamic-thresholds'],
    metrics: metrics,
    detailedResults: allResults
  }, null, 2));
  
  console.log(`📝 Detailed results saved to: ${reportPath}`);
  console.log('');
  
  const acc = parseFloat(metrics.accuracy);
  const fpRate = metrics.confusionMatrix.falsePositive / (metrics.confusionMatrix.falsePositive + metrics.confusionMatrix.trueNegative) || 0;
  const fnRate = metrics.confusionMatrix.falseNegative / (metrics.confusionMatrix.falseNegative + metrics.confusionMatrix.truePositive) || 0;
  
  console.log('💡 ANALYSIS');
  console.log('==========\n');
  
  if (acc >= 90) {
    console.log('✅ EXCELLENT: Accuracy >= 90%');
  } else if (acc >= 80) {
    console.log('✅ GOOD: Accuracy 80-90%');
  } else if (acc >= 70) {
    console.log('⚠️  MODERATE: Accuracy 70-80%');
  } else {
    console.log('❌ NEEDS MORE WORK: Accuracy < 70%');
  }
  
  console.log('');
  console.log('Error Analysis:');
  console.log(`   False Positive Rate: ${(fpRate * 100).toFixed(2)}% (real videos flagged as AI)`);
  console.log(`   False Negative Rate: ${(fnRate * 100).toFixed(2)}% (AI videos missed)`);
  
  if (fpRate > 0.2) {
    console.log('   ⚠️  High false positives - consider adjusting thresholds');
  }
  if (fnRate > 0.2) {
    console.log('   ⚠️  High false negatives - AI detection needs improvement');
  }
  
  console.log('');
  console.log('Benchmark complete! ✅');
  
  return metrics;
}

if (require.main === module) {
  runBenchmark()
    .then(metrics => {
      console.log('\n✅ Benchmark completed successfully');
      process.exit(0);
    })
    .catch(err => {
      console.error('\n❌ Benchmark failed:', err);
      console.error(err.stack);
      process.exit(1);
    });
}

module.exports = { runBenchmark, testVideo, calculateMetrics };
