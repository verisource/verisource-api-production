/**
 * VIDEO AUDIO FINGERPRINTING INTEGRATION
 * 
 * Add this to your index.js to enable Chromaprint fingerprinting for video audio tracks.
 * 
 * INSTALLATION:
 * 1. Copy video-audio-fingerprint.js to your services/ folder
 * 2. Add the import at the top of index.js
 * 3. Add the analysis code in the video processing section
 * 4. Update the response object
 * 5. Update the database save
 */

// ============================================================================
// STEP 1: Add import at top of index.js (around line 30)
// ============================================================================

const VideoAudioFingerprint = require('./services/video-audio-fingerprint');

// ============================================================================
// STEP 2: Add this code AFTER the existing audioAnalysis in video processing
// Location: Around line 1080-1100 in /verify-remote and similar in /verify
// Find: "const audioAnalysis = await analyzeVideoAudio(filePath);"
// Add AFTER that block:
// ============================================================================

// --- VIDEO AUDIO FINGERPRINTING ---
let videoAudioFingerprint = null;
let videoAudioMatches = null;

if (kind === 'video' && audioAnalysis && audioAnalysis.hasAudio) {
  try {
    console.log('🎵 Running video audio fingerprint analysis...');
    
    const audioFpResult = await VideoAudioFingerprint.analyzeVideoAudio(
      filePath,  // or tempFilePath in /verify-remote
      db,
      { 
        requestId: requestId,
        excludeFingerprint: fingerprint,
        threshold: 85
      }
    );
    
    if (audioFpResult.success && audioFpResult.fingerprint) {
      videoAudioFingerprint = {
        fingerprint: audioFpResult.fingerprint,
        duration: audioFpResult.duration,
        extracted_from: audioFpResult.extracted_from,
        fingerprint_length: audioFpResult.fingerprint_length
      };
      
      videoAudioMatches = audioFpResult.matches;
      
      if (videoAudioMatches && videoAudioMatches.found) {
        console.log(`   ⚠️ Audio match found: ${videoAudioMatches.count} previous submissions`);
        console.log(`   Match type: ${videoAudioMatches.match_type}`);
      } else {
        console.log('   ✅ Audio is unique (not found in database)');
      }
    } else if (!audioFpResult.has_audio) {
      console.log('   ℹ️ Video has no audio track to fingerprint');
    } else {
      console.log('   ⚠️ Audio fingerprint extraction failed:', audioFpResult.error);
    }
    
  } catch (audioFpErr) {
    console.error('⚠️ Video audio fingerprint error:', audioFpErr.message);
  }
}

// ============================================================================
// STEP 3: Update fraud flags based on audio matches
// Add this after the audio fingerprint analysis:
// ============================================================================

// Add audio match to fraud indicators if found
if (videoAudioMatches && videoAudioMatches.found && crossReference) {
  crossReference.fraud_indicators = crossReference.fraud_indicators || { flags: [], risk_level: 'low' };
  
  if (videoAudioMatches.match_type === 'exact') {
    crossReference.fraud_indicators.flags.push(
      `AUDIO_REUSE: Exact audio track match found in ${videoAudioMatches.count} previous submission(s)`
    );
    crossReference.fraud_indicators.risk_level = 'high';
  } else if (videoAudioMatches.match_type === 'similar' && videoAudioMatches.matches[0]?.similarity >= 95) {
    crossReference.fraud_indicators.flags.push(
      `AUDIO_SIMILAR: Very similar audio track found (${videoAudioMatches.matches[0].similarity}% match)`
    );
    if (crossReference.fraud_indicators.risk_level === 'low') {
      crossReference.fraud_indicators.risk_level = 'medium';
    }
  }
}

// ============================================================================
// STEP 4: Update the saveVerification call to include audio fingerprint
// Location: Around line 1400 in /verify-remote, similar in /verify
// Add audio_fingerprint to the object:
// ============================================================================

await saveVerification({
  fingerprint: fingerprint,
  algorithm: 'sha256',
  filename: tempFileName,  // or req.file.originalname in /verify
  file_size: stats.size,   // or req.file.size in /verify
  file_type: mockFile.mimetype,
  media_kind: kind,
  ip_address: req.ip || req.connection?.remoteAddress,
  polygon_block_number: polygonVerification?.block_number || null,
  polygon_tx_hash: polygonVerification?.transaction_hash || null,
  polygon_timestamp: polygonVerification?.timestamp || null,
  bitcoin_proof_status: blockchainVerification?.status || null,
  bitcoin_submitted_at: blockchainVerification?.submitted_at || null,
  phash: phash || null,
  phash_regions: phashRegions || null,
  google_vision_labels: googleVisionResult?.results?.labels || [],
  // ADD THIS LINE:
  audio_fingerprint: videoAudioFingerprint?.fingerprint || chromaprint || null
});

// ============================================================================
// STEP 5: Update the response object to include audio fingerprint data
// Location: In the response JSON object, inside the video_analysis section
// ============================================================================

// Option A: Add to existing video_analysis object
...(kind === 'video' && videoAnalysis && {
  video_analysis: {
    ...videoAnalysis,
    // ADD THESE:
    audio_fingerprint: videoAudioFingerprint,
    audio_matches: videoAudioMatches
  }
}),

// Option B: Or add as separate top-level fields
...(videoAudioFingerprint && { 
  video_audio_fingerprint: videoAudioFingerprint 
}),
...(videoAudioMatches && { 
  video_audio_matches: videoAudioMatches 
}),

// ============================================================================
// EXAMPLE OUTPUT
// ============================================================================
/*
{
  "video_analysis": {
    "ai_confidence": 15,
    "verdict": "LIKELY_AUTHENTIC",
    "frames_analyzed": 30,
    
    "audio_fingerprint": {
      "fingerprint": "AQADtNKYSJJyCZEu...",
      "duration": 45.2,
      "extracted_from": "video_audio_track",
      "fingerprint_length": 1248
    },
    
    "audio_matches": {
      "found": true,
      "match_type": "exact",
      "count": 1,
      "matches": [
        {
          "sha256": "abc123def456...",
          "filename": "dashcam_claim_2024.mp4",
          "media_type": "video",
          "first_seen": "2024-06-15T10:30:00Z",
          "similarity": 100,
          "interpretation": "Identical"
        }
      ],
      "warning": "Exact audio match found - this audio track has been submitted before"
    }
  },
  
  "cross_reference": {
    "fraud_indicators": {
      "risk_level": "high",
      "flags": [
        "AUDIO_REUSE: Exact audio track match found in 1 previous submission(s)"
      ]
    }
  }
}
*/

// ============================================================================
// OPTIONAL: Add AcoustID music identification
// If you want to identify known music in video audio tracks
// ============================================================================

// Add after fingerprint generation:
if (videoAudioFingerprint && acoustid.isConfigured()) {
  try {
    console.log('🎵 Checking for music identification...');
    const audioTempPath = path.join(os.tmpdir(), `music-check-${requestId}.wav`);
    
    // Extract audio again for AcoustID (or reuse if still available)
    await new Promise((resolve, reject) => {
      const ffmpeg = require('fluent-ffmpeg');
      ffmpeg(filePath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioFrequency(44100)
        .audioChannels(1)
        .output(audioTempPath)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    
    const musicResult = await acoustid.identifyAudio(audioTempPath);
    
    if (musicResult.identified) {
      videoAudioFingerprint.music_identified = true;
      videoAudioFingerprint.music = {
        title: musicResult.recording.title,
        artist: musicResult.recording.artist,
        album: musicResult.recording.album || null
      };
      console.log(`   🎵 Music identified: ${musicResult.recording.title} - ${musicResult.recording.artist}`);
      
      // Flag if stock music detected
      if (videoAudioFingerprint.music.title) {
        crossReference.fraud_indicators = crossReference.fraud_indicators || { flags: [], risk_level: 'low' };
        crossReference.fraud_indicators.flags.push(
          `KNOWN_MUSIC: Audio contains "${videoAudioFingerprint.music.title}" by ${videoAudioFingerprint.music.artist}`
        );
      }
    }
    
    try { fs.unlinkSync(audioTempPath); } catch (e) {}
    
  } catch (musicErr) {
    console.log('   ℹ️ Music identification skipped:', musicErr.message);
  }
}