const fs = require('fs');
let content = fs.readFileSync('video-canonicalization.ts', 'utf8');
const lines = content.split('\n');

// Find line with "const resized = await sharp(frameBuffer, {"
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const resized = await sharp(frameBuffer, {')) {
    // Replace lines i through i+5 with single line
    lines.splice(i, 6, '    const resized = await sharp(frameBuffer)');
    break;
  }
}

fs.writeFileSync('video-canonicalization.ts', lines.join('\n'));
console.log('Fixed sharp call!');
