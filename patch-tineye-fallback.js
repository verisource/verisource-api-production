// patch-tineye-fallback.js
// Run: node patch-tineye-fallback.js
// Adds Tier 3 TinEye cross-reference fallback to findSimilarContent()

const fs = require('fs');
const path = 'services/provenance-service.js';

let code = fs.readFileSync(path, 'utf8');

const insertAfter = `      if (candidates.length > 800) {
        candidates = candidates.slice(0, 800);
      }`;

const newBlock = `      if (candidates.length > 800) {
        candidates = candidates.slice(0, 800);
      }

      // --------------------------------------------
      // TIER 3: TinEye cross-reference fallback
      // Only runs when pHash/region prefix search found ZERO candidates
      // Links images that share >=3 TinEye match URLs
      // --------------------------------------------
      if (candidates.length === 0 && excludeFingerprint) {
        try {
          const sharedResult = await db.query(\`
            SELECT b.fingerprint, COUNT(DISTINCT a.match_url) as shared_urls
            FROM external_matches a
            JOIN external_matches b ON a.match_url = b.match_url AND a.service = b.service
            WHERE a.fingerprint = $1
              AND b.fingerprint != $1
              AND a.service = 'tineye'
            GROUP BY b.fingerprint
            HAVING COUNT(DISTINCT a.match_url) >= 3
            LIMIT 50
          \`, [excludeFingerprint]);

          if (sharedResult.rows?.length) {
            const fps = sharedResult.rows.map(r => r.fingerprint);
            console.log('🔗 TinEye cross-ref found:', fps.length, 'related fingerprints');

            const placeholders = fps.map((_, i) => \`$\${i + 1}\`).join(',');
            const verifResult = await db.query(\`
              SELECT DISTINCT ON (fingerprint)
                fingerprint, phash, phash_regions, upload_date, media_kind,
                original_filename, file_size, file_type, width, height,
                has_camera_info, has_gps, has_exif, exif_date, camera_make, camera_model
              FROM verifications
              WHERE fingerprint IN (\${placeholders})
              ORDER BY fingerprint, (width IS NULL) ASC, upload_date ASC
            \`, fps);

            if (verifResult.rows?.length) {
              mergeCandidates(verifResult.rows);
            }
          }
        } catch (tineyeErr) {
          console.log('⚠️ TinEye cross-ref fallback error:', tineyeErr.message);
        }
      }`;

if (code.includes(insertAfter)) {
  code = code.replace(insertAfter, newBlock);
  fs.writeFileSync(path, code);
  console.log('✅ Tier 3 TinEye cross-reference fallback inserted into findSimilarContent()');
  
  // Verify
  const updated = fs.readFileSync(path, 'utf8');
  if (updated.includes('TIER 3: TinEye cross-reference fallback')) {
    console.log('✅ Verified: patch applied successfully');
    const line = updated.split('\n').findIndex(l => l.includes('TIER 3')) + 1;
    console.log(`   Inserted at line ~${line}`);
  }
} else {
  console.log('❌ Could not find insertion point. Check if the safety cap block matches exactly.');
  console.log('Looking for:\n', insertAfter);
}