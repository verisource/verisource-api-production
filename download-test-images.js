/**
 * Download test images for JPEG artifact analysis testing
 * Downloads both AI-generated and real photos
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Test images to download
const testImages = [
  {
    name: 'ai-generated-1.jpg',
    url: 'https://images.unsplash.com/photo-1706885093487-7eda37b48a60', // AI-generated style image
    description: 'AI-generated image (Midjourney style)'
  },
  {
    name: 'real-photo-1.jpg',
    url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4', // Real mountain photo
    description: 'Real photo (landscape)'
  },
  {
    name: 'real-photo-2.jpg',
    url: 'https://images.unsplash.com/photo-1682687220742-aba13b6e50ba', // Real portrait
    description: 'Real photo (portrait)'
  },
  {
    name: 'ai-generated-2.jpg',
    url: 'https://images.unsplash.com/photo-1707343843437-caacff5cfa74', // AI style
    description: 'AI-generated image (abstract)'
  }
];

// Create test-images directory if it doesn't exist
const testDir = path.join(__dirname, 'test-images');
if (!fs.existsSync(testDir)) {
  fs.mkdirSync(testDir);
  console.log('✅ Created test-images directory');
}

/**
 * Download a single image
 */
function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    console.log(`📥 Downloading: ${path.basename(filepath)}...`);
    
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Handle redirects
        downloadImage(response.headers.location, filepath)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(filepath);
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`   ✅ Saved: ${path.basename(filepath)}`);
        resolve();
      });
      
      fileStream.on('error', (err) => {
        fs.unlink(filepath, () => {}); // Delete partial file
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Download all test images
 */
async function downloadAllImages() {
  console.log('='.repeat(60));
  console.log('DOWNLOADING TEST IMAGES');
  console.log('='.repeat(60));
  console.log('');
  
  let successCount = 0;
  let failCount = 0;
  
  for (const image of testImages) {
    try {
      const filepath = path.join(testDir, image.name);
      
      // Skip if already exists
      if (fs.existsSync(filepath)) {
        console.log(`⏭️  Skipping (already exists): ${image.name}`);
        successCount++;
        continue;
      }
      
      await downloadImage(image.url, filepath);
      successCount++;
      
      // Add small delay between downloads
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`   ❌ Failed to download ${image.name}:`, error.message);
      failCount++;
    }
  }
  
  console.log('');
  console.log('='.repeat(60));
  console.log(`✅ Download complete: ${successCount} succeeded, ${failCount} failed`);
  console.log('='.repeat(60));
  console.log('');
  
  // Print summary
  console.log('TEST IMAGES:');
  console.log('-'.repeat(60));
  testImages.forEach((img, idx) => {
    const filepath = path.join(testDir, img.name);
    const exists = fs.existsSync(filepath);
    const status = exists ? '✅' : '❌';
    console.log(`${status} ${img.name}`);
    console.log(`   ${img.description}`);
    console.log(`   Path: ${filepath}`);
    console.log('');
  });
  
  console.log('');
  console.log('Next steps:');
  console.log('1. Run tests with: node test-jpeg-ensemble.js test-images/ai-generated-1.jpg');
  console.log('2. Compare results across all test images');
  console.log('');
}

// Run downloader
downloadAllImages().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});