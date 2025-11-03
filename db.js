// PostgreSQL connection with initialization support

let pool = null;
let dbAvailable = false;
let connectionPromise = null;

async function connect() {
  if (!process.env.DATABASE_URL) {
    console.log('⚠️ DATABASE_URL not configured');
    return false;
  }

  try {
    console.log('✅ DATABASE_URL found');
    console.log('🔌 Connecting to PostgreSQL...');
    
    const { Pool } = require('pg');
    
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
      max: 10
    });
    
    // Test connection
    const client = await pool.connect();
    console.log('✅ PostgreSQL client connected');
    
    const result = await client.query('SELECT NOW()');
    console.log('✅ Database test query successful:', result.rows[0].now);
    
    client.release();
    dbAvailable = true;
    
    pool.on('error', (err) => {
      console.error('⚠️ Database error:', err.message);
      dbAvailable = false;
    });
    
    return true;
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    dbAvailable = false;
    return false;
  }
}

// Start connection immediately
connectionPromise = connect();

const query = async (text, params) => {
  // Wait for connection to be ready
  await connectionPromise;
  
  if (!pool || !dbAvailable) {
    throw new Error('Database not available');
  }
  return pool.query(text, params);
};

const isAvailable = () => dbAvailable;

// Wait for connection to be ready
const waitForConnection = () => connectionPromise;

module.exports = {
  query,
  isAvailable,
  waitForConnection
};
