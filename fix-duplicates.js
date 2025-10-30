const fs = require('fs');
let content = fs.readFileSync('video-canonicalization.ts', 'utf8');
let lines = content.split('\n');

// Remove lines 16-20 (the old imports that are now duplicated)
lines.splice(15, 6);

// Insert correct imports at line 16
const correctImports = [
  "// Copyright (c) 2025 [Your Name]",
  "// SPDX-License-Identifier: MIT", 
  "/**",
  " * Video Canonicalization for Content Origin Credentials",
  " * ",
  " * Version: vid:v1:srgb|max720|fps15.000|resize-lanczos3|rgb8",
  " * ",
  " * Pipeline:",
  " * 1. Demux & decode (visual only) - drop audio",
  " * 2. Normalize geometry - max 720px, keep aspect, Lanczos3",
  " * 3. Normalize temporal - resample to 15.000 fps",
  " * 4. Keyframe baseline - treat every frame as canonical",
  " * 5. Packaging - work in memory (or PNG sequence for tests)",
  " */",
  "import sharp from 'sharp';",
  "import { createHash } from 'crypto';",
  "import * as fs from 'fs';",
  "import ffmpeg from 'fluent-ffmpeg';",
  "const blake3 = require('blake3');"
];

// Replace first 20 lines with correct header
lines = correctImports.concat(lines.slice(20));

fs.writeFileSync('video-canonicalization.ts', lines.join('\n'));
console.log('Fixed duplicates!');
