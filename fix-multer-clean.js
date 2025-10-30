const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');
const oldMulter = /const upload = multer\(\{[\s\S]*?\}\);/;
const newMulter = `const upload = multer({
  dest: "./uploads",
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^(image|video)\\//.test(file.mimetype) || /\\.(png|jpe?g|webp|gif|tiff?|bmp|mp4|mov|m4v|webm|mkv|avi)$/i.test(file.originalname);
    cb(ok ? null : new Error("Unsupported file type"));
  }
});`;
content = content.replace(oldMulter, newMulter);
fs.writeFileSync('index.js', content);
