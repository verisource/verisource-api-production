const { analyzeImage } = require('./google-vision-search');
const fs = require('fs');
const path = require('path');

async function test() {
  try {
    // Find a test image
    const testDirs = ['.', './test-images', './uploads', '/workspaces/verisource-beta'];
    let testImage = null;
    
    for (const dir of testDirs) {
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter(f => 
          f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.jpeg')
        );
        if (files.length > 0) {
          testImage = path.join(dir, files[0]);
          break;
        }
      }
    }
    
    if (!testImage) {
      console.log('No test image found');
      return;
    }
    
    console.log('Testing Google Vision with:', testImage);
    console.log('---');
    
    const result = await analyzeImage(testImage);
    console.log(JSON.stringify(result, null, 2));
    
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
  }
}

test();
