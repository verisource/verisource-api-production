#!/usr/bin/env node
/**
 * VeriSource Training Data Generator — DALL·E 3 Batch
 * Generates photorealistic AI images for classifier training.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node generate_dalle_training_data.js
 *
 * Options (env vars):
 *   BATCH_SIZE=500              Total images to generate (default: 500)
 *   OUTPUT_DIR=./dalle-training Output directory (default: ./dalle-training)
 *   SUBMIT_ONLY=true            Submit batch job, skip polling/download
 *   BATCH_ID=batch_xxx          Download results from existing batch job
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OUTPUT_DIR = process.env.OUTPUT_DIR || './dalle-training';
const SUBMIT_ONLY = process.env.SUBMIT_ONLY === 'true';
const EXISTING_BATCH_ID = process.env.BATCH_ID;

const BATCH_SIZE = Number.parseInt(process.env.BATCH_SIZE ?? '500', 10);
if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE <= 0) {
  console.error('❌ BATCH_SIZE must be a positive integer');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY is required');
  process.exit(1);
}

// ============================================================
// PROMPT LIBRARY — Photorealistic, fraud/legal/insurance relevant
// ============================================================
const PROMPT_CATEGORIES = {
  // --- INSURANCE / PERSONAL INJURY ---
  car_accidents: [
    'Photorealistic photo of a two-car collision at a suburban intersection, airbags deployed, broken glass on asphalt, police car in background, daylight, documentary style',
    'Realistic photograph of a rear-end collision on a highway, crumpled bumpers, hazard lights on, driver standing beside vehicle, overcast sky',
    'Photorealistic image of a totaled SUV after rollover accident on a rural road, roof crushed, tire marks visible, golden hour lighting',
    'Realistic photo of a minor fender-bender in a parking lot, two cars with dented bumpers, driver exchanging information, shopping mall background',
    'Photorealistic crash scene showing a sedan that ran into a utility pole, deployed airbag visible through windshield, night scene with street lighting',
    'Realistic insurance photo of hail damage on a car roof and hood, multiple dents, suburban driveway, natural light',
    'Photorealistic photo of flood-damaged car interior, waterline visible on seats, muddy floor mats, open door showing street flooding outside',
    'Realistic photo of a motorcycle accident scene, bike on its side on asphalt, rider gear scattered, ambulance in background',
    'Photorealistic image of car fire on highway shoulder, thick smoke, fire extinguisher foam on ground, emergency vehicles present',
    'Realistic photo of a car with shattered windshield from falling tree branch, suburban street after storm',
  ],

  property_damage: [
    'Photorealistic photo of a house with fire damage, charred roof beams exposed, broken windows, fire hose on ground, daylight',
    'Realistic photograph of a flooded basement with furniture floating, water stain line on walls, insurance adjuster with clipboard',
    'Photorealistic image of a collapsed ceiling in a living room, debris on floor, water damage stains, natural light through window',
    'Realistic photo of storm damage to a roof, missing shingles, blue tarp partially installed, tree branch on rooftop',
    'Photorealistic picture of burst pipe water damage in a kitchen, warped laminate flooring, wet drywall, mold beginning to form',
    'Realistic insurance documentation photo of vandalized storefront, broken glass, graffiti on shutters, morning light',
    'Photorealistic image of tornado damage to a suburban home, one wall completely missing, furniture exposed, debris field',
    'Realistic photo of smoke damage in a bedroom, black soot on walls and ceiling, fire suppression residue on furniture',
    'Photorealistic picture of a sinkhole that swallowed part of a residential driveway and front lawn, suburban setting',
    'Realistic photo of earthquake damage to a brick building, cracked facade, fallen masonry on sidewalk, caution tape',
  ],

  personal_injury: [
    'Photorealistic medical photo of a bruised and swollen ankle injury, clinical lighting, white background, ruler for scale',
    'Realistic photo of a person with arm in a cast and sling sitting in a hospital waiting room, fluorescent lighting',
    'Photorealistic image of a laceration wound on a forearm being examined by a doctor in clinical gloves, medical setting',
    'Realistic photo of whiplash injury documentation, person wearing cervical collar, hospital gown, neutral expression',
    'Photorealistic picture of a slip and fall aftermath, wet floor sign next to person seated on floor in a grocery store',
    'Realistic medical documentation photo of a black eye and facial bruising, neutral expression, clinical background',
    'Photorealistic image of a construction worker with knee injury on a job site, sitting on lumber, other workers around',
    'Realistic photo of an injured pedestrian being helped by paramedics after being struck by a vehicle, crosswalk visible',
  ],

  workers_compensation: [
    'Photorealistic photo of a warehouse worker with back injury, holding lower back, stacked boxes in background, hard hat on ground',
    'Realistic image of a construction worker who fell from scaffolding, worker on ground, scaffolding visible above, coworkers around',
    'Photorealistic picture of a factory worker with hand injury, wrapped bandage, industrial machinery background, safety vest',
    'Realistic photo of a nurse with a needlestick injury in a hospital corridor, showing puncture mark on finger',
    'Photorealistic image of a delivery driver with package-related shoulder injury in a loading dock, holding shoulder in pain',
  ],

  // --- WAR AND CONFLICT ---
  war_documentary: [
    'Photorealistic documentary-style photo of destroyed urban buildings in a conflict zone, rubble and debris, smoke in distance, overcast sky',
    'Realistic war photojournalism image of soldiers in tactical gear moving through a damaged city street, dust and smoke',
    'Photorealistic photo of a bombed-out residential neighborhood, collapsed apartment buildings, personal belongings in rubble, golden hour',
    'Realistic documentary photo of military vehicles convoy on a damaged road through a war-affected town, civilian structures damaged',
    'Photorealistic image of a field hospital tent in a conflict zone, medical personnel treating patients, supply crates around',
    'Realistic war journalism photo of journalists with cameras and flak jackets at a press briefing near conflict zone, military in background',
    'Photorealistic image of a damaged bridge over a river in a conflict-affected area, blast marks visible, military checkpoint nearby',
    'Realistic documentary-style photo of burned-out military equipment on a dirt road, fields in background, overcast sky',
    'Photorealistic photo of civilians evacuating a war-damaged city, carrying belongings, damaged buildings on both sides of street',
    'Realistic documentary photo of unexploded ordnance disposal team working in a field, full protective gear, rural landscape',
  ],

  social_unrest: [
    'Photorealistic documentary photo of a protest march on a city street, large crowd, signs and banners, police line in background, daylight',
    'Realistic photojournalism image of riot police in formation facing protesters, smoke in the air, urban setting, dusk lighting',
    'Photorealistic photo of a building on fire during civil unrest, flames visible through windows, fire trucks on scene, crowd nearby',
    'Realistic documentary image of looted storefront after civil unrest, broken display cases, debris on floor, boarded windows outside',
    'Photorealistic photo of a National Guard deployment on a city street during curfew, empty streets, floodlights, tension visible',
    'Realistic photojournalism photo of a crowd surrounding an overturned police car, urban intersection, nighttime, street lights',
    'Photorealistic image of tear gas being deployed at a protest, white smoke clouds, protesters scattering, urban plaza',
    'Realistic documentary photo of graffiti-covered government building facade after protest, cleanup crews arriving',
    'Photorealistic photo of a peaceful candlelight vigil in a public square, large somber crowd, city hall background, night',
    'Realistic documentary image of barricaded downtown streets during political unrest, jersey barriers, military presence, abandoned vehicles',
  ],

  // --- FRAUD-SPECIFIC SCENARIOS ---
  fraud_scenarios: [
    'Photorealistic photo of a staged slip and fall scene in a grocery store, wet floor sign far from spill, security camera visible',
    'Realistic photo of a person faking injury in a minor car accident, holding neck dramatically, minimal vehicle damage visible',
    'Photorealistic image of two people appearing to discuss something near a minor parking lot fender-bender, both on phones',
    'Realistic photo of an exaggerated property damage claim scene, small water stain circled with marker, camera close-up',
    'Photorealistic image of a person with crutches walking normally when unobserved, surveillance-style candid photo, parking lot',
  ],

  // --- MEDICAL / HEALTHCARE ---
  medical: [
    'Photorealistic clinical photo of an X-ray being reviewed by a doctor on a lightboard, hospital setting, professional attire',
    'Realistic photo of a patient in a hospital bed with IV drip, monitors visible, medical staff in background, clinical lighting',
    'Photorealistic image of an MRI scan result being discussed between doctor and patient, consultation room, neutral lighting',
    'Realistic photo of a physical therapy session in progress, therapist working on patient knee, clinical rehabilitation setting',
    'Photorealistic picture of an emergency room triage area, multiple patients, nurses in scrubs, controlled chaos, fluorescent lighting',
  ],

  // --- FACES / IDENTITY (for deepfake training) ---
  realistic_portraits: [
    'Photorealistic portrait photo of a middle-aged man in business casual clothing, neutral expression, office background, natural lighting',
    'Realistic headshot photo of a woman in her 30s, professional attire, slight smile, blurred office background, DSLR quality',
    'Photorealistic candid photo of an elderly man sitting on a park bench, natural light, genuine expression, depth of field',
    'Realistic photo of a young woman in casual clothing at an outdoor cafe, candid style, natural lighting, shallow depth of field',
    'Photorealistic portrait of a diverse group of professionals in a conference room, business meeting setting, natural window light',
  ],
};

// ============================================================
// HELPERS
// ============================================================
function is2xx(status) {
  return status >= 200 && status < 300;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeErrorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

// ============================================================
// BUILD BATCH REQUESTS
// ============================================================
function buildBatchRequests(totalImages) {
  const requests = [];
  const allPrompts = [];

  for (const [category, prompts] of Object.entries(PROMPT_CATEGORIES)) {
    for (const prompt of prompts) {
      allPrompts.push({ category, prompt });
    }
  }

  console.log(`📝 Total unique prompts available: ${allPrompts.length}`);
  console.log(`🎯 Target images: ${totalImages}`);

  let idx = 0;
  while (requests.length < totalImages) {
    const { category, prompt } = allPrompts[idx % allPrompts.length];

    const variations = [
      '',
      ' Shot on Canon EOS R5, 85mm lens, f/2.8.',
      ' Shot on Sony A7IV, 35mm lens, photojournalism style.',
      ' High resolution, sharp details, natural lighting.',
      ' Documentary photography style, candid moment.',
      ' Professional photography, news wire quality.',
    ];

    const variation = variations[Math.floor(requests.length / allPrompts.length) % variations.length];
    const finalPrompt = prompt + variation;

    requests.push({
      custom_id: `verisource-${category}-${requests.length.toString().padStart(4, '0')}`,
      method: 'POST',
      url: '/v1/images/generations',
      body: {
        model: 'dall-e-3',
        prompt: finalPrompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
        response_format: 'url',
      },
    });

    idx += 1;
  }

  return requests;
}

// ============================================================
// OPENAI API HELPERS
// ============================================================
function apiRequest(method, endpoint, body, isMultipart = false) {
  return new Promise((resolve, reject) => {
    const data = isMultipart ? body : (body ? JSON.stringify(body) : null);

    const options = {
      hostname: 'api.openai.com',
      path: endpoint,
      method,
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        ...(isMultipart
          ? {
              'Content-Type': body.contentType,
              'Content-Length': body.buffer.length,
            }
          : (data
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(data),
                }
              : {})),
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];

      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: JSON.parse(raw),
          });
        } catch {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: raw,
          });
        }
      });
    });

    req.on('error', reject);

    if (isMultipart) {
      req.write(body.buffer);
    } else if (data) {
      req.write(data);
    }

    req.end();
  });
}

function httpGetBuffer(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error(`Too many redirects while downloading: ${url}`));
      return;
    }

    const client = url.startsWith('https://') ? https : http;

    const req = client.get(url, (res) => {
      const status = res.statusCode || 0;

      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = res.headers.location;
        if (!location) {
          reject(new Error(`Redirect without location header for: ${url}`));
          return;
        }

        const nextUrl = new URL(location, url).toString();
        res.resume();
        resolve(httpGetBuffer(nextUrl, redirectCount + 1));
        return;
      }

      if (status !== 200) {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const bodyPreview = Buffer.concat(chunks).toString('utf8').slice(0, 200);
          reject(new Error(`Download failed (${status}) for ${url}. Body: ${bodyPreview}`));
        });
        res.on('error', reject);
        return;
      }

      const contentType = String(res.headers['content-type'] || '');
      if (contentType && !contentType.startsWith('image/')) {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const bodyPreview = Buffer.concat(chunks).toString('utf8').slice(0, 200);
          reject(new Error(`Unexpected content-type "${contentType}" for ${url}. Body: ${bodyPreview}`));
        });
        res.on('error', reject);
        return;
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error', reject);
  });
}

async function downloadFileWithRetry(url, attempts = 3, baseDelayMs = 1500) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await httpGetBuffer(url);
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        const delay = baseDelayMs * attempt;
        console.log(`   ↻ Download retry ${attempt}/${attempts - 1} after ${delay}ms: ${sanitizeErrorMessage(err)}`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('🚀 VeriSource DALL·E Training Data Generator');
  console.log('============================================');

  if (EXISTING_BATCH_ID) {
    console.log(`📥 Downloading results for batch: ${EXISTING_BATCH_ID}`);
    await downloadBatchResults(EXISTING_BATCH_ID);
    return;
  }

  const requests = buildBatchRequests(BATCH_SIZE);
  console.log(`\n📦 Built ${requests.length} batch requests`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const batchFile = path.join(OUTPUT_DIR, 'batch_input.jsonl');
  fs.writeFileSync(batchFile, requests.map(r => JSON.stringify(r)).join('\n'));
  console.log(`✅ Wrote batch file: ${batchFile}`);

  // Approximate estimate only; pricing can change.
  const approximateCostPerImage = 0.04;
  const batchDiscountFactor = 0.5;
  const estimatedCost = requests.length * approximateCostPerImage * batchDiscountFactor;

  console.log('\n💰 Approximate cost estimate:');
  console.log(`   ${requests.length} images × $${approximateCostPerImage} × 50% batch discount = $${estimatedCost.toFixed(2)}`);
  console.log('   Note: verify against current OpenAI pricing before large runs.');

  console.log('\n📤 Uploading batch file to OpenAI...');

  const fileBuffer = fs.readFileSync(batchFile);
  const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;

  const formParts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nbatch\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="batch_input.jsonl"\r\nContent-Type: application/jsonl\r\n\r\n`,
  ];
  const formEnd = `\r\n--${boundary}--\r\n`;

  const formBuffer = Buffer.concat([
    Buffer.from(formParts[0]),
    Buffer.from(formParts[1]),
    fileBuffer,
    Buffer.from(formEnd),
  ]);

  const uploadRes = await apiRequest(
    'POST',
    '/v1/files',
    {
      contentType: `multipart/form-data; boundary=${boundary}`,
      buffer: formBuffer,
    },
    true
  );

  if (!is2xx(uploadRes.status)) {
    console.error('❌ File upload failed:', JSON.stringify(uploadRes.body, null, 2));
    process.exit(1);
  }

  const fileId = uploadRes.body?.id;
  if (!fileId) {
    console.error('❌ File upload succeeded but no file ID was returned');
    process.exit(1);
  }

  console.log(`✅ File uploaded: ${fileId}`);

  console.log('\n🚀 Submitting batch job...');
  const batchRes = await apiRequest('POST', '/v1/batches', {
    input_file_id: fileId,
    endpoint: '/v1/images/generations',
    completion_window: '24h',
    metadata: {
      project: 'verisource-training-data',
      generator: 'dall-e-3',
      version: '1.1',
      image_count: String(requests.length),
    },
  });

  if (!is2xx(batchRes.status)) {
    console.error('❌ Batch submission failed:', JSON.stringify(batchRes.body, null, 2));
    process.exit(1);
  }

  const batchId = batchRes.body?.id;
  if (!batchId) {
    console.error('❌ Batch submission succeeded but no batch ID was returned');
    process.exit(1);
  }

  console.log('\n✅ Batch job submitted!');
  console.log(`   Batch ID: ${batchId}`);
  console.log(`   Status:   ${batchRes.body.status}`);
  console.log('   Window:   24 hours');

  const trackingFile = path.join(OUTPUT_DIR, 'batch_tracking.json');
  fs.writeFileSync(
    trackingFile,
    JSON.stringify(
      {
        batch_id: batchId,
        file_id: fileId,
        submitted_at: new Date().toISOString(),
        image_count: requests.length,
        estimated_cost_usd: estimatedCost,
        status: 'submitted',
      },
      null,
      2
    )
  );

  console.log(`\n📋 Tracking info saved to: ${trackingFile}`);
  console.log('\nTo download results later, run:');
  console.log(`BATCH_ID=${batchId} OPENAI_API_KEY=... node generate_dalle_training_data.js`);

  if (!SUBMIT_ONLY) {
    console.log('\n⏳ Polling for completion (Ctrl+C to stop; resume later with BATCH_ID)...');
    await pollAndDownload(batchId);
  }
}

// ============================================================
// POLL + DOWNLOAD
// ============================================================
async function pollAndDownload(batchId) {
  let attempts = 0;
  const maxAttempts = 180; // 3 hours at 1-minute intervals

  while (attempts < maxAttempts) {
    await sleep(60_000);
    attempts += 1;

    const statusRes = await apiRequest('GET', `/v1/batches/${batchId}`, null);

    if (!is2xx(statusRes.status)) {
      console.log(`[${new Date().toLocaleTimeString()}] Warning: failed to fetch batch status (${statusRes.status})`);
      continue;
    }

    const batch = statusRes.body || {};
    const completed = batch.request_counts?.completed || 0;
    const total = batch.request_counts?.total || 0;
    const failed = batch.request_counts?.failed || 0;

    console.log(
      `[${new Date().toLocaleTimeString()}] Status: ${batch.status} | ${completed}/${total} complete | ${failed} failed`
    );

    if (batch.status === 'completed') {
      console.log('\n✅ Batch completed!');
      await downloadBatchResults(batchId, batch.output_file_id);
      return;
    }

    if (batch.status === 'failed' || batch.status === 'cancelled' || batch.status === 'expired') {
      console.error(`\n❌ Batch ${batch.status}:`, JSON.stringify(batch.errors || {}, null, 2));
      process.exit(1);
    }
  }

  console.log('\n⚠️ Polling timeout reached. The batch may still complete later.');
  console.log('Resume download with:');
  console.log(`BATCH_ID=${batchId} OPENAI_API_KEY=... node generate_dalle_training_data.js`);
}

async function downloadBatchResults(batchId, outputFileId) {
  if (!outputFileId) {
    const statusRes = await apiRequest('GET', `/v1/batches/${batchId}`, null);

    if (!is2xx(statusRes.status)) {
      console.error('❌ Failed to fetch batch status:', JSON.stringify(statusRes.body, null, 2));
      process.exit(1);
    }

    const batch = statusRes.body || {};
    if (batch.status !== 'completed') {
      console.log(`Batch status: ${batch.status} — not ready yet`);
      console.log(`Completed: ${batch.request_counts?.completed || 0}/${batch.request_counts?.total || 0}`);
      return;
    }

    outputFileId = batch.output_file_id;
  }

  if (!outputFileId) {
    console.error('❌ Batch completed but no output_file_id was returned');
    process.exit(1);
  }

  console.log(`\n📥 Downloading results file: ${outputFileId}`);
  const fileRes = await apiRequest('GET', `/v1/files/${outputFileId}/content`, null);

  if (!is2xx(fileRes.status)) {
    console.error('❌ Failed to download batch output file:', JSON.stringify(fileRes.body, null, 2));
    process.exit(1);
  }

  const rawContent = typeof fileRes.body === 'string' ? fileRes.body : JSON.stringify(fileRes.body);
  const lines = rawContent.split('\n').filter(Boolean);

  console.log(`📦 Processing ${lines.length} results...`);

  const imagesDir = path.join(OUTPUT_DIR, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });

  const metadataRecords = [];
  let downloaded = 0;
  let failed = 0;

  for (const line of lines) {
    try {
      const result = JSON.parse(line);

      if (result.error) {
        console.log(`⚠️  ${result.custom_id || 'unknown'}: ${result.error.message || JSON.stringify(result.error)}`);
        failed += 1;
        continue;
      }

      const imageUrl = result.response?.body?.data?.[0]?.url;
      const revisedPrompt = result.response?.body?.data?.[0]?.revised_prompt;

      if (!imageUrl) {
        console.log(`⚠️  ${result.custom_id || 'unknown'}: no image URL found in batch result`);
        failed += 1;
        continue;
      }

      const customId = String(result.custom_id || 'verisource-unknown-0000');
      const parts = customId.split('-');
      const category = parts.slice(1, -1).join('_') || 'unknown';
      const idx = parts[parts.length - 1] || '0000';

      const filename = `dalle3_${category}_${idx}.jpg`;
      const filepath = path.join(imagesDir, filename);

      const imgBuffer = await downloadFileWithRetry(imageUrl, 3, 1500);
      fs.writeFileSync(filepath, imgBuffer);
      downloaded += 1;

      metadataRecords.push({
        id: `ai_dalle3_${category}_${idx}`,
        filename,
        filepath,
        label: 'ai',
        source: 'dalle3',
        category,
        metadata: {
          generator_model: 'dall-e-3',
          revised_prompt: revisedPrompt || null,
          original_custom_id: customId,
          downloaded_at: new Date().toISOString(),
          size: '1024x1024',
          quality: 'standard',
        },
      });

      if (downloaded % 50 === 0) {
        console.log(`  ✅ Downloaded ${downloaded} images...`);
      }
    } catch (err) {
      console.log(`⚠️  Parse/download error: ${sanitizeErrorMessage(err)}`);
      failed += 1;
    }
  }

  const metaFile = path.join(OUTPUT_DIR, 'dalle3_metadata.json');
  fs.writeFileSync(
    metaFile,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        batch_id: batchId,
        total_downloaded: downloaded,
        total_failed: failed,
        generator: 'dall-e-3',
        images: metadataRecords,
      },
      null,
      2
    )
  );

  console.log('\n✅ Download complete!');
  console.log(`   Downloaded: ${downloaded} images`);
  console.log(`   Failed:     ${failed}`);
  console.log(`   Images dir: ${imagesDir}`);
  console.log(`   Metadata:   ${metaFile}`);
  console.log('\n📋 Next step: Run merge_training_data.js to add to your existing dataset');
}

main().catch(err => {
  console.error('❌ Fatal error:', sanitizeErrorMessage(err));
  process.exit(1);
});
