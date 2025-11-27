const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

// Replace: console.log`...`); with console.log(`...`);
// Step 1: Find all instances
const pattern = /console\.log`/g;
content = content.replace(pattern, 'console.log(`');

// Step 2: Find closing backtick-paren and add opening paren
const pattern2 = /console\.log\(\s*`([^`]*)`\)/g;
content = content.replace(pattern2, 'console.log(`$1`)');

fs.writeFileSync('index.js', content);
console.log('✅ Fixed');
