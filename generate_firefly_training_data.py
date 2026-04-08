"""
VeriSource — Adobe Firefly Training Data Generator
====================================================
Generates photorealistic images via Adobe Firefly Services API (Image 4/5).
Saves to /mnt/verisource/training-data/ai/firefly/

Prerequisites:
  1. Adobe Developer Console account at developer.adobe.com
  2. Create a project → Add Firefly API → Generate OAuth Server-to-Server credentials
  3. Set environment variables:
     export FIREFLY_CLIENT_ID=your_client_id
     export FIREFLY_CLIENT_SECRET=your_client_secret

Usage:
  python3 generate_firefly_training_data.py
  python3 generate_firefly_training_data.py --count 2000 --concurrency 5

Cost: ~$0.04-0.08/image depending on plan
Time: ~33 minutes for 2,000 images at concurrency 5
"""

import os
import sys
import json
import time
import hashlib
import asyncio
import argparse
import requests
from pathlib import Path
from datetime import datetime, timedelta

# ─── Configuration ────────────────────────────────────────────

FIREFLY_CLIENT_ID     = os.environ.get('FIREFLY_CLIENT_ID', '')
FIREFLY_CLIENT_SECRET = os.environ.get('FIREFLY_CLIENT_SECRET', '')

TOKEN_URL    = 'https://ims-na1.adobelogin.com/ims/token/v3'
GENERATE_URL = 'https://firefly-api.adobe.io/v3/images/generate-async'
STATUS_URL   = 'https://firefly-api.adobe.io/v3/images/generate-async/{job_id}'
SCOPE        = 'openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis'

OUTPUT_DIR = Path(os.environ.get('OUTPUT_DIR', '/mnt/verisource/training-data/ai/firefly'))

# ─── Prompts ──────────────────────────────────────────────────

PORTRAIT_PROMPTS = [
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
    'Photorealistic passport-style photo of a white woman in her 30s, neutral expression, white background',
    'Photorealistic ID card photo of a Black man in his 40s, plain background, direct gaze',
    'Photorealistic driver license style photo of a Hispanic woman in her 20s, neutral background',
    'Photorealistic government ID style portrait of a Middle Eastern woman in her 30s, neutral expression',
    'Photorealistic employee ID badge photo of a white woman in her 40s, office background',
    'Photorealistic candid photo of an elderly man sitting on a park bench, natural light',
    'Photorealistic portrait of a Hispanic woman in window light, natural indoor setting',
]

VARIATIONS = [
    '',
    ' Shot on Canon EOS R5, 85mm lens, f/2.8.',
    ' Shot on Sony A7IV, photojournalism style.',
    ' Shot on iPhone 15 Pro, natural light.',
    ' High resolution, sharp details, natural lighting.',
    ' Documentary photography style, candid moment.',
]

# ─── Authentication ───────────────────────────────────────────

class FireflyAuth:
    def __init__(self, client_id, client_secret):
        self.client_id = client_id
        self.client_secret = client_secret
        self.access_token = None
        self.expires_at = None

    def get_token(self):
        # Return cached token if still valid (with 5 min buffer)
        if self.access_token and self.expires_at and datetime.now() < self.expires_at:
            return self.access_token

        resp = requests.post(TOKEN_URL, data={
            'grant_type': 'client_credentials',
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'scope': SCOPE,
        })
        resp.raise_for_status()
        data = resp.json()
        self.access_token = data['access_token']
        # Tokens are valid 24 hours, cache for 23h55m
        self.expires_at = datetime.now() + timedelta(hours=23, minutes=55)
        print('✅ Adobe access token obtained')
        return self.access_token

# ─── Image Generation ─────────────────────────────────────────

def submit_generation_job(prompt, auth):
    """Submit async image generation job, return job_id and status_url."""
    token = auth.get_token()
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-api-key': auth.client_id,
        'Authorization': f'Bearer {token}',
    }
    body = {
        'prompt': prompt,
        'n': 1,
        'size': {'width': 1024, 'height': 1024},
        'contentClass': 'photo',
        'styles': {
            'presets': ['photo'],
        },
    }
    resp = requests.post(GENERATE_URL, headers=headers, json=body, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data.get('jobId') or data.get('job_id'), data.get('statusUrl') or data.get('status_url')


def poll_job(job_id, status_url, auth, max_wait=120):
    """Poll job status until complete, return image URL."""
    token = auth.get_token()
    headers = {
        'Authorization': f'Bearer {token}',
        'x-api-key': auth.client_id,
    }

    start = time.time()
    while time.time() - start < max_wait:
        url = status_url or STATUS_URL.format(job_id=job_id)
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        status = data.get('status', '')

        if status == 'succeeded':
            outputs = data.get('result', {}).get('outputs', [])
            if outputs:
                return outputs[0].get('image', {}).get('url')
            return None
        elif status == 'failed':
            raise Exception(f"Job failed: {data.get('error', 'unknown error')}")

        time.sleep(2)

    raise Exception(f'Job timed out after {max_wait}s')


def download_image(url, dest_path, timeout=30):
    """Download image from pre-signed URL."""
    resp = requests.get(url, timeout=timeout, stream=True)
    resp.raise_for_status()
    data = resp.content
    if len(data) < 5000:
        raise Exception('Downloaded image too small')
    with open(dest_path, 'wb') as f:
        f.write(data)
    return len(data)


def generate_one(prompt, auth, output_dir, idx):
    """Full pipeline: submit → poll → download for one image."""
    import random
    variation = random.choice(VARIATIONS)
    full_prompt = prompt + variation

    uid = hashlib.md5(f'{full_prompt}{time.time()}{idx}'.encode()).hexdigest()[:12]
    dest = output_dir / f'firefly_{uid}.jpg'

    job_id, status_url = submit_generation_job(full_prompt, auth)
    if not job_id:
        raise Exception('No job ID returned')

    image_url = poll_job(job_id, status_url, auth)
    if not image_url:
        raise Exception('No image URL in response')

    size = download_image(image_url, dest)
    return dest, size

# ─── Main ─────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description='Adobe Firefly Training Data Generator')
    parser.add_argument('--count', type=int, default=2000, help='Number of images to generate')
    parser.add_argument('--output', default=str(OUTPUT_DIR), help='Output directory')
    parser.add_argument('--concurrency', type=int, default=3, help='Concurrent requests (max 5)')
    return parser.parse_args()


def main():
    args = parse_args()
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    print('╔══════════════════════════════════════════════════╗')
    print('║   VeriSource Adobe Firefly Generator            ║')
    print('╚══════════════════════════════════════════════════╝')

    if not FIREFLY_CLIENT_ID or not FIREFLY_CLIENT_SECRET:
        print('\n❌ Missing credentials. Set environment variables:')
        print('   export FIREFLY_CLIENT_ID=your_client_id')
        print('   export FIREFLY_CLIENT_SECRET=your_client_secret')
        print('\nGet credentials at: developer.adobe.com → Create Project → Add Firefly API')
        sys.exit(1)

    existing = list(output_dir.glob('firefly_*.jpg'))
    print(f'\nTarget:    {args.count} images')
    print(f'Existing:  {len(existing)} images')
    print(f'Output:    {output_dir}')
    print(f'Est. cost: ~${args.count * 0.05:.2f} ({args.count} images @ ~$0.05 each)\n')

    if len(existing) >= args.count:
        print('✅ Already at target!')
        return

    remaining = args.count - len(existing)
    auth = FireflyAuth(FIREFLY_CLIENT_ID, FIREFLY_CLIENT_SECRET)

    # Test auth
    try:
        auth.get_token()
    except Exception as e:
        print(f'❌ Authentication failed: {e}')
        sys.exit(1)

    import random
    done = 0
    failed = 0

    print(f'🚀 Generating {remaining} images with concurrency {args.concurrency}...\n')

    from concurrent.futures import ThreadPoolExecutor, as_completed

    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = {}
        prompt_idx = 0

        # Submit initial batch
        for i in range(min(args.concurrency, remaining)):
            prompt = PROMPTS[prompt_idx % len(PROMPTS)]
            prompt_idx += 1
            f = executor.submit(generate_one, prompt, auth, output_dir, i)
            futures[f] = i

        total_submitted = args.concurrency

        while futures:
            for future in as_completed(list(futures.keys())):
                idx = futures.pop(future)
                try:
                    dest, size = future.result()
                    done += 1
                    sys.stdout.write(f'\r✅ {done} ❌ {failed} | {done}/{remaining} | {size/1024:.0f}KB')
                    sys.stdout.flush()
                except Exception as e:
                    failed += 1
                    sys.stdout.write(f'\r✅ {done} ❌ {failed} | Failed: {str(e)[:50]}')
                    sys.stdout.flush()

                # Submit next if more needed
                if total_submitted < remaining:
                    prompt = PROMPTS[prompt_idx % len(PROMPTS)]
                    prompt_idx += 1
                    new_f = executor.submit(generate_one, prompt, auth, output_dir, total_submitted)
                    futures[new_f] = total_submitted
                    total_submitted += 1

                break  # Process one at a time to maintain concurrency

    print(f'\n\n╔══════════════════════════════════════════════════╗')
    print(f'║  Generation Complete!                            ║')
    print(f'╚══════════════════════════════════════════════════╝')
    print(f'\nGenerated: {done}')
    print(f'Failed:    {failed}')
    print(f'Total in dir: {len(list(output_dir.glob("firefly_*.jpg")))}')
    print(f'Est. cost: ~${done * 0.05:.2f}')


# Fix reference to PROMPTS
PROMPTS = PORTRAIT_PROMPTS

if __name__ == '__main__':
    main()