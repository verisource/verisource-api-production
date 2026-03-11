#!/usr/bin/env python3
import json, os, urllib.request, urllib.error, time, shutil
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

METADATA = '/workspace/training-data/metadata.json'
OUTPUT = '/workspace/training-data'
CONCURRENCY = 10
DALLE_DIR = '/mnt/verisource/dalle-training/images'

with open(METADATA) as f:
    data = json.load(f)

images = data['images']
print(f"Total images in metadata: {len(images)}")

for label in ['ai', 'real']:
    for split in ['train', 'val', 'test']:
        Path(f"{OUTPUT}/{split}/{label}").mkdir(parents=True, exist_ok=True)

def download_one(img):
    label = img['label']
    split = img.get('split', 'train')
    filename = img.get('filename') or img['id'] + '.jpg'
    dest = Path(f"{OUTPUT}/{split}/{label}/{filename}")
    if dest.exists():
        return 'skip', filename
    if img.get('source') == 'dalle3':
        local = Path(f"{DALLE_DIR}/{filename}")
        if local.exists():
            shutil.copy2(local, dest)
            return 'copy', filename
        return 'missing', filename
    url = img.get('url')
    if not url:
        return 'no_url', filename
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as r:
                dest.write_bytes(r.read())
            return 'ok', filename
        except Exception as e:
            if attempt == 2:
                return 'fail', f"{filename}: {e}"
            time.sleep(2 ** attempt)

done = skip = fail = copy = missing = 0
with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
    futures = {ex.submit(download_one, img): img for img in images}
    for i, future in enumerate(as_completed(futures)):
        status, name = future.result()
        if status == 'ok': done += 1
        elif status == 'skip': skip += 1
        elif status == 'copy': copy += 1
        elif status == 'missing': missing += 1
        else: fail += 1
        if (i+1) % 100 == 0:
            print(f"  [{i+1}/{len(images)}] ok:{done} copy:{copy} skip:{skip} fail:{fail} missing:{missing}")

print(f"Done! Downloaded:{done} Copied:{copy} Skipped:{skip} Failed:{fail} Missing:{missing}")
