/**
 * Adversarial Testing Suite for VeriSource AI Detection
 * Tests robustness against common and advanced evasion techniques
 */

const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const { detectAIGeneration } = require('./services/ensemble-ai-detection');

const TEST_DIR = './test-images/adversarial';

async function addNoise(inputPath, outputPath, noiseLevel) {
  const image = sharp(inputPath);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  
  for (let i = 0; i < data.length; i++) {
    const noise = (Math.random() - 0.5) * 2 * noiseLevel;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
  }
  
  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  })
    .jpeg({ quality: 90 })
    .toFile(outputPath);
}

async function addAdversarialPerturbation(inputPath, outputPath, epsilon = 10) {
  const image = sharp(inputPath);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  
  for (let i = 0; i < data.length; i += 3) {
    const x = (i / 3) % info.width;
    const y = Math.floor((i / 3) / info.width);
    const sign = ((x + y) % 2 === 0) ? 1 : -1;
    
    data[i] = Math.max(0, Math.min(255, data[i] + sign * epsilon));
    data[i+1] = Math.max(0, Math.min(255, data[i+1] - sign * epsilon));
    data[i+2] = Math.max(0, Math.min(255, data[i+2] + sign * epsilon));
  }
  
  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  })
    .jpeg({ quality: 90 })
    .toFile(outputPath);
}

async function testImage(imagePath, testName) {
  try {
    const result = await detectAIGeneration(imagePath);
    const detected = result.likely_ai_generated;
    const confidence = result.ai_confidence;
    const detectorCount = result.detector_count || 1;
    
    const status = detected ? '✅' : '❌';
    console.log(`${status} ${testName}: ${confidence}% (${detectorCount} detectors)`);
    
    return { detected, confidence, detectorCount, details: result.individual_results };
  } catch (error) {
    console.error(`❌ ${testName}: ERROR - ${error.message}`);
    return { detected: false, confidence: 0, detectorCount: 0, error: error.message };
  }
}

async function runAdversarialTests() {
  console.log('='.repeat(70));
  console.log('ADVERSARIAL TESTING SUITE - VeriSource AI Detection');
  console.log('='.repeat(70));
  console.log('');

  await fs.mkdir(TEST_DIR, { recursive: true });

  const sourceImage = './test-images/ai-test.jpg';
  
  try {
    await fs.access(sourceImage);
  } catch {
    console.error('❌ Source AI image not found:', sourceImage);
    process.exit(1);
  }

  const results = [];

  // Test 1: Baseline
  console.log('TEST 1: Original AI Image (Baseline)');
  console.log('-'.repeat(70));
  const baseline = await testImage(sourceImage, 'Original AI image');
  results.push({ test: 'Baseline', ...baseline });
  console.log('');

  // Test 2: Re-compression
  console.log('TEST 2: Re-compression Attacks');
  console.log('-'.repeat(70));
  for (const quality of [50, 70, 85, 95]) {
    const outputPath = path.join(TEST_DIR, `recompressed_q${quality}.jpg`);
    await sharp(sourceImage).jpeg({ quality }).toFile(outputPath);
    const result = await testImage(outputPath, `Re-compressed Q${quality}`);
    results.push({ test: `Recompress Q${quality}`, ...result });
  }
  console.log('');

  // Test 3: Resize
  console.log('TEST 3: Resize Attacks');
  console.log('-'.repeat(70));
  const resizes = [
    { width: 256, height: 256, name: 'Downscale 256' },
    { width: 1024, height: 1024, name: 'Upscale 1024' },
    { width: 800, height: 600, name: 'Aspect change 800x600' }
  ];
  for (const resize of resizes) {
    const outputPath = path.join(TEST_DIR, `resized_${resize.width}x${resize.height}.jpg`);
    await sharp(sourceImage).resize(resize.width, resize.height, { fit: 'fill' }).jpeg({ quality: 90 }).toFile(outputPath);
    const result = await testImage(outputPath, resize.name);
    results.push({ test: resize.name, ...result });
  }
  console.log('');

  // Test 4: Noise
  console.log('TEST 4: Noise Injection');
  console.log('-'.repeat(70));
  for (const noiseLevel of [5, 15, 30]) {
    const outputPath = path.join(TEST_DIR, `noise_${noiseLevel}.jpg`);
    await addNoise(sourceImage, outputPath, noiseLevel);
    const result = await testImage(outputPath, `Noise level ${noiseLevel}`);
    results.push({ test: `Noise ${noiseLevel}`, ...result });
  }
  console.log('');

  // Test 5: Crop
  console.log('TEST 5: Crop Attacks');
  console.log('-'.repeat(70));
  const crops = [
    { left: 50, top: 50, width: 400, height: 400, name: 'Center crop 400x400' },
    { left: 0, top: 0, width: 450, height: 450, name: 'Top-left crop' },
    { left: 10, top: 10, width: 490, height: 490, name: 'Slight trim' }
  ];
  for (const crop of crops) {
    const outputPath = path.join(TEST_DIR, `crop_${crop.name.replace(/\s/g, '_')}.jpg`);
    await sharp(sourceImage).extract(crop).jpeg({ quality: 90 }).toFile(outputPath);
    const result = await testImage(outputPath, crop.name);
    results.push({ test: crop.name, ...result });
  }
  console.log('');

  // Test 6: Format Conversion
  console.log('TEST 6: Format Conversion');
  console.log('-'.repeat(70));
  const pngPath = path.join(TEST_DIR, 'converted.png');
  const backToJpgPath = path.join(TEST_DIR, 'png_to_jpg.jpg');
  await sharp(sourceImage).png().toFile(pngPath);
  await sharp(pngPath).jpeg({ quality: 90 }).toFile(backToJpgPath);
  const pngResult = await testImage(pngPath, 'Converted to PNG');
  results.push({ test: 'PNG conversion', ...pngResult });
  const roundTripResult = await testImage(backToJpgPath, 'PNG→JPEG round-trip');
  results.push({ test: 'PNG→JPEG round-trip', ...roundTripResult });
  console.log('');

  // Test 7: Blur/Sharpen
  console.log('TEST 7: Blur/Sharpen Attacks');
  console.log('-'.repeat(70));
  const blurPath = path.join(TEST_DIR, 'blurred.jpg');
  await sharp(sourceImage).blur(2).jpeg({ quality: 90 }).toFile(blurPath);
  const blurResult = await testImage(blurPath, 'Gaussian blur (sigma=2)');
  results.push({ test: 'Blur', ...blurResult });
  const sharpenPath = path.join(TEST_DIR, 'sharpened.jpg');
  await sharp(sourceImage).sharpen({ sigma: 2 }).jpeg({ quality: 90 }).toFile(sharpenPath);
  const sharpenResult = await testImage(sharpenPath, 'Sharpened');
  results.push({ test: 'Sharpen', ...sharpenResult });
  console.log('');

  // Test 8: Metadata Spoofing
  console.log('TEST 8: Metadata Spoofing');
  console.log('-'.repeat(70));
  const spoofedPath = path.join(TEST_DIR, 'spoofed_exif.jpg');
  await sharp(sourceImage)
    .withMetadata({
      exif: {
        IFD0: { Make: 'Canon', Model: 'Canon EOS 5D Mark IV', Software: 'Adobe Photoshop CC 2024' }
      }
    })
    .jpeg({ quality: 90 })
    .toFile(spoofedPath);
  const spoofResult = await testImage(spoofedPath, 'Fake Canon EXIF injection');
  results.push({ test: 'EXIF Spoofing', ...spoofResult });
  console.log('');

  // Test 9: Double Compression
  console.log('TEST 9: Double JPEG Compression');
  console.log('-'.repeat(70));
  const double1 = path.join(TEST_DIR, 'double_compress_1.jpg');
  const double2 = path.join(TEST_DIR, 'double_compress_2.jpg');
  await sharp(sourceImage).jpeg({ quality: 75 }).toFile(double1);
  await sharp(double1).jpeg({ quality: 90 }).toFile(double2);
  const doubleResult = await testImage(double2, 'Double JPEG compression (75→90)');
  results.push({ test: 'Double Compression', ...doubleResult });
  console.log('');

  // Test 10: Color Space
  console.log('TEST 10: Color Space Attacks');
  console.log('-'.repeat(70));
  const grayscalePath = path.join(TEST_DIR, 'grayscale.jpg');
  await sharp(sourceImage).grayscale().jpeg({ quality: 90 }).toFile(grayscalePath);
  const grayResult = await testImage(grayscalePath, 'Grayscale conversion');
  results.push({ test: 'Grayscale', ...grayResult });
  
  const saturatedPath = path.join(TEST_DIR, 'saturated.jpg');
  await sharp(sourceImage).modulate({ saturation: 1.5 }).jpeg({ quality: 90 }).toFile(saturatedPath);
  const satResult = await testImage(saturatedPath, 'Increased saturation (+50%)');
  results.push({ test: 'Over-saturated', ...satResult });
  
  const desaturatedPath = path.join(TEST_DIR, 'desaturated.jpg');
  await sharp(sourceImage).modulate({ saturation: 0.5 }).jpeg({ quality: 90 }).toFile(desaturatedPath);
  const desatResult = await testImage(desaturatedPath, 'Decreased saturation (-50%)');
  results.push({ test: 'Desaturated', ...desatResult });
  console.log('');

  // Test 11: Brightness/Gamma
  console.log('TEST 11: Gamma/Brightness Attacks');
  console.log('-'.repeat(70));
  const brightPath = path.join(TEST_DIR, 'brightened.jpg');
  await sharp(sourceImage).modulate({ brightness: 1.3 }).jpeg({ quality: 90 }).toFile(brightPath);
  const brightResult = await testImage(brightPath, 'Brightened (+30%)');
  results.push({ test: 'Brightened', ...brightResult });
  
  const darkPath = path.join(TEST_DIR, 'darkened.jpg');
  await sharp(sourceImage).modulate({ brightness: 0.7 }).jpeg({ quality: 90 }).toFile(darkPath);
  const darkResult = await testImage(darkPath, 'Darkened (-30%)');
  results.push({ test: 'Darkened', ...darkResult });
  
  const gammaPath = path.join(TEST_DIR, 'gamma_corrected.jpg');
  await sharp(sourceImage).gamma(2.2).jpeg({ quality: 90 }).toFile(gammaPath);
  const gammaResult = await testImage(gammaPath, 'Gamma correction (2.2)');
  results.push({ test: 'Gamma Corrected', ...gammaResult });
  console.log('');

  // Test 12: Rotation
  console.log('TEST 12: Rotation Attacks');
  console.log('-'.repeat(70));
  const rotate90Path = path.join(TEST_DIR, 'rotated_90.jpg');
  await sharp(sourceImage).rotate(90).jpeg({ quality: 90 }).toFile(rotate90Path);
  const rot90Result = await testImage(rotate90Path, 'Rotated 90°');
  results.push({ test: 'Rotate 90°', ...rot90Result });
  
  const rotate1Path = path.join(TEST_DIR, 'rotated_1deg.jpg');
  await sharp(sourceImage).rotate(1, { background: { r: 255, g: 255, b: 255 } }).jpeg({ quality: 90 }).toFile(rotate1Path);
  const rot1Result = await testImage(rotate1Path, 'Rotated 1° (subtle)');
  results.push({ test: 'Rotate 1°', ...rot1Result });
  
  const flipPath = path.join(TEST_DIR, 'flipped.jpg');
  await sharp(sourceImage).flip().jpeg({ quality: 90 }).toFile(flipPath);
  const flipResult = await testImage(flipPath, 'Vertical flip');
  results.push({ test: 'Flipped', ...flipResult });
  console.log('');

  // Test 13: Adversarial Perturbations
  console.log('TEST 13: Adversarial Pixel Perturbations');
  console.log('-'.repeat(70));
  const perturbPath = path.join(TEST_DIR, 'perturbed.jpg');
  await addAdversarialPerturbation(sourceImage, perturbPath);
  const perturbResult = await testImage(perturbPath, 'Adversarial perturbation (ε=10)');
  results.push({ test: 'Pixel Perturbation', ...perturbResult });
  console.log('');

  // Test 14: Edge Enhancement
  console.log('TEST 14: Edge Manipulation');
  console.log('-'.repeat(70));
  const edgePath = path.join(TEST_DIR, 'edge_enhanced.jpg');
  await sharp(sourceImage)
    .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 9, -1, -1, -1, -1] })
    .jpeg({ quality: 90 })
    .toFile(edgePath);
  const edgeResult = await testImage(edgePath, 'Edge enhancement kernel');
  results.push({ test: 'Edge Enhanced', ...edgeResult });
  console.log('');

  // Test 15: Combined Attacks
  console.log('TEST 15: Combined Attack Chains');
  console.log('-'.repeat(70));
  
  const chain1Temp = path.join(TEST_DIR, 'chain1_temp.jpg');
  const chain1Path = path.join(TEST_DIR, 'chain_resize_noise_compress.jpg');
  await sharp(sourceImage).resize(800, 800).jpeg({ quality: 95 }).toFile(chain1Temp);
  await addNoise(chain1Temp, chain1Path, 20);
  const chain1Result = await testImage(chain1Path, 'Chain: Resize→Noise→Compress');
  results.push({ test: 'Chain Attack 1', ...chain1Result });
  
  const chain2Path = path.join(TEST_DIR, 'chain_crop_blur_sat.jpg');
  await sharp(sourceImage)
    .extract({ left: 25, top: 25, width: 460, height: 460 })
    .blur(1.5)
    .modulate({ saturation: 1.2 })
    .jpeg({ quality: 80 })
    .toFile(chain2Path);
  const chain2Result = await testImage(chain2Path, 'Chain: Crop→Blur→Saturate→Compress');
  results.push({ test: 'Chain Attack 2', ...chain2Result });
  
  const chain3Temp1 = path.join(TEST_DIR, 'chain3_png.png');
  const chain3Temp2 = path.join(TEST_DIR, 'chain3_webp.webp');
  const chain3Path = path.join(TEST_DIR, 'chain_format_manip.jpg');
  await sharp(sourceImage).png().toFile(chain3Temp1);
  await sharp(chain3Temp1).modulate({ brightness: 1.1 }).webp({ quality: 85 }).toFile(chain3Temp2);
  await sharp(chain3Temp2).jpeg({ quality: 88 }).toFile(chain3Path);
  const chain3Result = await testImage(chain3Path, 'Chain: JPEG→PNG→WebP→JPEG + edits');
  results.push({ test: 'Chain Attack 3', ...chain3Result });
  console.log('');

  // Summary
  console.log('='.repeat(70));
  console.log('ADVERSARIAL TEST SUMMARY');
  console.log('='.repeat(70));
  
  let passed = 0;
  let failed = 0;
  
  results.forEach(r => {
    const status = r.detected ? '✅ PASS' : '❌ FAIL';
    const confidenceStr = r.confidence.toString().padStart(3);
    console.log(`${status} | ${r.test.padEnd(25)} | Confidence: ${confidenceStr}% | Detectors: ${r.detectorCount}`);
    if (r.detected) passed++;
    else failed++;
  });
  
  console.log('');
  console.log(`Total: ${results.length} tests | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Robustness Score: ${((passed / results.length) * 100).toFixed(1)}%`);
  console.log('');
  
  const failures = results.filter(r => !r.detected);
  if (failures.length > 0) {
    console.log('⚠️  VULNERABILITIES DETECTED:');
    failures.forEach(f => {
      console.log(`   - ${f.test}: Only ${f.confidence}% confidence`);
    });
  } else {
    console.log('🛡️  EXCELLENT! No vulnerabilities detected in tested scenarios.');
  }
  
  // Show weakest results (lowest confidence while still passing)
  const weakest = results.filter(r => r.detected).sort((a, b) => a.confidence - b.confidence).slice(0, 5);
  console.log('');
  console.log('📊 WEAKEST DETECTIONS (potential attack vectors):');
  weakest.forEach(w => {
    console.log(`   - ${w.test}: ${w.confidence}%`);
  });
  
  console.log('');
}

runAdversarialTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});