const { Pool } = require('pg');

// Global state
const state = {
  pool: null,
  ready: false,
  initializing: false,
  initPromise: null
};

async function initialize() {
  // Return existing promise if already initializing
  if (state.initializing) {
    return state.initPromise;
  }
  
  // Already initialized
  if (state.ready) {
    return true;
  }
  
  state.initializing = true;
  state.initPromise = (async () => {
    if (!process.env.DATABASE_URL) {
      console.log('⚠️ DATABASE_URL not set - database disabled');
      state.ready = false;
      state.initializing = false;
      return false;
    }

    try {
      console.log('🔌 Connecting to PostgreSQL...');
      
      state.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
        max: 10
      });

      // Test connection
      const client = await state.pool.connect();
      const result = await client.query('SELECT NOW()');
      client.release();
      
      console.log('✅ PostgreSQL connected:', result.rows[0].now);
      state.ready = true;
      state.initializing = false;
      
      return true;
      
    } catch (error) {
      console.error('❌ PostgreSQL connection failed:', error.message);
      state.ready = false;
      state.initializing = false;
      state.pool = null;
      return false;
    }
  })();
  
  return state.initPromise;
}

async function query(text, params) {
  if (!state.ready) {
    throw new Error('Database not ready');
  }
  return state.pool.query(text, params);
}

function isAvailable() {
  return state.ready;
}

// Initialize immediately when module loads
if (process.env.DATABASE_URL) {
  initialize().catch(err => {
    console.error('Database auto-init failed:', err);
  });
}

module.exports = {
  initialize,
  query,
  isAvailable
};
