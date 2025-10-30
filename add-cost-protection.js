const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

// Add cost tracking middleware
const costProtection = `
// Cost protection
let dailyRequestCount = 0;
let dailyResetTime = Date.now() + 24 * 60 * 60 * 1000;

app.use((req, res, next) => {
  // Reset counter daily
  if (Date.now() > dailyResetTime) {
    dailyRequestCount = 0;
    dailyResetTime = Date.now() + 24 * 60 * 60 * 1000;
    console.log('Daily request counter reset');
  }
  
  // Check daily limit
  const maxDailyRequests = parseInt(process.env.MAX_REQUESTS_PER_DAY) || 10000;
  if (dailyRequestCount >= maxDailyRequests) {
    console.warn(\`Daily limit reached: \${dailyRequestCount}\`);
    return res.status(429).json({ 
      error: 'Daily request limit reached. Try again tomorrow.',
      limit: maxDailyRequests
    });
  }
  
  dailyRequestCount++;
  next();
});
`;

// Insert after rate limiter setup
content = content.replace(
  "app.use('/verify', limiter);",
  "app.use('/verify', limiter);\n" + costProtection
);

fs.writeFileSync('index.js', content);
console.log('✅ Cost protection added');
