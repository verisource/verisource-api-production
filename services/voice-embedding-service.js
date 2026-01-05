/**
 * Voice Embedding Service for VeriSource
 * 
 * Extracts speaker embeddings from audio for cross-claim voice matching.
 * Uses Pyannote for accurate speaker differentiation.
 */
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');
const os = require('os');

class VoiceEmbeddingService {
  
  /**
   * Check if Pyannote is configured (HuggingFace token exists)
   */
  static isPyannoteConfigured() {
    return !!process.env.HUGGINGFACE_TOKEN;
  }
  
  /**
   * Extract voice embedding from audio file
   */
  static async extractEmbedding(audioPath, options = {}) {
    const requestId = options.requestId || Date.now();
    
    try {
      if (!fs.existsSync(audioPath)) {
        throw new Error('Audio file not found');
      }
      
      const duration = await this.getAudioDuration(audioPath);
      if (duration < 1) {
        return {
          success: false,
          error: 'Audio too short (minimum 1 second)',
          duration: duration
        };
      }
      
      if (this.isPyannoteConfigured()) {
        return await this.extractWithPyannote(audioPath, options);
      } else {
        console.log('   ⚠️ HUGGINGFACE_TOKEN not set, using local MFCC (less accurate)');
        return await this.extractWithLocalMFCC(audioPath, options);
      }
      
    } catch (error) {
      console.error('Voice embedding error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Extract embedding using Pyannote (accurate)
   */
  static async extractWithPyannote(audioPath, options = {}) {
    console.log('🎤 Extracting voice embedding via Pyannote...');
    
    // Convert to WAV format
    const wavPath = await this.convertToWav(audioPath, options.requestId);
    
    try {
      const scriptPath = path.join(__dirname, 'pyannote_embedding.py');
      const cmd = `python3 "${scriptPath}" "${wavPath}"`;
      
      const { stdout, stderr } = await execAsync(cmd, { 
        timeout: 120000,  // 2 minute timeout
        env: { ...process.env }
      });
      
      if (stderr && !stderr.includes('UserWarning')) {
        console.log('   ⚠️ Pyannote stderr:', stderr.substring(0, 200));
      }
      
      console.log('   Raw stdout:', stdout.substring(0, 100));
      const result = JSON.parse(stdout.trim());
      
      if (!result.success) {
        throw new Error(result.error || 'Pyannote extraction failed');
      }
      
      const duration = await this.getAudioDuration(audioPath);
      
      console.log('   ✅ Voice embedding extracted (pyannote, ' + result.embedding_size + ' dims)');
      
      return {
        success: true,
        embedding: result.embedding,
        embedding_size: result.embedding_size,
        method: 'pyannote',
        duration: duration
      };
      
    } catch (error) {
      console.error('   ❌ Pyannote error:', error.message);
      
      // Fall back to local MFCC if Pyannote fails
      console.log('   ⚠️ Falling back to local MFCC...');
      return await this.extractWithLocalMFCC(audioPath, options);
      
    } finally {
      // Cleanup temp file
      if (wavPath !== audioPath && fs.existsSync(wavPath)) {
        try { fs.unlinkSync(wavPath); } catch (e) {}
      }
    }
  }
  
  /**
   * Fallback: Extract embedding using local MFCC (less accurate)
   */
  static async extractWithLocalMFCC(audioPath, options = {}) {
    console.log('🎤 Extracting voice embedding via local MFCC...');
    
    const wavPath = await this.convertToWav(audioPath, options.requestId);
    
    try {
      const pythonScript = `
import sys
import wave
import struct
import math
import json

try:
    with wave.open('${wavPath.replace(/'/g, "\\'")}', 'rb') as wav:
        framerate = wav.getframerate()
        n_frames = wav.getnframes()
        audio_data = wav.readframes(n_frames)
        
    samples = struct.unpack('<%dh' % n_frames, audio_data)
    samples = list(samples)
    
    # Normalize
    max_val = max(abs(s) for s in samples) or 1
    samples = [s / max_val for s in samples]
    
    # Extract simple features
    frame_size = int(framerate * 0.025)
    hop_size = int(framerate * 0.010)
    
    frame_features = []
    for i in range(0, len(samples) - frame_size, hop_size):
        frame = samples[i:i + frame_size]
        energy = sum(x * x for x in frame) / len(frame)
        zero_crossings = sum(1 for j in range(1, len(frame)) if frame[j-1] * frame[j] < 0)
        frame_features.append([math.log(energy + 1e-10), zero_crossings / len(frame)])
    
    if not frame_features:
        print(json.dumps([0.0] * 128))
        sys.exit(0)
    
    # Aggregate into fixed embedding
    embedding = []
    for f in range(len(frame_features[0])):
        values = [ff[f] for ff in frame_features]
        embedding.extend([
            sum(values) / len(values),
            (sum((x - sum(values)/len(values))**2 for x in values) / len(values)) ** 0.5,
            min(values),
            max(values)
        ])
    
    # Pad to 128 dimensions
    while len(embedding) < 128:
        embedding.append(0.0)
    
    print(json.dumps(embedding[:128]))
    
except Exception as e:
    print(json.dumps([0.0] * 128))
`;

      const { stdout } = await execAsync(`python3 -c "${pythonScript.replace(/"/g, '\\"')}"`, { timeout: 30000 });
      const embedding = JSON.parse(stdout.trim());
      const duration = await this.getAudioDuration(audioPath);
      
      console.log('   ✅ Voice embedding extracted (local_mfcc)');
      
      return {
        success: true,
        embedding: embedding,
        embedding_size: embedding.length,
        method: 'local_mfcc',
        duration: duration,
        note: 'Local MFCC - less accurate than Pyannote'
      };
      
    } finally {
      if (wavPath !== audioPath && fs.existsSync(wavPath)) {
        try { fs.unlinkSync(wavPath); } catch (e) {}
      }
    }
  }
  
  /**
   * Search for matching voices in database
   */
  static async searchVoiceMatches(embedding, db, options = {}) {
    const { threshold = 0.80, limit = 10, excludeIds = [] } = options;
    
    try {
      const result = await db.query(`
        SELECT id, verification_id, source_type, source_file_hash, 
               voice_embedding, embedding_method, created_at
        FROM voice_prints 
        WHERE voice_embedding IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 100
      `);
      
      if (result.rows.length === 0) {
        return { found: false, count: 0, matches: [], threshold_used: threshold };
      }
      
      const matches = [];
      
      for (const row of result.rows) {
        if (excludeIds.includes(row.id)) continue;
        
        try {
          const storedEmbedding = typeof row.voice_embedding === 'string' 
            ? JSON.parse(row.voice_embedding) 
            : row.voice_embedding;
          
          // Handle different embedding sizes
          const similarity = this.cosineSimilarity(embedding, storedEmbedding);
          
          if (similarity >= threshold) {
            matches.push({
              id: row.id,
              verification_id: row.verification_id,
              source_type: row.source_type,
              similarity: similarity,
              similarity_percent: Math.round(similarity * 100),
              interpretation: similarity >= 0.90 ? 'STRONG_MATCH' : 
                             similarity >= 0.80 ? 'LIKELY_MATCH' : 'POSSIBLE_MATCH',
              created_at: row.created_at
            });
          }
        } catch (e) {
          // Skip invalid embeddings
        }
      }
      
      matches.sort((a, b) => b.similarity - a.similarity);
      
      return {
        found: matches.length > 0,
        count: matches.length,
        matches: matches.slice(0, limit),
        threshold_used: threshold
      };
      
    } catch (error) {
      console.error('Voice match search error:', error.message);
      return { found: false, count: 0, matches: [], error: error.message };
    }
  }
  
  /**
   * Convert audio to WAV format
   */
  static async convertToWav(audioPath, requestId = Date.now()) {
    const ext = path.extname(audioPath).toLowerCase();
    
    const wavPath = path.join(os.tmpdir(), `voice_${requestId}.wav`);
    
    // 16kHz, 16-bit, mono PCM WAV
    const cmd = `ffmpeg -i "${audioPath}" -acodec pcm_s16le -ar 16000 -ac 1 -f wav "${wavPath}" -y 2>&1`;
    
    try {
      await execAsync(cmd, { timeout: 60000 });
      return wavPath;
    } catch (error) {
      console.error('WAV conversion error:', error.message);
      throw new Error('Failed to convert audio to WAV format');
    }
  }
  
  /**
   * Get audio duration in seconds
   */
  static async getAudioDuration(audioPath) {
    try {
      const cmd = `ffprobe -i "${audioPath}" -show_entries format=duration -v quiet -of csv="p=0"`;
      const { stdout } = await execAsync(cmd);
      return parseFloat(stdout.trim()) || 0;
    } catch (e) {
      return 0;
    }
  }
  
  /**
   * Calculate cosine similarity between two embeddings
   */
  static cosineSimilarity(emb1, emb2) {
    if (!emb1 || !emb2) return 0;
    
    // Handle different embedding sizes by using the smaller one
    const minLen = Math.min(emb1.length, emb2.length);
    if (minLen === 0) return 0;
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < minLen; i++) {
      dotProduct += emb1[i] * emb2[i];
      norm1 += emb1[i] * emb1[i];
      norm2 += emb2[i] * emb2[i];
    }
    
    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }
}

module.exports = VoiceEmbeddingService;
