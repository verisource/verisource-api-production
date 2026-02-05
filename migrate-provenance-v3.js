/**
 * Migration: Add change tracking to content_relationships
 * Run this ONCE before deploying provenance-service v3
 * 
 * Adds:
 * - change_diff JSONB column to content_relationships
 * - New relationship types index
 * - pHash prefix index for scalable search
 * 
 * Safe to run multiple times (uses IF NOT EXISTS)
 */

const db = require('./db-minimal');

async function migrate() {
  console.log('🔄 Running provenance v3 migration...');
  
  try {
    // 1. Add change_diff column to content_relationships
    console.log('   Adding change_diff column...');
    await db.query(`
      ALTER TABLE content_relationships 
      ADD COLUMN IF NOT EXISTS change_diff JSONB
    `);
    console.log('   ✅ change_diff column added');
    
    // 2. Add index on relationship_type for stats queries
    console.log('   Adding relationship_type index...');
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_rel_type 
      ON content_relationships(relationship_type)
    `);
    console.log('   ✅ relationship_type index created');
    
    // 3. Add pHash prefix index for scalable search
    // This allows WHERE LEFT(phash, N) = 'prefix' to use an index scan
    console.log('   Adding pHash prefix index...');
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_phash_prefix 
      ON verifications (LEFT(phash, 8)) 
      WHERE phash IS NOT NULL
    `);
    console.log('   ✅ pHash prefix index created');
    
    // 4. Add file metadata columns if missing (for change detection)
    console.log('   Adding file metadata columns...');
    await db.query(`
      ALTER TABLE verifications 
      ADD COLUMN IF NOT EXISTS file_type VARCHAR(50)
    `);
    console.log('   ✅ file_type column verified');
    
    // 5. Add composite index for provenance queries
    console.log('   Adding provenance composite index...');
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_provenance 
      ON verifications (fingerprint, upload_date, phash) 
      WHERE phash IS NOT NULL
    `);
    console.log('   ✅ Provenance composite index created');
    
    console.log('\n✅ Provenance v3 migration complete!');
    console.log('   You can now deploy the updated provenance-service.js');
    
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    throw err;
  }
}

// Run if called directly
if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { migrate };