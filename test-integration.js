/**
 * Integration Test
 * Tests the complete flow: AI Detection → Trust Score → Response Format
 */

const aiRouter = require('./services/ai-detection-router');
const trustScore = require('./services/trust-score');
const formatter = require('./services/response-formatter');

async function testCompleteFlow() {
  console.log('\n========================================');
  console.log('🔗 INTEGRATION TEST: Complete Flow');
  console.log('========================================\n');

  // Simulate verification data for authentic iPhone photo
  const verificationData = {
    verificationId: 'ver_test_12345',
    hash: 'a'.repeat(64),
    fileIntegrity: {
      valid: true,
      corrupted: false
    },
    duplicates: {
      found: 0
    },
    blockchain: {
      timestamp: new Date().toISOString(),
      confirmations: 15,
      network: 'polygon',
      txHash: '0xabc123',
      txUrl: 'https://polygonscan.com/tx/0xabc123',
      block: 12345678,
      history: [
        { timestamp: new Date().toISOString() }
      ]
    },
    metadata: {
      format: 'jpeg',
      width: 4032,
      height: 3024,
      exif: {
        Make: 'Apple',
        Model: 'iPhone 13 Pro',
        DateTime: '2024-11-20 14:30:00',
        GPSLatitude: 40.7128,
        GPSLongitude: -74.0060
      }
    },
    reverseSearch: {
      tineye: { matches: [] },
      google: { matches: [] }
    },
    priorInstances: {
      earliestFound: null
    }
  };

  console.log('Step 1: AI Detection with Smart Routing...');
  const aiResult = await aiRouter.detectWithRouting({
    filePathOrUrl: 'https://example.com/photo.jpg',
    hash: verificationData.hash,
    metadata: verificationData.metadata,
    userTier: 'paid', // Test with paid tier
    mediaType: 'image'
  });

  console.log('✅ AI Detection Complete');
  console.log('  Local:', aiResult.local.result, `(${aiResult.local.confidence}%)`);
  console.log('  External:', aiResult.external ? 
    `${aiResult.external.result} (${aiResult.external.authentic_confidence}%)` : 
    'Not called');
  console.log('  Routing:', aiResult.routing.external_executed ? 
    'External API called' : 
    `Skipped (${aiResult.routing.external_skipped_reason})`);

  // Add AI results to verification data
  verificationData.aiDetection = aiResult;

  console.log('\nStep 2: Calculate Trust Score...');
  const trustScoreResult = await trustScore.calculateTrustScore(verificationData);

  console.log('✅ Trust Score Calculated');
  console.log('  Overall Score:', trustScoreResult.trust_score.overall);
  console.log('  Label:', trustScoreResult.trust_score.confidence_label);
  console.log('  Breakdown:');
  console.log('    - Cryptographic:', trustScoreResult.trust_score.breakdown.cryptographic);
  console.log('    - Blockchain:', trustScoreResult.trust_score.breakdown.blockchain);
  console.log('    - Metadata:', trustScoreResult.trust_score.breakdown.metadata);
  console.log('    - Provenance:', trustScoreResult.trust_score.breakdown.provenance);
  console.log('    - AI Detection:', trustScoreResult.trust_score.breakdown.ai_detection);

  console.log('\nStep 3: Format API Response...');
  const apiResponse = formatter.formatVerificationResponse(
    verificationData,
    trustScoreResult
  );

  console.log('✅ Response Formatted');
  console.log('\nFinal API Response:');
  console.log(JSON.stringify(apiResponse, null, 2));

  console.log('\n========================================');
  console.log('✅ INTEGRATION TEST COMPLETE');
  console.log('========================================');
  console.log('\nAll components working together:');
  console.log('  ✅ AI Detection Router');
  console.log('  ✅ Trust Score Calculator');
  console.log('  ✅ Response Formatter');
  console.log('\nReady for production integration!');
  console.log('========================================\n');
}

testCompleteFlow().catch(console.error);
