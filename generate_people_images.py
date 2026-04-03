"""
VeriSource — GPT Image 1 People Dataset Generator
==================================================
Generates photorealistic images of people for AI detection training.
Targets insurance fraud, identity fraud, and election integrity scenarios.

Output: /mnt/verisource/training-data/ai/
Metadata: /mnt/verisource/training-data/people_metadata.jsonl

Usage:
  OPENAI_API_KEY=sk-... python3 generate_people_images.py
  OPENAI_API_KEY=sk-... python3 generate_people_images.py --count 1000
  OPENAI_API_KEY=sk-... python3 generate_people_images.py --category portraits --count 200

Requirements:
  pip install openai requests
"""

import os
import sys
import json
import time
import random
import hashlib
import argparse
import requests
from pathlib import Path
from datetime import datetime

# ─── Configuration ───────────────────────────────────────────

OUTPUT_DIR = Path("/mnt/verisource/training-data/ai")
METADATA_FILE = Path("/mnt/verisource/training-data/people_metadata.jsonl")
CHECKPOINT_FILE = Path("/mnt/verisource/training-data/people_checkpoint.json")

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    print("❌ OPENAI_API_KEY environment variable not set")
    print("   Run: OPENAI_API_KEY=sk-... python3 generate_people_images.py")
    sys.exit(1)

MODEL = "gpt-image-1"
QUALITY = "high"  # HD quality
SIZE = "1024x1024"
MAX_RETRIES = 3
RETRY_DELAY = 10
RATE_LIMIT_DELAY = 2  # Seconds between requests

# ─── Prompt Library ──────────────────────────────────────────

PROMPTS = {

    "portraits": [
        "candid street photograph of a middle aged white man in casual clothes, shot on iPhone 14 Pro, natural daylight, slightly blurred background, unposed, photojournalism style, realistic",
        "candid photo of a hispanic woman in her 40s, outdoor natural light, smartphone photography, unposed expression, realistic skin texture, documentary style",
        "portrait of a black man in his 30s wearing a business casual shirt, office building exterior background, shot on Canon DSLR, natural light, professional but candid",
        "photo of an asian woman in her 50s standing outside a suburban home, overcast lighting, iPhone snapshot style, realistic, unposed",
        "candid photograph of an elderly white woman in a grocery store parking lot, fluorescent and natural mixed lighting, smartphone snapshot, realistic",
        "photo of a young hispanic man in his 20s outside an apartment building, morning light, shot on Android phone, candid, realistic facial features",
        "street photo of a middle aged black woman in professional attire walking on a sidewalk, urban background, candid, shot on iPhone, realistic",
        "portrait of a south asian man in his 40s standing in a home driveway, afternoon sunlight, Samsung Galaxy photo quality, unposed, realistic",
        "photo of a native american woman in her 30s outside a government building, overcast sky, photojournalism style, candid, realistic",
        "candid photo of a white man in his 60s in a hospital waiting room, indoor fluorescent lighting, smartphone photography, unposed, realistic",
        "photo of a young black woman in her 20s at a gas station, mixed lighting, candid iPhone snapshot, realistic skin texture",
        "portrait of a middle aged asian man outside a courthouse, overcast lighting, documentary photography style, candid expression, realistic",
        "candid photo of an elderly black man sitting on a park bench, natural outdoor lighting, smartphone snapshot style, relaxed expression, realistic",
        "portrait of a white woman in her 30s outside a coffee shop, morning light, candid street photography, realistic skin texture",
        "photo of a hispanic man in his 50s in a suburban backyard, afternoon sunlight, iPhone snapshot, relaxed unposed expression, realistic",
        "candid portrait of an asian woman in her 20s walking on a city street, natural daylight, documentary style, realistic",
        "photo of a middle aged white woman at a community center, indoor lighting, smartphone photo, candid, realistic",
        "portrait of a young south asian man outside a university building, overcast sky, candid, shot on DSLR, realistic",
        "candid photo of a black woman in her 60s in a library, mixed lighting, smartphone snapshot, unposed, realistic",
        "street portrait of a hispanic woman in her 20s in an urban setting, natural daylight, candid iPhone photo, realistic",
    ],

    "professional_headshots": [
        "professional headshot of a white woman in her 40s in a business suit, neutral gray background, studio lighting, corporate portrait style",
        "professional headshot of a black man in his 30s wearing a suit and tie, white background, confident expression, corporate photography",
        "professional portrait of a hispanic woman in her 50s in business attire, office building background slightly blurred, natural light",
        "corporate headshot of an asian man in his 40s in a dark suit, neutral background, professional studio lighting, realistic skin texture",
        "professional photo of a white man in his 30s in business casual attire, outdoor building background, natural light, LinkedIn style portrait",
        "headshot of a south asian woman in her 40s in professional attire, neutral background, warm studio lighting, corporate style",
        "professional portrait of a middle aged black woman in a blazer, government building exterior background, natural light, official style",
        "professional photo of a hispanic man in his 40s in suit and tie, courtroom or office background, formal lighting, attorney style",
        "headshot of an asian woman in her 30s in business attire, medical or corporate office background, professional lighting",
        "corporate headshot of an elderly white man in a suit, neutral background, professional studio lighting, executive style",
        "professional portrait of a young black woman in business attire, neutral background, warm lighting, entry level professional style",
        "headshot of a middle aged hispanic woman in a blazer, office background, natural window light, professional style",
        "corporate portrait of a white man in his 50s in business casual, outdoor urban background, natural light, senior executive style",
        "professional headshot of a south asian man in his 30s in suit, neutral gray background, studio lighting, corporate style",
        "LinkedIn style portrait of an asian man in his 50s in business attire, office background, natural light, professional expression",
        "professional headshot of a black woman in her 40s in a blazer, neutral background, even studio lighting, confident expression",
        "corporate photo of a white woman in her 60s in business suit, American flag in blurred background, official style",
        "professional portrait of a hispanic man in his 30s in business casual, modern office background, natural light",
        "headshot of an elderly asian woman in professional attire, neutral background, warm studio lighting, executive style",
        "corporate headshot of a native american man in his 40s in a suit, neutral background, professional lighting",
    ],

    "face_detection": [
        "close up portrait of a white man in his 40s, neutral expression, natural outdoor lighting, realistic skin texture, face clearly visible",
        "close up photo of a black woman in her 30s, slight smile, indoor natural light from window, realistic facial features",
        "face portrait of a hispanic man in his 50s, neutral expression, outdoor overcast lighting, realistic skin texture, candid",
        "close up of an asian woman in her 40s, relaxed expression, warm indoor lighting, realistic, face filling most of frame",
        "portrait of an elderly white woman, neutral expression, soft natural lighting, realistic skin texture, close up",
        "face photo of a young black man in his 20s, natural expression, outdoor daylight, realistic, candid portrait",
        "close up portrait of a south asian woman in her 30s, slight smile, studio style lighting, realistic skin texture",
        "face portrait of a middle aged hispanic woman, neutral expression, natural window light, realistic, close up",
        "close up photo of an elderly asian man, relaxed expression, soft indoor lighting, realistic skin texture",
        "portrait of a young white woman in her 20s, natural expression, outdoor morning light, realistic, face clearly visible",
        "face photo of a middle aged native american woman, neutral expression, natural outdoor lighting, realistic skin texture",
        "close up portrait of a black man in his 50s, relaxed expression, warm indoor lighting, realistic facial features",
        "face portrait of a young asian woman in her 20s, slight smile, natural daylight, realistic skin texture, candid",
        "close up photo of an elderly hispanic man, neutral expression, soft outdoor lighting, realistic, portrait style",
        "portrait of a white woman in her 50s, natural expression, indoor window light, realistic skin texture, close up",
        "face photo of a young south asian man in his 20s, relaxed expression, outdoor overcast lighting, realistic",
        "close up portrait of a middle aged black woman, slight smile, natural outdoor light, realistic skin texture",
        "face portrait of an elderly white man, neutral expression, soft studio style lighting, realistic, close up",
        "portrait of a young hispanic woman in her 20s, natural expression, warm indoor lighting, realistic skin texture",
        "close up photo of a middle aged asian man, relaxed expression, outdoor natural light, realistic facial features",
    ],

}

# Camera/style modifiers to add variety
STYLE_MODIFIERS = [
    "shot on iPhone 14 Pro",
    "Samsung Galaxy S23 photo",
    "Canon EOS DSLR",
    "candid smartphone photo",
    "photojournalism style",
    "documentary photography",
    "amateur photography",
    "professional photography",
]

# ─── OpenAI API ───────────────────────────────────────────────

def generate_image(prompt, image_id):
    """Generate a single image using GPT Image 1."""
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": MODEL,
        "prompt": prompt,
        "n": 1,
        "size": SIZE,
        "quality": QUALITY,
        "response_format": "url",
    }

    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(
                "https://api.openai.com/v1/images/generations",
                headers=headers,
                json=payload,
                timeout=60,
            )

            if response.status_code == 429:
                wait = RETRY_DELAY * (attempt + 1) * 2
                print(f"\n   ⚠️  Rate limited, waiting {wait}s...")
                time.sleep(wait)
                continue

            if response.status_code == 400:
                data = response.json()
                error = data.get("error", {}).get("message", "Unknown")
                print(f"\n   ❌ Content policy rejection: {error[:80]}")
                return None

            if response.status_code != 200:
                print(f"\n   ❌ API error {response.status_code}: {response.text[:100]}")
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY)
                continue

            data = response.json()
            image_url = data["data"][0]["url"]
            revised_prompt = data["data"][0].get("revised_prompt", prompt)
            return image_url, revised_prompt

        except requests.exceptions.Timeout:
            print(f"\n   ⚠️  Timeout on attempt {attempt + 1}")
            time.sleep(RETRY_DELAY)
        except Exception as e:
            print(f"\n   ⚠️  Error: {e}")
            time.sleep(RETRY_DELAY)

    return None


def download_image(url, filepath):
    """Download image from URL to filepath."""
    try:
        response = requests.get(url, timeout=30)
        if response.status_code == 200:
            with open(filepath, "wb") as f:
                f.write(response.content)
            return len(response.content)
        return None
    except Exception as e:
        print(f"\n   ❌ Download error: {e}")
        return None


# ─── Checkpoint System ────────────────────────────────────────

def load_checkpoint():
    if CHECKPOINT_FILE.exists():
        with open(CHECKPOINT_FILE) as f:
            return json.load(f)
    return {"completed": [], "total_generated": 0, "total_failed": 0}


def save_checkpoint(checkpoint):
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump(checkpoint, f, indent=2)


# ─── Main Generation ──────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="VeriSource People Image Generator")
    parser.add_argument("--count", type=int, default=1000, help="Total images to generate")
    parser.add_argument("--category", choices=list(PROMPTS.keys()) + ["all"], default="all")
    parser.add_argument("--resume", action="store_true", help="Resume from checkpoint")
    args = parser.parse_args()

    print("╔══════════════════════════════════════════════════╗")
    print("║   VeriSource People Image Generator             ║")
    print("║   Model: GPT Image 1 (HD quality)              ║")
    print("╚══════════════════════════════════════════════════╝")
    print(f"\nTarget:   {args.count} images")
    print(f"Category: {args.category}")
    print(f"Output:   {OUTPUT_DIR}")
    print(f"Cost est: ~${args.count * 0.08:.0f} USD")

    # Load checkpoint
    checkpoint = load_checkpoint() if args.resume else {"completed": [], "total_generated": 0, "total_failed": 0}
    completed_ids = set(checkpoint["completed"])
    print(f"Resume:   {len(completed_ids)} already completed")

    # Build prompt list
    if args.category == "all":
        active_prompts = PROMPTS
    else:
        active_prompts = {args.category: PROMPTS[args.category]}

    # Build full task list with IDs
    tasks = []
    for category, prompt_list in active_prompts.items():
        for i, prompt in enumerate(prompt_list):
            # Generate multiple variations per base prompt
            variations_needed = max(1, args.count // (len(prompt_list) * len(active_prompts)))
            for v in range(variations_needed):
                modifier = random.choice(STYLE_MODIFIERS)
                full_prompt = f"{prompt}, {modifier}"
                task_id = hashlib.md5(f"{category}_{i}_{v}".encode()).hexdigest()[:12]
                tasks.append({
                    "id": task_id,
                    "category": category,
                    "prompt": full_prompt,
                    "base_prompt": prompt,
                })

    # Shuffle for variety
    random.shuffle(tasks)
    tasks = tasks[:args.count]

    print(f"Tasks:    {len(tasks)} total ({len(tasks) - len(completed_ids)} remaining)")
    print("\nStarting generation...\n")

    generated = checkpoint["total_generated"]
    failed = checkpoint["total_failed"]
    start_time = time.time()

    for i, task in enumerate(tasks):
        if task["id"] in completed_ids:
            continue

        # Progress display
        pct = (i / len(tasks)) * 100
        elapsed = time.time() - start_time
        rate = generated / max(elapsed / 60, 0.01)
        sys.stdout.write(
            f"\r  [{i}/{len(tasks)}] ({pct:.1f}%) | "
            f"✅ {generated} | ❌ {failed} | "
            f"⚡ {rate:.1f}/min"
        )
        sys.stdout.flush()

        # Generate
        result = generate_image(task["prompt"], task["id"])

        if result is None:
            failed += 1
            checkpoint["total_failed"] = failed
            save_checkpoint(checkpoint)
            time.sleep(RATE_LIMIT_DELAY)
            continue

        image_url, revised_prompt = result

        # Save image
        filename = f"ai_gptimage1_{task['category']}_{task['id']}.jpg"
        filepath = OUTPUT_DIR / filename

        size = download_image(image_url, filepath)

        if size and size > 1000:
            generated += 1
            completed_ids.add(task["id"])
            checkpoint["completed"].append(task["id"])
            checkpoint["total_generated"] = generated

            # Save metadata
            metadata = {
                "filename": filename,
                "model": MODEL,
                "quality": QUALITY,
                "category": task["category"],
                "prompt": task["prompt"],
                "revised_prompt": revised_prompt,
                "label": "ai",
                "source": "gpt_image_1",
                "generated_at": datetime.utcnow().isoformat(),
                "file_size": size,
            }
            with open(METADATA_FILE, "a") as f:
                f.write(json.dumps(metadata) + "\n")

            save_checkpoint(checkpoint)
        else:
            failed += 1
            checkpoint["total_failed"] = failed

        time.sleep(RATE_LIMIT_DELAY)

    # Final summary
    print(f"\n\n╔══════════════════════════════════════════════════╗")
    print(f"║  Generation Complete!                           ║")
    print(f"╚══════════════════════════════════════════════════╝")
    print(f"\nGenerated: {generated}")
    print(f"Failed:    {failed}")
    print(f"Output:    {OUTPUT_DIR}")
    print(f"Metadata:  {METADATA_FILE}")
    elapsed_min = (time.time() - start_time) / 60
    print(f"Time:      {elapsed_min:.1f} minutes")
    print(f"Cost est:  ~${generated * 0.08:.2f} USD")


if __name__ == "__main__":
    main()