const trustScore = require('./services/trust-score');

async function testScenarios() {
  console.log('\n========================================');
  console.log('TRUST SCORE v3.1 TEST');
  console.log('========================================\n');

  // Scenario 1: Typical image - no EXIF, no blockchain yet, authentic
  const typical = await trustScore.calculateTrustScore({
    hash: 'a'.repeat(64),
    fileIntegrity: { valid: true, corrupted: false },
    metadata: { width: 1920, height: 1080 },
    aiDetection: { external: { authentic_confidence: 85 } }
  });
  console.log('1. Typical upload (no EXIF, authentic):');
  console.log('   Score:', typical.trust_score.overall);
  console.log('   Label:', typical.trust_score.confidence_label);
  console.log('   Breakdown:', typical.trust_score.breakdown);

  // Scenario 2: iPhone photo with full EXIF
  const iphone = await trustScore.calculateTrustScore({
    hash: 'b'.repeat(64),
    fileIntegrity: { valid: true, corrupted: false },
    metadata: { 
      width: 4032, height: 3024,
      exif: { Make: 'Apple', Model: 'iPhone 14 Pro', DateTimeOriginal: '2024:01:15 14:30:00' }
    },
    blockchain: { timestamp: new Date().toISOString(), confirmations: 0 },
    aiDetection: { external: { authentic_confidence: 92 } }
  });
  console.log('\n2. iPhone photo with EXIF:');
  console.log('   Score:', iphone.trust_score.overall);
  console.log('   Label:', iphone.trust_score.confidence_label);
  console.log('   Breakdown:', iphone.trust_score.breakdown);

  // Scenario 3: AI-generated image
  const aiGen = await trustScore.calculateTrustScore({
    hash: 'c'.repeat(64),
    fileIntegrity: { valid: true, corrupted: false },
    metadata: { width: 1024, height: 1024 },
    aiDetection: { external: { authentic_confidence: 15 } }
  });
  console.log('\n3. AI-generated image:');
  console.log('   Score:', aiGen.trust_score.overall);
  console.log('   Label:', aiGen.trust_score.confidence_label);
  console.log('   Breakdown:', aiGen.trust_score.breakdown);

  // Scenario 4: Image with Photoshop editing
  const edited = await trustScore.calculateTrustScore({
    hash: 'd'.repeat(64),
    fileIntegrity: { valid: true, corrupted: false },
    metadata: { 
      width: 1920, height: 1080,
      exif: { Software: 'Adobe Photoshop 2024' }
    },
    aiDetection: { external: { authentic_confidence: 78 } }
  });
  console.log('\n4. Photoshop-edited image:');
  console.log('   Score:', edited.trust_score.overall);
  console.log('   Label:', edited.trust_score.confidence_label);
  console.log('   Breakdown:', edited.trust_score.breakdown);

  // Scenario 5: AI software in EXIF (should be very low)
  const aiExif = await trustScore.calculateTrustScore({
    hash: 'e'.repeat(64),
    fileIntegrity: { valid: true, corrupted: false },
    metadata: { 
      width: 1024, height: 1024,
      exif: { Software: 'Stable Diffusion' }
    },
    aiDetection: { external: { authentic_confidence: 10 } }
  });
  console.log('\n5. AI software in EXIF:');
  console.log('   Score:', aiExif.trust_score.overall);
  console.log('   Label:', aiExif.trust_score.confidence_label);
  console.log('   Breakdown:', aiExif.trust_score.breakdown);

  console.log('\n========================================');
  console.log('TEST COMPLETE');
  console.log('========================================\n');
}

testScenarios().catch(console.error);
