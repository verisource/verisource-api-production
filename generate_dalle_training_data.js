#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OUTPUT_DIR = process.env.OUTPUT_DIR || './dalle-training';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '500', 10);
const CONCURRENCY = Math.min(parseInt(process.env.CONCURRENCY || '3', 10), 5);

if (!OPENAI_API_KEY) { console.error('OPENAI_API_KEY is required'); process.exit(1); }

const PROMPT_CATEGORIES = {
  car_accidents: [
    'Insurance documentation photograph of vehicle damage assessment, two cars with dented bumpers in a parking lot, natural daylight, professional documentation style',
    'Property damage assessment photo of a vehicle with rear-end collision damage, crumpled bumper, hazard lights on, roadside setting, overcast sky',
    'Insurance claim documentation of a rolled vehicle on a rural road, roof damage visible, professional assessment photography, golden hour',
    'Vehicle damage documentation photo showing two cars with minor impact damage, drivers exchanging information in a shopping mall parking lot',
    'Insurance assessment photograph of a car with front-end damage after striking a utility pole, night scene with street lighting, documentation style',
    'Property insurance documentation of hail damage on a vehicle roof and hood, multiple impact marks, suburban driveway, natural light',
    'Insurance documentation of water-damaged vehicle interior, waterline visible on seats, muddy floor mats, flood assessment photography',
    'Insurance claim documentation of a motorcycle and vehicle incident scene, motorcycle on its side, emergency responders present, assessment style',
    'Property damage documentation of a vehicle with fire damage on highway shoulder, emergency vehicles present, insurance assessment photography',
    'Insurance documentation photograph of a vehicle with storm damage, broken windshield from fallen tree branch, suburban street setting',
  ],
  property_damage: [
    'Property insurance assessment photograph of a house with fire damage to roof structure, charred beams visible, professional documentation style, daylight',
    'Insurance claim documentation of water-damaged basement, waterline on walls, furniture damage visible, professional assessment photography',
    'Property damage assessment photo of a living room with ceiling collapse, debris on floor, water damage documentation, natural light',
    'Roofing insurance assessment photograph showing storm damage, missing shingles, blue tarp installation in progress, professional documentation',
    'Insurance documentation of water damage in a kitchen, warped flooring, wet drywall, professional property assessment photography',
    'Property damage documentation photograph of a vandalized commercial storefront, broken glass, professional insurance assessment, morning light',
    'Disaster assessment photograph of a suburban home with severe storm structural damage, professional insurance documentation style',
    'Property insurance documentation of smoke damage in a bedroom, soot on walls and ceiling, professional assessment photography',
    'Geological damage assessment photograph of a residential driveway affected by ground subsidence, suburban setting, professional documentation',
    'Structural damage assessment photograph of a brick building with earthquake damage, cracked facade, professional insurance documentation',
  ],
  personal_injury: [
    'Medical documentation photograph of an ankle assessment, clinical lighting, professional medical photography, ruler for scale',
    'Medical documentation photo of a patient with arm immobilization in a hospital waiting room, clinical setting, fluorescent lighting',
    'Clinical documentation photograph of a forearm being examined by medical professional in clinical gloves, medical setting',
    'Medical documentation photograph for insurance purposes showing cervical collar assessment, hospital gown, clinical setting',
    'Workplace safety documentation photograph of a slip hazard incident scene in a grocery store, wet floor sign visible',
    'Medical documentation photograph of a patient consultation, physician reviewing patient condition, clinical background, professional medical photography',
    'Workplace injury documentation photograph of a construction worker receiving medical assessment on a job site',
    'Emergency response documentation photograph of a pedestrian receiving medical assistance at a crosswalk, paramedics present',
  ],
  workers_compensation: [
    'Workers compensation documentation photograph of a warehouse worker receiving medical assessment, stacked boxes in background, safety equipment visible',
    'Workplace incident documentation of a construction site medical response, safety equipment visible, workers compensation photography',
    'Workers compensation documentation photograph of a factory worker receiving hand injury assessment, industrial background, safety vest',
    'Clinical assessment photograph of a patient receiving medical evaluation, neutral expression, hospital setting, professional documentation',
    'Workers compensation documentation photograph of a delivery worker receiving shoulder assessment in a loading dock setting',
  ],
  war_documentary: [
    'Humanitarian assessment photograph of urban infrastructure damage in a conflict-affected area, rubble documentation, overcast sky',
    'Photojournalism documentation of peacekeeping forces in tactical gear moving through a war-affected city street, documentary style',
    'Humanitarian documentation photograph of a conflict-affected residential neighborhood, structural damage assessment, golden hour',
    'Documentary photograph of military logistics convoy on a damaged road through a conflict-affected town, humanitarian mission',
    'Humanitarian aid documentation photograph of a field medical facility, medical personnel, supply assessment, documentary style',
    'Photojournalism photograph of press corps with protective equipment at a conflict zone briefing, documentary style',
    'Infrastructure damage assessment photograph of a bridge in a conflict-affected area, documentary photography style',
    'Humanitarian documentation photograph of decommissioned military equipment on a rural road, documentary style, overcast sky',
    'Humanitarian documentary photograph of civilian displacement, people carrying belongings, damaged urban infrastructure visible',
    'Humanitarian demining team documentation photograph, protective equipment, rural landscape, professional documentary style',
  ],
  social_unrest: [
    'Documentary photograph of a public demonstration on a city street, large crowd with signs, documentary photojournalism style',
    'Photojournalism documentation of crowd control response at a public gathering, urban setting, dusk lighting, documentary style',
    'Documentary photograph of a building fire during a civil disturbance, fire department response visible, photojournalism style',
    'Documentary photograph of a commercial property after civil disturbance, property damage assessment, photojournalism style',
    'Documentary photograph of public safety deployment on a city street, empty streets, photojournalism documentation style',
    'Photojournalism documentation of a public gathering around an overturned vehicle at an urban intersection, nighttime',
    'Documentary photograph of crowd dispersal with smoke at a public plaza, photojournalism style, urban setting',
    'Documentary photograph of graffiti-covered government building facade, cleanup crews visible, photojournalism style',
    'Documentary photograph of a candlelight memorial gathering in a public square, large somber crowd, city hall background, night',
    'Photojournalism documentation of barricaded downtown streets during public unrest, security presence, abandoned vehicles',
  ],
  fraud_scenarios: [
    'Insurance documentation photograph of a slip hazard assessment scene in a grocery store, wet floor sign placement documentation',
    'Insurance documentation photograph of a minor vehicle impact scene, professional claims assessment photography, parking lot setting',
    'Insurance claims documentation photograph of two people at a minor vehicle contact scene in a parking lot, professional style',
    'Insurance property claim documentation photograph, water damage assessment with measurement marker, professional documentation',
    'Insurance medical assessment photograph of a patient in a clinical setting, medical professional present, neutral documentation style',
  ],
  medical: [
    'Photorealistic clinical photo of an X-ray being reviewed by a doctor on a lightboard, hospital setting, professional attire',
    'Realistic photo of a patient in a hospital bed with IV drip, monitors visible, medical staff in background, clinical lighting',
    'Photorealistic image of an MRI scan result being discussed between doctor and patient, consultation room, neutral lighting',
    'Realistic photo of a physical therapy session in progress, therapist working on patient knee, clinical rehabilitation setting',
    'Photorealistic picture of an emergency room triage area, multiple patients, nurses in scrubs, fluorescent lighting',
  ],
  realistic_portraits: [
    'Professional portrait photograph of a middle-aged man in business casual clothing, neutral expression, office background, natural lighting',
    'Professional headshot photograph of a woman in her 30s, business attire, slight smile, blurred office background, DSLR quality',
    'Candid documentary photograph of an elderly man sitting on a park bench, natural light, genuine expression, depth of field',
    'Candid portrait photograph of a young woman in casual clothing at an outdoor cafe, natural lighting, shallow depth of field',
    'Professional group portrait photograph of business professionals in a conference room, business meeting setting, natural window light',
  ],
};

const VARIATIONS = [
  '',
  ' Shot on Canon EOS R5, 85mm lens, f/2.8.',
  ' Shot on Sony A7IV, 35mm lens, photojournalism style.',
  ' High resolution, sharp details, natural lighting.',
  ' Documentary photography style, candid moment.',
  ' Professional photography, news wire quality.',
];

function buildPromptList(total) {
  const allPrompts = [];
  for (const [category, prompts] of Object.entries(PROMPT_CATEGORIES)) {
    for (const prompt of prompts) allPrompts.push({ category, prompt });
  }
  const result = [];
  for (let i = 0; i < total; i++) {
    const { category, prompt } = allPrompts[i % allPrompts.length];
    const variation = VARIATIONS[Math.floor(i / allPrompts.length) % VARIATIONS.length];
    result.push({ category, prompt: prompt + variation, index: i });
  }
  return result;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function apiPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.openai.com', path: endpoint, method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }); }
      });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

function downloadBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode)) {
        res.resume();
        return resolve(downloadBuffer(new URL(res.headers.location, url).toString(), redirects + 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function generateOne(item, imagesDir, attempt = 1) {
  const { category, prompt, index } = item;
  const idxStr = String(index).padStart(4, '0');
  try {
    const res = await apiPost('/v1/images/generations', {
      model: 'dall-e-3', prompt, n: 1, size: '1024x1024', quality: 'standard', response_format: 'url',
    });
    if (res.status === 429 || res.status === 500) {
      const delay = attempt * 10000;
      console.log(`  Rate limit on ${idxStr}, retry ${attempt} in ${delay/1000}s...`);
      await sleep(delay);
      return generateOne(item, imagesDir, attempt + 1);
    }
    if (res.status !== 200) throw new Error(`API ${res.status}: ${JSON.stringify(res.body)}`);
    const imageUrl = res.body?.data?.[0]?.url;
    const revisedPrompt = res.body?.data?.[0]?.revised_prompt;
    if (!imageUrl) throw new Error('No image URL in response');
    const imgBuffer = await downloadBuffer(imageUrl);
    const filename = `dalle3_${category}_${idxStr}.png`;
    fs.writeFileSync(path.join(imagesDir, filename), imgBuffer);
    return {
      id: `ai_dalle3_${category}_${idxStr}`,
      filename, filepath: path.join(imagesDir, filename),
      label: 'ai', source: 'dalle3', category,
      metadata: { generator_model: 'dall-e-3', revised_prompt: revisedPrompt || null, generated_at: new Date().toISOString(), size: '1024x1024', quality: 'standard' },
    };
  } catch (err) {
    if (attempt <= 3) { await sleep(attempt * 5000); return generateOne(item, imagesDir, attempt + 1); }
    console.log(`  Failed after 3 attempts: ${idxStr} - ${err.message}`);
    return null;
  }
}

async function runWithConcurrency(tasks, limit, fn) {
  const results = new Array(tasks.length);
  let i = 0;
  async function worker() { while (i < tasks.length) { const idx = i++; results[idx] = await fn(tasks[idx]); } }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  console.log('VeriSource DALL-E 3 Training Data Generator');
  console.log('============================================');
  console.log(`Target: ${BATCH_SIZE} images | Concurrency: ${CONCURRENCY}`);
  console.log(`Estimated cost: ${BATCH_SIZE} x $0.04 = $${(BATCH_SIZE * 0.04).toFixed(2)}`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const imagesDir = path.join(OUTPUT_DIR, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });

  const checkpointFile = path.join(OUTPUT_DIR, 'progress_checkpoint.json');
  let completed = [];
  if (fs.existsSync(checkpointFile)) {
    completed = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
    console.log(`Resuming from checkpoint: ${completed.length} already done`);
  }
  const completedIds = new Set(completed.map(r => r.id));
  const prompts = buildPromptList(BATCH_SIZE);
  const remaining = prompts.filter(p => !completedIds.has(`ai_dalle3_${p.category}_${String(p.index).padStart(4,'0')}`));
  console.log(`Remaining to generate: ${remaining.length}`);

  let done = completed.length;
  let failed = 0;

  await runWithConcurrency(remaining, CONCURRENCY, async (item) => {
    const result = await generateOne(item, imagesDir);
    if (result) {
      done++;
      completed.push(result);
      if (done % 10 === 0) {
        fs.writeFileSync(checkpointFile, JSON.stringify(completed, null, 2));
        console.log(`  Checkpoint: ${done}/${BATCH_SIZE}`);
      }
      console.log(`  [${done}/${BATCH_SIZE}] ${result.filename}`);
    } else { failed++; }
  });

  const metaFile = path.join(OUTPUT_DIR, 'dalle3_metadata.json');
  fs.writeFileSync(metaFile, JSON.stringify({ generated_at: new Date().toISOString(), total_downloaded: done, total_failed: failed, generator: 'dall-e-3', images: completed }, null, 2));
  if (fs.existsSync(checkpointFile)) fs.unlinkSync(checkpointFile);

  console.log(`Done! Generated: ${done} | Failed: ${failed}`);
  console.log(`Output: ${imagesDir}`);
  console.log(`Metadata: ${metaFile}`);
  console.log(`Next: run merge_training_data.js to add to your dataset`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
