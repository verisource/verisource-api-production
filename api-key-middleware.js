// =============================================
// API KEY AUTHENTICATION MIDDLEWARE
// VeriSource - Privacy-First Account Isolation
// =============================================

const db = require('./db-minimal');
const crypto = require('crypto');

/**
 * Get or create account for a platform user (PII-free)
 */
async function getOrCreateUserAccount(platform, externalUserId, providedAccountId = null) {
  // If user provides their account_id (migration scenario), verify and use it
  if (providedAccountId && providedAccountId.startsWith('acct_')) {
    const existing = await db.query(
      'SELECT account_id FROM user_mappings WHERE account_id = $1',
      [providedAccountId]
    );
    if (existing.rows.length > 0) {
      const hash = crypto.createHash('sha256')
        .update(platform + ':' + externalUserId)
        .digest('hex');
      
      await db.query(`
        INSERT INTO user_mappings (account_id, external_id_hash, platform)
        VALUES ($1, $2, $3)
        ON CONFLICT (external_id_hash, platform) 
        DO UPDATE SET last_seen_at = NOW()
      `, [providedAccountId, hash, platform]);
      
      return providedAccountId;
    }
  }

  const hash = crypto.createHash('sha256')
    .update(platform + ':' + externalUserId)
    .digest('hex');

  const existing = await db.query(
    'SELECT account_id FROM user_mappings WHERE external_id_hash = $1 AND platform = $2',
    [hash, platform]
  );

  if (existing.rows.length > 0) {
    await db.query(
      'UPDATE user_mappings SET last_seen_at = NOW() WHERE external_id_hash = $1 AND platform = $2',
      [hash, platform]
    );
    return existing.rows[0].account_id;
  }

  const accountId = 'acct_' + crypto.randomBytes(8).toString('hex');
  
  await db.query(`
    INSERT INTO user_mappings (account_id, external_id_hash, platform)
    VALUES ($1, $2, $3)
  `, [accountId, hash, platform]);

  return accountId;
}

/**
 * API Key Authentication Middleware
 */
async function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'Missing API key',
      message: 'Include X-API-Key header with your request'
    });
  }

  if (!apiKey.startsWith('vsk_') || apiKey.length < 20) {
    return res.status(401).json({
      success: false,
      error: 'Invalid API key format'
    });
  }

  try {
    const result = await db.query(`
      SELECT account_id, tier, is_active, rate_limit_per_hour, 
             requests_this_hour, hour_started_at
      FROM api_keys 
      WHERE api_key = $1
    `, [apiKey]);

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      });
    }

    const account = result.rows[0];

    if (!account.is_active) {
      return res.status(403).json({
        success: false,
        error: 'Account disabled'
      });
    }

    // Rate limiting
    const now = new Date();
    const hourAgo = new Date(now - 60 * 60 * 1000);
    
    if (account.hour_started_at && new Date(account.hour_started_at) > hourAgo) {
      if (account.requests_this_hour >= account.rate_limit_per_hour) {
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          message: `Limit: ${account.rate_limit_per_hour}/hour`
        });
      }
      await db.query(`
        UPDATE api_keys 
        SET requests_this_hour = requests_this_hour + 1, last_used_at = NOW()
        WHERE api_key = $1
      `, [apiKey]);
    } else {
      await db.query(`
        UPDATE api_keys 
        SET requests_this_hour = 1, hour_started_at = NOW(), last_used_at = NOW()
        WHERE api_key = $1
      `, [apiKey]);
    }

    // Handle app-tier keys (Base44)
    if (account.tier === 'app') {
      const userId = req.headers['x-user-id'];
      const providedAccountId = req.headers['x-account-id'];
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'Missing user ID',
          message: 'App-tier API keys require X-User-ID header'
        });
      }

      const platform = account.account_id.replace('app_', '');
      const userAccountId = await getOrCreateUserAccount(platform, userId, providedAccountId);
      
      req.account = {
        id: userAccountId,
        tier: account.tier,
        rateLimit: account.rate_limit_per_hour,
        platform: platform,
        isAppUser: true
      };
    } else {
      req.account = {
        id: account.account_id,
        tier: account.tier,
        rateLimit: account.rate_limit_per_hour,
        isAppUser: false
      };
    }

    next();
  } catch (error) {
    console.error('API key auth error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
}

/**
 * Get user's portable account ID
 */
async function getUserAccountId(req, res) {
  if (!req.account) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  return res.json({
    account_id: req.account.id,
    message: 'Save this ID to preserve your history if you switch platforms'
  });
}

/**
 * Optional auth - for gradual rollout
 */
function authenticateApiKeyOptional(req, res, next) {
  if (process.env.SKIP_API_AUTH === 'true' && !req.headers['x-api-key']) {
    req.account = {
      id: 'acct_development',
      tier: 'enterprise',
      rateLimit: 10000,
      isAppUser: false
    };
    return next();
  }
  return authenticateApiKey(req, res, next);
}

module.exports = { 
  authenticateApiKey, 
  authenticateApiKeyOptional,
  getUserAccountId,
  getOrCreateUserAccount
};