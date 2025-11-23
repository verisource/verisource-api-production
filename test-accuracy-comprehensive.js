const fs = require('fs');
const path = require('path');
const { detectAIGeneration } = require('./services/ensemble-ai-detection');

/**
 * Comprehensive Accuracy Testing
 * Tests detector against labeled dataset - REAL PHOTOS ONLY
 */

const categories = {
  'real-dslr': { label: 'authentic', expectedAI: false },
  'real-stock': { label: 'authentic', expectedAI: false },
  'real-smartphone': { label: 'authentic', expectedAI: false },
  'real-edited': { label: 'edited', expectedAI: false }
  // NOTE: ai-generated folder excluded from this test
};

async function testAccuracy() {
  console.log('========================================');
  console.log('VeriSource Accuracy Test - Real Photos');
  console.log('========================================\n');

  const results = {
    total: 0,
    correct: 0,
    byCategory: {}
  };

  for (const [category, config] of Object.entries(categories)) {
    const dir = path.join(__dirname, 'test-dataset', category);
    
    if (!fs.existsSync(dir)) {
      console.log(`⚠️ Directory not found: ${dir}`);
      continue;
    }

    const files = fs.readdirSync(dir).filter(f => 
      f.endsWith('.jpg') || f.endsWith('.jpeg') || 
      f.endsWith('.png') || f.endsWith('.webp')
    );

    console.log(`\n📁 Testing ${category}: ${files.length} images`);
    console.log('─'.repeat(50));

    results.byCategory[category] = {
      total: 0,
      correct: 0,
      falsePositives: 0,
      falseNegatives: 0,
      results: []
    };

    for (const file of files) {
      const imagePath = path.join(dir, file);
      
      try {
        const result = await detectAIGeneration(imagePath);
        const aiConfidence = result.ai_confidence;
        const detectedAsAI = aiConfidence >= 50;
        
        const isCorrect = detectedAsAI === config.expectedAI;
        
        results.total++;
        results.byCategory[category].total++;
        
        if (isCorrect) {
          results.correct++;
          results.byCategory[category].correct++;
          console.log(`✅ ${file}: ${aiConfidence}% AI`);
        } else {
          if (detectedAsAI && !config.expectedAI) {
            results.byCategory[category].falsePositives++;
            console.log(`❌ FALSE POSITIVE: ${file}: ${aiConfidence}% AI (should be authentic)`);
          } else {
            results.byCategory[category].falseNegatives++;
            console.log(`❌ FALSE NEGATIVE: ${file}: ${aiConfidence}% AI (should be AI)`);
          }
        }

        results.byCategory[category].results.push({
          file,
          aiConfidence,
          detectedAsAI,
          expectedAI: config.expectedAI,
          correct: isCorrect
        });

      } catch (error) {
        console.log(`⚠️ Error processing ${file}:`, error.message);
      }
    }

    const categoryAccuracy = results.byCategory[category].total > 0
      ? (results.byCategory[category].correct / results.byCategory[category].total * 100).toFixed(1)
      : 0;
    
    console.log(`\n${category} accuracy: ${categoryAccuracy}%`);
  }

  // Calculate overall accuracy
  const overallAccuracy = results.total > 0
    ? (results.correct / results.total * 100).toFixed(1)
    : 0;

  console.log('\n========================================');
  console.log('FINAL RESULTS - REAL PHOTOS ONLY');
  console.log('========================================');
  console.log(`Total images tested: ${results.total}`);
  console.log(`Correct: ${results.correct}`);
  console.log(`Incorrect: ${results.total - results.correct}`);
  console.log(`Overall Accuracy: ${overallAccuracy}%`);
  console.log('\nBy Category:');
  
  for (const [category, data] of Object.entries(results.byCategory)) {
    const acc = data.total > 0 ? (data.correct / data.total * 100).toFixed(1) : 0;
    console.log(`  ${category}: ${acc}% (${data.correct}/${data.total})`);
    if (data.falsePositives > 0) {
      console.log(`    ⚠️ False Positives: ${data.falsePositives} (real photos flagged as AI)`);
    }
    if (data.falseNegatives > 0) {
      console.log(`    ⚠️ False Negatives: ${data.falseNegatives}`);
    }
  }

  // Calculate false positive rate (critical metric)
  const totalFalsePositives = Object.values(results.byCategory)
    .reduce((sum, cat) => sum + cat.falsePositives, 0);
  const falsePositiveRate = results.total > 0 
    ? (totalFalsePositives / results.total * 100).toFixed(1)
    : 0;
  
  console.log('\n========================================');
  console.log('KEY METRICS');
  console.log('========================================');
  console.log(`False Positive Rate: ${falsePositiveRate}% (real photos incorrectly flagged as AI)`);
  console.log(`True Negative Rate: ${(100 - parseFloat(falsePositiveRate)).toFixed(1)}% (real photos correctly identified)`);

  // Save detailed results
  fs.writeFileSync(
    'test-results/accuracy-report.json',
    JSON.stringify(results, null, 2)
  );

  console.log('\n📊 Detailed results saved to: test-results/accuracy-report.json');
  
  if (parseFloat(overallAccuracy) >= 80) {
    console.log('\n🎉 TARGET ACHIEVED: 80%+ accuracy on real photos!');
  } else {
    console.log(`\n⚠️ TARGET NOT MET: Need ${(80 - parseFloat(overallAccuracy)).toFixed(1)}% improvement`);
    console.log('\nMost common issue: Real photos being flagged as AI (false positives)');
  }

  console.log('\n========================================');
  console.log('NEXT STEPS');
  console.log('========================================');
  
  if (parseFloat(overallAccuracy) < 80) {
    console.log('Based on results:');
    console.log('1. Identify which category has most false positives');
    console.log('2. Analyze those images for common patterns');
    console.log('3. Adjust detector thresholds or logic');
    console.log('4. Re-run test until 80%+ achieved');
  } else {
    console.log('Accuracy target met! Ready to:');
    console.log('1. Test with AI-generated images next');
    console.log('2. Fine-tune thresholds if needed');
    console.log('3. Deploy to production');
  }
}

testAccuracy().catch(console.error);
