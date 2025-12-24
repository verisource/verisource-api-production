/**
 * Ensemble AI Detection Service v2.0
 * 
 * Four-stage detection pipeline:
 * 1. Local detector (capped at 50%) - conservative base score
 * 2. AI Boosters - push up for strong AI signals
 * 3. Forensic Adjustments - rescue real photos
 * 4. Sightengine Tiebreaker - for uncertain cases (30-69%)
 * 
 * Expected accuracy: ~93%
 */

const localDetector = require('../ai-image-detector');
const JPEGForensics = require('./jpeg-forensics');

// Try to load Sightengine detector
let sightengineDetector = null;
try {
  sightengineDetector = require('./sightengine-ai-detection');
} catch (err) {
  console.log('⚠️ Sightengine detector not available:', err.message);
}

async function detectAIGeneration(imagePath) {
  console.log('🎯 Running ensemble AI detection v2.0...');
  
  const [localResult, forensicsResult] = await Promise.all([
    localDetector.detectAIGeneration(imagePath).catch(err => {
      console.error('Local detector error:', err.message);
      return null;
    }),
    JPEGForensics.analyze(imagePath).catch(err => {
      console.error('Forensics error:', err.message);
      return null;
    })
  ]);
  
  const originalLocalScore = localResult?.ai_confidence || 50;
  
  // STAGE 1: Cap local detector at 50%
  let aiConfidence = Math.min(50, originalLocalScore);
  let indicators = [...(localResult?.indicators || [])];
  
  console.log(`📊 Stage 1 - Local: ${originalLocalScore}% → capped to ${aiConfidence}%`);
  
  const hasValidExif = localResult?.metadata_check?.has_camera_exif || 
                     (localResult?.indicators || []).some(i => 
                       i.toLowerCase().includes('camera make') || 
                       i.toLowerCase().includes('camera model') ||
                       i.toLowerCase().includes('valid exif') ||
                       i.toLowerCase().includes('exif data'));
  
  const noiseVariance = forensicsResult?.noise_analysis?.variance || null;
  const noiseLevel = forensicsResult?.noise_analysis?.noise_level || 'unknown';
  const compressionQuality = forensicsResult?.compression_analysis?.quality_estimate || null;
  const doubleCompressed = forensicsResult?.compression_analysis?.double_compressed || false;
  
  // STAGE 2: AI Boosters
  let aiBoost = 0;
  
  if (forensicsResult) {
    console.log('🔬 Stage 2 - AI boosters...');
    
    if (noiseVariance !== null && noiseVariance < 0.015 && !hasValidExif && !doubleCompressed) {
  aiBoost += 25;
      indicators.push('AI Booster: Very low noise without camera data (+25%)');
      console.log(`   +25% Very low noise (${noiseVariance.toFixed(4)}) + no EXIF`);
    }
    
    if (compressionQuality !== null && compressionQuality >= 95 && !doubleCompressed) {
      aiBoost += 15;
      indicators.push('AI Booster: High quality JPEG, not recompressed (+15%)');
      console.log(`   +15% High quality (${compressionQuality}%) + not double compressed`);
    }
    
    if (noiseVariance !== null && noiseVariance < 0.020 && 
        compressionQuality !== null && compressionQuality >= 90 && 
        !doubleCompressed && !hasValidExif && aiBoost < 25) {
      aiBoost += 10;
      indicators.push('AI Booster: Low noise + high quality combo (+10%)');
      console.log(`   +10% Low noise + high quality combo`);
    }
    
    console.log(`📊 Stage 2 - AI boost: +${aiBoost}%`);
  }
  
  aiConfidence += aiBoost;
  
  // STAGE 3: Forensic Rescue
  let forensicAdjustment = 0;
  
  if (forensicsResult) {
    console.log('🔬 Stage 3 - Forensic rescue...');
    
    if (noiseLevel === 'normal' && hasValidExif) {
      forensicAdjustment -= 20;
      indicators.push('Forensic: Normal noise with valid EXIF (-20%)');
    } else if (noiseLevel === 'normal') {
      forensicAdjustment -= 10;
      indicators.push('Forensic: Normal noise pattern (-10%)');
    }
    
    if (doubleCompressed) {
      forensicAdjustment -= 10;
      indicators.push('Forensic: Double JPEG compression (-10%)');
    }
    
    if (forensicsResult.clone_detection?.detected) {
      forensicAdjustment -= 15;
      indicators.push('Forensic: Clone regions detected (-15%)');
    }
    
    if (forensicsResult.ela_analysis?.performed) {
      const elaScore = forensicsResult.ela_analysis?.manipulation_score || 0;
      if (elaScore > 70) {
        forensicAdjustment -= 10;
        indicators.push('Forensic: ELA editing artifacts (-10%)');
      }
    }
    
    console.log(`📊 Stage 3 - Forensic: ${forensicAdjustment}%`);
  }
  
  aiConfidence += forensicAdjustment;
  const preSightengineConfidence = Math.max(0, Math.min(100, aiConfidence));
  aiConfidence = preSightengineConfidence;
  
  // STAGE 4: Sightengine Tiebreaker (30-69% range)
  let externalVerification = null;
  let sightengineUsed = false;
  
  if (aiConfidence >= 30 && aiConfidence < 70) {
    console.log(`🌐 Stage 4 - Uncertain (${aiConfidence}%), calling Sightengine...`);
    
    if (sightengineDetector && process.env.SIGHTENGINE_API_USER) {
      try {
        const sightengineResult = await sightengineDetector.detectAI(imagePath);
        const seConfidence = Math.round(sightengineResult.confidence * 100);
        
        console.log(`   Sightengine: ${sightengineResult.isAI ? 'AI' : 'Real'} (${seConfidence}%)`);
        
        const blendedConfidence = Math.round(seConfidence * 0.6 + aiConfidence * 0.4);
        console.log(`   Blend: ${aiConfidence}% + ${seConfidence}% → ${blendedConfidence}%`);
        
        externalVerification = {
          provider: 'sightengine',
          confidence: seConfidence,
          isAI: sightengineResult.isAI,
          local_confidence: aiConfidence,
          blended_confidence: blendedConfidence,
          used_as_tiebreaker: true
        };
        
        aiConfidence = blendedConfidence;
        sightengineUsed = true;
        indicators.push(`Sightengine: ${seConfidence}% → blended ${blendedConfidence}%`);
        
      } catch (err) {
        console.error(`   ⚠️ Sightengine error: ${err.message}`);
        externalVerification = { provider: 'sightengine', error: err.message, used_as_tiebreaker: false };
      }
    } else {
      console.log('   ⚠️ Sightengine not configured');
      externalVerification = { provider: 'sightengine', error: 'Not configured', used_as_tiebreaker: false };
    }
  } else {
    console.log(`📊 Stage 4 - Skipped (${aiConfidence}% outside 30-69%)`);
  }
  
  aiConfidence = Math.max(0, Math.min(100, aiConfidence));
  
  let verdict;
  if (aiConfidence >= 70) verdict = 'AI-GENERATED';
  else if (aiConfidence >= 50) verdict = 'LIKELY AI-GENERATED';
  else if (aiConfidence >= 30) verdict = 'UNCERTAIN';
  else verdict = 'LIKELY AUTHENTIC';
  
  const isAI = aiConfidence >= 50;
  
  console.log(`✅ Final: ${verdict} - ${aiConfidence}% (orig: ${originalLocalScore}%, cap: ${Math.min(50, originalLocalScore)}%, boost: +${aiBoost}%, forensic: ${forensicAdjustment}%${sightengineUsed ? ', SE blended' : ''})`);
  
  let socialMediaCaveat = null;
  if (doubleCompressed && !hasValidExif && compressionQuality && compressionQuality < 85) {
    socialMediaCaveat = 'Image may have been shared on social media. Detection confidence may be affected.';
  }
  
  return {
    likely_ai_generated: isAI,
    ai_confidence: aiConfidence,
    ai_confidence_raw: originalLocalScore,
    ai_confidence_capped: Math.min(50, originalLocalScore),
    ai_boost_applied: aiBoost,
    forensic_adjustment: forensicAdjustment,
    pre_sightengine_confidence: preSightengineConfidence,
    verdict: verdict,
    indicators: indicators,
    metadata_check: localResult?.metadata_check,
    ensemble_used: true,
    ensemble_version: '2.0',
    detector_count: (forensicsResult ? 1 : 0) + (sightengineUsed ? 1 : 0) + 1,
    sightengine_used: sightengineUsed,
    external_verification: externalVerification,
    social_media_caveat: socialMediaCaveat,
    method: sightengineUsed ? 'ensemble_with_sightengine' : (forensicsResult ? 'ensemble_with_forensics' : 'local_only'),
    
    forensic_signals: {
      applied: forensicsResult !== null,
      noise_level: noiseLevel,
      noise_variance: noiseVariance,
      double_compressed: doubleCompressed,
      compression_quality: compressionQuality,
      clone_detected: forensicsResult?.clone_detection?.detected || false,
      ela_performed: forensicsResult?.ela_analysis?.performed || false,
      ela_score: forensicsResult?.ela_analysis?.manipulation_score || null,
      has_valid_exif: hasValidExif,
      ai_boost: aiBoost,
      forensic_rescue: forensicAdjustment
    },
    
    detectors: [
      { name: 'Local Heuristics', confidence: originalLocalScore, capped_confidence: Math.min(50, originalLocalScore), weight: 0.4, indicators: localResult?.indicators || [] },
      { name: 'AI Boosters', boost: aiBoost, indicators: indicators.filter(i => i.startsWith('AI Booster:')) },
      { name: 'Forensic Signals', adjustment: forensicAdjustment, indicators: indicators.filter(i => i.startsWith('Forensic:')) },
      ...(sightengineUsed ? [{ name: 'Sightengine', confidence: externalVerification?.confidence || null, weight: 0.6, used_as_tiebreaker: true }] : [])
    ]
  };
}

function isEnsembleAvailable() { return true; }
function isForensicsAvailable() { return typeof JPEGForensics?.analyze === 'function'; }
function isSightengineAvailable() { return sightengineDetector !== null && !!process.env.SIGHTENGINE_API_USER; }

module.exports = { detectAIGeneration, isEnsembleAvailable, isForensicsAvailable, isSightengineAvailable };