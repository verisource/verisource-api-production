const { Pool } = require('pg');

let pool = null;

// Initialize pool on module load
if (process.env.DATABASE_URL) {
  console.log('🔌 Creating PostgreSQL pool...');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    max: 10
  });
  
  // Test connection
  pool.query('SELECT NOW()', (err, res) => {
    if (err) {
      console.error('❌ PostgreSQL test failed:', err.message);
    } else {
      console.log('✅ PostgreSQL pool ready:', res.rows[0].now);
    }
  });
} else {
  console.log('⚠️ DATABASE_URL not set');
}

// Simple query - just try it
async function query(text, params) {
  if (!pool) {
    throw new Error('Database pool not created');
  }
  return pool.query(text, params);
}

module.exports = { query };
