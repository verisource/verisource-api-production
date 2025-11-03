const db = require('./db');

async function searchByFingerprint(fingerprint) {
  try {
    // Ensure database is initialized
    if (!db.isAvailable()) {
      console.log('⚠️ Database not available for search');
      return {
        found: false,
        is_first_verification: true,
        message: 'Database temporarily unavailable'
      };
    }
    
    const query = `
      SELECT * FROM verifications 
      WHERE fingerprint = $1
      ORDER BY upload_date ASC
    `;
    
    const result = await db.query(query, [fingerprint]);
    
    if (result.rows.length === 0) {
      return {
        found: false,
        is_first_verification: true,
        message: "First time this file has been verified"
      };
    }
    
    const matches = result.rows;
    return {
      found: true,
      is_first_verification: false,
      total_verifications: matches.length,
      first_seen: matches[0].upload_date,
      first_filename: matches[0].original_filename,
      matches: matches.map(m => ({
        verification_id: m.id,
        date: m.upload_date,
        filename: m.original_filename,
        file_size: m.file_size
      }))
    };
    
  } catch (error) {
    console.error('❌ Search error:', error.message);
    return {
      found: false,
      is_first_verification: true,
      message: 'Search failed: ' + error.message
    };
  }
}

async function saveVerification(data) {
  try {
    if (!db.isAvailable()) {
      console.log('⚠️ Database not available for save');
      return null;
    }
    
    const query = `
      INSERT INTO verifications (
        fingerprint, fingerprint_algorithm, original_filename,
        file_size, file_type, media_kind, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, upload_date
    `;
    
    const values = [
      data.fingerprint,
      data.algorithm || 'sha256',
      data.filename,
      data.file_size,
      data.file_type,
      data.media_kind,
      data.ip_address || null
    ];
    
    const result = await db.query(query, values);
    console.log('✅ Saved verification:', result.rows[0].id);
    
    return {
      verification_id: result.rows[0].id,
      upload_date: result.rows[0].upload_date
    };
    
  } catch (error) {
    console.error('❌ Save error:', error.message);
    return null;
  }
}

async function getStats() {
  try {
    if (!db.isAvailable()) {
      console.log('⚠️ Database not available for stats, isAvailable():', db.isAvailable());
      return {
        message: 'Database being configured',
        total_verifications: 0
      };
    }
    
    const query = `
      SELECT 
        COUNT(*) as total_verifications,
        COUNT(DISTINCT fingerprint) as unique_files,
        COUNT(*) - COUNT(DISTINCT fingerprint) as duplicates,
        MIN(upload_date) as first_verification,
        MAX(upload_date) as last_verification
      FROM verifications
    `;
    
    const result = await db.query(query);
    return result.rows[0];
    
  } catch (error) {
    console.error('❌ Stats error:', error.message);
    return {
      error: 'Database error',
      message: error.message
    };
  }
}

module.exports = {
  searchByFingerprint,
  saveVerification,
  getStats
};
