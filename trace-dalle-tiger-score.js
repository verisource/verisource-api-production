const { detectAIGeneration } = require('./ai-image-detector');

async function traceScore() {
  console.log('🔍 TRACING DALLE-TIGER SCORE CALCULATION');
  console.log('='.repeat(70));
  console.log('');
  
  const result = await detectAIGeneration('test-images/dalle-tiger.png');
  
  console.log('📊 Final Score:', result.ai_confidence + '%');
  console.log('🎯 Verdict:', result.likely_ai_generated ? 'AI-GENERATED' : 'AUTHENTIC');
  console.log('');
  
  console.log('⚠️  PENALTY INDICATORS (should ADD to score):');
  const penalties = result.indicators.filter(i => 
    !i.includes('authentic') && !i.includes('Natural') && !i.includes('Good')
  );
  penalties.forEach(p => console.log(`   + ${p}`));
  console.log(`   TOTAL PENALTY INDICATORS: ${penalties.length}`);
  
  console.log('');
  console.log('✓ BONUS INDICATORS (should SUBTRACT from score):');
  const bonuses = result.indicators.filter(i => 
    i.includes('authentic') || i.includes('Natural') || i.includes('Good')
  );
  bonuses.forEach(b => console.log(`   - ${b}`));
  console.log(`   TOTAL BONUS INDICATORS: ${bonuses.length}`);
  
  console.log('');
  console.log('💡 PROBLEM IDENTIFIED:');
  console.log(`   ${bonuses.length} bonus indicators are overwhelming ${penalties.length} penalty indicators`);
  console.log('');
  console.log('🔧 SOLUTION OPTIONS:');
  console.log('   1. Reduce weight of "authentic" bonuses for PNG files');
  console.log('   2. Add heavier penalty for PNG + AI dimensions combo');
  console.log('   3. Disable authentic bonuses entirely for PNGs without EXIF');
  console.log('');
  console.log('   Which would you prefer?');
}

traceScore().catch(console.error);
