// PostgreSQL connection with graceful fallback

let pool = null;
let dbAvailable = false;

try {
  if (!process.env.DATABASE_URL) {
    console.log('⚠️ DATABASE_URL not configured - database features disabled');
  } else {
    console.log('✅ DATABASE_URL found, connecting to PostgreSQL...');
    const { Pool } = require('pg');
    
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
      max: 10
    });
    
    pool.on('connect', () => {
      console.log('✅ PostgreSQL connected successfully');
      dbAvailable = true;
    });
    
    pool.on('error', (err) => {
      console.error('⚠️ PostgreSQL error:', err.message);
      dbAvailable = false;
    });
    
    // Test connection immediately
    pool.query('SELECT NOW()', (err, res) => {
      if (err) {
        console.error('⚠️ Database test query failed:', err.message);
        dbAvailable = false;
      } else {
        console.log('✅ Database test query successful:', res.rows[0].now);
        dbAvailable = true;
      }
    });
  }
} catch (error) {
  console.error('⚠️ Database initialization error:', error.message);
  console.log('⚠️ Application will continue without database features');
}

// Safe query wrapper
const query = async (text, params) => {
  if (!pool || !dbAvailable) {
    throw new Error('Database not available');
  }
  return pool.query(text, params);
};

const isAvailable = () => dbAvailable;

module.exports = {
  query,
  isAvailable
};
