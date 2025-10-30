#!/usr/bin/env node
/**
 * Test script for VeriSource API
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const API_URL = process.env.API_URL || 'http://localhost:8080';

console.log('==========================================');
console.log('  VeriSource API Test Suite');
console.log('==========================================');
console.log(`Testing: ${API_URL}\n`);

// Test 1: Health Check
async function testHealth() {
  return new Promise((resolve, reject) => {
    http.get(`${API_URL}/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log('✅ Health Check: PASSED');
          resolve(true);
        } else {
          console.log('❌ Health Check: FAILED');
          resolve(false);
        }
      });
    }).on('error', reject);
  });
}

// Test 2: Root endpoint
async function testRoot() {
  return new Promise((resolve, reject) => {
    http.get(`${API_URL}/`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const json = JSON.parse(data);
          if (json.service && json.supports) {
            console.log('✅ Root Endpoint: PASSED');
            console.log(`   Supports: ${json.supports.join(', ')}`);
            resolve(true);
          } else {
            console.log('❌ Root Endpoint: Invalid response');
            resolve(false);
          }
        } else {
          console.log('❌ Root Endpoint: FAILED');
          resolve(false);
        }
      });
    }).on('error', reject);
  });
}

// Run tests
async function runTests() {
  try {
    await testHealth();
    await testRoot();
    
    console.log('\n==========================================');
    console.log('  Test Suite Complete');
    console.log('==========================================\n');
    
    console.log('For full testing, upload test files:');
    console.log('  curl -X POST ' + API_URL + '/verify -F "file=@image.jpg"');
    
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    console.log('\nMake sure the API is running:');
    console.log('  npm start');
    process.exit(1);
  }
}

runTests();
