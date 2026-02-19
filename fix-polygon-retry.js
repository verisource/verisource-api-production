const fs = require('fs');
let code = fs.readFileSync('services/polygon-timestamp.js', 'utf8');

const old = "      const receipt = await tx.wait(1);";
const fixed = `      let receipt;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          receipt = await tx.wait(1);
          break;
        } catch (waitErr) {
          if (attempt < 2 && waitErr.code === 'SERVER_ERROR') {
            console.log(\`⏳ Polygon RPC rate limited, retrying in \${(attempt + 1) * 12}s...\`);
            await new Promise(r => setTimeout(r, (attempt + 1) * 12000));
          } else {
            throw waitErr;
          }
        }
      }`;

if (code.includes(old)) {
  code = code.replace(old, fixed);
  fs.writeFileSync('services/polygon-timestamp.js', code);
  console.log('✅ Added retry logic to tx.wait()');
} else {
  console.log('❌ Pattern not found');
}
