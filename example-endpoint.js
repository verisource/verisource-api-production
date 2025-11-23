/**
 * Example: Verification Endpoint Integration
 * Shows how to integrate trust score into Express endpoint
 */

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const sharp = require('sharp');

// Import our services
const aiRouter = require('./services/ai-detection-router');
const trustScore = require('./services/trust-score');
const formatter = require('./services/response-formatter');

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

/**
 * POST /api/verify
 * Complete verification endpoint with trust score
 */
router.post('/verify', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const userTier = req.user?.tier || 'free'; // Get from auth middleware
    
    console.log(`Processing verification for ${userTier} tier user`);

    // Step 1: Generate hash
    const fileBuffer = require('fs').readFileSync(file.path);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Step 2: Extract metadata
    let metadata;
    try {
      metadata = await sharp(file.path).metadata();
    } catch (error) {
      metadata = { format: 'unknown' };
    }

    // Step 3: Check for duplicates (simplified - would query database)
    const duplicates = {
      found: 0 // await db.findByHash(hash)
    };

    // Step 4: Record on blockchain (simplified)
    const blockchain = {
      timestamp: new Date().toISOString(),
      confirmations: 0, // Would be updated by blockchain service
      network: 'polygon',
      txHash: null, // Would be set after blockchain confirmation
      history: []
    };

    // Step 5: Reverse image search (simplified)
    const reverseSearch = {
      tineye: { matches: [] },
      google: { matches: [] }
    };

    // Step 6: AI Detection with smart routing
    const aiResult = await aiRouter.detectWithRouting({
      filePathOrUrl: file.path,
      hash: hash,
      metadata: metadata,
      userTier: userTier,
      mediaType: getMediaType(metadata.format)
    });

    // Step 7: Build verification data
    const verificationData = {
      verificationId: generateVerificationId(),
      hash: hash,
      fileIntegrity: {
        valid: true,
        corrupted: false
      },
      duplicates: duplicates,
      blockchain: blockchain,
      metadata: metadata,
      reverseSearch: reverseSearch,
      priorInstances: {
        earliestFound: null
      },
      aiDetection: aiResult
    };

    // Step 8: Calculate trust score
    const trustScoreResult = await trustScore.calculateTrustScore(verificationData);

    // Step 9: Format response
    const response = formatter.formatVerificationResponse(
      verificationData,
      trustScoreResult
    );

    // Step 10: Return to client
    res.json(response);

    // Cleanup uploaded file
    require('fs').unlinkSync(file.path);

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      error: 'Verification failed',
      message: error.message
    });
  }
});

/**
 * GET /api/verify/:id
 * Retrieve verification result
 */
router.get('/verify/:id', async (req, res) => {
  try {
    const verificationId = req.params.id;
    
    // Retrieve from database (simplified)
    // const verification = await db.getVerification(verificationId);
    
    res.json({
      verification_id: verificationId,
      status: 'found',
      // ... verification data
    });
  } catch (error) {
    res.status(404).json({
      error: 'Verification not found'
    });
  }
});

// Helper functions
function getMediaType(format) {
  const imageFormats = ['jpeg', 'jpg', 'png', 'gif', 'webp', 'heic'];
  const videoFormats = ['mp4', 'mov', 'avi', 'webm'];
  const audioFormats = ['mp3', 'wav', 'flac', 'aac', 'm4a'];
  
  if (imageFormats.includes(format?.toLowerCase())) return 'image';
  if (videoFormats.includes(format?.toLowerCase())) return 'video';
  if (audioFormats.includes(format?.toLowerCase())) return 'audio';
  
  return 'image'; // default
}

function generateVerificationId() {
  return 'ver_' + crypto.randomBytes(8).toString('hex');
}

module.exports = router;
