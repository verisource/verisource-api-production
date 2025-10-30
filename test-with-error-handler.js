const express = require('express');
const multer = require('multer');
const app = express();

const upload = multer({ 
  dest: './uploads',
  limits: { fileSize: 50 * 1024 * 1024 }
});

// Error handler middleware
app.use((err, req, res, next) => {
  console.log("ERROR MIDDLEWARE:", err);
  res.status(500).json({ error: err.message });
});

app.post('/verify', (req, res, next) => {
  console.log("BEFORE MULTER");
  next();
}, upload.single('file'), (err, req, res, next) => {
  if (err) {
    console.log("MULTER ERROR:", err);
    return res.status(400).json({ multerError: err.message });
  }
  next();
}, (req, res) => {
  console.log("AFTER MULTER, req.file:", req.file);
  res.json({ file: req.file });
});

app.listen(8080, () => console.log('Test :8080'));
