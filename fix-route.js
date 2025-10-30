const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');
content = content.replace(
  'app.post("/verify", upload.single("file"), async (req, res) => {',
  'app.post("/verify", upload.single("file"), (err, req, res, next) => { if (err) { console.log("MULTER ERROR:", err); return res.status(400).json({ error: err.message }); } next(); }, async (req, res) => {'
);
fs.writeFileSync('index.js', content);
