const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

const errorRecovery = `
// Graceful shutdown handler
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  console.log(\`Processed \${stats.successfulProcessing} files successfully\`);
  
  // Close server gracefully
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  
  // Force close after 30 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  stats.errors.push(\`CRITICAL: \${err.message}\`);
  // Don't exit - let process manager handle restarts
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  stats.errors.push(\`Promise rejection: \${reason}\`);
});

// Memory leak detection
setInterval(() => {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  
  if (heapUsedMB > 450) {
    console.error(\`⚠️ CRITICAL: Memory usage \${heapUsedMB.toFixed(0)}MB - possible leak!\`);
    
    // Try garbage collection if available
    if (global.gc) {
      console.log('Running garbage collection...');
      global.gc();
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes
`;

// Replace app.listen with server assignment for graceful shutdown
content = content.replace(
  'app.listen(PORT,',
  'const server = app.listen(PORT,'
);

// Insert error recovery after app.listen
content = content.replace(
  '  console.log("✓ Ready to accept requests!");\n});',
  '  console.log("✓ Ready to accept requests!");\n});\n' + errorRecovery
);

fs.writeFileSync('index.js', content);
console.log('✅ Error recovery added');
