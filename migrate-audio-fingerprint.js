const db = require('./db-minimal');

async function runMigration() {
  try {
    console.log('🔄 Running audio_fingerprint migration...');
    
    // Add audio_fingerprint column
    await db.query(`
      ALTER TABLE verifications 
      ADD COLUMN IF NOT EXISTS audio_fingerprint TEXT
    `);
    console.log('✅ Added audio_fingerprint column');
    
    // Create index for faster searches
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_audio_fingerprint 
      ON verifications(audio_fingerprint) 
      WHERE audio_fingerprint IS NOT NULL
    `);
    console.log('✅ Created index on audio_fingerprint');
    
    console.log('🎉 Migration complete!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
