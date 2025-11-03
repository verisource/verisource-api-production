const { Pool } = require('pg');

let pool = null;
let isReady = false;

async function initialize() {
  if (!process.env.DATABASE_URL) {
    console.log('⚠️ DATABASE_URL not configured');
    return false;
  }

  try {
    console.log('🔌 Initializing PostgreSQL...');
    
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
      max: 10
    });

    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    
    console.log('✅ PostgreSQL initialized:', result.rows[0].now);
    isReady = true;
    return true;
    
  } catch (error) {
    console.error('❌ PostgreSQL initialization failed:', error.message);
    isReady = false;
    return false;
  }
}

async function query(text, params) {
  if (!isReady || !pool) {
    throw new Error('Database not initialized');
  }
  return pool.query(text, params);
}

function isAvailable() {
  return isReady;
}

module.exports = {
  initialize,
  query,
  isAvailable
};
