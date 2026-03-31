"""
VeriSource AI Training Data Generator — Still Images
=====================================================
Generates photorealistic AI images for training data using:
  - Flux.1-dev (Black Forest Labs) — highest quality open source
  - SDXL Realistic Vision v6 — photorealistic Civitai fine-tune
  - epiCRealism (SDXL) — hyper-realistic skin/detail

Target scenarios: vehicle damage, property damage (insurance fraud)
Output: /mnt/verisource/training-data/ai/ (alongside downloaded Civitai images)

Usage:
  python3 generate_still_images.py
  python3 generate_still_images.py --model flux --count 5000
  python3 generate_still_images.py --model sdxl --count 5000
  python3 generate_still_images.py --model all --count 10000

Requirements:
  pip install diffusers transformers accelerate safetensors xformers
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

OUTPUT_DIR = Path("/mnt/verisource/training-data/ai")
MODEL_CACHE_DIR = Path("/workspace/model-cache")
METADATA_FILE = Path("/mnt/verisource/training-data/generated_metadata.jsonl")

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.bfloat16 if torch.cuda.is_available() else torch.float32

print(f"Device: {DEVICE}")
print(f"GPU: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'}")
print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f}GB" if torch.cuda.is_available() else "")

# ─── Prompt Library ──────────────────────────────────────────
# Focused on insurance fraud scenarios:
# Vehicle damage and property damage
# Prompts designed to be photorealistic and forensically convincing

VEHICLE_DAMAGE_PROMPTS = [
    # Minor damage
    "photograph of a car with a small dent on the rear bumper, parking lot, natural daylight, photorealistic",
    "photo of sedan with scratched door panel, street parking, overcast lighting, realistic",
    "picture of SUV with cracked tail light, driveway, afternoon sun, photographic quality",
    "image of pickup truck with minor front bumper damage, gas station, fluorescent lighting",
    "photo of hatchback with keyed door scratch, suburban street, morning light, realistic",
    "photograph of car hood with hail damage dents, residential driveway, overcast sky",
    "picture of vehicle side mirror broken off, parking garage, artificial lighting",
    "photo of car windshield with crack from rock chip, highway rest stop, bright daylight",
    
    # Moderate damage
    "photograph of car with significant front end collision damage, intersection, police present",
    "photo of vehicle with deployed airbags visible through windshield, accident scene",
    "picture of crumpled car door from sideswipe collision, suburban road, realistic",
    "image of SUV with rear end collision damage, highway shoulder, emergency lights",
    "photo of sedan with smashed front bumper and hood damage, parking lot incident",
    "photograph of vehicle undercarriage damage visible, car elevated, mechanic shop",
    "picture of car with broken windshield from accident, roadside, daylight realistic",
    "photo of truck with bed damage and dented tailgate, construction site",
    
    # Severe damage
    "photograph of totaled vehicle after rollover accident, roadside, emergency services",
    "photo of car with severe flood damage, interior visible, parking lot aftermath",
    "picture of vehicle fire damage, charred exterior, residential street",
    "image of car crushed by fallen tree, residential driveway, storm aftermath",
    "photograph of vehicle submerged in flood water up to windows, street flooding",
    "photo of car hit by another vehicle, significant structural damage, accident scene",
    
    # Documentation style (matching actual insurance claim photos)
    "close-up photograph of car dent for insurance documentation, white background card visible",
    "insurance claim photo of vehicle damage, measurement ruler visible, professional documentation",
    "photo of car damage with hand pointing to affected area, claim documentation style",
    "overhead view photograph of vehicle roof hail damage, insurance assessment",
    "multiple angle documentation photos of car bumper damage, insurance claim format",
    "close up of VIN plate next to car damage, insurance documentation, natural light",
    
    # Staged/suspicious scenarios (important for fraud detection training)
    "photograph of car with fresh paint around allegedly old damage, suspicious repair",
    "photo of vehicle damage that appears inconsistent with reported accident direction",
    "picture of car with damage on wrong side for claimed collision scenario",
    "image of vehicle with rust around damage edges suggesting pre-existing condition",
]

PROPERTY_DAMAGE_PROMPTS = [
    # Water damage
    "photograph of flooded basement with water damage to walls, residential home interior",
    "photo of water damaged ceiling with stains and sagging drywall, living room",
    "picture of bathroom with burst pipe water damage, realistic documentation photo",
    "image of kitchen with water damage from upstairs leak, realistic insurance claim photo",
    "photograph of hardwood floor with water damage buckling, residential interior",
    "photo of water damaged personal property, living room flooding aftermath",
    "picture of mold growth on wall from water damage, basement, realistic photo",
    "photograph of foundation crack with water seepage staining, basement wall",
    
    # Fire damage
    "photograph of room with smoke damage on walls and ceiling, fire aftermath",
    "photo of kitchen with fire damage to cabinets and appliances, realistic",
    "picture of exterior house wall with fire scorch marks, realistic documentation",
    "image of partially burned roof structure, fire damage, daylight photography",
    "photograph of melted plastic and charred materials, kitchen fire scene",
    
    # Storm and structural damage
    "photograph of roof with missing shingles after storm, aerial perspective",
    "photo of house with tree fallen through roof, storm damage, residential",
    "picture of fence damaged by wind storm, backyard, realistic documentation",
    "image of broken windows from storm debris, residential home exterior",
    "photograph of flooded ground floor of home, hurricane damage, realistic",
    "photo of siding damage from hail storm, close up documentation quality",
    "picture of garage door crumpled from impact, residential driveway",
    "photograph of chimney damage from earthquake, realistic documentation",
    
    # Theft and vandalism
    "photograph of broken door lock from forced entry, door frame damage visible",
    "photo of smashed window from break-in, residential home, glass on floor",
    "picture of vandalized exterior wall with spray paint, commercial building",
    "image of stolen air conditioning unit with exposed wiring, exterior wall",
    
    # Documentation style
    "insurance adjuster photographing property damage, clipboard visible, professional",
    "close-up photo of structural crack in foundation, measurement tape visible",
    "documentation photograph of water damage with moisture meter reading visible",
    "multiple angle property damage documentation, professional assessment style",
    "overhead drone photograph of roof storm damage, insurance documentation",
]

# Negative prompts to avoid obviously AI-looking outputs
NEGATIVE_PROMPT = (
    "anime, cartoon, illustration, painting, drawing, render, CGI, 3D, "
    "oversaturated, unrealistic, fake looking, artificial, digital art, "
    "watermark, text, logo, signature, blurry, low quality, deformed"
)

# ─── Model Loading ────────────────────────────────────────────

def load_flux():
    print("\n📥 Loading Flux.1-dev...")
    print("   First run will download ~24GB model weights")
    print("   Subsequent runs load from cache")
    
    pipe = FluxPipeline.from_pretrained(
        "black-forest-labs/FLUX.1-dev",
        torch_dtype=DTYPE,
        cache_dir=str(MODEL_CACHE_DIR),
    )
    pipe = pipe.to(DEVICE)
    pipe.enable_model_cpu_offload()  # Manages VRAM automatically
    
    print("   ✅ Flux.1-dev loaded")
    return pipe


def load_sdxl_realistic():
    print("\n📥 Loading SDXL Realistic Vision v6...")
    print("   First run will download ~7GB model weights")
    
    pipe = StableDiffusionXLPipeline.from_pretrained(
        "SG161222/RealVisXL_V4.0",
        torch_dtype=DTYPE,
        cache_dir=str(MODEL_CACHE_DIR),
        use_safetensors=True,
    )
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config)
    pipe = pipe.to(DEVICE)
    
    # Memory optimization
    pipe.enable_xformers_memory_efficient_attention()
    
    print("   ✅ SDXL Realistic Vision loaded")
    return pipe


# ─── Generation Functions ─────────────────────────────────────

def generate_flux(pipe, prompt, seed=None):
    if seed is None:
        seed = random.randint(0, 2**32 - 1)
    
    generator = torch.Generator(device=DEVICE).manual_seed(seed)
    
    result = pipe(
        prompt=prompt,
        height=768,
        width=1024,
        guidance_scale=3.5,
        num_inference_steps=28,
        generator=generator,
        max_sequence_length=512,
    )
    
    return result.images[0], seed


def generate_sdxl(pipe, prompt, seed=None):
    if seed is None:
        seed = random.randint(0, 2**32 - 1)
    
    generator = torch.Generator(device=DEVICE).manual_seed(seed)
    
    result = pipe(
        prompt=prompt,
        negative_prompt=NEGATIVE_PROMPT,
        height=768,
        width=1024,
        guidance_scale=7.0,
        num_inference_steps=30,
        generator=generator,
    )
    
    return result.images[0], seed


# ─── Image Saving ─────────────────────────────────────────────

def save_image(image, model_name, prompt, seed, scenario):
    # Generate unique filename from content hash
    timestamp = int(time.time() * 1000)
    unique_id = hashlib.md5(f"{model_name}_{seed}_{timestamp}".encode()).hexdigest()[:12]
    filename = f"ai_{model_name}_{scenario}_{unique_id}.jpg"
    filepath = OUTPUT_DIR / filename
    
    image.save(str(filepath), "JPEG", quality=92)
    
    # Save metadata
    metadata = {
        "filename": filename,
        "model": model_name,
        "prompt": prompt,
        "seed": seed,
        "scenario": scenario,
        "label": "ai",
        "source": f"local_{model_name}",
        "generated_at": datetime.utcnow().isoformat(),
        "width": image.width,
        "height": image.height,
    }
    
    with open(str(METADATA_FILE), "a") as f:
        f.write(json.dumps(metadata) + "\n")
    
    return filepath


# ─── Main Generation Loop ─────────────────────────────────────

def generate_batch(model_name, pipe, generate_fn, prompts, scenario, 
                   target_count, start_idx=0):
    
    generated = 0
    failed = 0
    
    print(f"\n🎨 Generating {target_count} {scenario} images with {model_name}...")
    print(f"   Output: {OUTPUT_DIR}")
    
    # Check existing count for incremental mode
    existing = list(OUTPUT_DIR.glob(f"ai_{model_name}_{scenario}_*.jpg"))
    if len(existing) >= target_count:
        print(f"   ✅ Already have {len(existing)} images, skipping")
        return len(existing)
    
    remaining = target_count - len(existing)
    print(f"   Existing: {len(existing)} | Need: {remaining} more")
    
    prompt_cycle = prompts.copy()
    random.shuffle(prompt_cycle)
    prompt_idx = 0
    
    while generated < remaining:
        prompt = prompt_cycle[prompt_idx % len(prompt_cycle)]
        prompt_idx += 1
        
        # Add variety by appending random quality modifiers
        quality_mods = [
            ", shot on iPhone 14 Pro",
            ", taken with Samsung Galaxy S23",
            ", photographed with Canon DSLR",
            ", smartphone photo",
            ", taken from above",
            ", eye level perspective",
            ", close up detail shot",
            ", wide angle documentation photo",
        ]
        full_prompt = prompt + random.choice(quality_mods)
        
        try:
            image, seed = generate_fn(pipe, full_prompt)
            filepath = save_image(image, model_name, full_prompt, seed, scenario)
            generated += 1
            
            total_done = len(existing) + generated
            pct = (total_done / target_count) * 100
            
            sys.stdout.write(
                f"\r   [{model_name}:{scenario}] {total_done}/{target_count} "
                f"({pct:.1f}%) | Failed: {failed}"
            )
            sys.stdout.flush()
            
        except Exception as e:
            failed += 1
            if failed <= 5:
                print(f"\n   ⚠️  Generation error: {e}")
            continue
        
        # Periodic VRAM cleanup
        if generated % 50 == 0:
            torch.cuda.empty_cache()
    
    print(f"\n   ✅ Done: {generated} generated, {failed} failed")
    return generated


def main():
    parser = argparse.ArgumentParser(description="VeriSource AI Image Generator")
    parser.add_argument("--model", choices=["flux", "sdxl", "all"], default="all",
                        help="Which model to use")
    parser.add_argument("--count", type=int, default=10000,
                        help="Total images to generate per model")
    parser.add_argument("--scenario", choices=["vehicle", "property", "all"], default="all",
                        help="Which scenario to generate")
    args = parser.parse_args()

    total_per_scenario = args.count // 2 if args.scenario == "all" else args.count

    print("╔══════════════════════════════════════════════════╗")
    print("║   VeriSource Still Image Generator              ║")
    print("╚══════════════════════════════════════════════════╝")
    print(f"\nModel:    {args.model}")
    print(f"Count:    {args.count} total")
    print(f"Scenario: {args.scenario}")
    print(f"Output:   {OUTPUT_DIR}")
    
    # Count existing generated images
    existing_total = len(list(OUTPUT_DIR.glob("ai_flux_*.jpg"))) + \
                     len(list(OUTPUT_DIR.glob("ai_sdxl_*.jpg")))
    print(f"Existing: {existing_total} AI images already generated")
    
    if args.model in ["flux", "all"]:
        pipe = load_flux()
        
        if args.scenario in ["vehicle", "all"]:
            generate_batch(
                "flux", pipe, generate_flux,
                VEHICLE_DAMAGE_PROMPTS, "vehicle",
                total_per_scenario
            )
        
        if args.scenario in ["property", "all"]:
            generate_batch(
                "flux", pipe, generate_flux,
                PROPERTY_DAMAGE_PROMPTS, "property",
                total_per_scenario
            )
        
        # Free VRAM before loading next model
        del pipe
        torch.cuda.empty_cache()
        print("\n🧹 Freed Flux VRAM")
    
    if args.model in ["sdxl", "all"]:
        pipe = load_sdxl_realistic()
        
        if args.scenario in ["vehicle", "all"]:
            generate_batch(
                "sdxl", pipe, generate_sdxl,
                VEHICLE_DAMAGE_PROMPTS, "vehicle",
                total_per_scenario
            )
        
        if args.scenario in ["property", "all"]:
            generate_batch(
                "sdxl", pipe, generate_sdxl,
                PROPERTY_DAMAGE_PROMPTS, "property",
                total_per_scenario
            )
        
        del pipe
        torch.cuda.empty_cache()
    
    # Final count
    final_total = len(list(OUTPUT_DIR.glob("ai_flux_*.jpg"))) + \
                  len(list(OUTPUT_DIR.glob("ai_sdxl_*.jpg")))
    
    print(f"\n╔══════════════════════════════════════════════════╗")
    print(f"║  Generation Complete!                           ║")
    print(f"╚══════════════════════════════════════════════════╝")
    print(f"\nTotal generated: {final_total} images")
    print(f"Output: {OUTPUT_DIR}")
    print(f"Metadata: {METADATA_FILE}")
    print(f"\nNext: Run generate_deepfake_frames.py for video deepfake frames")


if __name__ == "__main__":
    main()