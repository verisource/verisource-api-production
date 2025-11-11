/**
 * Batch Verification Routes
 * Endpoints for uploading and managing batch image verifications
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const os = require('os');
const batchProcessor = require('../services/batchProcessor');
const batchStore = require('../services/batchStore');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file
    files: 100 // Max 100 files per batch
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.originalname}. Only images are allowed (jpg, png, gif, webp)`));
    }
  }
});

/**
 * POST /api/verify/batch
 * Upload and verify multiple files
 */
router.post('/verify/batch', upload.array('files', 100), async (req, res) => {
  const startTime = Date.now();
  const batchId = generateBatchId();
  
  try {
    // Validate files
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        error: 'No files provided',
        message: 'Please upload at least one image file',
        code: 'NO_FILES'
      });
    }
    
    // Get user ID (from auth middleware or API key)
    const userId = req.user?.id || req.headers['x-user-id'] || 'anonymous';
    
    console.log(`[Batch ${batchId}] Starting batch verification for user ${userId}`);
    console.log(`[Batch ${batchId}] Processing ${req.files.length} files`);
    
    // Parse options from request body
    const options = {
      userId,
      concurrency: parseInt(req.body.concurrency) || 10,
      checkDuplicates: req.body.checkDuplicates !== 'false'
    };
    
    // Process batch
    const batchResult = await batchProcessor.processBatch(req.files, options);
    
    // Determine overall status
    const status = batchResult.summary.failed === 0 
      ? 'completed' 
      : batchResult.summary.successful === 0 
        ? 'failed'
        : 'completed_with_errors';
    
    // Generate batch data
    const batchData = {
      batchId,
      userId,
      status,
      summary: batchResult.summary,
      timing: {
        startedAt: new Date(startTime),
        completedAt: new Date(),
        processingTime: batchResult.timing.processingTime,
        avgTimePerFile: batchResult.timing.avgTimePerFile
      },
      results: batchResult.results,
      metadata: {
        concurrency: options.concurrency,
        checkDuplicates: options.checkDuplicates,
        apiVersion: '1.0'
      }
    };
    
    // Store batch results
    const saved = batchStore.saveBatch(batchId, batchData);
    
    if (!saved) {
      console.error(`[Batch ${batchId}] Failed to save batch results`);
    }
    
    console.log(`[Batch ${batchId}] Complete: ${batchResult.summary.successful}/${batchResult.summary.total} successful in ${batchResult.timing.processingTime}ms`);
    
    // Return response
    return res.status(200).json({
      batchId,
      status: batchData.status,
      summary: batchData.summary,
      timing: {
        processingTime: batchData.timing.processingTime,
        avgTimePerFile: batchData.timing.avgTimePerFile
      },
      results: batchData.results,
      links: {
        self: `/api/batch/${batchId}`,
        dashboard: `/batch/${batchId}/dashboard`,
        csv: `/api/batch/${batchId}/csv`,
        json: `/api/batch/${batchId}/json`
      }
    });
    
  } catch (error) {
    console.error(`[Batch ${batchId}] Critical error:`, error);
    
    // Clean up any uploaded files on error
    if (req.files) {
      const fs = require('fs').promises;
      await Promise.allSettled(
        req.files.map(file => fs.unlink(file.path))
      );
    }
    
    return res.status(500).json({
      error: 'Batch processing failed',
      message: error.message,
      batchId,
      code: 'BATCH_PROCESSING_ERROR'
    });
  }
});

/**
 * GET /api/batch/:batchId
 * Get batch results as JSON
 */
router.get('/batch/:batchId', async (req, res) => {
  try {
    const batchData = batchStore.getBatch(req.params.batchId);
    
    if (!batchData) {
      return res.status(404).json({ 
        error: 'Batch not found',
        message: 'This batch may have expired or does not exist',
        code: 'BATCH_NOT_FOUND',
        batchId: req.params.batchId
      });
    }
    
    // Optional: Check ownership if auth is available
    // if (req.user && batchData.userId !== req.user.id && !req.user.isAdmin) {
    //   return res.status(403).json({ 
    //     error: 'Access denied',
    //     message: 'You do not have permission to view this batch'
    //   });
    // }
    
    // Add TTL info
    const ttl = batchStore.getBatchTTL(req.params.batchId);
    
    return res.json({
      ...batchData,
      expiresIn: ttl,
      expiresAt: new Date(Date.now() + (ttl * 1000)).toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching batch:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch batch',
      message: error.message,
      code: 'FETCH_ERROR'
    });
  }
});

/**
 * GET /batch/:batchId/dashboard
 * View HTML dashboard
 */
router.get('/batch/:batchId/dashboard', async (req, res) => {
  try {
    const batchData = batchStore.getBatch(req.params.batchId);
    
    if (!batchData) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Batch Not Found - VeriSource</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                text-align: center;
                padding: 100px 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
              }
              .error-box {
                background: white;
                color: #333;
                padding: 50px;
                border-radius: 16px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                max-width: 500px;
              }
              h1 { font-size: 48px; margin: 0 0 20px 0; }
              p { font-size: 18px; margin: 0 0 30px 0; color: #666; }
              .btn {
                display: inline-block;
                padding: 12px 24px;
                background: #667eea;
                color: white;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
              }
            </style>
          </head>
          <body>
            <div class="error-box">
              <h1>❌</h1>
              <h1>Batch Not Found</h1>
              <p>This batch may have expired or does not exist.</p>
              <p style="font-size: 14px; color: #999;">Batch ID: ${req.params.batchId}</p>
              <a href="/" class="btn">Return Home</a>
            </div>
          </body>
        </html>
      `);
    }
    
    // Render dashboard template
    return res.render('batch-dashboard', { 
      batch: batchData,
      formatDate: (date) => new Date(date).toLocaleString(),
      formatFileSize: (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      }
    });
    
  } catch (error) {
    console.error('Error rendering dashboard:', error);
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h1>Error Loading Dashboard</h1>
          <p>${error.message}</p>
        </body>
      </html>
    `);
  }
});

/**
 * GET /api/batch/:batchId/csv
 * Download batch results as CSV
 */
router.get('/batch/:batchId/csv', async (req, res) => {
  try {
    const batchData = batchStore.getBatch(req.params.batchId);
    
    if (!batchData) {
      return res.status(404).json({ 
        error: 'Batch not found',
        code: 'BATCH_NOT_FOUND'
      });
    }
    
    // Optional: Check ownership
    // if (req.user && batchData.userId !== req.user.id && !req.user.isAdmin) {
    //   return res.status(403).json({ error: 'Access denied' });
    // }
    
    // Generate CSV
    const csv = generateCSV(batchData);
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="verisource_batch_${req.params.batchId}.csv"`);
    res.send(csv);
    
  } catch (error) {
    console.error('Error generating CSV:', error);
    return res.status(500).json({ 
      error: 'Failed to generate CSV',
      message: error.message,
      code: 'CSV_GENERATION_ERROR'
    });
  }
});

/**
 * GET /api/batch/:batchId/json
 * Download batch results as JSON file
 */
router.get('/batch/:batchId/json', async (req, res) => {
  try {
    const batchData = batchStore.getBatch(req.params.batchId);
    
    if (!batchData) {
      return res.status(404).json({ 
        error: 'Batch not found',
        code: 'BATCH_NOT_FOUND'
      });
    }
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="verisource_batch_${req.params.batchId}.json"`);
    res.send(JSON.stringify(batchData, null, 2));
    
  } catch (error) {
    console.error('Error generating JSON:', error);
    return res.status(500).json({ 
      error: 'Failed to generate JSON',
      code: 'JSON_GENERATION_ERROR'
    });
  }
});

/**
 * DELETE /api/batch/:batchId
 * Delete a batch (admin/user only)
 */
router.delete('/batch/:batchId', async (req, res) => {
  try {
    const batchData = batchStore.getBatch(req.params.batchId);
    
    if (!batchData) {
      return res.status(404).json({ 
        error: 'Batch not found',
        code: 'BATCH_NOT_FOUND'
      });
    }
    
    // Optional: Check ownership
    // if (req.user && batchData.userId !== req.user.id && !req.user.isAdmin) {
    //   return res.status(403).json({ error: 'Access denied' });
    // }
    
    const deleted = batchStore.deleteBatch(req.params.batchId);
    
    if (deleted) {
      return res.json({ 
        message: 'Batch deleted successfully',
        batchId: req.params.batchId
      });
    } else {
      return res.status(500).json({ 
        error: 'Failed to delete batch',
        code: 'DELETE_ERROR'
      });
    }
    
  } catch (error) {
    console.error('Error deleting batch:', error);
    return res.status(500).json({ 
      error: 'Failed to delete batch',
      message: error.message
    });
  }
});

/**
 * GET /api/batch/stats
 * Get batch statistics (admin only)
 */
router.get('/batch-stats', (req, res) => {
  try {
    const stats = batchStore.getStats();
    return res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch stats',
      message: error.message
    });
  }
});

/**
 * Helper: Generate batch ID
 */
function generateBatchId() {
  const timestamp = new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .split('.')[0];
  const random = Math.random().toString(36).substring(2, 9);
  return `batch_${timestamp}_${random}`;
}

/**
 * Helper: Generate CSV from batch data
 */
function generateCSV(batchData) {
  const rows = [
    // Header row
    [
      '#',
      'Filename',
      'Status',
      'File ID',
      'Size (KB)',
      'Dimensions',
      'Format',
      'SHA-256',
      'Perceptual Hash',
      'Duplicates',
      'Duplicate Details',
      'Error',
      'Processing Time (ms)'
    ]
  ];
  
  // Data rows
  batchData.results.forEach((result, index) => {
    const row = [
      index + 1,
      result.filename,
      result.status,
      result.fileId || '—',
      result.metadata?.size ? Math.round(result.metadata.size / 1024) : '—',
      result.metadata?.width && result.metadata?.height 
        ? `${result.metadata.width}×${result.metadata.height}` 
        : '—',
      result.metadata?.format?.toUpperCase() || '—',
      result.fingerprint?.sha256?.substring(0, 16) + '...' || '—',
      result.fingerprint?.perceptualHash?.substring(0, 16) + '...' || '—',
      result.matches?.length || 0,
      result.matches?.length > 0 
        ? result.matches.map(m => `${m.filename} (${Math.round(m.similarity * 100)}%)`).join('; ')
        : '',
      result.error?.message || '',
      batchData.timing.avgTimePerFile
    ];
    
    rows.push(row);
  });
  
  // Convert to CSV string
  return rows.map(row => 
    row.map(cell => {
      // Escape cells containing commas or quotes
      const str = String(cell);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',')
  ).join('\n');
}

module.exports = router;
