const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

// Replace the broken fileFilter with a working one
const newFilter = `fileFilter: (req, file, cb) => {
      console.log("MULTER CHECK:", file.originalname, file.mimetype);
      const ok = /^(image|video)\//.test(file.mimetype) || 
                 /\.(png|jpe?g|webp|gif|tiff?|bmp|mp4|mov|m4v|webm|mkv|avi)$/i.test(file.originalname);
      console.log("MULTER ACCEPT:", ok);
      cb(ok ? null : new Error("Unsupported file type"));
    },`;

// Find and replace the fileFilter section
content = content.replace(
  /fileFilter: \(req, file, cb\) => \{[\s\S]*?cb\(ok[^}]+\);[\s\S]*?\},/,
  newFilter
);

fs.writeFileSync('index.js', content);
console.log("Fixed!");
