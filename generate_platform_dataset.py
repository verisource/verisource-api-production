"""
VeriSource — Synthetic Platform Detection Dataset Generator v2.0
================================================================
Creates labeled training data for platform detection and compression
history analysis. Covers all major platforms + editing software
simulations applied BEFORE and AFTER platform compression.

Platforms covered:
  WhatsApp, Instagram Feed, Instagram Story, Facebook HQ, Facebook LQ,
  Twitter/X, Telegram, TikTok, iMessage, LinkedIn, Reddit, Screenshot

Editing software simulations (applied before platform compression):
  Photoshop, Lightroom, VSCO, Instagram Filters, Snapseed,
  Brightness/Contrast, Crop, Rotation, Sharpening, Noise Reduction

Chain operations (multi-step):
  Edited → Platform, Platform → Screenshot, Platform → Platform,
  Double compressed, Triple compressed

Output: /mnt/verisource/training-data/platform/synthetic/
Labels: /mnt/verisource/training-data/platform/synthetic/labels.json

Usage:
  python3 generate_platform_dataset.py
  python3 generate_platform_dataset.py --real-count 5000 --ai-count 5000
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
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
import piexif

# ─── Config ───────────────────────────────────────────────────

REAL_DIR = Path(os.environ.get('REAL_DIR', '/mnt/verisource/training-data/real'))
AI_DIR   = Path(os.environ.get('AI_DIR',  '/mnt/verisource/training-data/ai'))
OUT_DIR  = Path(os.environ.get('OUT_DIR', '/mnt/verisource/training-data/platform/synthetic'))

# ─── Platform Compression Profiles ───────────────────────────

PLATFORM_PROFILES = {

    'native': {
        'description': 'Original unprocessed image',
        'quality': None,
        'compression_gens': 1,
    },

    'whatsapp': {
        'description': 'WhatsApp photo compression',
        'quality': 72,
        'max_size': 1600,
        'strip_exif': True,
        'progressive': False,
        'subsampling': 2,
        'add_noise': True,
        'compression_gens': 2,
    },

    'instagram_feed': {
        'description': 'Instagram feed post',
        'quality': 85,
        'max_size': 1080,
        'target_width': 1080,
        'strip_exif': True,
        'progressive': False,
        'subsampling': 1,
        'compression_gens': 2,
    },

    'instagram_story': {
        'description': 'Instagram story',
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
        'strip_exif': False,
        'strip_gps': True,
        'progressive': True,
        'subsampling': 1,
        'compression_gens': 2,
    },

    'facebook_lq': {
        'description': 'Facebook low quality (mobile)',
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
        'force_jpeg': True,
        'compression_gens': 2,
    },

    'telegram': {
        'description': 'Telegram photo (least aggressive)',
        'quality': 90,
        'max_size': 1280,
        'strip_exif': False,
        'strip_gps': True,
        'progressive': False,
        'subsampling': 0,
        'compression_gens': 2,
    },

    'tiktok': {
        'description': 'TikTok image/thumbnail compression',
        'quality': 75,
        'target_width': 1080,
        'target_height': 1920,
        'strip_exif': True,
        'progressive': False,
        'subsampling': 2,
        'force_jpeg': True,
        'compression_gens': 2,
    },

    'imessage': {
        'description': 'iMessage photo compression',
        'quality': 85,
        'max_size': 1600,
        'strip_exif': False,
        'strip_gps': True,
        'progressive': False,
        'subsampling': 1,
        'compression_gens': 2,
    },

    'linkedin': {
        'description': 'LinkedIn profile/post image',
        'quality': 80,
        'max_size': 1200,
        'strip_exif': True,
        'progressive': True,
        'subsampling': 1,
        'compression_gens': 2,
    },

    'reddit': {
        'description': 'Reddit image compression',
        'quality': 85,
        'max_size': 1080,
        'strip_exif': True,
        'progressive': False,
        'subsampling': 1,
        'force_webp': False,
        'compression_gens': 2,
    },

    'screenshot': {
        'description': 'Screenshot of image on screen',
        'quality': 92,
        'max_size': None,
        'strip_exif': True,
        'progressive': False,
        'subsampling': 0,
        'screen_gamma': True,
        'add_screen_noise': True,
        'compression_gens': 2,
    },

    # ── Editing software simulations (before platform) ────────

    'photoshop_instagram': {
        'description': 'Edited in Photoshop then Instagram',
        'edit_software': 'photoshop',
        'base_platform': 'instagram_feed',
        'compression_gens': 3,
    },

    'lightroom_facebook': {
        'description': 'Edited in Lightroom then Facebook HQ',
        'edit_software': 'lightroom',
        'base_platform': 'facebook_hq',
        'compression_gens': 3,
    },

    'vsco_instagram': {
        'description': 'VSCO filter then Instagram',
        'edit_software': 'vsco',
        'base_platform': 'instagram_feed',
        'compression_gens': 3,
    },

    'snapseed_whatsapp': {
        'description': 'Snapseed edited then WhatsApp',
        'edit_software': 'snapseed',
        'base_platform': 'whatsapp',
        'compression_gens': 3,
    },

    'instagram_filter_feed': {
        'description': 'Instagram filter applied then posted',
        'edit_software': 'instagram_filter',
        'base_platform': 'instagram_feed',
        'compression_gens': 3,
    },

    'brightness_twitter': {
        'description': 'Brightness adjusted then Twitter',
        'edit_software': 'brightness_contrast',
        'base_platform': 'twitter',
        'compression_gens': 3,
    },

    'sharpened_linkedin': {
        'description': 'Sharpened then LinkedIn',
        'edit_software': 'sharpen',
        'base_platform': 'linkedin',
        'compression_gens': 3,
    },

    'noise_reduced_facebook': {
        'description': 'Noise reduced then Facebook',
        'edit_software': 'noise_reduction',
        'base_platform': 'facebook_hq',
        'compression_gens': 3,
    },

    # ── Cropping variants ─────────────────────────────────────

    'cropped_instagram': {
        'description': 'Cropped then Instagram',
        'crop_first': {'min_ratio': 0.7, 'max_ratio': 0.95},
        'base_platform': 'instagram_feed',
        'compression_gens': 3,
    },

    'cropped_whatsapp': {
        'description': 'Cropped then WhatsApp',
        'crop_first': {'min_ratio': 0.6, 'max_ratio': 0.9},
        'base_platform': 'whatsapp',
        'compression_gens': 3,
    },

    'rotated_facebook': {
        'description': 'Rotated then Facebook',
        'rotate_first': True,
        'base_platform': 'facebook_hq',
        'compression_gens': 3,
    },

    # ── Multi-generation chains ───────────────────────────────

    'double_compressed': {
        'description': 'Saved twice at different quality levels',
        'chain_profiles': [
            {'quality': 95, 'max_size': None, 'strip_exif': False, 'subsampling': 0},
            {'quality': 75, 'max_size': None, 'strip_exif': False, 'subsampling': 1},
        ],
        'compression_gens': 3,
    },

    'triple_compressed': {
        'description': 'Saved three times at different quality levels',
        'chain_profiles': [
            {'quality': 95, 'max_size': None, 'strip_exif': False, 'subsampling': 0},
            {'quality': 80, 'max_size': None, 'strip_exif': False, 'subsampling': 1},
            {'quality': 65, 'max_size': None, 'strip_exif': True, 'subsampling': 2},
        ],
        'compression_gens': 4,
    },

    'instagram_whatsapp': {
        'description': 'Instagram then shared via WhatsApp',
        'chain_keys': ['instagram_feed', 'whatsapp'],
        'compression_gens': 4,
    },

    'facebook_whatsapp': {
        'description': 'Facebook then shared via WhatsApp',
        'chain_keys': ['facebook_hq', 'whatsapp'],
        'compression_gens': 4,
    },

    'whatsapp_screenshot': {
        'description': 'WhatsApp then screenshotted',
        'chain_keys': ['whatsapp', 'screenshot'],
        'compression_gens': 4,
    },

    'tiktok_screenshot': {
        'description': 'TikTok then screenshotted',
        'chain_keys': ['tiktok', 'screenshot'],
        'compression_gens': 4,
    },


    'instagram_facebook': {
        'description': 'Instagram then reshared to Facebook',
        'chain_keys': ['instagram_feed', 'facebook_hq'],
        'compression_gens': 4,
    },

    'facebook_instagram': {
        'description': 'Facebook then reshared to Instagram',
        'chain_keys': ['facebook_hq', 'instagram_feed'],
        'compression_gens': 4,
    },

    'instagram_tiktok': {
        'description': 'Instagram then reshared to TikTok',
        'chain_keys': ['instagram_feed', 'tiktok'],
        'compression_gens': 4,
    },

    'tiktok_instagram': {
        'description': 'TikTok then reshared to Instagram',
        'chain_keys': ['tiktok', 'instagram_feed'],
        'compression_gens': 4,
    },

    'tiktok_facebook': {
        'description': 'TikTok then reshared to Facebook',
        'chain_keys': ['tiktok', 'facebook_hq'],
        'compression_gens': 4,
    },
    'edited_instagram_whatsapp': {
        'description': 'Edited → Instagram → WhatsApp (3-platform chain)',
        'edit_software': 'brightness_contrast',
        'chain_keys': ['instagram_feed', 'whatsapp'],
        'compression_gens': 5,
    },
}

# ─── Editing Software Simulations ────────────────────────────

def apply_editing_software(img, software):
    """Simulate editing software effects on image."""
    if software == 'photoshop':
        # Photoshop: slight sharpening, color grading, possible levels adjustment
        img = img.filter(ImageFilter.UnsharpMask(radius=0.5, percent=80, threshold=3))
        brightness = random.uniform(0.95, 1.1)
        contrast = random.uniform(0.95, 1.1)
        img = ImageEnhance.Brightness(img).enhance(brightness)
        img = ImageEnhance.Contrast(img).enhance(contrast)

    elif software == 'lightroom':
        # Lightroom: exposure, clarity, vibrance adjustments
        exposure = random.uniform(0.9, 1.15)
        clarity = random.uniform(1.0, 1.2)
        img = ImageEnhance.Brightness(img).enhance(exposure)
        img = ImageEnhance.Sharpness(img).enhance(clarity)
        saturation = random.uniform(0.95, 1.2)
        img = ImageEnhance.Color(img).enhance(saturation)

    elif software == 'vsco':
        # VSCO: film-like color grading, slight fade, tone adjustments
        img = ImageEnhance.Contrast(img).enhance(random.uniform(0.85, 1.05))
        img = ImageEnhance.Color(img).enhance(random.uniform(0.8, 1.1))
        # Slight fade effect
        arr = np.array(img, dtype=np.float32)
        arr = arr * 0.9 + 15  # Add slight lift/fade
        img = Image.fromarray(arr.clip(0, 255).astype(np.uint8))

    elif software == 'snapseed':
        # Snapseed: selective adjustments, structure, HDR-ish
        img = ImageEnhance.Sharpness(img).enhance(random.uniform(1.1, 1.5))
        img = ImageEnhance.Contrast(img).enhance(random.uniform(1.0, 1.2))

    elif software == 'instagram_filter':
        # Instagram filter: color cast, vignette, saturation boost
        img = ImageEnhance.Color(img).enhance(random.uniform(0.8, 1.4))
        img = ImageEnhance.Contrast(img).enhance(random.uniform(0.9, 1.2))
        # Add vignette effect
        arr = np.array(img, dtype=np.float32)
        h, w = arr.shape[:2]
        Y, X = np.ogrid[:h, :w]
        cx, cy = w / 2, h / 2
        dist = np.sqrt((X - cx)**2 + (Y - cy)**2) / np.sqrt(cx**2 + cy**2)
        vignette = 1 - (dist * 0.3).clip(0, 0.4)
        arr *= vignette[:, :, np.newaxis]
        img = Image.fromarray(arr.clip(0, 255).astype(np.uint8))

    elif software == 'brightness_contrast':
        brightness = random.uniform(0.75, 1.35)
        contrast = random.uniform(0.75, 1.35)
        img = ImageEnhance.Brightness(img).enhance(brightness)
        img = ImageEnhance.Contrast(img).enhance(contrast)

    elif software == 'sharpen':
        amount = random.uniform(1.2, 2.5)
        img = ImageEnhance.Sharpness(img).enhance(amount)

    elif software == 'noise_reduction':
        # Simulate AI noise reduction (slight blurring)
        radius = random.uniform(0.3, 0.8)
        img = img.filter(ImageFilter.GaussianBlur(radius=radius))

    return img


# ─── Image Processing ─────────────────────────────────────────

def load_image(path):
    try:
        img = Image.open(path).convert('RGB')
        if img.size[0] < 100 or img.size[1] < 100:
            return None
        return img
    except Exception:
        return None


def resize_image(img, max_size=None, target_width=None, target_height=None):
    w, h = img.size
    if target_width and target_height:
        ratio = min(target_width / w, target_height / h)
        return img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
    if target_width:
        ratio = target_width / w
        return img.resize((target_width, int(h * ratio)), Image.LANCZOS)
    if max_size and (w > max_size or h > max_size):
        ratio = min(max_size / w, max_size / h)
        return img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
    return img


def strip_exif_data(img, keep_some=False, strip_gps=False):
    try:
        if not keep_some:
            data = list(img.getdata())
            clean = Image.new(img.mode, img.size)
            clean.putdata(data)
            return clean
        return img
    except Exception:
        return img


def add_noise(img, intensity=0.3):
    arr = np.array(img, dtype=np.float32)
    noise = np.random.normal(0, intensity, arr.shape)
    return Image.fromarray((arr + noise).clip(0, 255).astype(np.uint8))


def apply_screen_gamma(img):
    arr = np.array(img, dtype=np.float32) / 255.0
    arr = np.power(arr, 1.0 / 2.2)
    return Image.fromarray((arr * 255).clip(0, 255).astype(np.uint8))


def random_crop(img, min_ratio, max_ratio):
    w, h = img.size
    ratio = random.uniform(min_ratio, max_ratio)
    nw, nh = int(w * ratio), int(h * ratio)
    left = random.randint(0, w - nw)
    top = random.randint(0, h - nh)
    return img.crop((left, top, left + nw, top + nh))


def apply_single_compression(img, params):
    """Apply a single compression step with given parameters."""
    if params.get('max_size') or params.get('target_width'):
        img = resize_image(img, params.get('max_size'),
                          params.get('target_width'), params.get('target_height'))
    if params.get('strip_exif'):
        img = strip_exif_data(img)
    if params.get('add_noise'):
        img = add_noise(img, 0.3)
    if params.get('add_screen_noise'):
        img = add_noise(img, 0.1)
    if params.get('screen_gamma'):
        img = apply_screen_gamma(img)
    quality = params.get('quality')
    if quality is None:
        return img
    buf = io.BytesIO()
    kwargs = {'format': 'JPEG', 'quality': quality,
              'progressive': params.get('progressive', False)}
    if params.get('subsampling') is not None:
        kwargs['subsampling'] = params['subsampling']
    img.save(buf, **kwargs)
    buf.seek(0)
    return Image.open(buf).convert('RGB')


def compress_image(img, profile_name, profile):
    """Apply full platform profile to image."""
    img = img.copy()

    # Handle chain via profile keys
    if 'chain_keys' in profile:
        # Apply editing software first if specified
        if 'edit_software' in profile:
            img = apply_editing_software(img, profile['edit_software'])
        for key in profile['chain_keys']:
            img = compress_image(img, key, PLATFORM_PROFILES[key])
        return img

    # Handle chain via raw profiles
    if 'chain_profiles' in profile:
        for params in profile['chain_profiles']:
            img = apply_single_compression(img, params)
        return img

    # Handle editing software + base platform
    if 'edit_software' in profile and 'base_platform' in profile:
        img = apply_editing_software(img, profile['edit_software'])
        base = PLATFORM_PROFILES[profile['base_platform']]
        return compress_image(img, profile['base_platform'], base)

    # Handle crop first + base platform
    if 'crop_first' in profile and 'base_platform' in profile:
        crop = profile['crop_first']
        img = random_crop(img, crop['min_ratio'], crop['max_ratio'])
        base = PLATFORM_PROFILES[profile['base_platform']]
        return compress_image(img, profile['base_platform'], base)

    # Handle rotate first + base platform
    if profile.get('rotate_first') and 'base_platform' in profile:
        angles = [90, 180, 270]
        img = img.rotate(random.choice(angles), expand=True)
        base = PLATFORM_PROFILES[profile['base_platform']]
        return compress_image(img, profile['base_platform'], base)

    # Native — no compression
    if profile.get('quality') is None:
        return img

    # Standard single-platform compression
    return apply_single_compression(img, profile)


# ─── Dataset Generation ───────────────────────────────────────

def get_source_files(real_dir, ai_dir, real_count, ai_count):
    real_files = []
    for ext in ('*.jpg', '*.jpeg', '*.png'):
        real_files.extend(list(Path(real_dir).rglob(ext)))
    real_files = [f for f in real_files if f.stat().st_size > 10000]
    random.seed(42)
    random.shuffle(real_files)
    real_files = real_files[:real_count]
    print(f"Real images selected: {len(real_files)}")

    ai_files = []
    ai_subdirs = [d for d in Path(ai_dir).iterdir() if d.is_dir()]
    per_subdir = max(1, ai_count // len(ai_subdirs)) if ai_subdirs else ai_count
    for subdir in ai_subdirs:
        files = []
        for ext in ('*.jpg', '*.jpeg', '*.png', '*.webp'):
            files.extend(list(subdir.glob(ext)))
        files = [f for f in files if f.stat().st_size > 5000]
        random.shuffle(files)
        ai_files.extend(files[:per_subdir])
    ai_files = ai_files[:ai_count]
    print(f"AI images selected: {len(ai_files)} from {len(ai_subdirs)} generators")

    return real_files, ai_files


def generate_dataset(args):
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    print('╔══════════════════════════════════════════════════╗')
    print('║  VeriSource Platform Detection Dataset v2.0     ║')
    print('╚══════════════════════════════════════════════════╝')
    print(f'\nReal images:  {args.real_count}')
    print(f'AI images:    {args.ai_count}')
    print(f'Variants:     {len(PLATFORM_PROFILES)}')
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

        for profile_name, profile in PLATFORM_PROFILES.items():
            try:
                processed_img = compress_image(img.copy(), profile_name, profile)
                platform_dir = out_dir / profile_name
                platform_dir.mkdir(exist_ok=True)
                filename = f'{source_type}_{src_hash}_{profile_name}.jpg'
                dest = platform_dir / filename
                processed_img.save(str(dest), format='JPEG', quality=95)

                labels.append({
                    'path': str(dest),
                    'platform': profile_name,
                    'source_type': source_type,
                    'source_path': str(src_path),
                    'compression_gens': profile.get('compression_gens', 1),
                    'is_chain': any(k in profile for k in ['chain_keys', 'chain_profiles', 'edit_software', 'crop_first', 'rotate_first']),
                    'has_edit': 'edit_software' in profile,
                    'description': profile.get('description', ''),
                })
            except Exception as e:
                failed += 1

        processed += 1
        if processed % 50 == 0:
            print(f'  Processed: {processed}/{len(all_sources)} | Failed: {failed}')

    labels_path = out_dir / 'labels.json'
    with open(labels_path, 'w') as f:
        json.dump({
            'total': len(labels),
            'platform_counts': dict(Counter(l['platform'] for l in labels)),
            'source_counts': dict(Counter(l['source_type'] for l in labels)),
            'compression_gen_counts': dict(Counter(str(l['compression_gens']) for l in labels)),
            'samples': labels,
        }, f, indent=2)

    print(f'\n╔══════════════════════════════════════════════════╗')
    print(f'║  Dataset Generation Complete!                   ║')
    print(f'╚══════════════════════════════════════════════════╝')
    print(f'\nTotal samples: {len(labels):,}')
    print(f'Failed:        {failed}')
    print(f'Labels:        {labels_path}')
    print(f'\nPlatform distribution:')
    counts = Counter(l['platform'] for l in labels)
    for platform, count in sorted(counts.items(), key=lambda x: -x[1]):
        print(f'  {platform}: {count}')
    print(f'\nCompression generation distribution:')
    gen_counts = Counter(l['compression_gens'] for l in labels)
    for gen, count in sorted(gen_counts.items()):
        print(f'  {gen} generations: {count}')


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--real-dir', default=str(REAL_DIR))
    parser.add_argument('--ai-dir', default=str(AI_DIR))
    parser.add_argument('--output', default=str(OUT_DIR))
    parser.add_argument('--real-count', type=int, default=5000)
    parser.add_argument('--ai-count', type=int, default=5000)
    return parser.parse_args()


if __name__ == '__main__':
    random.seed(42)
    np.random.seed(42)
    args = parse_args()
    generate_dataset(args)