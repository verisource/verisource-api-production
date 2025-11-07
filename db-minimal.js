// Minimal PostgreSQL database module
// Provides simple query interface with connection pooling

const { Pool } = require('pg');

let pool = null;

// Initialize connection pool
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') 
      ? false 
      : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10
  });

  pool.on('error', (err) => {
    console.error('⚠️ Unexpected database pool error:', err.message);
  });
} else {
  console.warn('⚠️ DATABASE_URL not set - database features will not be available');
}

/**
 * Execute a database query
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters (optional)
 * @returns {Promise<QueryResult>} - Query result
 */
async function query(text, params) {
  if (!pool) {
    throw new Error('Database pool not initialized - DATABASE_URL not configured');
  }
  
  return pool.query(text, params);
}

/**
 * Get a client from the pool for transactions
 * @returns {Promise<PoolClient>}
 */
async function getClient() {
  if (!pool) {
    throw new Error('Database pool not initialized - DATABASE_URL not configured');
  }
  
  return pool.connect();
}

/**
 * Close the database pool (for graceful shutdown)
 */
async function close() {
  if (pool) {
    await pool.end();
    console.log('✅ Database pool closed');
  }
}


/**
 * Check if database is available
 * @returns {boolean}
 */
function isAvailable() {
  return pool !== null;
}

module.exports = {
  query,
  getClient,
  close,
  isAvailable
};