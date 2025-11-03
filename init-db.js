const db = require('./db');

async function initDatabase() {
  try {
    // Database should already be initialized by index.js
    if (!db.isAvailable()) {
      console.log('⚠️ Database not available for table creation');
      return false;
    }
    
    console.log('🔨 Creating database tables...');
    
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS verifications (
        id SERIAL PRIMARY KEY,
        fingerprint VARCHAR(64) NOT NULL,
        fingerprint_algorithm VARCHAR(20) DEFAULT 'sha256',
        original_filename VARCHAR(255),
        file_size INTEGER,
        file_type VARCHAR(50),
        media_kind VARCHAR(20),
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45)
      );
      
      CREATE INDEX IF NOT EXISTS idx_fingerprint ON verifications(fingerprint);
      CREATE INDEX IF NOT EXISTS idx_upload_date ON verifications(upload_date DESC);
    `;
    
    await db.query(createTableQuery);
    console.log('✅ Tables created/verified successfully');
    
    // Count existing records
    const result = await db.query('SELECT COUNT(*) FROM verifications');
    console.log('📊 Current records in database:', result.rows[0].count);
    
    return true;
    
  } catch (error) {
    console.error('❌ Table creation failed:', error.message);
    return false;
  }
}

module.exports = { initDatabase };
