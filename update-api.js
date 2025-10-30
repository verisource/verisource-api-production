const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

// Update allowed MIME types
content = content.replace(
  /const allowedMimeTypes = \['video\/mp4', 'video\/quicktime', 'video\/x-msvideo'\];/,
  `const allowedMimeTypes = [
  // Video formats
  'video/mp4', 
  'video/quicktime', 
  'video/x-msvideo',
  'video/webm',
  // Image formats
  'image/jpeg',
  'image/jpg', 
  'image/png',
  'image/webp',
  'image/gif'
];`
);

fs.writeFileSync('index.js', content);
console.log('Updated MIME types!');
