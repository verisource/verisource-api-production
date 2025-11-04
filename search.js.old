const pool = require('./db');

async function searchByFingerprint(fingerprint) {
  if (!fingerprint) {
    throw new Error('Fingerprint required for search');
  }
  
  const query = `
    SELECT 
      id,
      original_filename,
      file_size,
      file_type,
      media_kind,
      upload_date,
      fingerprint_algorithm
    FROM verifications 
    WHERE fingerprint = $1
    ORDER BY upload_date ASC
  `;
  
  try {
    const result = await pool.query(query, [fingerprint]);
    
    if (result.rows.length === 0) {
      return {
        found: false,
        is_first_verification: true,
        message: "This is the first time this file has been verified"
      };
    }
    
    const matches = result.rows;
    const firstVerification = matches[0];
    
    return {
      found: true,
      is_first_verification: false,
      total_verifications: matches.length,
      first_seen: firstVerification.upload_date,
      first_filename: firstVerification.original_filename,
      matches: matches.map(m => ({
        verification_id: m.id,
        date: m.upload_date,
        filename: m.original_filename,
        file_size: m.file_size,
        file_type: m.file_type,
        media_kind: m.media_kind
      }))
    };
    
  } catch (error) {
    console.error('❌ Search error:', error);
    throw error;
  }
}

async function saveVerification(data) {
  const query = `
    INSERT INTO verifications (
      fingerprint,
      fingerprint_algorithm,
      original_filename,
      file_size,
      file_type,
      media_kind,
      ip_address
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
  
  try {
    const result = await pool.query(query, values);
    return {
      verification_id: result.rows[0].id,
      upload_date: result.rows[0].upload_date
    };
  } catch (error) {
    console.error('❌ Save error:', error);
    throw error;
  }
}

async function getStats() {
  const query = `
    SELECT 
      COUNT(*) as total_verifications,
      COUNT(DISTINCT fingerprint) as unique_files,
      COUNT(*) - COUNT(DISTINCT fingerprint) as duplicates,
      MIN(upload_date) as first_verification,
      MAX(upload_date) as last_verification,
      COUNT(CASE WHEN media_kind = 'image' THEN 1 END) as images,
      COUNT(CASE WHEN media_kind = 'video' THEN 1 END) as videos,
      COUNT(CASE WHEN media_kind = 'audio' THEN 1 END) as audio
    FROM verifications
  `;
  
  try {
    const result = await pool.query(query);
    return result.rows[0];
  } catch (error) {
    console.error('❌ Stats error:', error);
    throw error;
  }
}

module.exports = {
  searchByFingerprint,
  saveVerification,
  getStats
};
