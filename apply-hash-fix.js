const fs = require('fs');
const content = fs.readFileSync('index.js', 'utf8');

// Find the canonical image section and replace it
const oldCode = `    if (isImg && canonicalizeImage) {
      const canonBuf = await canonicalizeImage(buf);
      r.canonical = {
        algorithm: 'perceptual_hash',
        fingerprint: canonBuf.toString('hex'),
        version: 'img:v2'
      };
    }`;

const newCode = `    if (isImg && canonicalizeImage) {
      const canonBuf = await canonicalizeImage(buf);
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(canonBuf).digest('hex');
      r.canonical = {
        algorithm: 'sha256',
        fingerprint: hash,
        version: 'img:v2'
      };
    }`;

const updated = content.replace(oldCode, newCode);

if (updated === content) {
  console.log('❌ Pattern not found - no changes made');
  process.exit(1);
} else {
  fs.writeFileSync('index.js', updated);
  console.log('✅ Successfully updated canonical to use SHA-256 hash');
}
