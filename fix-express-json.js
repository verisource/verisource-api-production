const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');
content = content.replace(
  'app.use(express.json({ limit: "5mb" }));',
  '// express.json removed - was interfering with multipart uploads'
);
fs.writeFileSync('index.js', content);
