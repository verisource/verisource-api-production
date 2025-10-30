const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');
content = content.replace(
  'let result = { status: "ok" });',
  'res.json({ status: "ok" });'
);
fs.writeFileSync('index.js', content);
