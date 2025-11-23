# VeriSource Trust Score Integration Guide

## Overview

The trust score system consists of 4 main components:

1. **AI Detection Router** (`services/ai-detection-router.js`)
   - Smart routing between local and external AI detection
   - Tier-based access control
   - Caching for efficiency

2. **External AI Detection** (`services/external-ai-detection.js`)
   - Hive AI API integration
   - 95%+ accuracy
   - Premium feature

3. **Trust Score Calculator** (`services/trust-score.js`)
   - 5-component scoring (Crypto, Blockchain, Metadata, Provenance, AI)
   - 15% AI weighting (4.5% local + 10.5% external)
   - 7 confidence levels

4. **Response Formatter** (`services/response-formatter.js`)
   - Clean API responses
   - User-friendly messaging
   - Alert generation

## Quick Start

### 1. Environment Setup
```bash
# Required
export HIVE_API_KEY=your_hive_api_key_here

# Optional
export HIVE_API_URL=https://api.thehive.ai/api/v2/task/sync
```

### 2. Basic Integration
```javascript
const aiRouter = require('./services/ai-detection-router');
const trustScore = require('./services/trust-score');
const formatter = require('./services/response-formatter');

// In your verification endpoint
async function verifyContent(file, userTier) {
  // 1. AI Detection
  const aiResult = await aiRouter.detectWithRouting({
    filePathOrUrl: file.path,
    hash: fileHash,
    metadata: metadata,
    userTier: userTier, // 'free' or 'paid'
    mediaType: 'image'
  });
  
  // 2. Build verification data
  const verificationData = {
    hash: fileHash,
    fileIntegrity: { valid: true, corrupted: false },
    duplicates: { found: 0 },
    blockchain: { /* ... */ },
    metadata: metadata,
    reverseSearch: { /* ... */ },
    priorInstances: { /* ... */ },
    aiDetection: aiResult
  };
  
  // 3. Calculate trust score
  const score = await trustScore.calculateTrustScore(verificationData);
  
  // 4. Format response
  const response = formatter.formatVerificationResponse(
    verificationData,
    score
  );
  
  return response;
}
```

### 3. User Tiers

**Free Tier:**
- Local AI detection only (4.5 / 15 points)
- Trust score: 0-95.5 (max without external AI)
- Message: "Upgrade for advanced AI detection"

**Paid Tier:**
- Local + External AI detection (15 / 15 points)
- Trust score: 0-100 (full range)
- 95%+ AI detection accuracy

## Trust Score Breakdown

| Component | Points | Description |
|-----------|--------|-------------|
| Cryptographic Integrity | 32 | Hash, file integrity, duplicates |
| Blockchain Provenance | 25 | Timestamp, chain of custody |
| Metadata Authenticity | 18 | Camera EXIF, GPS, software |
| Content Provenance | 10 | Reverse search, prior instances |
| AI Detection | 15 | Local (4.5) + External (10.5) |
| **Total** | **100** | |

## Confidence Levels

| Score | Label | Recommendation |
|-------|-------|----------------|
| 95-100 | ✅ VERIFIED | Safe to use |
| 85-94 | ✅ TRUSTED | Likely safe |
| 70-84 | ⚠️ ACCEPTABLE | Review carefully |
| 55-69 | ⚠️ UNCERTAIN | Verify source |
| 40-54 | ⚠️ SUSPICIOUS | Do not use |
| 25-39 | 🔴 UNTRUSTED | Reject |
| 0-24 | 🚨 HIGH RISK | Reject immediately |

## API Response Format
```json
{
  "verification_id": "ver_abc123",
  "timestamp": "2024-11-23T03:54:44.316Z",
  "trust_score": {
    "overall": 95,
    "confidence_level": "verified",
    "confidence_label": "VERIFIED",
    "recommendation": "safe_to_use",
    "message": "Very high confidence in authenticity.",
    "breakdown": {
      "cryptographic": 32,
      "blockchain": 25,
      "metadata": 18,
      "provenance": 10,
      "ai_detection": 15
    }
  },
  "verification": { /* detailed results */ },
  "indicators": [ /* list of findings */ ],
  "links": { /* verification URLs */ }
}
```

## Testing

Run the test suite:
```bash
# Unit tests
node test-trust-score.js

# Integration test
node test-integration.js

# With external API simulation
node test-integration-with-external.js
```

## Deployment Checklist

- [ ] Set `HIVE_API_KEY` environment variable
- [ ] Update verification endpoints to use trust score
- [ ] Configure user tier authentication
- [ ] Set up blockchain service
- [ ] Configure reverse image search APIs
- [ ] Test with real images
- [ ] Monitor AI API usage and costs
- [ ] Set up error alerting

## Cost Optimization

**Smart Routing Saves Money:**
- Local detection is certain → Skip external API (save $0.02)
- Free tier users → Never call external API
- Cache results → Avoid duplicate API calls

**Expected Costs:**
- 1000 verifications/month, 50% need external → $10/month
- 10000 verifications/month, 50% need external → $100/month

## Troubleshooting

**Low AI detection scores:**
- Check if external API is being called
- Verify `HIVE_API_KEY` is set
- Check user tier is 'paid' or 'premium'

**External API not called:**
- Local detection was certain (expected behavior)
- User is on free tier (expected)
- Check routing logs

**Trust score lower than expected:**
- Check breakdown to see which components are low
- Missing metadata reduces score
- No blockchain timestamp reduces score

## Support

For issues or questions:
- Check logs for error messages
- Review test suite for examples
- Verify environment variables are set

