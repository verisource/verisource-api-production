"""
VeriSource — Synthetic Platform Detection Dataset Generator
============================================================
Creates labeled training data for platform detection and compression
history analysis by simulating social media platform processing.

For each source image (real + AI), generates:
  - native: original image (label: native)
  - whatsapp: WhatsApp compressed (label: whatsapp)
  - instagram_feed: Instagram feed compressed (label: instagram_feed)
  - instagram_story: Instagram story compressed (label: instagram_story)
  - facebook_hq: Facebook high quality (label: facebook_hq)
  - facebook_lq: Facebook low quality (label: facebook_lq)
  - twitter: Twitter/X compressed (label: twitter)
  - telegram: Telegram compressed (label: telegram)
  - screenshot: Screenshot simulation (label: screenshot)
  - edited_whatsapp: Edited then WhatsApp (label: edited_whatsapp) — chain
  - cropped_instagram: Cropped then Instagram (label: cropped_instagram) — chain
  - double_compressed: Saved twice at different quality (label: double_compressed)

Output: /mnt/verisource/training-data/platform/synthetic/
Labels: /mnt/verisource/training-data/platform/synthetic/labels.json

Usage:
  python3 generate_platform_dataset.py
  python3 generate_platform_dataset.py --real-count 5000 --ai-count 5000
  python3 generate_platform_dataset.py --real-dir /path/to/real --ai-dir /path/to/ai
"""

import os
import io
import json
import random
import argparse
import hashlib
from pathlib import Path
from collections import Counter

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
import piexif

# ─── Configuration ────────────────────────────────────────────

REAL_DIR = Path(os.environ.get('REAL_DIR', '/mnt/verisource/training-data/real'))
AI_DIR   = Path(os.environ.get('AI_DIR',  '/mnt/verisource/training-data/ai'))
OUT_DIR  = Path(os.environ.get('OUT_DIR', '/mnt/verisource/training-data/platform/synthetic'))

# ─── Platform Compression Profiles ───────────────────────────
# Based on academic research (VISION dataset paper + empirical measurements)
# Quality values, resize dimensions, and processing parameters per platform

PLATFORM_PROFILES = {

    'native': {
        'description': 'Original unprocessed image',
        'quality': None,  # No recompression
        'max_size': None,
        'strip_exif': False,
        'progressive': False,
        'subsampling': None,
        'compression_gens': 1,
    },

    'whatsapp': {
        'description': 'WhatsApp photo compression (most aggressive)',
        'quality': 72,
        'max_size': 1600,
        'strip_exif': True,
        'progressive': False,
        'subsampling': 2,  # 4:2:0 chroma subsampling
        'add_noise': True,  # WhatsApp adds slight DCT noise
        'compression_gens': 2,
    },

    'instagram_feed': {
        'description': 'Instagram feed post compression',
        'quality': 85,
        'max_size': 1080,
        'target_width': 1080,
        'strip_exif': True,
        'progressive': False,
        'subsampling': 1,  # 4:2:2
        'crop_square': False,  # Instagram allows non-square now
        'compression_gens': 2,
    },

    'instagram_story': {
        'description': 'Instagram story compression',
        'quality': 80,
        'target_width': 1080,
        'target_height': 1920,
        'strip_exif': True,
        'progressive': False,
        'subsampling': 1,
        'compression_gens': 2,
    },

    'facebook_hq': {
        'description': 'Facebook high quality upload',
        'quality': 85,
        'max_size': 2048,
        'strip_exif': False,  # Facebook keeps some EXIF
        'strip_gps': True,    # But strips GPS
        'progressive': True,  # Facebook uses progressive JPEG
        'subsampling': 1,
        'compression_gens': 2,
    },

    'facebook_lq': {
        'description': 'Facebook low quality (mobile/slow connection)',
        'quality': 70,
        'max_size': 960,
        'strip_exif': True,
        'progressive': True,
        'subsampling': 2,
        'compression_gens': 2,
    },

    'twitter': {
        'description': 'Twitter/X image compression',
        'quality': 80,
        'max_size': 1200,
        'strip_exif': True,
        'progressive': False,
        'subsampling': 1,
        'force_jpeg': True,  # Converts PNG to JPEG
        'compression_gens': 2,
    },

    'telegram': {
        'description': 'Telegram photo compression (least aggressive)',
        'quality': 90,
        'max_size': 1280,
        'strip_exif': False,  # Telegram preserves more metadata
        'strip_gps': True,
        'progressive': False,
        'subsampling': 0,  # 4:4:4 (higher quality)
        'compression_gens': 2,
    },

    'screenshot': {
        'description': 'Screenshot of image on screen',
        'quality': 92,
        'max_size': None,
        'strip_exif': True,
        'progressive': False,
        'subsampling': 0,
        'screen_gamma': True,  # Apply screen gamma correction
        'add_screen_noise': True,
        'compression_gens': 2,
    },

    # ── Chain operations (multi-step processing) ──────────────

    'edited_whatsapp': {
        'description': 'Brightness/contrast edited then WhatsApp compressed',
        'edit_first': {
            'brightness': (0.8, 1.3),  # Random brightness adjustment
            'contrast': (0.8, 1.3),    # Random contrast adjustment
        },
        'quality': 72,
        'max_size': 1600,
        'strip_exif': True,
        'progressive': False,
        'subsampling': 2,
        'compression_gens': 3,
    },

    'cropped_instagram': {
        'description': 'Cropped then Instagram compressed',
        'crop_first': {
            'min_ratio': 0.7,  # Keep at least 70% of image
            'max_ratio': 0.95,
        },
        'quality': 85,
        'max_size': 1080,
        'strip_exif': True,
        'progressive': False,
        'subsampling': 1,
        'compression_gens': 3,
    },

    'double_compressed': {
        'description': 'Saved twice at different JPEG quality levels',
        'first_quality': 95,   # First save at high quality
        'quality': 75,         # Second save at lower quality
        'max_size': None,
        'strip_exif': False,
        'progressive': False,
        'subsampling': 1,
        'compression_gens': 3,
    },

    'whatsapp_screenshot': {
        'description': 'Screenshot of WhatsApp image (3-generation chain)',
        'chain': ['whatsapp', 'screenshot'],
        'compression_gens': 4,
    },

    'instagram_whatsapp': {
        'description': 'Instagram then WhatsApp (common resharing chain)',
        'chain': ['instagram_feed', 'whatsapp'],
        'compression_gens': 4,
    },
}

# ─── Image Processing ─────────────────────────────────────────

def load_image(path):
    """Load image, convert to RGB."""
    try:
        img = Image.open(path).convert('RGB')
        if img.size[0] < 100 or img.size[1] < 100:
            return None
        return img
    except Exception:
        return None


def resize_image(img, max_size=None, target_width=None, target_height=None):
    """Resize image maintaining aspect ratio."""
    w, h = img.size

    if target_width and target_height:
        # Fit to target dimensions (story format)
        ratio = min(target_width / w, target_height / h)
        new_w = int(w * ratio)
        new_h = int(h * ratio)
        return img.resize((new_w, new_h), Image.LANCZOS)

    if target_width:
        ratio = target_width / w
        return img.resize((target_width, int(h * ratio)), Image.LANCZOS)

    if max_size and (w > max_size or h > max_size):
        ratio = min(max_size / w, max_size / h)
        return img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

    return img


def strip_exif(img, keep_some=False, strip_gps=False):
    """Strip EXIF data from image."""
    try:
        if not keep_some:
            # Full strip
            data = list(img.getdata())
            clean = Image.new(img.mode, img.size)
            clean.putdata(data)
            return clean
        elif strip_gps:
            # Strip GPS only
            try:
                exif_bytes = img.info.get('exif', b'')
                if exif_bytes:
                    exif_dict = piexif.load(exif_bytes)
                    exif_dict.pop('GPS', None)
                    return img
            except Exception:
                pass
        return img
    except Exception:
        return img


def apply_screen_gamma(img):
    """Simulate screen gamma for screenshot effect."""
    arr = np.array(img, dtype=np.float32) / 255.0
    arr = np.power(arr, 1.0 / 2.2)  # Apply sRGB gamma
    arr = (arr * 255).clip(0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def add_compression_noise(img, intensity=0.5):
    """Add subtle noise simulating compression artifacts."""
    arr = np.array(img, dtype=np.float32)
    noise = np.random.normal(0, intensity, arr.shape)
    arr = (arr + noise).clip(0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def apply_edit(img, brightness_range, contrast_range):
    """Apply random brightness/contrast edit."""
    brightness = random.uniform(*brightness_range)
    contrast = random.uniform(*contrast_range)
    img = ImageEnhance.Brightness(img).enhance(brightness)
    img = ImageEnhance.Contrast(img).enhance(contrast)
    return img


def random_crop(img, min_ratio, max_ratio):
    """Apply random crop to image."""
    w, h = img.size
    ratio = random.uniform(min_ratio, max_ratio)
    new_w = int(w * ratio)
    new_h = int(h * ratio)
    left = random.randint(0, w - new_w)
    top = random.randint(0, h - new_h)
    return img.crop((left, top, left + new_w, top + new_h))


def compress_image(img, profile):
    """Apply platform compression profile to image."""

    # Handle chain profiles
    if 'chain' in profile:
        result = img
        for step in profile['chain']:
            result = compress_image(result, PLATFORM_PROFILES[step])
        return result

    # Handle double compression
    if 'first_quality' in profile:
        buf = io.BytesIO()
        img.save(buf, format='JPEG', quality=profile['first_quality'],
                 subsampling=profile.get('subsampling', 1))
        buf.seek(0)
        img = Image.open(buf).convert('RGB')

    # Apply edits first if specified
    if 'edit_first' in profile:
        edit = profile['edit_first']
        img = apply_edit(img, edit.get('brightness', (1.0, 1.0)),
                        edit.get('contrast', (1.0, 1.0)))

    # Apply crop first if specified
    if 'crop_first' in profile:
        crop = profile['crop_first']
        img = random_crop(img, crop['min_ratio'], crop['max_ratio'])

    # Apply screen gamma for screenshots
    if profile.get('screen_gamma'):
        img = apply_screen_gamma(img)

    # Resize
    img = resize_image(
        img,
        max_size=profile.get('max_size'),
        target_width=profile.get('target_width'),
        target_height=profile.get('target_height'),
    )

    # Strip EXIF
    if profile.get('strip_exif'):
        img = strip_exif(img, keep_some=False)
    elif profile.get('strip_gps'):
        img = strip_exif(img, keep_some=True, strip_gps=True)

    # Apply WhatsApp-style noise
    if profile.get('add_noise'):
        img = add_compression_noise(img, intensity=0.3)

    # Add screen noise for screenshots
    if profile.get('add_screen_noise'):
        img = add_compression_noise(img, intensity=0.1)

    # Return as-is if native
    if profile.get('quality') is None:
        return img

    # Compress to JPEG with platform settings
    buf = io.BytesIO()
    save_kwargs = {
        'format': 'JPEG',
        'quality': profile['quality'],
        'progressive': profile.get('progressive', False),
    }
    if profile.get('subsampling') is not None:
        save_kwargs['subsampling'] = profile['subsampling']

    img.save(buf, **save_kwargs)
    buf.seek(0)
    return Image.open(buf).convert('RGB')


# ─── Dataset Generation ───────────────────────────────────────

def get_source_files(real_dir, ai_dir, real_count, ai_count):
    """Collect source image files."""
    real_files = []
    ai_files = []

    # Real images
    for ext in ('*.jpg', '*.jpeg', '*.png'):
        real_files.extend(list(Path(real_dir).rglob(ext)))
    real_files = [f for f in real_files if f.stat().st_size > 10000]
    random.seed(42)
    random.shuffle(real_files)
    real_files = real_files[:real_count]
    print(f"Real images selected: {len(real_files)}")

    # AI images — sample evenly from each generator
    ai_subdirs = [d for d in Path(ai_dir).iterdir() if d.is_dir()]
    per_subdir = max(1, ai_count // len(ai_subdirs)) if ai_subdirs else ai_count
    for subdir in ai_subdirs:
        files = list(subdir.glob('*.jpg')) + list(subdir.glob('*.jpeg')) + \
                list(subdir.glob('*.png')) + list(subdir.glob('*.webp'))
        files = [f for f in files if f.stat().st_size > 5000]
        random.shuffle(files)
        ai_files.extend(files[:per_subdir])
    ai_files = ai_files[:ai_count]
    print(f"AI images selected: {len(ai_files)} (from {len(ai_subdirs)} generators)")

    return real_files, ai_files


def generate_dataset(args):
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    print('╔══════════════════════════════════════════════════╗')
    print('║  VeriSource Platform Detection Dataset Generator ║')
    print('╚══════════════════════════════════════════════════╝')
    print(f'\nReal images:  {args.real_count} per platform variant')
    print(f'AI images:    {args.ai_count} per platform variant')
    print(f'Platforms:    {len(PLATFORM_PROFILES)} variants')
    print(f'Output:       {out_dir}')
    total = (args.real_count + args.ai_count) * len(PLATFORM_PROFILES)
    print(f'Total images: ~{total:,}\n')

    real_files, ai_files = get_source_files(
        args.real_dir, args.ai_dir, args.real_count, args.ai_count
    )

    labels = []
    processed = 0
    failed = 0

    all_sources = [('real', f) for f in real_files] + [('ai', f) for f in ai_files]

    for source_type, src_path in all_sources:
        img = load_image(src_path)
        if img is None:
            failed += 1
            continue

        src_hash = hashlib.md5(str(src_path).encode()).hexdigest()[:10]

        for platform_name, profile in PLATFORM_PROFILES.items():
            try:
                processed_img = compress_image(img.copy(), profile)

                # Save
                platform_dir = out_dir / platform_name
                platform_dir.mkdir(exist_ok=True)
                filename = f'{source_type}_{src_hash}_{platform_name}.jpg'
                dest = platform_dir / filename
                processed_img.save(str(dest), format='JPEG', quality=95)

                labels.append({
                    'path': str(dest),
                    'platform': platform_name,
                    'source_type': source_type,
                    'source_path': str(src_path),
                    'compression_gens': profile.get('compression_gens', 1),
                    'is_chain': 'chain' in profile or 'edit_first' in profile or 'crop_first' in profile,
                })

            except Exception as e:
                failed += 1
                continue

        processed += 1
        if processed % 100 == 0:
            print(f'  Processed: {processed}/{len(all_sources)} | Failed: {failed}')

    # Save labels
    labels_path = out_dir / 'labels.json'
    with open(labels_path, 'w') as f:
        json.dump({
            'total': len(labels),
            'platform_counts': dict(Counter(l['platform'] for l in labels)),
            'source_counts': dict(Counter(l['source_type'] for l in labels)),
            'compression_gen_counts': dict(Counter(l['compression_gens'] for l in labels)),
            'samples': labels,
        }, f, indent=2)

    print(f'\n╔══════════════════════════════════════════════════╗')
    print(f'║  Dataset Generation Complete!                   ║')
    print(f'╚══════════════════════════════════════════════════╝')
    print(f'\nTotal samples: {len(labels):,}')
    print(f'Failed:        {failed}')
    print(f'Labels saved:  {labels_path}')
    print(f'\nPlatform distribution:')
    for platform, count in sorted(Counter(l['platform'] for l in labels).items(), key=lambda x: -x[1]):
        print(f'  {platform}: {count}')


def parse_args():
    parser = argparse.ArgumentParser(description='VeriSource Platform Dataset Generator')
    parser.add_argument('--real-dir', default=str(REAL_DIR))
    parser.add_argument('--ai-dir', default=str(AI_DIR))
    parser.add_argument('--output', default=str(OUT_DIR))
    parser.add_argument('--real-count', type=int, default=5000)
    parser.add_argument('--ai-count', type=int, default=5000)
    return parser.parse_args()


if __name__ == '__main__':
    args = parse_args()
    generate_dataset(args)