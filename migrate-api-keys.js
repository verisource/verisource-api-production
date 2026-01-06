// =============================================
// VERISOURCE PRIVACY-FIRST SCHEMA MIGRATION
// Run: node migrate-api-keys.js
// =============================================

const db = require('./db-minimal');
const crypto = require('crypto');

async function runMigration() {
  console.log('🔄 Starting VeriSource API Key Migration...\n');

  try {
    // 1. Create API Keys table
    console.log('1️⃣ Creating api_keys table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        account_id VARCHAR(50) NOT NULL UNIQUE,
        api_key VARCHAR(64) NOT NULL UNIQUE,
        tier VARCHAR(20) DEFAULT 'starter',
        is_active BOOLEAN DEFAULT true,
        rate_limit_per_hour INTEGER DEFAULT 100,
        requests_this_hour INTEGER DEFAULT 0,
        hour_started_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_used_at TIMESTAMP
      )
    `);
    console.log('   ✅ api_keys table created\n');

    // 2. Create indexes for API keys
    console.log('2️⃣ Creating indexes for api_keys...');
    await db.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys(account_id)`);
    console.log('   ✅ Indexes created\n');

    // 3. Add account_id to voice_prints
    console.log('3️⃣ Adding account_id to voice_prints...');
    await db.query(`ALTER TABLE voice_prints ADD COLUMN IF NOT EXISTS account_id VARCHAR(50)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_voice_prints_account ON voice_prints(account_id)`);
    console.log('   ✅ voice_prints.account_id added\n');

    // 4. Add account_id to verifications
    console.log('4️⃣ Adding account_id to verifications...');
    await db.query(`ALTER TABLE verifications ADD COLUMN IF NOT EXISTS account_id VARCHAR(50)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_verifications_account ON verifications(account_id)`);
    console.log('   ✅ verifications.account_id added\n');

    // 5. Create user_mappings table (PII-free platform portability)
    console.log('5️⃣ Creating user_mappings table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_mappings (
        id SERIAL PRIMARY KEY,
        account_id VARCHAR(50) NOT NULL UNIQUE,
        external_id_hash VARCHAR(64) NOT NULL,
        platform VARCHAR(30) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(external_id_hash, platform)
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_user_mappings_hash ON user_mappings(external_id_hash, platform)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_user_mappings_account ON user_mappings(account_id)`);
    console.log('   ✅ user_mappings table created\n');

    // 6. Generate Base44 app-level API key
    console.log('6️⃣ Creating Base44 app API key...');
    const base44AccountId = 'app_base44';
    const base44ApiKey = 'vsk_' + crypto.randomBytes(24).toString('hex');
    
    const base44Result = await db.query(`
      INSERT INTO api_keys (account_id, api_key, tier, rate_limit_per_hour)
      VALUES ($1, $2, 'app', 5000)
      ON CONFLICT (account_id) DO NOTHING
      RETURNING account_id, api_key, tier
    `, [base44AccountId, base44ApiKey]);

    if (base44Result.rows.length > 0) {
      console.log('   ✅ Base44 app key created:\n');
      console.log('   ╔════════════════════════════════════════════════════════════╗');
      console.log(`   ║ Account ID: ${base44Result.rows[0].account_id.padEnd(44)} ║`);
      console.log(`   ║ API Key:    ${base44Result.rows[0].api_key.padEnd(44)} ║`);
      console.log(`   ║ Tier:       ${base44Result.rows[0].tier.padEnd(44)} ║`);
      console.log('   ╚════════════════════════════════════════════════════════════╝');
      console.log('\n   ⚠️  USE THIS KEY IN YOUR BASE44 FRONTEND\n');
    } else {
      console.log('   ℹ️  Base44 app key already exists\n');
    }

    // 7. Generate enterprise API key for direct API customers
    console.log('7️⃣ Creating test enterprise API key...');
    const accountId = 'acct_' + crypto.randomBytes(8).toString('hex');
    const apiKey = 'vsk_' + crypto.randomBytes(24).toString('hex');
    
    const result = await db.query(`
      INSERT INTO api_keys (account_id, api_key, tier)
      VALUES ($1, $2, 'enterprise')
      ON CONFLICT (account_id) DO NOTHING
      RETURNING account_id, api_key, tier
    `, [accountId, apiKey]);

    if (result.rows.length > 0) {
      console.log('   ✅ Enterprise test key created:\n');
      console.log('   ╔════════════════════════════════════════════════════════════╗');
      console.log(`   ║ Account ID: ${result.rows[0].account_id.padEnd(44)} ║`);
      console.log(`   ║ API Key:    ${result.rows[0].api_key.padEnd(44)} ║`);
      console.log(`   ║ Tier:       ${result.rows[0].tier.padEnd(44)} ║`);
      console.log('   ╚════════════════════════════════════════════════════════════╝');
      console.log('\n   ⚠️  SAVE THIS - for direct API testing\n');
    } else {
      console.log('   ℹ️  Enterprise key already exists, skipping creation\n');
    }

    // 8. Verify migration
    console.log('8️⃣ Verifying migration...');
    const apiKeysCount = await db.query('SELECT COUNT(*) FROM api_keys');
    const userMappingsCheck = await db.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name = 'user_mappings'
    `);
    const voicePrintsCheck = await db.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'voice_prints' AND column_name = 'account_id'
    `);
    const verificationsCheck = await db.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'verifications' AND column_name = 'account_id'
    `);

    console.log(`   ✅ api_keys table: ${apiKeysCount.rows[0].count} row(s)`);
    console.log(`   ✅ user_mappings table: ${userMappingsCheck.rows.length > 0 ? 'EXISTS' : 'MISSING'}`);
    console.log(`   ✅ voice_prints.account_id: ${voicePrintsCheck.rows.length > 0 ? 'EXISTS' : 'MISSING'}`);
    console.log(`   ✅ verifications.account_id: ${verificationsCheck.rows.length > 0 ? 'EXISTS' : 'MISSING'}`);

    console.log('\n🎉 Migration complete!\n');
    console.log('════════════════════════════════════════════════════════════════');
    console.log('WHAT YOU STORE (Zero PII):');
    console.log('  • account_id      → Random string (acct_xxx)');
    console.log('  • external_id_hash → SHA256 hash, not reversible');
    console.log('  • platform        → Just "base44" or "custom"');
    console.log('════════════════════════════════════════════════════════════════');
    console.log('\nNext steps:');
    console.log('  1. Copy api-key-middleware.js to your project');
    console.log('  2. Update index.js to use the middleware');
    console.log('  3. Update Base44 frontend with the app API key');
    console.log('  4. Update voice matching to filter by account_id');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
