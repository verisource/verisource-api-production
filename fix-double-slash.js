const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');
content = content.replace('/^(image|video)//', '/^(image|video)\\/');
fs.writeFileSync('index.js', content);
