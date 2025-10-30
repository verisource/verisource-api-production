const fs = require('fs');
let content = fs.readFileSync('video-canonicalization.ts', 'utf8');
const lines = content.split('\n');

// Find the line with "const resized = await sharp(frameBuffer)"
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const resized = await sharp(frameBuffer)')) {
    // Replace this section with complete pipeline
    lines.splice(i, 3, 
      '    const resized = await sharp(frameBuffer)',
      '      .resize(CONFIG.PHASH_SIZE, CONFIG.PHASH_SIZE, {',
      '        fit: \'fill\',',
      '        kernel: \'lanczos3\'',
      '      })',
      '      .grayscale()',
      '      .raw()',
      '      .toBuffer();'
    );
    break;
  }
}

fs.writeFileSync('video-canonicalization.ts', lines.join('\n'));
console.log('Fixed!');
