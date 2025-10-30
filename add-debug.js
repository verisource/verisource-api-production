const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');
content = content.replace(
  'app.post("/verify", upload.single("file"), async (req, res) => {',
  'app.post("/verify", upload.single("file"), async (req, res) => {\n    console.log("DEBUG: req.file =", req.file ? "EXISTS" : "NULL");\n    console.log("DEBUG: Content-Type =", req.headers["content-type"]);'
);
fs.writeFileSync('index.js', content);
