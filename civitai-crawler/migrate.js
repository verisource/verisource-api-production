const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrate() {
  console.log('Altering hash columns to TEXT...');
  
  await pool.query(`
    ALTER TABLE ai_image_hashes 
    ALTER COLUMN phash TYPE TEXT,
    ALTER COLUMN dhash TYPE TEXT,
    ALTER COLUMN average_hash TYPE TEXT;
  `);
  
  console.log('✓ Migration complete');
  await pool.end();
}

migrate().catch(console.error);
