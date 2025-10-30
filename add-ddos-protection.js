const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');

const ddosProtection = `
// DDoS Protection
const blockedIPs = new Set();
const ipRequestCount = new Map(); // Track requests per IP
const suspiciousIPs = new Set();

// Clean up old tracking data every hour
setInterval(() => {
  ipRequestCount.clear();
  console.log('IP tracking cleaned');
}, 60 * 60 * 1000);

// IP monitoring middleware
app.use((req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  
  // Block if in blocked list
  if (blockedIPs.has(ip)) {
    console.warn(\`Blocked IP attempted access: \${ip}\`);
    return res.status(403).json({ error: 'Access denied' });
  }
  
  // Track request count per IP
  const count = (ipRequestCount.get(ip) || 0) + 1;
  ipRequestCount.set(ip, count);
  
  // Flag suspicious activity (>500 requests in an hour)
  if (count > 500) {
    suspiciousIPs.add(ip);
    console.warn(\`Suspicious activity from IP: \${ip} (\${count} requests)\`);
  }
  
  // Auto-block after 1000 requests in an hour
  if (count > 1000) {
    blockedIPs.add(ip);
    console.error(\`Auto-blocked IP: \${ip} (\${count} requests)\`);
    return res.status(403).json({ error: 'Too many requests. IP blocked.' });
  }
  
  next();
});
`;

// Insert after helmet/cors setup
content = content.replace(
  'app.use(cors());',
  'app.use(cors());\n' + ddosProtection
);

fs.writeFileSync('index.js', content);
console.log('✅ DDoS protection added');
