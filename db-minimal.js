const { Pool } = require('pg');

let pool = null;

// Create pool immediately if DATABASE_URL exists
if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
      max: 5
    });
    console.log('📦 Database pool created');
  } catch (error) {
    console.error('⚠️ Pool creation failed:', error.message);
  }
}

// Simple query function
async function query(text, params) {
  if (!pool) {
    throw new Error('No database pool');
  }
  return pool.query(text, params);
}

module.exports = { query };
