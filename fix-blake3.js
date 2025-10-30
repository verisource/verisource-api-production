const fs = require('fs');
let content = fs.readFileSync('video-canonicalization.ts', 'utf8');

// Replace blake3 import with blake3-wasm
content = content.replace(
  "import * as blake3 from 'blake3';",
  "import { createHash as blake3CreateHash } from 'blake3-wasm/node';\nconst blake3 = { hash: (data) => blake3CreateHash().update(data).digest('hex') };"
);

fs.writeFileSync('video-canonicalization.ts', content);
console.log('Switched to blake3-wasm!');
