const express = require('express');
const multer = require('multer');
const upload = multer({ dest: './test-uploads' });
const app = express();

app.post('/test', upload.single('file'), (req, res) => {
  console.log('GOT FILE:', req.file ? 'YES' : 'NO');
  res.json({ received: !!req.file, file: req.file });
});

app.listen(9999, () => console.log('Test on :9999'));
