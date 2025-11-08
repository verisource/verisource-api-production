#!/usr/bin/env node
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { URL } = require('url');

const VERISOURCE_API = process.env.VERISOURCE_API || 'https://api.verisource.io';
const OUTPUT_DIR = path.join(__dirname, 'test-all-images');

// Load URLs from test-urls files
const authenticUrls = fs.readFileSync('test-urls/authentic.txt', 'utf8')
  .split('\n').filter(line => line.trim() && !line.startsWith('#'));
const aiUrls = fs.readFileSync('test-urls/ai-generated.txt', 'utf8')
  .split('\n').filter(line => line.trim() && !line.startsWith('#'));

const TEST_IMAGES = [
  ...authenticUrls.map((url, i) => ({ name: `Authentic ${i+1}`, url, type: 'authentic' })),
  ...aiUrls.map((url, i) => ({ name: `AI Generated ${i+1}`, url, type: 'ai-generated' }))
];

async function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const file = fs.createWriteStream(filepath);
    const request = client.get(url, { headers: { 'User-Agent': 'VeriSource-Test/1.0', 'Accept': 'image/*' }}, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        file.close();
        fs.unlinkSync(filepath);
        return downloadFile(response.headers.location, filepath).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
        return reject(new Error(`HTTP ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          const stats = fs.statSync(filepath);
          if (stats.size === 0) { fs.unlinkSync(filepath); reject(new Error('Empty file')); }
          else { resolve(filepath); }
        });
      });
    });
    request.on('error', (err) => { file.close(); if (fs.existsSync(filepath)) fs.unlinkSync(filepath); reject(err); });
  });
}

async function verifyImage(filepath) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', fs.createReadStream(filepath));
    const urlObj = new URL(`${VERISOURCE_API}/verify`);
    const client = urlObj.protocol === 'https:' ? https : http;
    const request = client.request({
      method: 'POST', hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname, headers: form.getHeaders(),
    }, (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => { try { resolve(JSON.parse(data)); } catch (err) { reject(new Error(`Parse error: ${err.message}`)); }});
    });
    request.on('error', reject);
    form.pipe(request);
  });
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function main() {
  console.log('🚀 VeriSource Comprehensive AI Detection Test');
  console.log('='.repeat(50));
  console.log(`API: ${VERISOURCE_API}`);
  console.log(`Total Tests: ${TEST_IMAGES.length}\n`);
  
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  
  let passed = 0, failed = 0;
  let aiDetected = 0, aiMissed = 0;
  let authenticCorrect = 0, falsePositives = 0;
  
  for (let i = 0; i < TEST_IMAGES.length; i++) {
    const test = TEST_IMAGES[i];
    const filepath = path.join(OUTPUT_DIR, `test_${i + 1}.jpg`);
    
    console.log(`\n[${i + 1}/${TEST_IMAGES.length}] ${test.name}`);
    console.log(`Type: ${test.type}`);
    
    try {
      process.stdout.write('  ⬇️  Downloading... ');
      await downloadFile(test.url, filepath);
      console.log('✅');
      
      await sleep(2000);
      
      process.stdout.write('  🔍 Verifying... ');
      const result = await verifyImage(filepath);
      console.log('✅');
      
      const aiDetection = result.ai_detection || {};
      const isAi = aiDetection.likely_ai_generated || false;
      const confidence = aiDetection.ai_confidence || 0;
      
      console.log(`  📊 AI: ${isAi ? 'YES' : 'NO'} (${confidence}%)`);
      
      const correct = (test.type === 'ai-generated' && isAi) || (test.type === 'authentic' && !isAi);
      
      if (correct) {
        console.log(`     ✅ CORRECT`);
        passed++;
        if (test.type === 'ai-generated') aiDetected++;
        if (test.type === 'authentic') authenticCorrect++;
      } else {
        console.log(`     ❌ INCORRECT`);
        failed++;
        if (test.type === 'ai-generated') aiMissed++;
        if (test.type === 'authentic') falsePositives++;
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
      failed++;
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 FINAL RESULTS');
  console.log('='.repeat(50));
  console.log(`Overall: ${passed}/${TEST_IMAGES.length} (${Math.round(passed/TEST_IMAGES.length*100)}%)`);
  console.log(`\nAI Detection:`);
  console.log(`  ✅ Detected: ${aiDetected}`);
  console.log(`  ❌ Missed: ${aiMissed}`);
  console.log(`\nAuthentic Images:`);
  console.log(`  ✅ Correct: ${authenticCorrect}`);
  console.log(`  ❌ False Positives: ${falsePositives}`);
  console.log('='.repeat(50));
  
  return failed === 0;
}

main().then(success => process.exit(success ? 0 : 1)).catch(error => { console.error('Fatal error:', error); process.exit(1); });
