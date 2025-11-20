/**
 * Live Photo Validation Service
 * Validates iPhone Live Photos by checking video-image pairing
 * Strong authenticity signal - AI cannot generate temporal consistency
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const sharp = require('sharp');

/**
 * Detect and validate Live Photo pairing
 * @param {string} imagePath - Path to the image file
 * @param {Object} exifData - EXIF metadata
 * @returns {Object} Validation result
 */
async function validateLivePhoto(imagePath, exifData) {
  const result = {
    is_live_photo: false,
    video_found: false,
    pairing_valid: false,
    confidence: 0,
    indicators: [],
    temporal_consistency: null,
    video_path: null
  };

  try {
    // Check if image has Live Photo indicators in EXIF
    const hasLivePhotoTag = detectLivePhotoTags(exifData);
    
    if (hasLivePhotoTag.detected) {
      result.is_live_photo = true;
      result.indicators.push(...hasLivePhotoTag.indicators);
      
      // Look for paired MOV file
      const videoPath = await findPairedVideo(imagePath);
      
      if (videoPath) {
        result.video_found = true;
        result.video_path = videoPath;
        result.indicators.push('Paired video file found');
        
        // Validate pairing
        const validation = await validatePairing(imagePath, videoPath, exifData);
        result.pairing_valid = validation.valid;
        result.temporal_consistency = validation.consistency;
        result.confidence = validation.confidence;
        result.indicators.push(...validation.indicators);
      } else {
        result.indicators.push('Live Photo tag present but video not found (converted/cropped?)');
        result.confidence = 30; // Partial confidence
      }
    } else {
      // Check if a paired video exists anyway (some apps strip EXIF)
      const videoPath = await findPairedVideo(imagePath);
      if (videoPath) {
        result.video_found = true;
        result.video_path = videoPath;
        result.indicators.push('Paired video found without Live Photo tag');
        
        const validation = await validatePairing(imagePath, videoPath, exifData);
        result.pairing_valid = validation.valid;
        result.confidence = validation.confidence * 0.7; // Reduced confidence without tag
      }
    }

  } catch (err) {
    console.error('Live Photo validation error:', err.message);
    result.indicators.push('Could not validate Live Photo');
  }

  return result;
}

/**
 * Detect Live Photo EXIF tags
 */
function detectLivePhotoTags(exifData) {
  const result = {
    detected: false,
    indicators: []
  };

  if (!exifData) return result;

  // Apple Live Photo identifier
  if (exifData.ContentIdentifier || exifData.MediaGroupUUID) {
    result.detected = true;
    result.indicators.push('Apple Live Photo UUID found');
  }

  // Live Photo version tag
  if (exifData.RunTimeValue || exifData.RunTimeScale) {
    result.detected = true;
    result.indicators.push('Live Photo timing metadata found');
  }

  // Apple Maker Notes may contain Live Photo flag
  if (exifData.AppleMakerNote) {
    result.detected = true;
    result.indicators.push('Apple Maker Note contains Live Photo data');
  }

  return result;
}

/**
 * Find paired MOV video file
 */
async function findPairedVideo(imagePath) {
  try {
    const dir = path.dirname(imagePath);
    const baseName = path.basename(imagePath, path.extname(imagePath));
    
    // Try common naming patterns
    const patterns = [
      `${baseName}.MOV`,
      `${baseName}.mov`,
      `${baseName}_HEVC.MOV`,
      `IMG_${baseName.replace('IMG_', '')}.MOV`
    ];

    for (const pattern of patterns) {
      const videoPath = path.join(dir, pattern);
      try {
        await fs.access(videoPath);
        return videoPath; // Found it!
      } catch (err) {
        continue;
      }
    }

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Validate that image and video are properly paired
 */
async function validatePairing(imagePath, videoPath, exifData) {
  const result = {
    valid: false,
    confidence: 0,
    indicators: [],
    consistency: {
      temporal: false,
      visual: false,
      metadata: false
    }
  };

  try {
    // 1. Extract middle frame from video
    const frameExtracted = await extractKeyFrame(videoPath);
    
    if (frameExtracted) {
      // 2. Compare image similarity
      const similarity = await compareImageSimilarity(imagePath, frameExtracted.path);
      
      if (similarity >= 85) {
        result.consistency.visual = true;
        result.indicators.push(`High visual similarity (${similarity}%)`);
        result.confidence += 40;
      } else if (similarity >= 70) {
        result.indicators.push(`Moderate visual similarity (${similarity}%)`);
        result.confidence += 20;
      }

      // Cleanup temp frame
      await fs.unlink(frameExtracted.path).catch(() => {});
    }

    // 3. Check video duration (Live Photos are ~3 seconds)
    const videoDuration = await getVideoDuration(videoPath);
    if (videoDuration >= 2.5 && videoDuration <= 3.5) {
      result.consistency.temporal = true;
      result.indicators.push('Video duration matches Live Photo (3s)');
      result.confidence += 30;
    }

    // 4. Validate metadata consistency
    const videoMeta = await extractVideoMetadata(videoPath);
    if (videoMeta.creationTime && exifData.DateTimeOriginal) {
      const timeDiff = Math.abs(new Date(videoMeta.creationTime) - new Date(exifData.DateTimeOriginal));
      if (timeDiff < 60000) { // Within 1 minute
        result.consistency.metadata = true;
        result.indicators.push('Timestamps match within 1 minute');
        result.confidence += 30;
      }
    }

    // Overall validation
    result.valid = result.confidence >= 60;

  } catch (err) {
    console.error('Pairing validation error:', err.message);
    result.indicators.push('Could not complete pairing validation');
  }

  return result;
}

/**
 * Extract a key frame from video
 */
async function extractKeyFrame(videoPath) {
  try {
    const tempFramePath = `/tmp/live_photo_frame_${Date.now()}.jpg`;
    
    // Use ffmpeg to extract middle frame
    execSync(
      `ffmpeg -i "${videoPath}" -vf "select=eq(n\\,0)" -vframes 1 "${tempFramePath}" -y 2>/dev/null`,
      { timeout: 10000 }
    );

    return { path: tempFramePath };
  } catch (err) {
    return null;
  }
}

/**
 * Compare visual similarity between image and video frame
 */
async function compareImageSimilarity(imagePath1, imagePath2) {
  try {
    // Resize both to same dimensions for comparison
    const [img1, img2] = await Promise.all([
      sharp(imagePath1).resize(256, 256, { fit: 'fill' }).greyscale().raw().toBuffer(),
      sharp(imagePath2).resize(256, 256, { fit: 'fill' }).greyscale().raw().toBuffer()
    ]);

    // Calculate pixel-wise difference
    let totalDiff = 0;
    for (let i = 0; i < img1.length; i++) {
      totalDiff += Math.abs(img1[i] - img2[i]);
    }

    const avgDiff = totalDiff / img1.length;
    const similarity = Math.max(0, 100 - (avgDiff / 255 * 100));

    return Math.round(similarity);
  } catch (err) {
    return 0;
  }
}

/**
 * Get video duration in seconds
 */
async function getVideoDuration(videoPath) {
  try {
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { encoding: 'utf8', timeout: 5000 }
    );
    return parseFloat(output.trim());
  } catch (err) {
    return 0;
  }
}

/**
 * Extract video metadata
 */
async function extractVideoMetadata(videoPath) {
  try {
    const output = execSync(
      `ffprobe -v quiet -print_format json -show_format "${videoPath}"`,
      { encoding: 'utf8', timeout: 5000 }
    );
    const data = JSON.parse(output);
    return {
      creationTime: data.format?.tags?.creation_time,
      duration: data.format?.duration
    };
  } catch (err) {
    return {};
  }
}

/**
 * Adjust AI confidence based on Live Photo validation
 */
function adjustForLivePhoto(aiDetection, livePhotoValidation) {
  if (!livePhotoValidation.is_live_photo || !aiDetection) {
    return aiDetection;
  }

  const originalConfidence = aiDetection.ai_confidence || 0;
  let adjustment = 0;

  // Valid Live Photo = strong authenticity signal
  if (livePhotoValidation.pairing_valid && livePhotoValidation.confidence >= 60) {
    adjustment = -Math.round(50 * (livePhotoValidation.confidence / 100));
  } else if (livePhotoValidation.video_found) {
    // Video found but not fully validated
    adjustment = -15;
  }

  const adjustedConfidence = Math.max(0, originalConfidence + adjustment);

  return {
    ...aiDetection,
    ai_confidence: adjustedConfidence,
    original_ai_confidence: aiDetection.original_ai_confidence || originalConfidence,
    live_photo_validated: livePhotoValidation.pairing_valid,
    live_photo_confidence: livePhotoValidation.confidence,
    live_photo_indicators: livePhotoValidation.indicators,
    adjusted_for_live_photo: true,
    warnings: [
      ...(aiDetection.warnings || []),
      `Live Photo ${livePhotoValidation.pairing_valid ? 'validated' : 'detected'} (${livePhotoValidation.confidence}% confidence). AI confidence adjusted from ${originalConfidence}% to ${adjustedConfidence}%.`
    ]
  };
}

module.exports = {
  validateLivePhoto,
  adjustForLivePhoto
};
