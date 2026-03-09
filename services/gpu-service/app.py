"""
VeriSource GPU Forensics Service
=================================
FastAPI service running on GPU (RunPod) for neural network-based
media verification. Replaces the CPU heuristic detector.

Models:
  1. UniversalFakeDetect (CLIP-based) - AI vs real classification
  2. Frequency Analysis (FFT + CNN) - spectral artifact detection

Called by Railway API at: POST /analyze
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
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse

# ─────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
API_KEY = os.environ.get("VERISOURCE_GPU_API_KEY", "")
MODEL_DIR = os.environ.get("MODEL_DIR", "/workspace/models")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("verisource-gpu")

models = {}


# ─────────────────────────────────────────────────
# Frequency Classifier Model
# ─────────────────────────────────────────────────

class FrequencyClassifier(nn.Module):
    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(), nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(), nn.AdaptiveAvgPool2d(8),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(128 * 8 * 8, 256),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(256, 2)
        )

    def forward(self, x):
        return self.classifier(self.features(x))


# ─────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────

def compute_fft_magnitude(image, size=256):
    gray = image.convert("L").resize((size, size))
    arr = np.array(gray, dtype=np.float32) / 255.0
    fft = np.fft.fft2(arr)
    fft_shift = np.fft.fftshift(fft)
    magnitude = np.log1p(np.abs(fft_shift))
    if magnitude.max() > magnitude.min():
        magnitude = (magnitude - magnitude.min()) / (magnitude.max() - magnitude.min())
    return torch.from_numpy(magnitude).unsqueeze(0).unsqueeze(0).float()


# ─────────────────────────────────────────────────
# Model Loaders
# ─────────────────────────────────────────────────

def load_clip_detector():
    try:
        import clip
        logger.info("Loading CLIP ViT-L/14...")
        clip_model, clip_preprocess = clip.load("ViT-L/14", device=DEVICE)
        clip_model.eval()
        classifier_path = os.path.join(MODEL_DIR, "ufd_classifier.pth")

        class CLIPClassifier(nn.Module):
            def __init__(self):
                super().__init__()
                self.layers = nn.Sequential(nn.Linear(768, 256), nn.ReLU(), nn.Dropout(0.2), nn.Linear(256, 2))
            def forward(self, x):
                return self.layers(x)

        classifier = CLIPClassifier().to(DEVICE)
        if os.path.exists(classifier_path):
            logger.info("Loading UFD classifier from " + classifier_path)
            state = torch.load(classifier_path, map_location=DEVICE, weights_only=True)
            classifier.load_state_dict(state)
        else:
            logger.warning("UFD classifier weights not found")
        classifier.eval()
        return {
            "clip_model": clip_model,
            "clip_preprocess": clip_preprocess,
            "classifier": classifier,
            "ready": os.path.exists(classifier_path)
        }
    except Exception as e:
        logger.error("CLIP not installed. Run: pip install git+https://github.com/openai/CLIP.git")
        return None


def load_frequency_model():
    model = FrequencyClassifier().to(DEVICE)
    weights_path = os.path.join(MODEL_DIR, "freq_classifier.pth")
    if os.path.exists(weights_path):
        logger.info("Loading frequency classifier from " + weights_path)
        state = torch.load(weights_path, map_location=DEVICE, weights_only=True)
        model.load_state_dict(state)
        model.eval()
        return {"model": model, "ready": True}
    logger.warning("Frequency classifier weights not found")
    model.eval()
    return {"model": model, "ready": False}


# ─────────────────────────────────────────────────
# Startup / Shutdown
# ─────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app):
    logger.info("Starting VeriSource GPU service on " + DEVICE)
    if torch.cuda.is_available():
        logger.info("GPU: " + torch.cuda.get_device_name(0))
        logger.info("VRAM: " + str(round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1)) + " GB")
    models["clip_detector"] = load_clip_detector()
    models["freq_classifier"] = load_frequency_model()
    clip_trained = bool(models["clip_detector"] and models["clip_detector"].get("ready"))
    freq_trained = bool(models["freq_classifier"] and models["freq_classifier"].get("ready"))
    clip_status = "trained" if clip_trained else "untrained"
    freq_status = "trained" if freq_trained else "untrained"
    logger.info("Models loaded — CLIP: " + clip_status + ", Freq: " + freq_status)
    logger.info("GPU service ready.")
    yield
    models.clear()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    logger.info("Shutting down...")


app = FastAPI(title="VeriSource GPU Forensics", version="1.0.0", lifespan=lifespan)


# ─────────────────────────────────────────────────
# Inference Functions
# ─────────────────────────────────────────────────

@torch.no_grad()
def run_clip_detection(image):
    detector = models.get("clip_detector")
    if not detector:
        return {"score": None, "error": "CLIP not loaded"}
    start = time.time()
    img_tensor = detector["clip_preprocess"](image).unsqueeze(0).to(DEVICE)
    features = detector["clip_model"].encode_image(img_tensor).float()
    features = F.normalize(features, dim=-1)
    logits = detector["classifier"](features)
    probs = F.softmax(logits, dim=-1)
    ai_score = probs[0][1].item()
    elapsed = (time.time() - start) * 1000
    return {
        "score": round(ai_score, 4),
        "label": "ai" if ai_score > 0.5 else "real",
        "confidence": round(abs(ai_score - 0.5) * 200, 1),
        "inference_ms": round(elapsed, 1),
        "trained": detector.get("ready", False)
    }


@torch.no_grad()
def run_frequency_detection(image):
    freq = models.get("freq_classifier")
    if not freq:
        return {"score": None, "error": "Frequency model not loaded"}
    start = time.time()
    fft_tensor = compute_fft_magnitude(image).to(DEVICE)
    logits = freq["model"](fft_tensor)
    probs = F.softmax(logits, dim=-1)
    ai_score = probs[0][1].item()
    elapsed = (time.time() - start) * 1000
    return {
        "score": round(ai_score, 4),
        "label": "ai" if ai_score > 0.5 else "real",
        "confidence": round(abs(ai_score - 0.5) * 200, 1),
        "inference_ms": round(elapsed, 1),
        "trained": freq.get("ready", False)
    }


# ─────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────

@app.get("/health")
async def health():
    clip = models.get("clip_detector")
    freq = models.get("freq_classifier")
    clip_trained = bool(clip and clip.get("ready"))
    freq_trained = bool(freq and freq.get("ready"))
    gpu_info = None
    if torch.cuda.is_available():
        gpu_info = {
            "name": torch.cuda.get_device_name(0),
            "memory_allocated_gb": round(torch.cuda.memory_allocated() / 1e9, 2)
        }
    return {
        "status": "ok",
        "device": DEVICE,
        "gpu": gpu_info,
        "models_loaded": {
            "clip_detector": clip is not None,
            "freq_classifier": freq is not None
        },
        "models_trained": {
            "clip_detector": clip_trained,
            "freq_classifier": freq_trained
        },
        "ensemble": {
            "all_trained": clip_trained and freq_trained,
            "any_trained": clip_trained or freq_trained
        }
    }


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    start = time.time()
    contents = await file.read()
    try:
        image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail="Invalid image: " + str(e))

    clip_result = run_clip_detection(image)
    freq_result = run_frequency_detection(image)

    scores = [r["score"] for r in [clip_result, freq_result] if r.get("score") is not None]
    ensemble_score = sum(scores) / len(scores) if scores else 0.5
    label = "ai" if ensemble_score > 0.5 else "real"
    confidence = round(abs(ensemble_score - 0.5) * 200, 1)
    total_ms = round((time.time() - start) * 1000, 1)

    logger.info("Analyze: " + label + " (" + str(round(ensemble_score * 100, 2)) + "%) in " + str(total_ms) + "ms")

    return {
        "ai_score": round(ensemble_score, 4),
        "label": label,
        "confidence": confidence,
        "models": {
            "clip": {
                "ai_probability": clip_result.get("score"),
                "label": clip_result.get("label"),
                "confidence": clip_result.get("confidence"),
                "trained": clip_result.get("trained")
            },
            "frequency": {
                "ai_probability": freq_result.get("score"),
                "label": freq_result.get("label"),
                "confidence": freq_result.get("confidence"),
                "trained": freq_result.get("trained")
            }
        },
        "total_ms": total_ms
    }