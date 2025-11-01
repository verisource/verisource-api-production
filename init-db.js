const pool = require('./db');

async function initDatabase() {
  console.log('🔨 Initializing database...');
  
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
    CREATE INDEX IF NOT EXISTS idx_media_kind ON verifications(media_kind);
  `;
  
  try {
    await pool.query(createTableQuery);
    console.log('✅ Database tables created');
    console.log('✅ Indexes created');
    
    const checkQuery = `
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_name = 'verifications'
    `;
    const result = await pool.query(checkQuery);
    console.log('✅ Verification table exists:', result.rows[0].count === '1');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

initDatabase();
