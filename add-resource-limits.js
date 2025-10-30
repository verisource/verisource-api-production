const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

const resourceManagement = `
// Resource management
const activeProcessing = new Set();
const MAX_CONCURRENT_PROCESSING = 3;
const processingQueue = [];

// Process queue
function processQueue() {
  if (processingQueue.length === 0 || activeProcessing.size >= MAX_CONCURRENT_PROCESSING) {
    return;
  }
  
  const { req, res, next } = processingQueue.shift();
  activeProcessing.add(req.file.path);
  
  // Continue with original handler
  next();
}

// Queue middleware for /verify
const queueMiddleware = (req, res, next) => {
  if (!req.file) return next();
  
  if (activeProcessing.size >= MAX_CONCURRENT_PROCESSING) {
    processingQueue.push({ req, res, next });
    console.log(\`Request queued. Queue size: \${processingQueue.length}\`);
    
    // Timeout after 30 seconds
    setTimeout(() => {
      const index = processingQueue.findIndex(item => item.req === req);
      if (index !== -1) {
        processingQueue.splice(index, 1);
        res.status(503).json({ 
          error: 'Server busy. Please try again.',
          queue_position: index + 1
        });
      }
    }, 30000);
  } else {
    activeProcessing.add(req.file.path);
    next();
  }
};

// Cleanup after processing
function cleanupProcessing(filepath) {
  activeProcessing.delete(filepath);
  processQueue();
}
`;

// Insert after DDoS protection
content = content.replace(
  'app.post("/verify",',
  resourceManagement + '\n\napp.post("/verify",\n  queueMiddleware,'
);

// Add cleanup in finally block
content = content.replace(
  '    } finally {',
  '    } finally {\n      cleanupProcessing(req.file.path);'
);

fs.writeFileSync('index.js', content);
console.log('✅ Resource management added');
