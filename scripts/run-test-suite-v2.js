const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const https = require('https');
const http = require('http');
const execPromise = util.promisify(exec);

const { analyzeVideo } = require('../video-analyzer');
const { detectAIGeneration } = require('../ai-image-detector');

class TestSuiteRunner {
  constructor() {
    this.projectRoot = '/workspaces/verisource-api-production';
    this.testDir = path.join(this.projectRoot, 'test-videos');
    this.resultsDir = path.join(this.projectRoot, 'test-results');
    
    this.categories = {
      authentic: {
        urlFile: path.join(this.projectRoot, 'test-urls/authentic.txt'),
        expectedVerdict: 'AUTHENTIC',
        expectedIsReal: true
      },
      deepfakes: {
        urlFile: path.join(this.projectRoot, 'test-urls/deepfakes.txt'),
        expectedVerdict: 'LIKELY_MANIPULATED',
        expectedIsReal: false
      },
      'ai-generated': {
        urlFile: path.join(this.projectRoot, 'test-urls/ai-generated.txt'),
        expectedVerdict: 'LIKELY_MANIPULATED',
        expectedIsReal: false
      },
      manipulated: {
        urlFile: path.join(this.projectRoot, 'test-urls/manipulated.txt'),
        expectedVerdict: 'QUESTIONABLE',
        expectedIsReal: false
      }
    };
    
    this.results = {
      startTime: new Date().toISOString(),
      total: 0,
      correct: 0,
      incorrect: 0,
      errors: 0,
      byCategory: {},
      confusionMatrix: {
        truePositive: 0,
        trueNegative: 0,
        falsePositive: 0,
        falseNegative: 0
      },
      detailedResults: []
    };
  }
  
  async setup() {
    await fs.mkdir(this.testDir, { recursive: true });
    await fs.mkdir(this.resultsDir, { recursive: true });
    
    for (const category of Object.keys(this.categories)) {
      await fs.mkdir(path.join(this.testDir, category), { recursive: true });
    }
    
    console.log('✓ Test directories created');
  }
  
  async runFullTestSuite() {
    console.log('🧪 VeriSource Accuracy Test Suite v2\n');
    console.log('='.repeat(60));
    
    await this.setup();
    
    for (const [category, config] of Object.entries(this.categories)) {
      console.log(`\n📁 Category: ${category.toUpperCase()}`);
      console.log('-'.repeat(60));
      
      await this.testCategory(category, config);
    }
    
    this.calculateMetrics();
    await this.generateReport();
    await this.saveRawResults();
    this.displaySummary();
    
    return this.results;
  }
  
  async testCategory(category, config) {
    const urls = await this.readUrls(config.urlFile);
    console.log(`Found ${urls.length} URLs\n`);
    
    const categoryResults = {
      total: urls.length,
      correct: 0,
      incorrect: 0,
      errors: 0,
      details: []
    };
    
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const videoName = `video_${i + 1}.mp4`;
      
      try {
        console.log(`[${i + 1}/${urls.length}] Testing: ${url.substring(0, 60)}...`);
        
        const videoPath = await this.downloadVideo(url, category, videoName);
        
        if (!videoPath) {
          throw new Error('Download failed');
        }
        
        console.log('   Verifying...');
        const result = await this.verifyContent(videoPath);
        
        const evaluation = this.evaluateResult(result, config);
        
        if (evaluation.correct) {
          categoryResults.correct++;
          this.results.correct++;
          console.log(`   ✓ CORRECT: ${result.verdict} (${result.confidence}%)`);
        } else {
          categoryResults.incorrect++;
          this.results.incorrect++;
          console.log(`   ✗ INCORRECT: ${result.verdict} (expected: ${config.expectedVerdict})`);
        }
        
        this.results.total++;
        this.updateConfusionMatrix(result, config);
        
        const detailedResult = {
          category,
          url,
          videoName,
          expected: config.expectedVerdict,
          actual: result.verdict,
          confidence: result.confidence,
          correct: evaluation.correct,
          ...result
        };
        
        categoryResults.details.push(detailedResult);
        this.results.detailedResults.push(detailedResult);
        
      } catch (error) {
        console.error(`   ✗ ERROR: ${error.message}`);
        categoryResults.errors++;
        this.results.errors++;
        
        this.results.detailedResults.push({
          category,
          url,
          videoName,
          error: error.message
        });
      }
      
      console.log('');
      await this.sleep(2000);
    }
    
    this.results.byCategory[category] = categoryResults;
  }
  
  async verifyContent(filePath) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const isVideo = ['.mp4', '.mov', '.avi', '.webm'].includes(ext);
      
      if (isVideo) {
        const videoResult = await analyzeVideo(filePath);
        
        return {
          verdict: this.determineVerdict(videoResult),
          confidence: this.calculateConfidence(videoResult),
          aiDetection: videoResult.ai_detection,
          framesAnalyzed: videoResult.frames_analyzed
        };
      } else {
        const imageResult = await detectAIGeneration(filePath);
        
        return {
          verdict: imageResult.likely_ai_generated ? 'LIKELY_MANIPULATED' : 'AUTHENTIC',
          confidence: imageResult.likely_ai_generated ? imageResult.ai_confidence : (100 - imageResult.ai_confidence),
          aiDetection: imageResult
        };
      }
    } catch (error) {
      console.error('Verification error:', error);
      throw error;
    }
  }
  
  determineVerdict(result) {
    if (result.ai_detection && result.ai_detection.likely_ai_generated) {
      return 'LIKELY_MANIPULATED';
    }
    
    const aiConfidence = result.ai_detection?.ai_confidence || 0;
    
    if (aiConfidence >= 80) return 'LIKELY_MANIPULATED';
    if (aiConfidence >= 50) return 'QUESTIONABLE';
    if (aiConfidence >= 30) return 'LIKELY_AUTHENTIC';
    return 'AUTHENTIC';
  }
  
  calculateConfidence(result) {
    if (result.confidence) return result.confidence;
    if (result.ai_detection) {
      return result.ai_detection.ai_confidence || 0;
    }
    return 50;
  }
  
  async readUrls(urlFile) {
    try {
      const content = await fs.readFile(urlFile, 'utf-8');
      return content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
    } catch (error) {
      console.error(`Error reading ${urlFile}:`, error.message);
      return [];
    }
  }
  
  async downloadVideo(url, category, filename) {
    const outputPath = path.join(this.testDir, category, filename);
    
    try {
      try {
        await fs.access(outputPath);
        console.log('   (Using cached download)');
        return outputPath;
      } catch {}
      
      console.log('   Downloading...');
      
      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        const command = `yt-dlp -f "best[height<=720]" -o "${outputPath}" "${url}"`;
        await execPromise(command, { timeout: 120000 });
      } else {
        await this.directDownload(url, outputPath);
      }
      
      return outputPath;
      
    } catch (error) {
      console.error(`   Download error: ${error.message}`);
      return null;
    }
  }
  
  async directDownload(url, outputPath) {
    return new Promise((resolve, reject) => {
      const file = require('fs').createWriteStream(outputPath);
      const protocol = url.startsWith('https') ? https : http;
      
      protocol.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          file.close();
          require('fs').unlinkSync(outputPath);
          return this.directDownload(response.headers.location, outputPath)
            .then(resolve)
            .catch(reject);
        }
        
        if (response.statusCode !== 200) {
          file.close();
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        
        response.pipe(file);
        
        file.on('finish', () => {
          file.close();
          resolve();
        });
        
        file.on('error', (err) => {
          file.close();
          try { require('fs').unlinkSync(outputPath); } catch {}
          reject(err);
        });
      }).on('error', (err) => {
        file.close();
        try { require('fs').unlinkSync(outputPath); } catch {}
        reject(err);
      });
    });
  }
  
  evaluateResult(result, config) {
    if (result.verdict === config.expectedVerdict) {
      return { correct: true, reason: 'exact_match' };
    }
    
    const resultIsFake = ['QUESTIONABLE', 'LIKELY_MANIPULATED'].includes(result.verdict);
    const expectedIsFake = !config.expectedIsReal;
    
    if (resultIsFake === expectedIsFake) {
      return { correct: true, reason: 'classification_match' };
    }
    
    return { correct: false, reason: 'mismatch' };
  }
  
  updateConfusionMatrix(result, config) {
    const predictedFake = ['QUESTIONABLE', 'LIKELY_MANIPULATED'].includes(result.verdict);
    const actuallyFake = !config.expectedIsReal;
    
    if (predictedFake && actuallyFake) {
      this.results.confusionMatrix.truePositive++;
    } else if (!predictedFake && !actuallyFake) {
      this.results.confusionMatrix.trueNegative++;
    } else if (predictedFake && !actuallyFake) {
      this.results.confusionMatrix.falsePositive++;
    } else {
      this.results.confusionMatrix.falseNegative++;
    }
  }
  
  calculateMetrics() {
    const cm = this.results.confusionMatrix;
    const total = this.results.total - this.results.errors;
    
    if (total === 0) {
      this.results.accuracy = 0;
      this.results.precision = 0;
      this.results.recall = 0;
      this.results.f1Score = 0;
      return;
    }
    
    this.results.accuracy = (this.results.correct / total * 100).toFixed(2);
    
    const precisionDenom = cm.truePositive + cm.falsePositive;
    this.results.precision = precisionDenom > 0 
      ? (cm.truePositive / precisionDenom * 100).toFixed(2)
      : 0;
    
    const recallDenom = cm.truePositive + cm.falseNegative;
    this.results.recall = recallDenom > 0
      ? (cm.truePositive / recallDenom * 100).toFixed(2)
      : 0;
    
    const p = parseFloat(this.results.precision);
    const r = parseFloat(this.results.recall);
    this.results.f1Score = (p + r) > 0
      ? (2 * (p * r) / (p + r)).toFixed(2)
      : 0;
  }
  
  async generateReport() {
    const report = `
# VeriSource Accuracy Test Report

**Generated:** ${new Date().toISOString()}
**Test Started:** ${this.results.startTime}

---

## 📊 Overall Results

| Metric | Value |
|--------|-------|
| **Total Tests** | ${this.results.total} |
| **Correct** | ${this.results.correct} ✓ |
| **Incorrect** | ${this.results.incorrect} ✗ |
| **Errors** | ${this.results.errors} ⚠️ |
| **Accuracy** | **${this.results.accuracy}%** |

---

## 📈 Performance Metrics

| Metric | Value | Description |
|--------|-------|-------------|
| **Precision** | ${this.results.precision}% | Of flagged fakes, how many were actually fake |
| **Recall** | ${this.results.recall}% | Of all fakes, how many did we catch |
| **F1 Score** | ${this.results.f1Score} | Harmonic mean of precision and recall |

---

## 🎯 Confusion Matrix

|  | **Predicted Real** | **Predicted Fake** |
|---|---|---|
| **Actually Real** | ${this.results.confusionMatrix.trueNegative} (TN) | ${this.results.confusionMatrix.falsePositive} (FP) |
| **Actually Fake** | ${this.results.confusionMatrix.falseNegative} (FN) | ${this.results.confusionMatrix.truePositive} (TP) |

---

## 📂 Results by Category

${Object.entries(this.results.byCategory).map(([cat, data]) => `
### ${cat.toUpperCase()}

| Metric | Value |
|--------|-------|
| Total | ${data.total} |
| Correct | ${data.correct} |
| Incorrect | ${data.incorrect} |
| Errors | ${data.errors} |
| **Accuracy** | **${data.total > 0 ? (data.correct / data.total * 100).toFixed(2) : 0}%** |
`).join('\n')}

---

## 📝 Detailed Results

See \`test-results-detailed.json\` for full results.
`;
    
    await fs.writeFile(
      path.join(this.resultsDir, 'test-report.md'),
      report
    );
    
    console.log('\n📄 Report saved: test-results/test-report.md');
  }
  
  async saveRawResults() {
    await fs.writeFile(
      path.join(this.resultsDir, 'test-results-detailed.json'),
      JSON.stringify(this.results, null, 2)
    );
    
    console.log('📄 Detailed results saved: test-results/test-results-detailed.json');
  }
  
  displaySummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`\nTotal Tests: ${this.results.total}`);
    console.log(`Correct: ${this.results.correct} ✓`);
    console.log(`Incorrect: ${this.results.incorrect} ✗`);
    console.log(`Errors: ${this.results.errors} ⚠️`);
    console.log(`\n🎯 Overall Accuracy: ${this.results.accuracy}%`);
    console.log(`📈 Precision: ${this.results.precision}%`);
    console.log(`📈 Recall: ${this.results.recall}%`);
    console.log(`📈 F1 Score: ${this.results.f1Score}`);
    console.log('\n' + '='.repeat(60));
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function main() {
  const runner = new TestSuiteRunner();
  await runner.runFullTestSuite();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = TestSuiteRunner;