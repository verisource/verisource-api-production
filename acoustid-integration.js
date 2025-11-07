const https = require('https');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const ACOUSTID_API_KEY = process.env.ACOUSTID_API_KEY;
const USER_AGENT = 'VeriSource/1.0 (brian@verisource.io)';

async function generateChromaprint(audioPath) {
  try {
    const ffmpegCmd = `ffmpeg -i "${audioPath}" -f chromaprint -fp_format base64 - 2>/dev/null | tail -1`;
    const { stdout: fpData } = await execAsync(ffmpegCmd);
    
    const durationCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
    const { stdout: durationStr } = await execAsync(durationCmd);
    
    return {
      fingerprint: fpData.trim(),
      duration: Math.round(parseFloat(durationStr))
    };
  } catch (error) {
    console.error('❌ Error generating chromaprint:', error);
    throw new Error('Failed to generate audio fingerprint');
  }
}

async function identifyWithAcoustID(fingerprint, duration) {
  if (!ACOUSTID_API_KEY) {
    throw new Error('ACOUSTID_API_KEY not configured');
  }

  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      client: ACOUSTID_API_KEY,
      fingerprint: fingerprint,
      duration: duration,
      meta: 'recordings releasegroups releases tracks compress usermeta'
    });

    const options = {
      hostname: 'api.acoustid.org',
      path: `/v2/lookup?${params}`,
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          
          if (result.status !== 'ok') {
            return reject(new Error(`AcoustID error: ${result.error?.message || 'Unknown error'}`));
          }

          if (!result.results || result.results.length === 0) {
            return resolve({ identified: false, message: 'No matching recordings found' });
          }

          const bestMatch = result.results.reduce((best, current) => 
            (current.score > best.score) ? current : best
          );

          resolve({
            identified: true,
            score: bestMatch.score,
            acoustid_id: bestMatch.id,
            recordings: bestMatch.recordings || []
          });
        } catch (error) {
          reject(new Error(`Failed to parse AcoustID response: ${error.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('AcoustID request timeout'));
    });
    req.end();
  });
}

async function getMusicBrainzMetadata(recordingId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'musicbrainz.org',
      path: `/ws/2/recording/${recordingId}?inc=artists+releases+isrcs+tags+ratings&fmt=json`,
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          
          const metadata = {
            id: result.id,
            title: result.title,
            length: result.length ? Math.round(result.length / 1000) : null,
            artist: result['artist-credit']?.[0]?.name || 'Unknown Artist',
            artists: result['artist-credit']?.map(ac => ac.name) || [],
            isrc: result.isrcs?.[0] || null,
            disambiguation: result.disambiguation || null
          };

          if (result.releases && result.releases.length > 0) {
            const release = result.releases[0];
            metadata.album = release.title;
            metadata.release_date = release.date;
            metadata.country = release.country;
          }

          if (result.tags && result.tags.length > 0) {
            metadata.genres = result.tags.map(t => t.name);
          }

          resolve(metadata);
        } catch (error) {
          reject(new Error(`Failed to parse MusicBrainz response: ${error.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('MusicBrainz request timeout'));
    });
    req.end();
  });
}

async function identifyAudio(audioPath) {
  const startTime = Date.now();
  
  try {
    console.log('🎵 Identifying audio with AcoustID/MusicBrainz...');
    
    const { fingerprint, duration } = await generateChromaprint(audioPath);
    console.log(`✅ Fingerprint generated (${duration}s)`);
    
    const acoustidResult = await identifyWithAcoustID(fingerprint, duration);
    
    if (!acoustidResult.identified) {
      return {
        identified: false,
        message: acoustidResult.message,
        processing_time_ms: Date.now() - startTime
      };
    }
    
    console.log(`✅ AcoustID match (score: ${(acoustidResult.score * 100).toFixed(1)}%)`);
    
    const bestRecording = acoustidResult.recordings[0];
    if (!bestRecording) {
      return {
        identified: false,
        message: 'No recording metadata available',
        processing_time_ms: Date.now() - startTime
      };
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const metadata = await getMusicBrainzMetadata(bestRecording.id);
    console.log(`✅ Metadata retrieved: ${metadata.title} - ${metadata.artist}`);
    
    return {
      identified: true,
      confidence: acoustidResult.score,
      acoustid_id: acoustidResult.acoustid_id,
      recording: metadata,
      processing_time_ms: Date.now() - startTime,
      sources: ['AcoustID', 'MusicBrainz']
    };
    
  } catch (error) {
    console.error('❌ Audio identification error:', error.message);
    return {
      identified: false,
      error: error.message,
      processing_time_ms: Date.now() - startTime
    };
  }
}

function isConfigured() {
  return !!ACOUSTID_API_KEY;
}

module.exports = {
  identifyAudio,
  isConfigured
};
