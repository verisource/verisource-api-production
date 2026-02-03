const https = require('https');
const COOKIE = process.env.LEXICA_SESSION_COOKIE;

function fetchWithCookie(url, cookie) {
  return new Promise(function(resolve, reject) {
    const urlObj = new URL(url);
    const req = https.request({ 
      hostname: urlObj.hostname, 
      path: urlObj.pathname + urlObj.search, 
      method: 'GET', 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Cookie': '__Secure-next-auth.session-token=' + cookie
      }, 
      timeout: 30000 
    }, function(res) {
      let data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() { resolve({ status: res.statusCode, data: data }); });
    });
    req.on('error', reject);
    req.end();
  });
}

async function debug() {
  console.log('Cookie present:', !!COOKIE);
  const url = 'https://lexica.art/?q=portrait';
  console.log('Fetching:', url);
  
  try {
    const response = await fetchWithCookie(url, COOKIE);
    console.log('Status:', response.status);
    console.log('Response length:', response.data.length);
    console.log('Has __NEXT_DATA__:', response.data.includes('__NEXT_DATA__'));
    console.log('Has image.lexica.art:', response.data.includes('image.lexica.art'));
    
    const match = response.data.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (match) {
      console.log('__NEXT_DATA__ length:', match[1].length);
      const data = JSON.parse(match[1]);
      console.log('props.pageProps keys:', Object.keys(data.props?.pageProps || {}));
      if (data.props?.pageProps?.images) {
        console.log('Images count:', data.props.pageProps.images.length);
      }
    } else {
      console.log('No __NEXT_DATA__ found');
      console.log('Response preview:', response.data.substring(0, 1500));
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

debug();
