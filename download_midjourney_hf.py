"""
VeriSource — Midjourney Training Data Downloader
=================================================
Downloads Midjourney V5/V6 images from Hugging Face dataset.
Source: ehristoforu/midjourney-images

Usage:
  pip install datasets pillow --break-system-packages -q
  python3 download_midjourney_hf.py
  python3 download_midjourney_hf.py --count 5000 --output /mnt/verisource/training-data/ai/midjourney

Requirements:
  pip install datasets pillow requests --break-system-packages
"""

import os
import sys
import time
import random
import hashlib
import argparse
import requests
from pathlib import Path
from io import BytesIO

def parse_args():
    parser = argparse.ArgumentParser(description='Midjourney HuggingFace Downloader')
    parser.add_argument('--count', type=int, default=5000,
                        help='Number of images to download (default: 5000)')
    parser.add_argument('--output', default='/mnt/verisource/training-data/ai/midjourney',
                        help='Output directory')
    parser.add_argument('--batch-size', type=int, default=50,
                        help='Download batch size')
    parser.add_argument('--skip-existing', action='store_true', default=True,
                        help='Skip already downloaded images')
    return parser.parse_args()

def download_image(url, dest_path, timeout=30):
    """Download a single image from URL."""
    try:
        headers = {
            'User-Agent': 'VeriSourceTraining/1.0 (verisource-training@verisource.io)',
        }
        response = requests.get(url, timeout=timeout, headers=headers, stream=True)
        if response.status_code != 200:
            return False, f'HTTP {response.status_code}'

        content_type = response.headers.get('content-type', '')
        if not content_type.startswith('image/'):
            return False, f'Not image: {content_type}'

        data = response.content
        if len(data) < 10000:  # Skip tiny/corrupt images
            return False, 'Too small'

        with open(dest_path, 'wb') as f:
            f.write(data)
        return True, None

    except Exception as e:
        return False, str(e)[:60]

def main():
    args = parse_args()
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print('╔══════════════════════════════════════════════════╗')
    print('║   VeriSource Midjourney Dataset Downloader      ║')
    print('╚══════════════════════════════════════════════════╝')
    print(f'\nTarget:   {args.count} images')
    print(f'Output:   {output_dir}')
    print(f'Source:   ehristoforu/midjourney-images (HuggingFace)\n')

    # Check existing
    existing = list(output_dir.glob('*.jpg')) + list(output_dir.glob('*.png')) + \
               list(output_dir.glob('*.webp'))
    print(f'Already downloaded: {len(existing)} images')

    if len(existing) >= args.count:
        print(f'✅ Already at target ({args.count}). Nothing to do.')
        return

    remaining = args.count - len(existing)
    print(f'Need to download: {remaining} more\n')

    # Load dataset
    print('📥 Loading Midjourney dataset from HuggingFace...')
    print('   (First run downloads metadata ~500MB, subsequent runs use cache)\n')

    try:
        from datasets import load_dataset
    except ImportError:
        print('❌ datasets library not found.')
        print('   Run: pip install datasets --break-system-packages')
        sys.exit(1)

    try:
        dataset = load_dataset(
            'ehristoforu/midjourney-images',
            split='train',
            streaming=True,  # Stream to avoid loading all into memory
        )
    except Exception as e:
        print(f'❌ Failed to load dataset: {e}')
        print('\nTrying alternative dataset...')
        try:
            dataset = load_dataset(
                'wanng/midjourney-v5-202304-clean',
                split='train',
                streaming=True,
            )
            print('✅ Using wanng/midjourney-v5-202304-clean instead')
        except Exception as e2:
            print(f'❌ Alternative also failed: {e2}')
            sys.exit(1)

    print('✅ Dataset loaded, starting downloads...\n')

    downloaded = 0
    failed = 0
    skipped = 0
    existing_names = set(f.stem for f in existing)

    for i, item in enumerate(dataset):
        if downloaded >= remaining:
            break

        # Get image URL — field names vary by dataset
        image_url = None
        for field in ['image_url', 'url', 'image', 'img_url', 'link']:
            if field in item and item[field]:
                val = item[field]
                # Handle PIL Image objects (non-streaming datasets)
                if hasattr(val, 'save'):
                    uid = hashlib.md5(f'{i}{time.time()}'.encode()).hexdigest()[:12]
                    dest = output_dir / f'midjourney_{uid}.jpg'
                    try:
                        val.save(str(dest), 'JPEG', quality=92)
                        downloaded += 1
                        sys.stdout.write(f'\r✅ {downloaded} ❌ {failed} ⏭️ {skipped} | {downloaded}/{remaining}')
                        sys.stdout.flush()
                    except Exception as e:
                        failed += 1
                    image_url = None
                    break
                elif isinstance(val, str) and val.startswith('http'):
                    image_url = val
                    break

        if image_url is None:
            skipped += 1
            continue

        # Generate filename from URL hash
        uid = hashlib.md5(image_url.encode()).hexdigest()[:12]
        ext = '.jpg'
        if '.png' in image_url.lower():
            ext = '.png'
        elif '.webp' in image_url.lower():
            ext = '.webp'

        filename = f'midjourney_{uid}{ext}'

        if args.skip_existing and uid in existing_names:
            skipped += 1
            continue

        dest = output_dir / filename
        success, err = download_image(image_url, dest)

        if success:
            downloaded += 1
            existing_names.add(uid)
        else:
            failed += 1

        sys.stdout.write(f'\r✅ {downloaded} ❌ {failed} ⏭️ {skipped} | {downloaded}/{remaining} | last err: {err or "none":<40}')
        sys.stdout.flush()

        # Small delay to be polite
        if downloaded % 100 == 0:
            time.sleep(1)

    print(f'\n\n╔══════════════════════════════════════════════════╗')
    print(f'║  Download Complete!                              ║')
    print(f'╚══════════════════════════════════════════════════╝')
    print(f'\nDownloaded: {downloaded}')
    print(f'Failed:     {failed}')
    print(f'Skipped:    {skipped}')
    print(f'Total in dir: {len(list(output_dir.glob("midjourney_*")))}')
    print(f'Output: {output_dir}')

if __name__ == '__main__':
    main()