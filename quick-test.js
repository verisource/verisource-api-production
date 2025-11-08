#!/usr/bin/env node
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { URL } = require('url');

const VERISOURCE_API = process.env.VERISOURCE_API || 'https://api.verisource.io';
const OUTPUT_DIR = path.join(__dirname, 'quick-test-images');

const TEST_IMAGES = [
  { name: 'AI Face 1', url: 'https://thispersondoesnotexist.com/', type: 'ai-generated' },
  { name: 'Authentic Cat', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/400px-Cat03.jpg', type: 'authentic' },
  { name: 'Authentic Flower', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/JPEG_example_flower.jpg/640px-JPEG_example_flower.jpg', type: 'authentic' }
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
  console.log('🚀 VeriSource AI Detection Test\n========================\nAPI: ' + VERISOURCE_API + '\n');
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  let passed = 0, failed = 0;
  for (let i = 0; i < TEST_IMAGES.length; i++) {
    const test = TEST_IMAGES[i];
    const filepath = path.join(OUTPUT_DIR, `test_${i + 1}.jpg`);
    console.log(`\n[${i + 1}/${TEST_IMAGES.length}] ${test.name}\nType: ${test.type}\nURL: ${test.url}`);
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
      console.log(`  📊 Results:\n     AI Generated: ${isAi ? '✅ YES' : '❌ NO'}\n     AI Confidence: ${confidence}%\n     Expected: ${test.type}`);
      if (aiDetection.indicators && aiDetection.indicators.length > 0) {
        console.log(`     Indicators: ${aiDetection.indicators.slice(0, 3).join(', ')}${aiDetection.indicators.length > 3 ? '...' : ''}`);
      }
      const correct = (test.type === 'ai-generated' && isAi) || (test.type === 'authentic' && !isAi);
      if (correct) { console.log('     ✅ CORRECT DETECTION'); passed++; }
      else { console.log(`     ❌ INCORRECT (Expected ${test.type})`); failed++; }
    } catch (error) { console.log(`❌ Error: ${error.message}`); failed++; }
  }
  console.log('\n' + '='.repeat(50) + '\n📊 RESULTS\n' + '='.repeat(50));
  console.log(`✅ Passed: ${passed}/${TEST_IMAGES.length}\n❌ Failed: ${failed}/${TEST_IMAGES.length}\n📁 Images: ${OUTPUT_DIR}\n` + '='.repeat(50));
  return failed === 0;
}

main().then(success => process.exit(success ? 0 : 1)).catch(error => { console.error('Fatal error:', error); process.exit(1); });
