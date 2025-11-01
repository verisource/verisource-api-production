const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'verifications.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL,
      fingerprint_algorithm TEXT DEFAULT 'sha256',
      original_filename TEXT,
      file_size INTEGER,
      file_type TEXT,
      media_kind TEXT,
      upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      ip_address TEXT
    )
  `);
  
  db.run(`CREATE INDEX IF NOT EXISTS idx_fingerprint ON verifications(fingerprint)`);
  console.log('✅ SQLite database initialized');
});

const query = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve({ rows: rows || [] });
      });
    } else {
      db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ 
          rows: [{ 
            id: this.lastID, 
            upload_date: new Date().toISOString() 
          }] 
        });
      });
    }
  });
};

module.exports = { query };
