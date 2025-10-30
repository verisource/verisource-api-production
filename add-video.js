const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

// Add after const fs line
content = content.replace(
  'const fs = require("fs");',
  `const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function runVideoWorker(inputPath) {
  const run = spawnSync("node", ["worker/video-worker.js", inputPath], {
    encoding: "utf8", maxBuffer: 50 * 1024 * 1024
  });
  if (run.status !== 0) throw new Error(run.stderr || "video-worker failed");
  return JSON.parse(run.stdout);
}
`
);

// Update handler
content = content.replace(
  'res.json({ ',
  `const absPath = path.resolve(req.file.path);
    const isVideo = /^video\\//i.test(req.file.mimetype);
    
    let result = { `
);

content = content.replace(
  'path: req.file.path',
  `path: req.file.path,
      ...(isVideo ? { canonical: runVideoWorker(absPath) } : {})`
);

fs.writeFileSync('index.js', content);
