// Check if DATABASE_URL exists and is valid
if (process.env.DATABASE_URL && 
    !process.env.DATABASE_URL.includes('localhost') &&
    !process.env.DATABASE_URL.includes('::1')) {
  
  console.log('✅ Using PostgreSQL');
  const { Pool } = require('pg');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  pool.on('connect', () => console.log('✅ PostgreSQL connected'));
  pool.on('error', (err) => console.error('❌ PostgreSQL error:', err));
  
  module.exports = pool;
  
} else {
  // Fallback to SQLite
  console.log('⚠️ DATABASE_URL not configured, using SQLite fallback');
  
  try {
    module.exports = require('./db-sqlite');
  } catch (error) {
    console.error('❌ SQLite not available:', error.message);
    // Provide dummy module if SQLite also fails
    module.exports = {
      query: async () => ({ rows: [] })
    };
  }
}
