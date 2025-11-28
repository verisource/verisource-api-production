// Speed up TensorFlow with Node.js backend
require("@tensorflow/tfjs-node");

/**
 * Deepfake Detection Module
 * Phase 1: Face-focused AI detection
 * Phase 2: Deepfake-specific artifact detection
 */

const faceapi = require('@vladmandic/face-api');
const canvas = require('canvas');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { detectAIGeneration } = require('./ai-image-detector');

// Patch face-api.js for Node.js environment
const { Canvas, Image, ImageData } = canvas;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Load models once at startup
let modelsLoaded = false;

async function loadFaceModels() {
  if (modelsLoaded) return;
  
  console.log('📥 Loading face detection models...');
  
  const modelPath = path.join(__dirname, 'models/face-api');
  
  try {
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelPath);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelPath);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelPath);
    
    modelsLoaded = true;
    console.log('✅ Face detection models loaded');
  } catch (err) {
    console.error('❌ Error loading face models:', err.message);
    throw err;
  }
}

/**
 * Extract faces from a single frame
 */
async function extractFacesFromFrame(framePath) {
  try {
    // Load image using canvas
    const img = await canvas.loadImage(framePath);
    
    // Detect faces with landmarks and descriptors
    const detections = await faceapi
      .detectAllFaces(img)
      .withFaceLandmarks()
      .withFaceDescriptors();
    
    if (detections.length === 0) {
      return [];
    }
    
    // Extract each face region
    const faces = [];
    
    for (let i = 0; i < detections.length; i++) {
      const detection = detections[i];
      const box = detection.detection.box;
      
      // Expand box by 20% to include context
      const padding = 0.2;
      const expandedBox = {
        x: Math.max(0, box.x - box.width * padding),
        y: Math.max(0, box.y - box.height * padding),
        width: box.width * (1 + 2 * padding),
        height: box.height * (1 + 2 * padding)
      };
      
      // Get image dimensions
      const metadata = await sharp(framePath).metadata();
      
      // Ensure box doesn't exceed image bounds
      expandedBox.x = Math.max(0, Math.min(expandedBox.x, metadata.width));
      expandedBox.y = Math.max(0, Math.min(expandedBox.y, metadata.height));
      expandedBox.width = Math.min(expandedBox.width, metadata.width - expandedBox.x);
      expandedBox.height = Math.min(expandedBox.height, metadata.height - expandedBox.y);
      
      // Extract face region
      const faceBuffer = await sharp(framePath)
        .extract({
          left: Math.round(expandedBox.x),
          top: Math.round(expandedBox.y),
          width: Math.round(expandedBox.width),
          height: Math.round(expandedBox.height)
        })
        .toBuffer();
      
      faces.push({
        buffer: faceBuffer,
        box: expandedBox,
        landmarks: detection.landmarks,
        descriptor: detection.descriptor,
        detection: detection.detection
      });
    }
    
    return faces;
    
  } catch (err) {
    console.error(`Error extracting faces from ${path.basename(framePath)}:`, err.message);
    return [];
  }
}

/**
 * Phase 2: Check face boundary blending
 * Deepfakes often have unnatural blending at face edges
 */
async function checkFaceBoundaryBlending(framePath, faceBox) {
  try {
    const metadata = await sharp(framePath).metadata();
    
    // Extract narrow strips around face boundary
    const borderWidth = 5; // 5 pixel border
    
    // Top border
    const topBorder = await sharp(framePath)
      .extract({
        left: Math.round(faceBox.x),
        top: Math.max(0, Math.round(faceBox.y - borderWidth)),
        width: Math.round(faceBox.width),
        height: borderWidth
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    // Calculate blur/sharpness of boundary
    const stats = await sharp(topBorder.data, {
      raw: topBorder.info
    }).stats();
    
    const avgStdDev = stats.channels.reduce((sum, ch) => sum + ch.stdev, 0) / stats.channels.length;
    
    // Low std dev = blurry boundary (suspicious)
    // High std dev = sharp boundary (natural)
    const blurScore = Math.max(0, 100 - avgStdDev);
    
    return {
      suspicious: blurScore > 70, // Very blurry boundary
      blurScore: blurScore,
      indicator: blurScore > 70 ? 'Blurred face boundary detected' : null
    };
    
  } catch (err) {
    return { suspicious: false, blurScore: 0, indicator: null };
  }
}

/**
 * Phase 2: Check temporal face consistency
 * Same person should have similar face descriptors across frames
 */
function checkFaceDescriptorConsistency(descriptors) {
  if (descriptors.length < 3) {
    return { consistent: true, variance: 0 };
  }
  
  // Calculate pairwise distances between face descriptors
  const distances = [];
  
  for (let i = 0; i < descriptors.length - 1; i++) {
    const distance = faceapi.euclideanDistance(
      descriptors[i],
      descriptors[i + 1]
    );
    distances.push(distance);
  }
  
  // Calculate variance in distances
  const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
  const variance = distances.reduce((sum, d) => sum + Math.pow(d - avgDistance, 2), 0) / distances.length;
  
  // High variance = face identity changes (deepfake)
  // Low variance = consistent face (real)
  const suspicious = variance > 0.02 || avgDistance > 0.6;
  
  return {
    consistent: !suspicious,
    variance: variance,
    avgDistance: avgDistance,
    indicator: suspicious ? 'Face identity inconsistent across frames' : null
  };
}

/**
 * Phase 2: Check landmark stability
 * Face landmarks should move smoothly, not jitter
 */
function checkLandmarkStability(landmarkSequence) {
  if (landmarkSequence.length < 3) {
    return { stable: true, jitter: 0 };
  }
  
  // Track key landmarks (eyes, nose, mouth)
  const leftEyePositions = landmarkSequence.map(lm => lm.getLeftEye());
  const rightEyePositions = landmarkSequence.map(lm => lm.getRightEye());
  const nosePositions = landmarkSequence.map(lm => lm.getNose());
  
  // Calculate jitter (frame-to-frame movement variance)
  function calculateJitter(positions) {
    const movements = [];
    for (let i = 0; i < positions.length - 1; i++) {
      // Calculate center of landmark group
      const center1 = positions[i].reduce((sum, pt) => ({
        x: sum.x + pt.x,
        y: sum.y + pt.y
      }), { x: 0, y: 0 });
      center1.x /= positions[i].length;
      center1.y /= positions[i].length;
      
      const center2 = positions[i + 1].reduce((sum, pt) => ({
        x: sum.x + pt.x,
        y: sum.y + pt.y
      }), { x: 0, y: 0 });
      center2.x /= positions[i + 1].length;
      center2.y /= positions[i + 1].length;
      
      // Calculate distance moved
      const dx = center2.x - center1.x;
      const dy = center2.y - center1.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      movements.push(distance);
    }
    
    // Calculate variance in movements
    const avgMovement = movements.reduce((a, b) => a + b, 0) / movements.length;
    const variance = movements.reduce((sum, m) => sum + Math.pow(m - avgMovement, 2), 0) / movements.length;
    
    return Math.sqrt(variance);
  }
  
  const leftEyeJitter = calculateJitter(leftEyePositions);
  const rightEyeJitter = calculateJitter(rightEyePositions);
  const noseJitter = calculateJitter(nosePositions);
  
  const avgJitter = (leftEyeJitter + rightEyeJitter + noseJitter) / 3;
  
  // High jitter = unstable landmarks (deepfake)
  const suspicious = avgJitter > 3;
  
  return {
    stable: !suspicious,
    jitter: avgJitter,
    leftEyeJitter,
    rightEyeJitter,
    noseJitter,
    indicator: suspicious ? `High landmark jitter detected (${avgJitter.toFixed(1)}px)` : null
  };
}

/**
 * Main deepfake analysis function
 * Combines Phase 1 (face-focused AI detection) and Phase 2 (artifact detection)
 */
async function analyzeForDeepfakes(framePaths, tempDir) {
  console.log('🎭 Analyzing for deepfakes...');
  
  // Load models if not already loaded
  await loadFaceModels();
  
  const deepfakeIndicators = [];
  const faceAnalysisResults = [];
  const allDescriptors = [];
  const allLandmarks = [];
  
  let totalFaces = 0;
  let aiFaces = 0;
  
  // Analyze up to 15 frames for deepfakes (more than needed for speed)
  const framesToCheck = framePaths.slice(0, Math.min(15, framePaths.length));
  
  for (let i = 0; i < framesToCheck.length; i++) {
    const framePath = framesToCheck[i];
    
    // Extract faces from frame
    const faces = await extractFacesFromFrame(framePath);
    
    if (faces.length === 0) continue;
    
    for (const face of faces) {
      totalFaces++;
      
      // Save face region temporarily
      const faceImagePath = path.join(tempDir, `deepfake-face-${totalFaces}.jpg`);
      await sharp(face.buffer).toFile(faceImagePath);
      
      // Phase 1: Analyze face region with AI detector
      const aiResult = await detectAIGeneration(faceImagePath);
      
      if (aiResult.likely_ai_generated || aiResult.ai_confidence > 65) {
        aiFaces++;
        deepfakeIndicators.push(`Face ${totalFaces}: AI-generated (${aiResult.ai_confidence}% confidence)`);
      }
      
      // Phase 2: Check face boundary blending
      const blendingCheck = await checkFaceBoundaryBlending(framePath, face.box);
      if (blendingCheck.suspicious) {
        deepfakeIndicators.push(blendingCheck.indicator);
      }
      
      // Store descriptors and landmarks for temporal analysis
      allDescriptors.push(face.descriptor);
      allLandmarks.push(face.landmarks);
      
      faceAnalysisResults.push({
        aiGenerated: aiResult.likely_ai_generated,
        aiConfidence: aiResult.ai_confidence,
        blurryBoundary: blendingCheck.suspicious
      });
      
      // Clean up temp face image
      try {
        fs.unlinkSync(faceImagePath);
      } catch (err) {}
    }
  }
  
  if (totalFaces === 0) {
    return {
      isDeepfake: false,
      confidence: 0,
      reason: 'No faces detected in video',
      facesAnalyzed: 0,
      indicators: []
    };
  }
  
  // Phase 2: Temporal consistency checks
  const descriptorConsistency = checkFaceDescriptorConsistency(allDescriptors);
  if (!descriptorConsistency.consistent) {
    deepfakeIndicators.push(descriptorConsistency.indicator);
  }
  
  const landmarkStability = checkLandmarkStability(allLandmarks);
  if (!landmarkStability.stable) {
    deepfakeIndicators.push(landmarkStability.indicator);
  }
  
  // Calculate deepfake score
  const aiFacePercentage = (aiFaces / totalFaces) * 100;
  let deepfakeScore = aiFacePercentage;
  
  // Boost score based on artifact detection
  if (!descriptorConsistency.consistent) deepfakeScore += 15;
  if (!landmarkStability.stable) deepfakeScore += 10;
  if (faceAnalysisResults.some(r => r.blurryBoundary)) deepfakeScore += 10;
  
  deepfakeScore = Math.min(100, deepfakeScore);
  
  const isDeepfake = deepfakeScore > 50;
  
  console.log(`   Faces analyzed: ${totalFaces}`);
  console.log(`   AI-generated faces: ${aiFaces} (${aiFacePercentage.toFixed(1)}%)`);
  console.log(`   Face identity variance: ${descriptorConsistency.variance.toFixed(4)}`);
  console.log(`   Landmark jitter: ${landmarkStability.jitter.toFixed(2)}px`);
  console.log(`   Deepfake score: ${deepfakeScore.toFixed(1)}%`);
  console.log(`   Verdict: ${isDeepfake ? '⚠️  DEEPFAKE DETECTED' : '✅ No deepfake detected'}`);
  
  return {
    isDeepfake: isDeepfake,
    confidence: Math.round(deepfakeScore),
    facesAnalyzed: totalFaces,
    aiFacePercentage: Math.round(aiFacePercentage),
    descriptorConsistency: {
      consistent: descriptorConsistency.consistent,
      variance: descriptorConsistency.variance,
      avgDistance: descriptorConsistency.avgDistance
    },
    landmarkStability: {
      stable: landmarkStability.stable,
      jitter: landmarkStability.jitter
    },
    indicators: deepfakeIndicators.filter(ind => ind !== null)
  };
}

module.exports = {
  analyzeForDeepfakes,
  loadFaceModels
};
