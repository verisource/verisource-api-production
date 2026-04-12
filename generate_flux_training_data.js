/**
 * VeriSource — Flux Training Data Generator (BFL API)
 * Uses Black Forest Labs API — no GPU needed, async polling.
 * Saves to /mnt/verisource/training-data/ai/flux/
 *
 * Usage:
 *   export FLUX_API_KEY=bfl_your_key
 *   BATCH_SIZE=5000 node generate_flux_training_data.js
 *
 * Models:
 *   flux-1.1-pro         — stable, good quality (~$0.04/image)
 *   flux-2-pro-preview   — best quality (~$0.06/image)
 *   flux-2-klein-9b-preview — fastest, cheapest (~$0.014/image)
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FLUX_API_KEY = process.env.FLUX_API_KEY || 'YOUR_BFL_API_KEY_HERE';
const OUT_DIR = process.env.OUTPUT_DIR || '/mnt/verisource/training-data/ai/flux';
const TARGET = parseInt(process.env.BATCH_SIZE || '5000', 10);
const MODEL = process.env.FLUX_MODEL || 'flux-1.1-pro';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5', 10);
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 120;

fs.mkdirSync(OUT_DIR, { recursive: true });

const PROMPTS = [
  'Photorealistic professional headshot of a white man in his 40s, suit and tie, neutral background, studio lighting',
  'Photorealistic professional headshot of a Black woman in her 30s, business attire, grey background, studio lighting',
  'Photorealistic professional headshot of an Asian man in his 50s, collared shirt, white background, soft lighting',
  'Photorealistic professional headshot of a Latina woman in her 20s, blazer, professional smile, studio portrait',
  'Photorealistic professional headshot of a Middle Eastern man in his 30s, business casual, neutral background',
  'Photorealistic professional headshot of a South Asian woman in her 40s, formal attire, corporate portrait style',
  'Photorealistic LinkedIn profile photo of a white woman in her 50s, confident expression, blurred office background',
  'Photorealistic corporate headshot of a Black man in his 20s, suit jacket, warm studio lighting',
  'Photorealistic headshot of an Asian woman in her 30s, blazer, clean white background, professional smile',
  'Photorealistic professional portrait of a Hispanic man in his 40s, dress shirt, neutral grey background',
  'Photorealistic candid portrait of a young Asian woman smiling outdoors, natural daylight, bokeh background',
  'Photorealistic casual photo of a white man in his 30s, outdoor setting, natural light',
  'Photorealistic portrait of an elderly Black woman, warm smile, indoor natural lighting, close-up',
  'Photorealistic candid photo of a Middle Eastern woman in her 40s, outdoor cafe setting',
  'Photorealistic portrait of an elderly white man with beard and glasses, reading indoors',
  'Photorealistic photo of a young South Asian man laughing, casual setting, natural light',
  'Photorealistic Instagram-style selfie of a young white woman, ring light, bedroom background',
  'Photorealistic social media profile photo of a Black man in his 20s, casual outdoor setting',
  'Photorealistic Facebook profile photo of a middle-aged Hispanic woman, smiling outdoors',
  'Photorealistic passport-style photo of a white woman in her 30s, neutral expression, white background',
  'Photorealistic ID card photo of a Black man in his 40s, plain background, direct gaze',
  'Photorealistic driver license style photo of a Hispanic woman in her 20s, neutral background',
  'Photorealistic government ID style portrait of a Middle Eastern woman in her 30s, neutral expression',
  'Photorealistic portrait of an Asian teenage boy around 16, casual clothing, school setting',
  'Photorealistic photo of a Black child around 8 years old, smiling, playground background',
  'Photorealistic portrait of a white woman in her 70s, warm smile, garden setting',
  'Photorealistic selfie of an Asian teenage girl, natural light, bedroom background',
  'Photorealistic photo of a Hispanic man in his 60s, outdoor market setting, casual clothing',
  'Photorealistic portrait of a Black woman in her 50s, professional attire, office background',
  'Photorealistic candid photo of a white woman in her 20s, coffee shop setting, natural light',
];

const VARIATIONS = [
  '',
  ' Shot on Canon EOS R5.',
  ' Shot on Sony A7IV.',
  ' Shot on iPhone 15 Pro.',
  ' High resolution, sharp details.',
  ' Documentary photography style.',
];

function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.bfl.ai',
      path: urlPath,
      method,
      headers: {
        'accept': 'application/json',
        'x-key': FLUX_API_KEY,
        'Content-Type': 'application/json',
        ...(bodyStr && { 'Content-Length': Buffer.byteLength(bodyStr) }),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode === 402) return reject(new Error('Out of credits'));
          if (res.statusCode >= 400) return reject(new Error(json.detail || json.message || `HTTP ${res.statusCode}`));
          resolve(json);
        } catch (e) { reject(new Error(`Parse error: ${data.substring(0, 100)}`)); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function downloadImage(url, destPath) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, res => {
      if ([301, 302].includes(res.statusCode)) {
        return downloadImage(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`Download ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        if (data.length < 5000) return reject(new Error('Too small'));
        fs.writeFileSync(destPath, data);
        resolve(data.length);
      });
    }).on('error', reject);
  });
}

async function pollForResult(pollingUrl) {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const result = await new Promise((resolve, reject) => {
      https.get(pollingUrl, { headers: { 'accept': 'application/json', 'x-key': FLUX_API_KEY } }, res => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
    if (result.status === 'Ready' && result.result?.sample) return result.result.sample;
    if (result.status === 'Error') throw new Error(`Generation error: ${result.result?.error || 'unknown'}`);
  }
  throw new Error('Timeout');
}

async function generateOne(prompt, idx) {
  const variation = VARIATIONS[idx % VARIATIONS.length];
  const fullPrompt = prompt + variation;
  const uid = crypto.createHash('md5').update(`${fullPrompt}${Date.now()}${idx}`).digest('hex').substring(0, 16);
  const destPath = path.join(OUT_DIR, `flux_${uid}.jpg`);

  const submission = await apiRequest('POST', `/v1/${MODEL}`, {
    prompt: fullPrompt,
    width: 1024,
    height: 1024,
  });

  if (!submission.polling_url) throw new Error('No polling URL');
  const imageUrl = await pollForResult(submission.polling_url);
  await downloadImage(imageUrl, destPath);
  return destPath;
}

async function main() {
  if (!FLUX_API_KEY || FLUX_API_KEY === 'YOUR_BFL_API_KEY_HERE') {
    console.error('❌ Set your BFL API key: export FLUX_API_KEY=bfl_your_key');
    process.exit(1);
  }

  const existing = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter(f => f.startsWith('flux_')).length : 0;

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   VeriSource Flux Training Data Generator       ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Target:      ${TARGET} images | Already have: ${existing}`);
  console.log(`Model:       ${MODEL}`);
  console.log(`Output:      ${OUT_DIR}`);
  console.log(`Concurrency: ${CONCURRENCY}\n`);

  if (existing >= TARGET) { console.log('Already at target!'); return; }

  const needed = TARGET - existing;
  let done = 0, fail = 0, idx = existing;

  async function worker() {
    while (done + fail < needed) {
      const prompt = PROMPTS[(idx++) % PROMPTS.length];
      try {
        await generateOne(prompt, idx);
        done++;
      } catch (err) {
        fail++;
        if (err.message.includes('Out of credits')) {
          console.error('\n❌ Out of credits! Add credits at api.bfl.ai');
          process.exit(1);
        }
      }
      process.stdout.write(`\r✅ ${done} ❌ ${fail} | ${done + fail}/${needed} | ${prompt.substring(0, 50)}...`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`\n\nComplete! Generated: ${done} | Failed: ${fail}`);
  console.log(`Total in dir: ${fs.readdirSync(OUT_DIR).filter(f => f.startsWith('flux_')).length}`);
}

main().catch(console.error);