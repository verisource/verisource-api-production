const fs = require('fs');

let content = fs.readFileSync('services/ensemble-ai-detection.js', 'utf8');

// Find the ensemble scoring logic and modify it to weight JPEG at 0
// We need to find where ai_confidence is calculated from both detectors

// Option 1: If there's explicit weighting
content = content.replace(
  /const jpegWeight = [0-9.]+;/,
  'const jpegWeight = 0.0;'
);

content = content.replace(
  /const localWeight = [0-9.]+;/,
  'const localWeight = 1.0;'
);

// Option 2: If it's averaged directly, change to only use local
// Look for: (jpeg + local) / 2
content = content.replace(
  /ai_confidence:\s*Math\.round\(\s*\(\s*jpegResult\.ai_confidence\s*\+\s*localResult\.ai_confidence\s*\)\s*\/\s*2\s*\)/g,
  'ai_confidence: Math.round(localResult.ai_confidence)'
);

// Also handle the case where it might use both scores
content = content.replace(
  /\(jpegResult\.ai_confidence \+ localResult\.ai_confidence\) \/ 2/g,
  'localResult.ai_confidence'
);

// Write it back
fs.writeFileSync('services/ensemble-ai-detection.js', content);

console.log('✅ Modified ensemble to use Local detector only (JPEG weight = 0)');
