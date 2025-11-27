const ExifParser = require('exif-parser');
const fs = require('fs');

const file = process.argv[2] || 'test2.jpg';
const buffer = fs.readFileSync(file);
const parser = ExifParser.create(buffer);
const result = parser.parse();

console.log('=== EXIF Tags ===');
console.log(JSON.stringify(result.tags, null, 2));

console.log('\n=== Image Size ===');
console.log(JSON.stringify(result.imageSize, null, 2));

console.log('\n=== Checking for Make/Model ===');
console.log('Make:', result.tags.Make || result.tags.make || 'NOT FOUND');
console.log('Model:', result.tags.Model || result.tags.model || 'NOT FOUND');
