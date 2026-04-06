/**
 * VeriSource — Grok Aurora Training Data Generator
 * Generates photorealistic face/portrait images via xAI API.
 * Saves directly to /mnt/verisource/training-data/ai/grok/
 * Run on RunPod: GROK_API_KEY=your_key node generate_grok_training_data.js
 * Get API key at: console.x.ai
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GROK_API_KEY = process.env.GROK_API_KEY || 'YOUR_GROK_API_KEY_HERE';
const OUT_DIR = process.env.OUTPUT_DIR || '/mnt/verisource/training-data/ai/grok';
const TARGET = parseInt(process.env.BATCH_SIZE || '2000', 10);
const CONCURRENCY = 3;
const DELAY_MS = 2000;

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
  'Photorealistic casual selfie-style photo of a white man in his 30s, outdoor setting, natural light',
  'Photorealistic portrait of an elderly Black woman, warm smile, indoor natural lighting, close-up',
  'Photorealistic photo of a teenage Hispanic boy, casual clothes, school hallway background',
  'Photorealistic candid photo of a Middle Eastern woman in her 40s, outdoor cafe setting',
  'Photorealistic portrait of an elderly white man with beard and glasses, reading indoors',
  'Photorealistic photo of a young South Asian man laughing, casual setting, natural light',
  'Photorealistic candid portrait of a mixed-race woman in her 30s, park setting, afternoon light',
  'Photorealistic Instagram-style selfie of a young white woman, ring light, bedroom background',
  'Photorealistic social media profile photo of a Black man in his 20s, casual outdoor setting',
  'Photorealistic Facebook profile photo of a middle-aged Hispanic woman, family gathering background',
  'Photorealistic selfie of an Asian teenage girl, natural light, neutral expression',
  'Photorealistic social media photo of a young white man at a gym, athletic wear, confident pose',
  'Photorealistic Instagram portrait of a South Asian woman in her 20s, coffee shop setting',
  'Photorealistic passport-style photo of a white woman in her 30s, neutral expression, white background',
  'Photorealistic ID card photo of a Black man in his 40s, plain background, direct gaze',
  'Photorealistic driver license style photo of a Hispanic woman in her 20s, neutral background',
  'Photorealistic visa application photo of an Asian man in his 50s, formal attire, white background',
  'Photorealistic government ID style portrait of a Middle Eastern woman in her 30s, neutral expression',
  'Photorealistic passport photo of an elderly South Asian man, plain light background',
  'Photorealistic photo of a Black child around 8 years old, school photo style, blue background',
  'Photorealistic portrait of an Asian teenage boy around 16, casual clothes, natural light',
  'Photorealistic photo of a Hispanic man in his 60s, outdoor setting, candid expression',
  'Photorealistic portrait of a white woman in her 70s, warm smile, indoor natural lighting',
  'Photorealistic candid photo of a South Asian man in his 80s, outdoor park setting',
  'Photorealistic portrait of a white man in dramatic side lighting, artistic portrait style',
  'Photorealistic photo of a Black woman in golden hour sunlight, outdoor portrait',
  'Photorealistic portrait of an Asian woman under soft indoor lamp light, evening setting',
  'Photorealistic photo of a Middle Eastern man in overcast outdoor lighting, candid style',
  'Photorealistic portrait of a Hispanic woman in window light, natural indoor setting',
  'Photorealistic photo of a South Asian woman in fluorescent office lighting, candid work photo',
  'Realistic headshot photo of a woman in her 30s, professional attire, slight smile, blurred office background',
  'Photorealistic candid photo of an elderly man sitting on a park bench, natural light, genuine expression',
  'Realistic photo of a young woman in casual clothing at an outdoor cafe, candid style, natural lighting',
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
      model: 'aurora',
      prompt: prompt,
      n: 1,
      response_format: 'b64_json',
    });

    const options = {
      hostname: 'api.x.ai',
      path: '/v1/images/generations',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROK_API_KEY}`,
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
          const b64 = json.data?.[0]?.b64_json;
          if (!b64) return reject(new Error('No image data in response'));
          resolve(b64);
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function worker(id) {
  while ((done + fail) < TARGET) {
    const promptIdx = Math.floor(Math.random() * PROMPTS.length);
    const variationIdx = Math.floor((done + fail) / PROMPTS.length) % VARIATIONS.length;
    const prompt = PROMPTS[promptIdx] + VARIATIONS[variationIdx];
    const imageId = crypto.randomBytes(8).toString('hex');
    const dest = path.join(OUT_DIR, `grok_${imageId}.jpg`);

    try {
      const b64 = await generateImage(prompt);
      fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
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
  if (GROK_API_KEY === 'YOUR_GROK_API_KEY_HERE') {
    console.error('❌ Set your xAI API key: GROK_API_KEY=your_key node generate_grok_training_data.js');
    console.error('   Get a key at: console.x.ai');
    process.exit(1);
  }

  const existing = fs.existsSync(OUT_DIR)
    ? fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.jpg')).length : 0;
  done = existing;

  console.log(`Grok Aurora Portrait Generator`);
  console.log(`Target: ${TARGET} images | Already have: ${existing}`);
  console.log(`Output: ${OUT_DIR}`);
  console.log(`Estimated cost: ~$${((TARGET - existing) * 0.07).toFixed(2)}`);
  console.log(`Estimated time: ~${Math.ceil((TARGET - existing) / CONCURRENCY * DELAY_MS / 60000)} minutes\n`);

  if (done >= TARGET) { console.log('Already at target!'); return; }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

  console.log(`\n\nComplete! Generated: ${done} | Failed: ${fail}`);
  console.log(`Saved to: ${OUT_DIR}`);
}

main().catch(console.error);