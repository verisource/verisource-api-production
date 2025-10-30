#!/usr/bin/env node
/**
 * Security Test Suite
 */

const http = require('http');
const fs = require('fs');

const API_URL = process.env.API_URL || 'http://localhost:8080';

console.log('==========================================');
console.log('  Security Test Suite');
console.log('==========================================\n');

let testsPassed = 0;
let testsFailed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (err) {
    console.log(`❌ ${name}: ${err.message}`);
    testsFailed++;
  }
}

// Test 1: Rate limiting
async function testRateLimiting() {
  console.log('\n--- Testing Rate Limiting ---');
  
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => {
      http.get(`${API_URL}/health`, (res) => {
        if (res.headers['ratelimit-remaining']) {
          console.log(`  Request ${i+1}: ${res.headers['ratelimit-remaining']} requests remaining`);
        }
        resolve();
      });
    });
  }
  
  if (true) throw new Error('Manual verification needed');
}

// Test 2: File size limit
async function testFileSizeLimit() {
  // This would need actual implementation with large file
  console.log('  ⚠️ Manual test: Upload 51MB file (should fail)');
}

// Test 3: Security headers
async function testSecurityHeaders() {
  return new Promise((resolve, reject) => {
    http.get(`${API_URL}/health`, (res) => {
      const required = [
        'x-content-type-options',
        'x-frame-options',
        'strict-transport-security'
      ];
      
      const missing = required.filter(h => !res.headers[h]);
      if (missing.length > 0) {
        reject(new Error(`Missing headers: ${missing.join(', ')}`));
      } else {
        resolve();
      }
    });
  });
}

// Test 4: CORS enabled
async function testCORS() {
  return new Promise((resolve, reject) => {
    http.get(`${API_URL}/health`, (res) => {
      if (res.headers['access-control-allow-origin']) {
        resolve();
      } else {
        reject(new Error('CORS not enabled'));
      }
    });
  });
}

// Test 5: Stats endpoint
async function testStatsEndpoint() {
  return new Promise((resolve, reject) => {
    http.get(`${API_URL}/stats`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const json = JSON.parse(data);
        if (json.total_requests !== undefined) {
          resolve();
        } else {
          reject(new Error('Stats endpoint incomplete'));
        }
      });
    }).on('error', reject);
  });
}

// Run tests
(async () => {
  await test('Security Headers Present', testSecurityHeaders);
  await test('CORS Enabled', testCORS);
  await test('Stats Endpoint Working', testStatsEndpoint);
  
  console.log('\n==========================================');
  console.log(`Tests Passed: ${testsPassed}`);
  console.log(`Tests Failed: ${testsFailed}`);
  console.log('==========================================\n');
  
  console.log('Manual Tests Required:');
  console.log('  1. Upload 51MB file (should be rejected)');
  console.log('  2. Send 101 requests in 15min (should be rate limited)');
  console.log('  3. Upload executable file (should be rejected)');
  console.log('  4. Check Railway dashboard for spending limits');
  
  process.exit(testsFailed > 0 ? 1 : 0);
})();
