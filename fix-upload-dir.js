const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');
content = content.replace('dest: "/tmp/verisource_uploads"', 'dest: "./uploads"');
fs.writeFileSync('index.js', content);
