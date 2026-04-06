/**
 * VeriSource — DALL-E 3 Portrait & Face Training Data Generator
 * Generates 1000 photorealistic face/portrait images for classifier training.
 * Saves directly to /mnt/verisource/training-data/ai/dalle3/
 * Run on RunPod: node generate_dalle_training_data.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'YOUR_OPENAI_API_KEY_HERE';
const OUT_DIR = process.env.OUTPUT_DIR || '/mnt/verisource/training-data/ai/dalle3';
const TARGET = parseInt(process.env.BATCH_SIZE || '1000', 10);
const CONCURRENCY = 3;
const DELAY_MS = 2000;

fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── Portrait & Face Prompt Library ──────────────────────────
const PROMPTS = [
  // Professional headshots
  'Photorealistic professional headshot of a white man in his 40s, suit and tie, neutral background, studio lighting',
  'Photorealistic professional headshot of a Black woman in her 30s, business attire, grey background, studio lighting',
  'Photorealistic professional headshot of an Asian man in his 50s, collared shirt, white background, soft lighting',
  'Photorealistic professional headshot of a Latina woman in her 20s, blazer, professional smile, studio portrait',
  'Photorealistic professional headshot of a Middle Eastern man in his 30s, business casual, neutral background',
  'Photorealistic professional headshot of a South Asian woman in her 40s, formal attire, corporate portrait style',
  'Photorealistic LinkedIn profile photo of a white woman in her 50s, confident expression, blurred office background',
  'Photorealistic corporate headshot of a Black man in his 20s, suit jacket, warm studio lighting',
  'Photorealistic headshot of an Asian woman in her 30s, blazer, clean white background, professional smile. Shot on Canon EOS R5, 85mm lens.',
  'Photorealistic professional portrait of a Hispanic man in his 40s, dress shirt, neutral grey background, soft box lighting.',

  // Casual and candid portraits
  'Photorealistic candid portrait of a young Asian woman smiling outdoors, natural daylight, bokeh background',
  'Photorealistic casual selfie-style photo of a white man in his 30s, outdoor setting, natural light',
  'Photorealistic portrait of an elderly Black woman, warm smile, indoor natural lighting, close-up',
  'Photorealistic photo of a teenage Hispanic boy, casual clothes, school hallway background',
  'Photorealistic candid photo of a Middle Eastern woman in her 40s, outdoor cafe setting',
  'Photorealistic portrait of an elderly white man with beard and glasses, reading indoors',
  'Photorealistic photo of a young South Asian man laughing, casual setting, natural light',
  'Photorealistic candid portrait of a mixed-race woman in her 30s, park setting, afternoon light',
  'Photorealistic candid photo of a Black teenage girl smiling, school courtyard, natural light, documentary style.',
  'Photorealistic portrait of an elderly Asian woman in her 70s, sitting by a window, soft natural light, gentle expression.',

  // Social media style
  'Photorealistic Instagram-style selfie of a young white woman, ring light, bedroom background',
  'Photorealistic social media profile photo of a Black man in his 20s, casual outdoor setting',
  'Photorealistic Facebook profile photo of a middle-aged Hispanic woman, family gathering background',
  'Photorealistic selfie of an Asian teenage girl, natural light, neutral expression',
  'Photorealistic social media photo of a young white man at a gym, athletic wear, confident pose',
  'Photorealistic Instagram portrait of a South Asian woman in her 20s, coffee shop setting',
  'Photorealistic Twitter profile photo of a white man in his 30s, casual outdoor background, candid smile.',
  'Photorealistic social media selfie of a Latina woman in her 20s, natural lighting, minimal makeup, genuine expression.',

  // ID and document style
  'Photorealistic passport-style photo of a white woman in her 30s, neutral expression, white background',
  'Photorealistic ID card photo of a Black man in his 40s, plain background, direct gaze',
  'Photorealistic driver license style photo of a Hispanic woman in her 20s, neutral background',
  'Photorealistic visa application photo of an Asian man in his 50s, formal attire, white background',
  'Photorealistic government ID style portrait of a Middle Eastern woman in her 30s, neutral expression',
  'Photorealistic passport photo of an elderly South Asian man, plain light background',
  'Photorealistic employee ID badge photo of a white woman in her 40s, lanyard visible, company office background.',
  'Photorealistic DMV-style license photo of a Black teenager, neutral background, direct camera gaze.',

  // Diverse ages
  'Photorealistic portrait of a white baby around 1 year old, natural indoor lighting, close-up face',
  'Photorealistic photo of a Black child around 8 years old, school photo style, blue background',
  'Photorealistic portrait of an Asian teenage boy around 16, casual clothes, natural light',
  'Photorealistic photo of a Hispanic man in his 60s, outdoor setting, candid expression',
  'Photorealistic portrait of a white woman in her 70s, warm smile, indoor natural lighting',
  'Photorealistic candid photo of a South Asian man in his 80s, outdoor park setting',

  // Various lighting conditions
  'Photorealistic portrait of a white man in dramatic side lighting, artistic portrait style',
  'Photorealistic photo of a Black woman in golden hour sunlight, outdoor portrait',
  'Photorealistic portrait of an Asian woman under soft indoor lamp light, evening setting',
  'Photorealistic photo of a Middle Eastern man in overcast outdoor lighting, candid style',
  'Photorealistic portrait of a Hispanic woman in window light, natural indoor setting',
  'Photorealistic photo of a South Asian woman in fluorescent office lighting, candid work photo',

  // Realistic portraits from original script
  'Photorealistic portrait photo of a middle-aged man in business casual clothing, neutral expression, office background, natural lighting',
  'Realistic headshot photo of a woman in her 30s, professional attire, slight smile, blurred office background, DSLR quality',
  'Photorealistic candid photo of an elderly man sitting on a park bench, natural light, genuine expression, depth of field',
  'Realistic photo of a young woman in casual clothing at an outdoor cafe, candid style, natural lighting, shallow depth of field',
  'Photorealistic portrait of a diverse group of professionals in a conference room, business meeting setting, natural window light',
];

const VARIATIONS = [
  '',
  ' Shot on Canon EOS R5, 85mm lens, f/2.8.',
  ' Shot on Sony A7IV, 35mm lens, photojournalism style.',
  ' High resolution, sharp details, natural lighting.',
  ' Documentary photography style, candid moment.',
  ' Professional photography, news wire quality.',
];

let done = 0, fail = 0;

function generateImage(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
      response_format: 'url',
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/images/generations',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(json.error.message));
          const url = json.data?.[0]?.url;
          if (!url) return reject(new Error('No URL in response'));
          resolve(url);
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.tmp';
    const file = fs.createWriteStream(tmp);
    https.get(url, res => {
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          if (!fs.existsSync(tmp)) return reject(new Error('File missing'));
          const size = fs.statSync(tmp).size;
          if (size < 1000) { fs.unlinkSync(tmp); return reject(new Error('too small')); }
          fs.renameSync(tmp, dest);
          resolve(size);
        });
      });
    }).on('error', err => {
      try { fs.unlinkSync(tmp); } catch {}
      reject(err);
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function worker(id) {
  while ((done + fail) < TARGET) {
    const promptIdx = Math.floor(Math.random() * PROMPTS.length);
    const variationIdx = Math.floor((done + fail) / PROMPTS.length) % VARIATIONS.length;
    const prompt = PROMPTS[promptIdx] + VARIATIONS[variationIdx];
    const imageId = crypto.randomBytes(8).toString('hex');
    const dest = path.join(OUT_DIR, `dalle3_${imageId}.jpg`);

    try {
      const url = await generateImage(prompt);
      await downloadImage(url, dest);
      done++;
      process.stdout.write(`\r✅ ${done} ❌ ${fail} | ${done + fail}/${TARGET} | ${prompt.substring(0, 55)}...`);
    } catch (err) {
      fail++;
      process.stdout.write(`\r✅ ${done} ❌ ${fail} | Error: ${err.message.substring(0, 55)}`);
    }

    await sleep(DELAY_MS * CONCURRENCY);
  }
}

async function main() {
  const existing = fs.existsSync(OUT_DIR)
    ? fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.jpg')).length
    : 0;
  done = existing;

  console.log(`DALL-E 3 Portrait & Face Generator`);
  console.log(`Target: ${TARGET} images | Already have: ${existing}`);
  console.log(`Output: ${OUT_DIR}`);
  console.log(`Prompts: ${PROMPTS.length} unique prompts with ${VARIATIONS.length} variations`);
  console.log(`Estimated cost: ~$${((TARGET - existing) * 0.04).toFixed(2)}`);
  console.log(`Estimated time: ~${Math.ceil((TARGET - existing) / CONCURRENCY * DELAY_MS / 60000)} minutes\n`);

  if (done >= TARGET) { console.log('Already at target!'); return; }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

  console.log(`\n\nComplete! Generated: ${done} | Failed: ${fail}`);
  console.log(`Saved to: ${OUT_DIR}`);
}

main().catch(console.error);