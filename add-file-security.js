const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

const fileSecurity = `
// File security validation
function validateFileContent(buffer, mimetype, filename) {
  // 1. Check for executable signatures
  const executableSignatures = [
    { sig: Buffer.from([0x4D, 0x5A]), name: 'Windows executable' },
    { sig: Buffer.from([0x7F, 0x45, 0x4C, 0x46]), name: 'Linux executable' },
    { sig: Buffer.from([0xCA, 0xFE, 0xBA, 0xBE]), name: 'Java class' },
    { sig: Buffer.from([0x23, 0x21]), name: 'Script with shebang' }
  ];
  
  for (const { sig, name } of executableSignatures) {
    if (buffer.length >= sig.length && buffer.slice(0, sig.length).equals(sig)) {
      throw new Error(\`Executable files not allowed: \${name}\`);
    }
  }
  
  // 2. Check file extension matches content
  const ext = filename.split('.').pop().toLowerCase();
  
  // PNG should start with PNG signature
  if (ext === 'png' && !buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
    throw new Error('PNG file signature mismatch - possible malicious file');
  }
  
  // JPEG should start with FFD8
  if ((ext === 'jpg' || ext === 'jpeg') && !buffer.slice(0, 2).equals(Buffer.from([0xFF, 0xD8]))) {
    throw new Error('JPEG file signature mismatch - possible malicious file');
  }
  
  // 3. Check for suspicious patterns in filename
  const suspiciousPatterns = [
    /\.\.|\/\.\.|\\\.\./, // Path traversal
    /[<>:"|?*]/, // Invalid filename characters
    /\0/, // Null bytes
    /\.php$|\.asp$|\.jsp$/i // Server-side scripts
  ];
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(filename)) {
      throw new Error('Suspicious filename pattern detected');
    }
  }
  
  return true;
}
`;

// Add validation to the verify endpoint
const validationCall = `
      // Validate file content for security
      try {
        const fileBuffer = fs.readFileSync(req.file.path);
        validateFileContent(fileBuffer, req.file.mimetype, req.file.originalname);
      } catch (secError) {
        // Clean up and reject
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {}
        return res.status(400).json({ 
          error: 'File validation failed', 
          detail: secError.message 
        });
      }
`;

// Insert file security function before app.get
content = content.replace(
  'app.get("/"',
  fileSecurity + '\n\napp.get("/"'
);

// Insert validation call after "if (!req.file)"
content = content.replace(
  '    if (!req.file) {',
  '    if (!req.file) {'
);

content = content.replace(
  '    let workPath = req.file.path;',
  validationCall + '\n    let workPath = req.file.path;'
);

fs.writeFileSync('index.js', content);
console.log('✅ File security validation added');
