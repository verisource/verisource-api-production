const fs = require('fs');
let content = fs.readFileSync('video-canonicalization.ts', 'utf8');
const lines = content.split('\n');

// Fix specific lines
lines[16] = "import sharp from 'sharp';";
lines[17] = "import { createHash } from 'crypto';";
lines[18] = "import * as fs from 'fs';";
lines[19] = "import ffmpeg from 'fluent-ffmpeg';";
lines[20] = "const blake3 = require('blake3');";

fs.writeFileSync('video-canonicalization.ts', lines.join('\n'));
console.log('Fixed imports!');
