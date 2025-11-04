/**
 * Perceptual Hash (pHash) Module for VeriSource
 * Detects visually similar images even if:
 * - Resized
 * - Compressed
 * - Format changed
 * - Slightly edited
 * - Watermarked
 */

const imghash = require('imghash');
const sharp = require('sharp');
const fs = require('fs');

/**
 * Generate perceptual hash for an image
 * @param {string|Buffer} input - File path or buffer
 * @returns {Promise<Object>} - pHash result
 */
async function generatePHash(input) {
    try {
        // imghash.hash() is the correct function
        const hash = await imghash.hash(input, 16, 'hex');
        
        return {
            success: true,
            phash: hash,
            algorithm: 'pHash-DCT',
            bits: 16
        };
    } catch (error) {
        console.error('pHash generation error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Compare two pHashes and return similarity score
 * @param {string} hash1 - First pHash
 * @param {string} hash2 - Second pHash
 * @returns {Object} - Similarity result
 */
function comparePHashes(hash1, hash2) {
    if (!hash1 || !hash2) {
        return {
            similar: false,
            similarity: 0,
            hamming_distance: null,
            error: 'Invalid hashes'
        };
    }
    
    // Convert hex to binary and calculate Hamming distance
    const bin1 = hexToBinary(hash1);
    const bin2 = hexToBinary(hash2);
    
    let distance = 0;
    for (let i = 0; i < bin1.length; i++) {
        if (bin1[i] !== bin2[i]) distance++;
    }
    
    // Calculate similarity percentage (lower distance = more similar)
    const maxDistance = bin1.length;
    const similarity = ((maxDistance - distance) / maxDistance) * 100;
    
    // Consider similar if hamming distance <= 10 (industry standard)
    const similar = distance <= 10;
    
    return {
        similar,
        similarity: parseFloat(similarity.toFixed(2)),
        hamming_distance: distance,
        threshold: 10,
        interpretation: getSimilarityInterpretation(distance)
    };
}

/**
 * Convert hex string to binary
 */
function hexToBinary(hex) {
    let binary = '';
    for (let i = 0; i < hex.length; i++) {
        const bin = parseInt(hex[i], 16).toString(2).padStart(4, '0');
        binary += bin;
    }
    return binary;
}

/**
 * Get human-readable similarity interpretation
 */
function getSimilarityInterpretation(distance) {
    if (distance === 0) return 'Identical';
    if (distance <= 5) return 'Nearly identical';
    if (distance <= 10) return 'Very similar';
    if (distance <= 15) return 'Similar';
    if (distance <= 20) return 'Somewhat similar';
    return 'Different';
}

/**
 * Search database for similar images using pHash
 * @param {string} phash - pHash to search for
 * @param {Object} db - Database connection
 * @returns {Promise<Array>} - Similar images found
 */
async function searchSimilarImages(phash, db) {
    try {
        // Get all image verifications with pHash from database
        const allImages = await db.query(`
            SELECT 
                id as verification_id,
                original_filename as filename,
                phash,
                upload_date as verified_at,
                file_size
            FROM verifications
            WHERE media_kind = 'image'
            AND phash IS NOT NULL
            ORDER BY upload_date DESC
            LIMIT 1000
        `);
        
        const similarImages = [];
        
        for (const img of allImages.rows) {
            const comparison = comparePHashes(phash, img.phash);
            
            // Only include if similar (hamming distance <= 10)
            if (comparison.similar) {
                similarImages.push({
                    verification_id: img.verification_id,
                    filename: img.filename,
                    verified_at: img.verified_at,
                    file_size: img.file_size,
                    similarity: comparison.similarity,
                    hamming_distance: comparison.hamming_distance,
                    interpretation: comparison.interpretation
                });
            }
        }
        
        // Sort by similarity (highest first)
        similarImages.sort((a, b) => b.similarity - a.similarity);
        
        return similarImages;
        
    } catch (error) {
        console.error('Similar image search error:', error);
        return [];
    }
}

module.exports = {
    generatePHash,
    comparePHashes,
    searchSimilarImages
};
