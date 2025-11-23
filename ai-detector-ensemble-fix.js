    // ========================================
    // ENSEMBLE: JPEG + LOCAL ONLY (NO HF)
    // ========================================
    
    const detectors = [];
    
    // Add JPEG detector
    if (jpegConfidence !== null) {
      detectors.push({ name: 'JPEG', confidence: jpegConfidence });
    }
    
    // Add Local detector
    if (localConfidence !== null) {
      detectors.push({ name: 'Local', confidence: localConfidence });
    }
    
    // DO NOT add HuggingFace to ensemble (too inaccurate)
    // We'll log it for reference but not use it in calculation
    
    console.log(`📊 Available detectors: JPEG=${jpegConfidence !== null}, Local=${localConfidence !== null}, HF=${hfConfidence !== null}`);
    
    if (detectors.length === 0) {
      console.log('⚠️ No AI detectors available');
      return {
        ai_confidence: 0,
        likely_ai_generated: false,
        detectors: [],
        agreement: 'none'
      };
    }
    
    // Calculate average from JPEG + Local ONLY
    const avgConfidence = detectors.reduce((sum, d) => sum + d.confidence, 0) / detectors.length;
    
    // Calculate agreement (deviation from average)
    const deviations = detectors.map(d => Math.abs(d.confidence - avgConfidence));
    const maxDeviation = Math.max(...deviations);
    
    let agreement = 'high';
    if (maxDeviation > 25) agreement = 'low';
    else if (maxDeviation > 15) agreement = 'medium';
    
    // Log results (including HF for reference only)
    const jpegStr = jpegConfidence !== null ? `JPEG: ${jpegConfidence}%` : '';
    const localStr = localConfidence !== null ? `Local: ${localConfidence}%` : '';
    const hfStr = hfConfidence !== null ? `HF: ${hfConfidence}% (not used)` : '';
    const parts = [jpegStr, localStr, hfStr].filter(s => s);
    
    console.log(`✅ Full ensemble result: ${Math.round(avgConfidence)}% (${parts.join(', ')})`);
    console.log(`   Agreement: ${agreement} (max deviation: ${Math.round(maxDeviation)}%)`);
    
    const isAI = avgConfidence >= 50;
    const label = isAI ? 'AI-GENERATED' : 'LIKELY AUTHENTIC';
    console.log(`✅ Ensemble detection: ${label} (${Math.round(avgConfidence)}%)`);
    
    return {
      ai_confidence: Math.round(avgConfidence),
      likely_ai_generated: isAI,
      detectors: detectors.map(d => ({ name: d.name, confidence: d.confidence })),
      agreement
    };
