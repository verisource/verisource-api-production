const fs = require('fs');

// Read the file
let content = fs.readFileSync('services/jpeg-artifact-analysis.js', 'utf8');

// FIX 1: Add ai_confidence to the return statement in analyze function
// Find the return statement and add ai_confidence
content = content.replace(
  /(\s+return \{)\s*\n(\s+isAI,)/,
  '$1\n        ai_confidence: Math.round(confidence * 100),\n$2'
);

// FIX 2: Add memory limit to jpeg.decode
content = content.replace(
  /jpeg\.decode\(buffer, \{ useTArray: true \}\)/,
  'jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 2048 })'
);

// Write back
fs.writeFileSync('services/jpeg-artifact-analysis.js', content);

console.log('✅ Fixes applied correctly');
