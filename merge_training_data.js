#!/usr/bin/env node
/**
 * VeriSource Training Data Merger
 * Merges newly generated DALL-E 3 images into existing training-data/metadata.json
 *
 * Usage:
 *   node merge_training_data.js
 *
 * Options (env vars):
 *   DALLE_DIR=./dalle-training
 *   METADATA_FILE=./training-data/metadata.json
 *   DRY_RUN=true
 */

const fs = require('fs');
const path = require('path');

const DALLE_DIR = process.env.DALLE_DIR || './dalle-training';
const METADATA_FILE = process.env.METADATA_FILE || './training-data/metadata.json';
const DRY_RUN = process.env.DRY_RUN === 'true';
const VAL_RATIO = 0.1;
const TEST_RATIO = 0.1;

function assignSplit(index, total) {
  const testCount = Math.floor(total * TEST_RATIO);
  const valCount = Math.floor(total * VAL_RATIO);
  if (index < testCount) return 'test';
  if (index < testCount + valCount) return 'val';
  return 'train';
}

async function main() {
  console.log('VeriSource Training Data Merger');
  console.log('================================');

  const existing = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
  const existingImages = existing.images || [];
  const existingIds = new Set(existingImages.map(i => i.id));

  console.log(`Existing images: ${existingImages.length}`);
  console.log(`  AI:   ${existingImages.filter(i => i.label === 'ai').length}`);
  console.log(`  Real: ${existingImages.filter(i => i.label === 'real').length}`);

  const dalleMetaFile = path.join(DALLE_DIR, 'dalle3_metadata.json');
  if (!fs.existsSync(dalleMetaFile)) {
    console.error(`❌ Not found: ${dalleMetaFile}`);
    console.error('   Run generate_dalle_training_data.js first');
    process.exit(1);
  }

  const dalleMeta = JSON.parse(fs.readFileSync(dalleMetaFile, 'utf8'));
  console.log(`\nDALL-E images available: ${dalleMeta.images.length}`);

  const newImages = dalleMeta.images.filter(img => !existingIds.has(img.id));
  const skipped = dalleMeta.images.length - newImages.length;
  if (skipped > 0) console.log(`Skipping ${skipped} duplicates`);

  const withSplits = newImages.map((img, idx) => ({
    id: img.id,
    url: null,
    local_path: img.filepath,
    filename: img.filename,
    label: 'ai',
    source: 'dalle3',
    downloadable: false,
    metadata: {
      generator_model: 'dall-e-3',
      category: img.category,
      revised_prompt: img.metadata?.revised_prompt || null,
      generated_at: img.metadata?.generated_at || new Date().toISOString(),
      size: img.metadata?.size || '1024x1024',
    },
    split: assignSplit(idx, newImages.length),
    split_key: img.id,
  }));

  const splitCounts = withSplits.reduce((acc, i) => { acc[i.split] = (acc[i.split] || 0) + 1; return acc; }, {});
  const catCounts = withSplits.reduce((acc, i) => { acc[i.metadata.category] = (acc[i.metadata.category] || 0) + 1; return acc; }, {});

  console.log(`\nNew images to add: ${withSplits.length}`);
  console.log('Splits:', splitCounts);
  console.log('Categories:');
  for (const [cat, count] of Object.entries(catCounts)) console.log(`  ${cat}: ${count}`);

  const merged = [...existingImages, ...withSplits];
  const newAI = merged.filter(i => i.label === 'ai').length;
  const newReal = merged.filter(i => i.label === 'real').length;

  console.log(`\nAfter merge: ${merged.length} total | AI: ${newAI} | Real: ${newReal}`);

  if (Math.abs(newAI - newReal) > 200) {
    console.log(`⚠️  Class imbalance: AI=${newAI}, Real=${newReal} — consider adding more real images`);
  }

  if (DRY_RUN) { console.log('\nDRY RUN — no files written'); return; }

  const backupFile = METADATA_FILE.replace('.json', `_backup_${Date.now()}.json`);
  fs.copyFileSync(METADATA_FILE, backupFile);
  console.log(`\nBacked up to: ${backupFile}`);

  fs.writeFileSync(METADATA_FILE, JSON.stringify({
    ...existing,
    updated_at: new Date().toISOString(),
    stats: { ...existing.stats, ai_total: newAI, real_total: newReal, total: merged.length, dalle3_added: withSplits.length },
    images: merged,
  }, null, 2));

  console.log(`✅ Merged metadata written to: ${METADATA_FILE}`);
  console.log('\nNext steps:');
  console.log('  1. Version weights: cp model.pt model_v1_civitai_only.pt');
  console.log('  2. Retrain with expanded dataset');
}

main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });