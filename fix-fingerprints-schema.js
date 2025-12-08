const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'services', 'verifications.db');
const db = new Database(dbPath);

console.log('Fixing fingerprints schema...');

// Drop and recreate without foreign key
db.exec(`DROP TABLE IF EXISTS fingerprints`);

db.exec(`
  CREATE TABLE fingerprints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sha256 TEXT NOT NULL,
    phash TEXT,
    source_type TEXT DEFAULT 'submission',
    source_url TEXT,
    source_domain TEXT,
    verification_id INTEGER,
    customer_id TEXT,
    claim_context TEXT,
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    occurrence_count INTEGER DEFAULT 1
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_fp_sha256 ON fingerprints(sha256);
  CREATE INDEX IF NOT EXISTS idx_fp_phash ON fingerprints(phash);
`);

console.log('Done. Testing insert...');

const result = db.prepare('INSERT INTO fingerprints (sha256, source_type) VALUES (?, ?)').run('test789', 'submission');
console.log('Insert OK:', result.lastInsertRowid);

const row = db.prepare('SELECT * FROM fingerprints WHERE sha256 = ?').get('test789');
console.log('Row:', row);

// Clean up test
db.prepare('DELETE FROM fingerprints WHERE sha256 = ?').run('test789');

db.close();
console.log('Schema fixed!');
