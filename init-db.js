const db = require('./db');

async function initDatabase() {
  try {
    console.log('⏳ Waiting for database connection...');
    
    // Wait for connection to be ready
    await db.waitForConnection();
    
    if (!db.isAvailable()) {
      console.log('⚠️ Database connection failed, skipping table creation');
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
    console.log('✅ Database tables created successfully');
    
    // Verify tables exist
    const checkQuery = "SELECT COUNT(*) FROM verifications";
    const result = await db.query(checkQuery);
    console.log('📊 Current verifications in database:', result.rows[0].count);
    
    return true;
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    return false;
  }
}

module.exports = { initDatabase };
