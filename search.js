const db = require('./db');

async function searchByFingerprint(fingerprint) {
  try {
    const query = `
      SELECT * FROM verifications 
      WHERE fingerprint = $1
      ORDER BY upload_date ASC
    `;
    
    const result = await db.query(query, [fingerprint]);
    
    if (result.rows.length === 0) {
      return {
        found: false,
        is_first_verification: true
      };
    }
    
    return {
      found: true,
      is_first_verification: false,
      total_verifications: result.rows.length,
      first_seen: result.rows[0].upload_date,
      first_filename: result.rows[0].original_filename,
      matches: result.rows.map(m => ({
        verification_id: m.id,
        date: m.upload_date,
        filename: m.original_filename
      }))
    };
    
  } catch (error) {
    // Database not available - just log and continue
    console.log('⚠️ Database unavailable:', error.message);
    return {
      found: false,
      is_first_verification: true,
      message: 'Database temporarily unavailable'
    };
  }
}

async function saveVerification(data) {
  try {
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
    console.log('⚠️ Save failed:', error.message);
    return null;
  }
}

async function getStats() {
  try {
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
    console.log('⚠️ Stats unavailable:', error.message);
    return {
      message: 'Database temporarily unavailable',
      total_verifications: 0
    };
  }
}

module.exports = {
  searchByFingerprint,
  saveVerification,
  getStats
};
