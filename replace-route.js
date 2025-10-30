const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

// Find the start of the /verify route
const lines = content.split('\n');
let routeStart = -1;
let routeEnd = -1;

// Find where the route starts
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('app.post("/verify"')) {
    routeStart = i;
    break;
  }
}

// Find where it ends (the closing }); for the route handler)
if (routeStart !== -1) {
  let braceCount = 0;
  let inRoute = false;
  for (let i = routeStart; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('{')) {
      braceCount += (line.match(/{/g) || []).length;
      inRoute = true;
    }
    if (line.includes('}')) {
      braceCount -= (line.match(/}/g) || []).length;
    }
    if (inRoute && braceCount === 0 && line.includes('});')) {
      routeEnd = i;
      break;
    }
  }
}

console.log('Route starts at line:', routeStart + 1);
console.log('Route ends at line:', routeEnd + 1);
console.log('Lines to replace:', routeEnd - routeStart + 1);
