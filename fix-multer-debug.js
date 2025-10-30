const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');
content = content.replace(
  'fileFilter: (req, file, cb) => {',
  'fileFilter: (req, file, cb) => {\n      console.log("MULTER CHECK:", file.originalname, file.mimetype);'
);
fs.writeFileSync('index.js', content);
