/**
 * JPEG Forensics Test Suite
 * Tests the enhanced AI detection and forensics system
 * 
 * Run: node test-jpeg-forensics.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Import the modules (adjust paths as needed)
const JPEGForensics = require('./services/jpeg-forensics');
const EnhancedAIDetector = require('./services/enhanced-ai-detector');

class ForensicsTestSuite {
  
  constructor() {
    this.testDir = './test-images';
    this.results = [];
    this.passed = 0;
    this.failed = 0;
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🧪 JPEG Forensics Test Suite');
    console.log('============================\n');
    
    // Ensure test directory exists
    if (!fs.existsSync(this.testDir)) {
      fs.mkdirSync(this.testDir, { recursive: true });
    }

    // Test 1: Check ImageMagick availability
    await this.testImageMagickAvailability();
    
    // Test 2: Test with synthetic image
    await this.testSyntheticImage();
    
    // Test 3: Test module imports
    await this.testModuleImports();
    
    // Test 4: Test ELA on generated test image
    await this.testELAAnalysis();
    
    // Test 5: Test compression analysis
    await this.testCompressionAnalysis();
    
    // Test 6: Test noise analysis
    await this.testNoiseAnalysis();
    
    // Test 7: Test ensemble scoring
    await this.testEnsembleScoring();
    
    // Test 8: Test API endpoint (if running)
    await this.testAPIEndpoint();
    
    // Summary
    this.printSummary();
    
    return {
      passed: this.passed,
      failed: this.failed,
      results: this.results
    };
  }

  /**
   * Test ImageMagick availability
   */
  async testImageMagickAvailability() {
    console.log('📋 Test 1: ImageMagick Availability');
    
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      exec('convert -version', { timeout: 5000 }, (error, stdout) => {
        if (error) {
          this.recordResult('ImageMagick Check', false, 'ImageMagick not installed - JPEG forensics will be limited');
        } else {
          const versionMatch = stdout.match(/Version: ImageMagick ([\d.-]+)/);
          const version = versionMatch ? versionMatch[1] : 'unknown';
          this.recordResult('ImageMagick Check', true, `ImageMagick ${version} available`);
        }
        resolve();
      });
    });
  }

  /**
   * Create and test with synthetic image
   */
  async testSyntheticImage() {
    console.log('\n📋 Test 2: Synthetic Image Generation');
    
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const testImage = path.join(this.testDir, 'test-synthetic.jpg');
      
      // Create a simple test JPEG
      const cmd = `convert -size 256x256 xc:white \
        -fill blue -draw "circle 128,128 128,64" \
        -fill red -draw "rectangle 50,50 100,100" \
        -quality 85 "${testImage}" 2>/dev/null`;
      
      exec(cmd, { timeout: 10000 }, (error) => {
        if (error) {
          this.recordResult('Create Test Image', false, 'Could not create test image (ImageMagick required)');
          resolve();
          return;
        }
        
        if (fs.existsSync(testImage)) {
          const stats = fs.statSync(testImage);
          this.recordResult('Create Test Image', true, `Created ${stats.size} byte test image`);
        } else {
          this.recordResult('Create Test Image', false, 'Test image not created');
        }
        resolve();
      });
    });
  }

  /**
   * Test module imports
   */
  async testModuleImports() {
    console.log('\n📋 Test 3: Module Imports');
    
    try {
      // Test JPEGForensics
      if (typeof JPEGForensics.analyze === 'function') {
        this.recordResult('JPEGForensics Import', true, 'JPEGForensics.analyze() available');
      } else {
        this.recordResult('JPEGForensics Import', false, 'JPEGForensics.analyze() not found');
      }
      
      // Test EnhancedAIDetector
      if (typeof EnhancedAIDetector.detect === 'function') {
        this.recordResult('EnhancedAIDetector Import', true, 'EnhancedAIDetector.detect() available');
      } else {
        this.recordResult('EnhancedAIDetector Import', false, 'EnhancedAIDetector.detect() not found');
      }
      
      // Test quick check methods
      if (typeof JPEGForensics.quickCheck === 'function') {
        this.recordResult('Quick Check Methods', true, 'quickCheck() methods available');
      } else {
        this.recordResult('Quick Check Methods', false, 'quickCheck() methods not found');
      }
    } catch (e) {
      this.recordResult('Module Imports', false, `Import error: ${e.message}`);
    }
  }

  /**
   * Test ELA analysis
   */
  async testELAAnalysis() {
    console.log('\n📋 Test 4: Error Level Analysis');
    
    const testImage = path.join(this.testDir, 'test-synthetic.jpg');
    
    if (!fs.existsSync(testImage)) {
      this.recordResult('ELA Analysis', false, 'Test image not available');
      return;
    }
    
    try {
      const result = await JPEGForensics.performELA(testImage);
      
      if (result.performed) {
        this.recordResult('ELA Analysis', true, 
          `ELA completed - Inconsistency score: ${result.inconsistency_score}, ` +
          `Suspicious regions: ${result.suspicious_regions}`);
      } else {
        this.recordResult('ELA Analysis', false, 
          `ELA not performed: ${result.indicators.join(', ')}`);
      }
      
      console.log('   Indicators:', result.indicators);
    } catch (e) {
      this.recordResult('ELA Analysis', false, `Error: ${e.message}`);
    }
  }

  /**
   * Test compression analysis
   */
  async testCompressionAnalysis() {
    console.log('\n📋 Test 5: Compression Analysis');
    
    const testImage = path.join(this.testDir, 'test-synthetic.jpg');
    
    if (!fs.existsSync(testImage)) {
      this.recordResult('Compression Analysis', false, 'Test image not available');
      return;
    }
    
    try {
      const result = await JPEGForensics.analyzeCompression(testImage);
      
      if (result.quality_estimate > 0) {
        this.recordResult('Compression Analysis', true, 
          `Quality: ${result.quality_estimate}%, Double compressed: ${result.double_compressed}`);
      } else {
        this.recordResult('Compression Analysis', false, 'Could not determine quality');
      }
      
      console.log('   Indicators:', result.indicators);
    } catch (e) {
      this.recordResult('Compression Analysis', false, `Error: ${e.message}`);
    }
  }

  /**
   * Test noise analysis
   */
  async testNoiseAnalysis() {
    console.log('\n📋 Test 6: Noise Consistency Analysis');
    
    const testImage = path.join(this.testDir, 'test-synthetic.jpg');
    
    if (!fs.existsSync(testImage)) {
      this.recordResult('Noise Analysis', false, 'Test image not available');
      return;
    }
    
    try {
      const result = await JPEGForensics.analyzeNoiseConsistency(testImage);
      
      if (result.noise_level !== 'unknown') {
        this.recordResult('Noise Analysis', true, 
          `Noise level: ${result.noise_level}, Variance: ${result.variance.toFixed(4)}`);
      } else {
        this.recordResult('Noise Analysis', false, 'Could not analyze noise');
      }
      
      console.log('   Indicators:', result.indicators);
    } catch (e) {
      this.recordResult('Noise Analysis', false, `Error: ${e.message}`);
    }
  }

  /**
   * Test ensemble scoring
   */
  async testEnsembleScoring() {
    console.log('\n📋 Test 7: Ensemble AI Detection');
    
    const testImage = path.join(this.testDir, 'test-synthetic.jpg');
    
    if (!fs.existsSync(testImage)) {
      this.recordResult('Ensemble Detection', false, 'Test image not available');
      return;
    }
    
    try {
      console.log('   Running full ensemble detection...');
      const result = await EnhancedAIDetector.detect(testImage);
      
      if (result.overall_verdict !== 'UNKNOWN') {
        this.recordResult('Ensemble Detection', true, 
          `Verdict: ${result.overall_verdict}, AI: ${result.ai_confidence}%, ` +
          `Manipulation: ${result.manipulation_confidence}%`);
        
        console.log('   Overall Confidence:', result.overall_confidence + '%');
        console.log('   Analysis Time:', result.analysis_time_ms + 'ms');
        console.log('   Warnings:', result.warnings.length > 0 ? result.warnings : 'None');
        console.log('   Recommendations:', result.recommendations);
      } else {
        this.recordResult('Ensemble Detection', false, 'Could not determine verdict');
      }
    } catch (e) {
      this.recordResult('Ensemble Detection', false, `Error: ${e.message}`);
    }
  }

  /**
   * Test API endpoint
   */
  async testAPIEndpoint() {
    console.log('\n📋 Test 8: API Endpoint Test');
    
    // Check if API is running locally
    const testImage = path.join(this.testDir, 'test-synthetic.jpg');
    
    if (!fs.existsSync(testImage)) {
      this.recordResult('API Endpoint', false, 'Test image not available');
      return;
    }
    
    return new Promise((resolve) => {
      // Try local first, then production
      const localUrl = 'http://localhost:3000/health';
      
      http.get(localUrl, { timeout: 3000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const health = JSON.parse(data);
            this.recordResult('API Endpoint', true, 
              `API running - JPEG forensics: ${health.features?.jpeg_forensics || 'checking...'}`);
          } catch (e) {
            this.recordResult('API Endpoint', true, 'API responding');
          }
          resolve();
        });
      }).on('error', () => {
        this.recordResult('API Endpoint', false, 'API not running locally (start with: node index.js)');
        resolve();
      });
    });
  }

  /**
   * Record a test result
   */
  recordResult(testName, passed, message) {
    const status = passed ? '✅' : '❌';
    console.log(`   ${status} ${testName}: ${message}`);
    
    this.results.push({
      test: testName,
      passed: passed,
      message: message,
      timestamp: new Date().toISOString()
    });
    
    if (passed) {
      this.passed++;
    } else {
      this.failed++;
    }
  }

  /**
   * Print test summary
   */
  printSummary() {
    const total = this.passed + this.failed;
    const percentage = total > 0 ? Math.round((this.passed / total) * 100) : 0;
    
    console.log('\n============================');
    console.log('📊 TEST SUMMARY');
    console.log('============================');
    console.log(`Total Tests: ${total}`);
    console.log(`Passed: ${this.passed} ✅`);
    console.log(`Failed: ${this.failed} ❌`);
    console.log(`Success Rate: ${percentage}%`);
    
    if (this.failed > 0) {
      console.log('\n⚠️  FAILED TESTS:');
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`   - ${r.test}: ${r.message}`);
      });
    }
    
    console.log('\n📝 RECOMMENDATIONS:');
    if (this.failed === 0) {
      console.log('   ✅ All tests passed! Ready for production.');
    } else {
      if (this.results.find(r => r.test === 'ImageMagick Check' && !r.passed)) {
        console.log('   ⚠️  Install ImageMagick: sudo apt-get install imagemagick');
      }
      if (this.results.find(r => r.test === 'API Endpoint' && !r.passed)) {
        console.log('   ⚠️  Start API server: node index.js');
      }
    }
  }
}

// Run tests if called directly
if (require.main === module) {
  const suite = new ForensicsTestSuite();
  suite.runAllTests()
    .then(results => {
      console.log('\n✅ Test suite completed');
      process.exit(results.failed > 0 ? 1 : 0);
    })
    .catch(err => {
      console.error('❌ Test suite error:', err);
      process.exit(1);
    });
}

module.exports = ForensicsTestSuite;