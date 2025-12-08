const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'verifications.db');
const db = new Database(dbPath);

console.log('Running fingerprint index migration...\n');

db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS fingerprints (
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
    occurrence_count INTEGER DEFAULT 1,
    FOREIGN KEY (verification_id) REFERENCES verifications(id)
  )
`);
console.log('Created fingerprints table');

db.exec(`
  CREATE TABLE IF NOT EXISTS content_labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    confidence REAL,
    source TEXT DEFAULT 'google_vision',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (fingerprint_id) REFERENCES fingerprints(id),
    UNIQUE(fingerprint_id, label, source)
  )
`);
console.log('Created content_labels table');

db.exec(`
  CREATE TABLE IF NOT EXISTS external_search_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint_id INTEGER,
    service TEXT NOT NULL,
    query_hash TEXT NOT NULL,
    total_matches INTEGER DEFAULT 0,
    match_urls TEXT,
    raw_response TEXT,
    queried_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY (fingerprint_id) REFERENCES fingerprints(id)
  )
`);
console.log('Created external_search_cache table');

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_fp_sha256 ON fingerprints(sha256);
  CREATE INDEX IF NOT EXISTS idx_fp_phash ON fingerprints(phash);
  CREATE INDEX IF NOT EXISTS idx_labels_fp ON content_labels(fingerprint_id);
  CREATE INDEX IF NOT EXISTS idx_labels_label ON content_labels(label);
  CREATE INDEX IF NOT EXISTS idx_cache_query ON external_search_cache(query_hash);
`);
console.log('Created indexes');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('\nTables:', tables.map(t => t.name).join(', '));

db.close();
console.log('\nMigration complete!');