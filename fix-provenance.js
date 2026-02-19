const fs = require('fs');
let code = fs.readFileSync('services/provenance-service.js', 'utf8');
const bad = "            `, fps);\n\n              verifResult.rows.forEach(r => r._tineye_match = true);\n              mergeCandidates(verifResult.rows);\n            }";
const good = "            `, fps);\n            if (verifResult.rows?.length) {\n              verifResult.rows.forEach(r => r._tineye_match = true);\n              mergeCandidates(verifResult.rows);\n            }";
if (code.includes(bad)) {
  code = code.replace(bad, good);
  fs.writeFileSync('services/provenance-service.js', code);
  console.log('✅ Fixed');
} else {
  console.log('❌ Pattern not found');
}
