const express = require('express');
const multer = require('multer');
const upload = multer({ dest: './uploads' });
const app = express();

app.post('/verify', upload.single('file'), (req, res) => {
  console.log('FILE:', req.file ? 'YES' : 'NO');
  res.json({ file: req.file });
});

app.listen(8080, () => console.log('Minimal test :8080'));
