"""
VeriSource GPU Forensics Service
=================================
FastAPI service running on GPU (RunPod) for neural network-based
AI detection. Loads trained CLIP and Frequency classifiers.

Endpoints:
  GET  /health   — service status, model info
  POST /analyze  — AI detection on uploaded image

Called by Railway API via gpu-ai-detector.js
"""

import os
import io
import time
import logging
from contextlib import asynccontextmanager

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, Header, HTTPException
from fastapi.responses import JSONResponse

# ─── Configuration ────────────────────────────────────────────

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
API_KEY = os.environ.get("VERISOURCE_GPU_API_KEY", "")
MODEL_DIR = os.environ.get("MODEL_DIR", "/workspace/models")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("verisource-gpu")

models = {}

# ─── Model Definitions (must match training_pipeline.py) ──────

class FrequencyClassifier(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d(8),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(128 * 8 * 8, 256),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(256, 2),
        )

    def forward(self, x):
        return self.classifier(self.features(x))


def compute_fft_magnitude(image, size=256):
    gray = image.convert("L").resize((size, size))
    arr = np.array(gray, dtype=np.float32) / 255.0
    fft = np.fft.fft2(arr)
    fft_shift = np.fft.fftshift(fft)
    magnitude = np.log1p(np.abs(fft_shift))
    if magnitude.max() > magnitude.min():
        magnitude = (magnitude - magnitude.min()) / (magnitude.max() - magnitude.min())
    return torch.from_numpy(magnitude).unsqueeze(0).unsqueeze(0).float()


# ─── Model Loading ────────────────────────────────────────────

def load_clip_detector():
    try:
        import clip
        logger.info("Loading CLIP ViT-L/14...")
        clip_model, clip_preprocess = clip.load("ViT-L/14", device=DEVICE)
        clip_model.eval()

        classifier_path = os.path.join(MODEL_DIR, "ufd_classifier.pth")
        classifier = nn.Sequential(
            nn.Linear(768, 256),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(256, 2),
        ).to(DEVICE)

        trained = False
        if os.path.exists(classifier_path):
            logger.info(f"Loading UFD classifier from {classifier_path}")
            state = torch.load(classifier_path, map_location=DEVICE, weights_only=True)
            classifier.load_state_dict(state)
            trained = True
        else:
            logger.warning("UFD classifier weights not found. Using untrained.")

        classifier.eval()
        return {
            "clip_model": clip_model,
            "clip_preprocess": clip_preprocess,
            "classifier": classifier,
            "ready": trained,
        }
    except ImportError:
        logger.error("CLIP not installed. Run: pip install git+https://github.com/openai/CLIP.git")
        return None
    except Exception as e:
        logger.error(f"Failed to load CLIP: {e}")
        return None


def load_frequency_model():
    model = FrequencyClassifier().to(DEVICE)
    weights_path = os.path.join(MODEL_DIR, "freq_classifier.pth")

    if os.path.exists(weights_path):
        logger.info(f"Loading frequency classifier from {weights_path}")
        state = torch.load(weights_path, map_location=DEVICE, weights_only=True)
        model.load_state_dict(state)
        model.eval()
        return {"model": model, "ready": True}
    else:
        logger.warning("Frequency classifier weights not found. Using untrained.")
        model.eval()
        return {"model": model, "ready": False}


# ─── Startup / Shutdown ──────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting VeriSource GPU service on {DEVICE}")
    if torch.cuda.is_available():
        logger.info(f"GPU: {torch.cuda.get_device_name(0)}")
        try:
            vram = torch.cuda.get_device_properties(0).total_memory / 1e9
            logger.info(f"VRAM: {vram:.1f} GB")
        except AttributeError:
            pass

    models["clip"] = load_clip_detector()
    models["freq"] = load_frequency_model()

    clip_ready = models["clip"]["ready"] if models["clip"] else False
    freq_ready = models["freq"]["ready"] if models["freq"] else False
    logger.info(f"Models loaded — CLIP: {'trained' if clip_ready else 'untrained'}, "
                f"Freq: {'trained' if freq_ready else 'untrained'}")
    logger.info("GPU service ready.")

    yield

    logger.info("Shutting down...")
    models.clear()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


app = FastAPI(title="VeriSource GPU Service", version="2.0.0", lifespan=lifespan)


# ─── Auth ─────────────────────────────────────────────────────

async def verify_api_key(key: str = None):
    if not API_KEY:
        return  # No key configured, allow all
    if key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


# ─── Health Endpoint ──────────────────────────────────────────

@app.get("/health")
async def health():
    clip_loaded = models.get("clip") is not None
    freq_loaded = models.get("freq") is not None
    clip_trained = models["clip"]["ready"] if clip_loaded else False
    freq_trained = models["freq"]["ready"] if freq_loaded else False

    gpu_info = {}
    if torch.cuda.is_available():
        gpu_info = {
            "name": torch.cuda.get_device_name(0),
            "memory_allocated_gb": round(torch.cuda.memory_allocated(0) / 1e9, 2),
        }

    return {
        "status": "ok",
        "device": DEVICE,
        "gpu": gpu_info,
        "models_loaded": {
            "clip_detector": clip_loaded,
            "freq_classifier": freq_loaded,
        },
        "models_trained": {
            "clip_detector": clip_trained,
            "freq_classifier": freq_trained,
        },
        "ensemble": {
            "all_trained": clip_trained and freq_trained,
            "any_trained": clip_trained or freq_trained,
        },
    }


# ─── Analyze Endpoint ────────────────────────────────────────

@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    x_gpu_api_key: str = Header(None),
):
    await verify_api_key(x_gpu_api_key)
    start = time.time()

    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as e:
        return JSONResponse(status_code=400, content={
            "success": False, "error": f"Invalid image: {e}"
        })

    results = {
        "success": True,
        "models": {},
    }

    # ── CLIP Detection ──
    clip_score = None
    clip_data = models.get("clip")
    if clip_data and clip_data["clip_model"]:
        try:
            img_tensor = clip_data["clip_preprocess"](image).unsqueeze(0).to(DEVICE)
            with torch.no_grad():
                features = clip_data["clip_model"].encode_image(img_tensor).float()
                features = F.normalize(features, dim=-1)
                logits = clip_data["classifier"](features)
                probs = F.softmax(logits, dim=-1)
                clip_score = probs[0, 1].item()  # AI probability

            results["models"]["clip"] = {
                "ai_probability": round(clip_score, 4),
                "label": "ai" if clip_score > 0.5 else "real",
                "confidence": round(abs(clip_score - 0.5) * 200, 1),
                "trained": clip_data["ready"],
            }
        except Exception as e:
            logger.error(f"CLIP error: {e}")
            results["models"]["clip"] = {"error": str(e)}

    # ── Frequency Detection ──
    freq_score = None
    freq_data = models.get("freq")
    if freq_data and freq_data["model"]:
        try:
            fft_tensor = compute_fft_magnitude(image).to(DEVICE)
            with torch.no_grad():
                logits = freq_data["model"](fft_tensor)
                probs = F.softmax(logits, dim=-1)
                freq_score = probs[0, 1].item()

            results["models"]["frequency"] = {
                "ai_probability": round(freq_score, 4),
                "label": "ai" if freq_score > 0.5 else "real",
                "confidence": round(abs(freq_score - 0.5) * 200, 1),
                "trained": freq_data["ready"],
            }
        except Exception as e:
            logger.error(f"Frequency error: {e}")
            results["models"]["frequency"] = {"error": str(e)}

    # ── Ensemble ──
    scores = []
    weights = []

    if clip_score is not None and clip_data.get("ready"):
        scores.append(clip_score)
        weights.append(0.75)

    if freq_score is not None and freq_data.get("ready"):
        scores.append(freq_score)
        weights.append(0.25)

    if scores:
        total_weight = sum(weights)
        ensemble_score = sum(s * w for s, w in zip(scores, weights)) / total_weight

        results["ai_score"] = round(ensemble_score, 4)
        results["label"] = "ai" if ensemble_score > 0.5 else "real"
        results["confidence"] = round(abs(ensemble_score - 0.5) * 200, 1)
        results["ensemble"] = {
            "ai_probability": round(ensemble_score, 4),
            "method": "weighted_average",
            "clip_weight": weights[0] if len(weights) > 0 else 0,
            "freq_weight": weights[1] if len(weights) > 1 else 0,
            "all_trained": all(
                models.get(m, {}).get("ready", False)
                for m in ["clip", "freq"]
            ),
        }
    else:
        results["ai_score"] = 0.5
        results["label"] = "unknown"
        results["confidence"] = 0
        results["ensemble"] = {"all_trained": False}

    elapsed = time.time() - start
    results["gpu_inference_ms"] = round(elapsed * 1000, 1)
    results["device"] = DEVICE

    logger.info(
        f"Analyze: {results['label']} "
        f"({results['ai_score']:.2%}) "
        f"in {results['gpu_inference_ms']}ms"
    )

    return results


# ─── Batch Endpoint (for video frames) ───────────────────────

@app.post("/analyze-batch")
async def analyze_batch(
    files: list[UploadFile] = File(...),
    x_gpu_api_key: str = Header(None),
):
    await verify_api_key(x_gpu_api_key)
    start = time.time()

    frame_results = []
    for f in files:
        try:
            image_bytes = await f.read()
            image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

            clip_score = None
            clip_data = models.get("clip")
            if clip_data and clip_data["clip_model"]:
                img_tensor = clip_data["clip_preprocess"](image).unsqueeze(0).to(DEVICE)
                with torch.no_grad():
                    features = clip_data["clip_model"].encode_image(img_tensor).float()
                    features = F.normalize(features, dim=-1)
                    logits = clip_data["classifier"](features)
                    probs = F.softmax(logits, dim=-1)
                    clip_score = probs[0, 1].item()

            frame_results.append({
                "ai_probability": round(clip_score, 4) if clip_score else 0.5,
                "label": "ai" if (clip_score or 0.5) > 0.5 else "real",
            })
        except Exception as e:
            frame_results.append({"error": str(e)})

    elapsed = time.time() - start
    return {
        "success": True,
        "frame_count": len(files),
        "results": frame_results,
        "total_time_ms": round(elapsed * 1000, 1),
        "per_frame_ms": round(elapsed / max(len(files), 1) * 1000, 1),
        "device": DEVICE,
    }


# ─── Run ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)