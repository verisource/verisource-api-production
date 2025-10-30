const fs = require('fs');
const indexLines = fs.readFileSync('index.js', 'utf8').split('\n');
const testLines = fs.readFileSync('test-with-error-handler.js', 'utf8').split('\n');
const workingRoute = testLines.slice(14, 27).map(l => l.replace("'/verify'", '"/verify"'));
const newContent = [...indexLines.slice(0, 186), ...workingRoute, ...indexLines.slice(296)].join('\n');
fs.writeFileSync('index.js', newContent);
console.log('Done!');
