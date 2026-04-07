"""
VeriSource AI Training Data Generator — Still Images
=====================================================
Generates photorealistic AI images for training data using:
  - Flux.1-dev (Black Forest Labs) — highest quality open source
  - SDXL Realistic Vision v4 — photorealistic Civitai fine-tune

Target scenarios: vehicle damage, property damage, portraits
Output: /mnt/verisource/training-data/ai/

Usage:
  python3 generate_still_images.py --model sdxl --scenario portrait --count 20000
  python3 generate_still_images.py --model sdxl --scenario property --count 40000
  python3 generate_still_images.py --model sdxl --scenario vehicle --count 40000
  python3 generate_still_images.py --model sdxl --scenario all --count 100000

Requirements:
  pip install diffusers transformers accelerate safetensors xformers --break-system-packages
"""

import os
import sys
import json
import time
import random
import argparse
import hashlib
from pathlib import Path
from datetime import datetime

import torch
from diffusers import (
    FluxPipeline,
    StableDiffusionXLPipeline,
    DPMSolverMultistepScheduler,
)

# ─── Configuration ───────────────────────────────────────────

OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "/mnt/verisource/training-data/ai"))
MODEL_CACHE_DIR = Path("/workspace/model-cache")
METADATA_FILE = Path("/mnt/verisource/training-data/generated_metadata.jsonl")

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.bfloat16 if torch.cuda.is_available() else torch.float32

print(f"Device: {DEVICE}")
if torch.cuda.is_available():
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f}GB")

# ─── Prompt Libraries ─────────────────────────────────────────

VEHICLE_DAMAGE_PROMPTS = [
    "photograph of a car with a small dent on the rear bumper, parking lot, natural light, insurance documentation",
    "photo of vehicle with cracked windshield from rock impact, realistic claim photo",
    "picture of car door dent from parking lot collision, close up, daylight",
    "image of front bumper damage on sedan, concrete parking structure, realistic",
    "photograph of side mirror broken off vehicle, street parking, natural light",
    "photo of scratched car door from keying, residential driveway, documentation style",
    "picture of vehicle with hail damage dimples on hood, driveway, overcast sky",
    "photograph of rear end collision damage, crumpled trunk, insurance assessment photo",
    "photo of car with deployed airbags visible through windshield, accident scene",
    "image of vehicle undercarriage damage from pothole, mechanic shop, realistic",
    "photograph of T-bone collision damage on driver door, intersection, realistic",
    "photo of car with front end damage from hitting deer, rural road, daylight",
    "picture of vehicle roof dented from fallen tree branch, residential street",
    "photograph of car with flood water damage interior, upholstery stained",
    "photo of stolen vehicle recovered, stripped interior, police documentation style",
    "close-up photograph of paint transfer on white car from collision, parking lot",
    "image of cracked tail light assembly on sedan, rear view, natural light",
    "photograph of car with blown tire damage to wheel well, highway shoulder",
    "photo of vehicle with vandalism damage, keyed hood, residential driveway",
    "picture of car with fire damage to engine compartment, parking lot",
    "photograph of multiple hail dents on car roof, neighborhood street, overcast",
    "insurance adjuster photographing vehicle damage with clipboard, parking lot",
    "close-up of crumpled car frame rail from front collision, mechanic shop",
    "photo of car bumper hanging off after low speed collision, parking structure",
    "picture of vehicle with broken glass from smash and grab theft, street",
    "photograph of car with suspension damage from curb strike, garage floor",
    "image of flood damaged vehicle interior with mud line visible, residential",
    "photo of car with damage inconsistent with claimed accident direction, suspicious",
    "picture of vehicle with fresh paint around allegedly old damage, suspicious repair",
    "photograph of rust around damage edges suggesting pre-existing condition, close-up",
]

PROPERTY_DAMAGE_PROMPTS = [
    "photograph of flooded basement with water damage to walls, residential home interior",
    "photo of water damaged ceiling with stains and sagging drywall, living room",
    "picture of bathroom with burst pipe water damage, realistic documentation photo",
    "image of kitchen with water damage from upstairs leak, realistic insurance claim photo",
    "photograph of hardwood floor with water damage buckling, residential interior",
    "photo of mold growth on wall from water damage, basement, realistic photo",
    "photograph of foundation crack with water seepage staining, basement wall",
    "photo of room with smoke damage on walls and ceiling, fire aftermath",
    "picture of kitchen with fire damage to cabinets and appliances, realistic",
    "image of exterior house wall with fire scorch marks, realistic documentation",
    "photograph of partially burned roof structure, fire damage, daylight photography",
    "photo of melted plastic and charred materials, kitchen fire scene",
    "photograph of roof with missing shingles after storm, drone perspective",
    "photo of house with tree fallen through roof, storm damage, residential",
    "picture of fence damaged by wind storm, backyard, realistic documentation",
    "image of broken windows from storm debris, residential home exterior",
    "photograph of flooded ground floor of home, hurricane damage, realistic",
    "photo of siding damage from hail storm, close up documentation quality",
    "picture of garage door crumpled from impact, residential driveway",
    "photograph of chimney damage from earthquake, realistic documentation",
    "photograph of broken door lock from forced entry, door frame damage visible",
    "photo of smashed window from break-in, residential home, glass on floor",
    "picture of vandalized exterior wall with spray paint, commercial building",
    "image of stolen air conditioning unit with exposed wiring, exterior wall",
    "insurance adjuster photographing property damage, clipboard visible, professional",
    "close-up photo of structural crack in foundation, measurement tape visible",
    "documentation photograph of water damage with moisture meter reading visible",
    "overhead drone photograph of roof storm damage, insurance documentation",
    "photo of collapsed ceiling drywall from water accumulation, residential",
    "picture of burst frozen pipe in wall cavity, plumber assessment photo",
]

PORTRAIT_PROMPTS = [
    # Professional headshots
    "photorealistic professional headshot of a white man in his 40s, suit and tie, neutral background, studio lighting",
    "photorealistic professional headshot of a Black woman in her 30s, business attire, grey background, studio lighting",
    "photorealistic professional headshot of an Asian man in his 50s, collared shirt, white background, soft lighting",
    "photorealistic professional headshot of a Latina woman in her 20s, blazer, professional smile, studio portrait",
    "photorealistic professional headshot of a Middle Eastern man in his 30s, business casual, neutral background",
    "photorealistic professional headshot of a South Asian woman in her 40s, formal attire, corporate portrait style",
    "photorealistic LinkedIn profile photo of a white woman in her 50s, confident expression, blurred office background",
    "photorealistic corporate headshot of a Black man in his 20s, suit jacket, warm studio lighting",
    "photorealistic headshot of an Asian woman in her 30s, blazer, clean white background, professional smile",
    "photorealistic professional portrait of a Hispanic man in his 40s, dress shirt, neutral grey background",
    # Candid portraits
    "photorealistic candid portrait of a young Asian woman smiling outdoors, natural daylight, bokeh background",
    "photorealistic casual photo of a white man in his 30s, outdoor setting, natural light",
    "photorealistic portrait of an elderly Black woman, warm smile, indoor natural lighting, close-up",
    "photorealistic candid photo of a Middle Eastern woman in her 40s, outdoor cafe setting",
    "photorealistic portrait of an elderly white man with beard and glasses, reading indoors",
    "photorealistic photo of a young South Asian man laughing, casual setting, natural light",
    "photorealistic candid portrait of a mixed-race woman in her 30s, park setting, afternoon light",
    "photorealistic portrait of an elderly Asian woman in her 70s, sitting by a window, soft natural light",
    # Social media style
    "photorealistic Instagram-style selfie of a young white woman, ring light, bedroom background",
    "photorealistic social media profile photo of a Black man in his 20s, casual outdoor setting",
    "photorealistic Facebook profile photo of a middle-aged Hispanic woman, family gathering background",
    "photorealistic selfie of an Asian teenage girl, natural light, neutral expression",
    "photorealistic social media photo of a young white man at a gym, athletic wear, confident pose",
    "photorealistic Instagram portrait of a South Asian woman in her 20s, coffee shop setting",
    "photorealistic Twitter profile photo of a white man in his 30s, casual outdoor background, candid smile",
    # ID and document style
    "photorealistic passport-style photo of a white woman in her 30s, neutral expression, white background",
    "photorealistic ID card photo of a Black man in his 40s, plain background, direct gaze",
    "photorealistic driver license style photo of a Hispanic woman in her 20s, neutral background",
    "photorealistic visa application photo of an Asian man in his 50s, formal attire, white background",
    "photorealistic government ID style portrait of a Middle Eastern woman in her 30s, neutral expression",
    "photorealistic passport photo of an elderly South Asian man, plain light background",
    "photorealistic employee ID badge photo of a white woman in her 40s, office background",
    # Age and demographic diversity
    "photorealistic photo of a Hispanic man in his 60s, outdoor setting, candid expression",
    "photorealistic portrait of a white woman in her 70s, warm smile, indoor natural lighting",
    "photorealistic candid photo of a South Asian man in his 80s, outdoor park setting",
    "photorealistic portrait of a white man in dramatic side lighting, artistic portrait style",
    "photorealistic photo of a Black woman in golden hour sunlight, outdoor portrait",
    "photorealistic portrait of an Asian woman under soft indoor lamp light, evening setting",
    "photorealistic photo of a Middle Eastern man in overcast outdoor lighting, candid style",
    "photorealistic portrait of a Hispanic woman in window light, natural indoor setting",
]

# Variations to append to prompts for diversity
QUALITY_VARIATIONS = [
    "",
    " Shot on Canon EOS R5, 85mm lens, f/2.8.",
    " Shot on Sony A7IV, 35mm lens, photojournalism style.",
    " Shot on iPhone 15 Pro, natural light.",
    " Shot on Samsung Galaxy S24, candid style.",
    " High resolution DSLR photograph, sharp details.",
    " Documentary photography style, candid moment.",
    " Professional photography, news wire quality.",
]

NEGATIVE_PROMPT = (
    "anime, cartoon, illustration, painting, drawing, render, CGI, 3D, "
    "oversaturated, unrealistic, fake looking, artificial, digital art, "
    "watermark, text, logo, signature, blurry, low quality, deformed"
)

# ─── Model Loading ────────────────────────────────────────────

def load_flux():
    print("\n📥 Loading Flux.1-dev...")
    pipe = FluxPipeline.from_pretrained(
        "black-forest-labs/FLUX.1-dev",
        torch_dtype=DTYPE,
        cache_dir=str(MODEL_CACHE_DIR),
    )
    pipe = pipe.to(DEVICE)
    pipe.enable_model_cpu_offload()
    print("✅ Flux.1-dev loaded")
    return pipe


def load_sdxl_realistic():
    print("\n📥 Loading SDXL RealVisXL V4...")
    pipe = StableDiffusionXLPipeline.from_pretrained(
        "SG161222/RealVisXL_V4.0",
        torch_dtype=DTYPE,
        cache_dir=str(MODEL_CACHE_DIR),
        use_safetensors=True,
    )
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config)
    pipe = pipe.to(DEVICE)
    try:
        pipe.enable_xformers_memory_efficient_attention()
    except Exception:
        pass
    print("✅ SDXL RealVisXL V4 loaded")
    return pipe


# ─── Generation Functions ─────────────────────────────────────

def generate_flux(pipe, prompt):
    result = pipe(
        prompt=prompt,
        height=1024,
        width=1024,
        num_inference_steps=28,
        guidance_scale=3.5,
    )
    return result.images[0]


def generate_sdxl(pipe, prompt):
    result = pipe(
        prompt=prompt,
        negative_prompt=NEGATIVE_PROMPT,
        height=1024,
        width=1024,
        num_inference_steps=30,
        guidance_scale=7.0,
    )
    return result.images[0]


def generate_batch(model_name, pipe, gen_fn, prompts, scenario, target_count):
    out_subdir = OUTPUT_DIR / scenario
    out_subdir.mkdir(parents=True, exist_ok=True)

    existing = list(out_subdir.glob(f"ai_{model_name}_*.jpg"))
    already_done = len(existing)
    remaining = target_count - already_done

    if remaining <= 0:
        print(f"✅ {scenario} already at target ({already_done} images)")
        return

    print(f"\n🎨 Generating {remaining} {scenario} images with {model_name}...")
    print(f"   Output: {out_subdir}")

    generated = 0
    failed = 0

    for i in range(remaining):
        prompt_base = prompts[i % len(prompts)]
        variation = random.choice(QUALITY_VARIATIONS)
        prompt = prompt_base + variation

        uid = hashlib.md5(f"{prompt}{time.time()}{random.random()}".encode()).hexdigest()[:12]
        out_path = out_subdir / f"ai_{model_name}_{uid}.jpg"

        try:
            image = gen_fn(pipe, prompt)
            image.save(str(out_path), "JPEG", quality=92)
            generated += 1

            # Save metadata
            with open(METADATA_FILE, "a") as f:
                f.write(json.dumps({
                    "file": str(out_path),
                    "model": model_name,
                    "scenario": scenario,
                    "prompt": prompt,
                    "timestamp": datetime.utcnow().isoformat(),
                    "label": "ai_generated"
                }) + "\n")

            sys.stdout.write(
                f"\r   [{generated + already_done}/{target_count + already_done}] "
                f"✅ {generated} generated | ❌ {failed} failed"
            )
            sys.stdout.flush()

        except Exception as e:
            failed += 1
            print(f"\n   ⚠️  Failed: {str(e)[:80]}")

    print(f"\n   ✅ Done: {generated} generated, {failed} failed")


# ─── Main ─────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="VeriSource Still Image Generator")
    parser.add_argument("--model", choices=["flux", "sdxl", "all"], default="sdxl",
                        help="Model to use for generation")
    parser.add_argument("--count", type=int, default=20000,
                        help="Total images to generate")
    parser.add_argument("--scenario", choices=["vehicle", "property", "portrait", "all"], default="all",
                        help="Which scenario to generate")
    args = parser.parse_args()

    scenarios = {
        "vehicle": VEHICLE_DAMAGE_PROMPTS,
        "property": PROPERTY_DAMAGE_PROMPTS,
        "portrait": PORTRAIT_PROMPTS,
    }

    active_scenarios = list(scenarios.keys()) if args.scenario == "all" else [args.scenario]
    count_per_scenario = args.count // len(active_scenarios)

    print("╔══════════════════════════════════════════════════╗")
    print("║   VeriSource Still Image Generator              ║")
    print("╚══════════════════════════════════════════════════╝")
    print(f"\nModel:     {args.model}")
    print(f"Count:     {args.count} total ({count_per_scenario} per scenario)")
    print(f"Scenarios: {', '.join(active_scenarios)}")
    print(f"Output:    {OUTPUT_DIR}")

    models_to_run = ["flux", "sdxl"] if args.model == "all" else [args.model]

    for model_name in models_to_run:
        pipe = load_flux() if model_name == "flux" else load_sdxl_realistic()
        gen_fn = generate_flux if model_name == "flux" else generate_sdxl

        for scenario in active_scenarios:
            generate_batch(model_name, pipe, gen_fn, scenarios[scenario], scenario, count_per_scenario)

        del pipe
        torch.cuda.empty_cache()
        print(f"\n🧹 Freed {model_name} VRAM")

    # Final counts
    print("\n╔══════════════════════════════════════════════════╗")
    print("║  Generation Complete!                           ║")
    print("╚══════════════════════════════════════════════════╝")
    for scenario in active_scenarios:
        count = len(list((OUTPUT_DIR / scenario).glob("ai_*.jpg")))
        print(f"  {scenario}: {count} images")


if __name__ == "__main__":
    main()