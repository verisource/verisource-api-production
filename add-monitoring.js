const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

const monitoring = `
// Monitoring and alerting
const stats = {
  totalRequests: 0,
  successfulProcessing: 0,
  failedProcessing: 0,
  imageProcessed: 0,
  videoProcessed: 0,
  audioProcessed: 0,
  totalProcessingTime: 0,
  errors: [],
  startTime: Date.now()
};

// Log stats every hour
setInterval(() => {
  const uptime = (Date.now() - stats.startTime) / 1000 / 60 / 60; // hours
  const avgProcessingTime = stats.totalProcessingTime / (stats.successfulProcessing || 1);
  
  console.log('=== HOURLY STATS ===');
  console.log(\`Uptime: \${uptime.toFixed(2)} hours\`);
  console.log(\`Total requests: \${stats.totalRequests}\`);
  console.log(\`Successful: \${stats.successfulProcessing}\`);
  console.log(\`Failed: \${stats.failedProcessing}\`);
  console.log(\`Images: \${stats.imageProcessed}, Videos: \${stats.videoProcessed}, Audio: \${stats.audioProcessed}\`);
  console.log(\`Avg processing time: \${avgProcessingTime.toFixed(0)}ms\`);
  console.log(\`Memory: \${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB\`);
  console.log(\`Recent errors: \${stats.errors.slice(-5).join(', ')}\`);
  console.log('==================');
  
  // Alert on high error rate
  const errorRate = stats.failedProcessing / (stats.totalRequests || 1);
  if (errorRate > 0.1) { // >10% error rate
    console.error(\`⚠️ HIGH ERROR RATE: \${(errorRate * 100).toFixed(1)}%\`);
  }
  
  // Alert on high memory usage
  const memoryMB = process.memoryUsage().heapUsed / 1024 / 1024;
  if (memoryMB > 400) { // >400MB
    console.error(\`⚠️ HIGH MEMORY USAGE: \${memoryMB.toFixed(0)}MB\`);
  }
}, 60 * 60 * 1000); // Every hour

// Stats endpoint
app.get("/stats", (req, res) => {
  const uptime = (Date.now() - stats.startTime) / 1000;
  const avgProcessingTime = stats.totalProcessingTime / (stats.successfulProcessing || 1);
  
  res.json({
    uptime_seconds: uptime.toFixed(0),
    total_requests: stats.totalRequests,
    successful: stats.successfulProcessing,
    failed: stats.failedProcessing,
    by_type: {
      image: stats.imageProcessed,
      video: stats.videoProcessed,
      audio: stats.audioProcessed
    },
    avg_processing_time_ms: avgProcessingTime.toFixed(0),
    memory_usage_mb: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
    error_rate: ((stats.failedProcessing / (stats.totalRequests || 1)) * 100).toFixed(2) + '%',
    recent_errors: stats.errors.slice(-10)
  });
});
`;

// Insert monitoring after resource management
content = content.replace(
  'app.get("/"',
  monitoring + '\n\napp.get("/"'
);

// Track stats in verify endpoint
content = content.replace(
  '  async (req, res) => {\n    const startTime = Date.now();',
  `  async (req, res) => {
    const startTime = Date.now();
    stats.totalRequests++;`
);

// Track success
content = content.replace(
  '      res.json(result);',
  `      stats.successfulProcessing++;
      stats.totalProcessingTime += (Date.now() - startTime);
      if (result.kind === 'image') stats.imageProcessed++;
      if (result.kind === 'video') stats.videoProcessed++;
      if (result.kind === 'audio') stats.audioProcessed++;
      
      res.json(result);`
);

// Track failures
content = content.replace(
  '    } catch (e) { \n      console.error("Processing error:", e);',
  `    } catch (e) { 
      stats.failedProcessing++;
      stats.errors.push(\`\${new Date().toISOString()}: \${e.message}\`);
      if (stats.errors.length > 100) stats.errors.shift(); // Keep last 100
      console.error("Processing error:", e);`
);

fs.writeFileSync('index.js', content);
console.log('✅ Monitoring added');
