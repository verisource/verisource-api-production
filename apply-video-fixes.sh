#!/bin/bash
cd /workspaces/verisource-api-production

node << 'NODEJS'
const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

// 1. Add mime import
const cryptoLine = content.indexOf("const crypto = require('crypto');");
if (!content.includes('mime-types')) {
  content = content.substring(0, cryptoLine) + "const mime = require('mime-types');\n" + content.substring(cryptoLine);
  console.log('1. Added mime');
}

// 2. Fix fileFilter  
content = content.replace(/fileFilter:.*?\},/s, 
  "fileFilter: (req, file, cb) => {\n    const exts = ['.jpg','.png','.gif','.webp','.mp4','.mov','.avi','.webm'];\n    if (exts.some(e => file.originalname.toLowerCase().endsWith(e)) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);\n    else cb(new Error('Invalid type'));\n  },");
console.log('2. Fixed filter');

// 3. File size
content = content.replace(/fileSize: 10 \* 1024 \* 1024/, 'fileSize: 200 * 1024 * 1024');
console.log('3. Size limit');

// 4. Add kind var
const v = content.indexOf("app.post('/verify'");
const f = content.indexOf('async (req, res) => {', v) + 21;
content = content.substring(0,f) + '\n    let kind = "unknown";\n' + content.substring(f);
console.log('4. Added kind');

// 5. Fix detection
const b = content.indexOf('const buf = fs.readFileSync(req.file.path);');
const n = content.indexOf('\n', b) + 1;
content = content.replace(/const isImg.*?\n/, '').replace(/const isVid.*?\n/, '').replace(/const isAud.*?\n/, '');
const det = '    const dm = req.file.mimetype === "application/octet-stream" ? (mime.lookup(req.file.originalname) || req.file.mimetype) : req.file.mimetype;\n    const isImg = /^image\\//i.test(dm);\n    const isVid = dm.startsWith("video/") || [\'.mp4\',\'.mov\',\'.avi\',\'.webm\'].some(e => req.file.originalname.toLowerCase().endsWith(e));\n    const isAud = /^audio\\//i.test(dm);\n    kind = isImg ? "image" : (isVid ? "video" : (isAud ? "audio" : "unknown"));\n';
const ab = content.indexOf('\n', content.indexOf('const buf = fs.readFileSync')) + 1;
content = content.substring(0, ab) + det + content.substring(ab);
console.log('5. Fixed detection');

// 6. Fix r.kind
content = content.replace(/kind: isImg.*?'audio'\)/, 'kind: kind');
console.log('6. Fixed r.kind');

fs.writeFileSync('index.js', content);
console.log('DONE!');
NODEJS
