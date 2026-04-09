"""
VeriSource GPU Forensics Service
=================================
FastAPI service running on GPU (RunPod) for neural network-based
AI detection. Loads trained CLIP, Frequency, and Generator classifiers.

Endpoints:
  GET  /health              — service status, model info
  POST /analyze             — AI detection on uploaded image (original)
  POST /detect              — binary AI detection (gpu-ai-detector.js compatible)
  POST /classify-generator  — which AI generator produced the image
  POST /analyze-batch       — batch detection for video frames

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
from torchvision import transforms, models as tv_models
from fastapi import FastAPI, File, UploadFile, Header, HTTPException
from fastapi.responses import JSONResponse

# ─── Configuration ────────────────────────────────────────────

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
API_KEY = os.environ.get("VERISOURCE_GPU_API_KEY", "")
MODEL_DIR = os.environ.get("MODEL_DIR", "/mnt/verisource/models")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

logging.basicConfig(level=LOG_LEVEL, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("verisource-gpu")

models = {}

# ─── Model Definitions ────────────────────────────────────────

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


def load_generator_model():
    gen_path = os.path.join(MODEL_DIR, "generator_classifier.pth")
    if not os.path.exists(gen_path):
        logger.warning(f"generator_classifier.pth not found at {gen_path}")
        return {"ready": False, "model": None, "labels": None, "label_names": None}
    try:
        checkpoint = torch.load(gen_path, map_location=DEVICE)
        label_map = checkpoint.get("labels", {})
        num_classes = len(label_map)
        backbone = tv_models.resnet50(weights=None)
        backbone.fc = nn.Sequential(
            nn.Dropout(0.3),
            nn.Linear(2048, num_classes)
        )
        backbone.load_state_dict(checkpoint["model_state_dict"])
        backbone.eval().to(DEVICE)
        val_acc = checkpoint.get("val_acc", "N/A")
        logger.info(f"✅ Generator classifier loaded ({num_classes} classes, val_acc={val_acc})")
        return {
            "ready": True,
            "model": backbone,
            "labels": label_map,
            "label_names": {v: k for k, v in label_map.items()},
        }
    except Exception as e:
        logger.error(f"Failed to load generator classifier: {e}")
        return {"ready": False, "model": None, "labels": None, "label_names": None}


# ─── Generator transform ──────────────────────────────────────

gen_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])

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
    models["generator"] = load_generator_model()

    clip_ready = models["clip"]["ready"] if models["clip"] else False
    freq_ready = models["freq"]["ready"] if models["freq"] else False
    gen_ready = models["generator"]["ready"] if models["generator"] else False
    logger.info(
        f"Models loaded — CLIP: {'trained' if clip_ready else 'untrained'}, "
        f"Freq: {'trained' if freq_ready else 'untrained'}, "
        f"Generator: {'ready' if gen_ready else 'not loaded'}"
    )
    logger.info("GPU service ready.")
    yield
    logger.info("Shutting down...")
    models.clear()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


app = FastAPI(title="VeriSource GPU Service", version="3.0.0", lifespan=lifespan)


# ─── Auth ─────────────────────────────────────────────────────

async def verify_api_key(key: str = None):
    if not API_KEY:
        return
    if key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


# ─── Shared inference helpers ─────────────────────────────────

def _run_binary(image):
    clip_score = None
    freq_score = None

    clip_data = models.get("clip")
    if clip_data and clip_data.get("clip_model"):
        try:
            img_tensor = clip_data["clip_preprocess"](image).unsqueeze(0).to(DEVICE)
            with torch.no_grad():
                features = clip_data["clip_model"].encode_image(img_tensor).float()
                features = F.normalize(features, dim=-1)
                logits = clip_data["classifier"](features)
                probs = F.softmax(logits, dim=-1)
                clip_score = probs[0, 1].item()
        except Exception as e:
            logger.error(f"CLIP error: {e}")

    freq_data = models.get("freq")
    if freq_data and freq_data.get("model"):
        try:
            fft_tensor = compute_fft_magnitude(image).to(DEVICE)
            with torch.no_grad():
                logits = freq_data["model"](fft_tensor)
                probs = F.softmax(logits, dim=-1)
                freq_score = probs[0, 1].item()
        except Exception as e:
            logger.error(f"Frequency error: {e}")

    scores, weights = [], []
    if clip_score is not None and clip_data.get("ready"):
        scores.append(clip_score)
        weights.append(0.75)
    if freq_score is not None and freq_data.get("ready"):
        scores.append(freq_score)
        weights.append(0.25)

    if scores:
        total_weight = sum(weights)
        ensemble_score = sum(s * w for s, w in zip(scores, weights)) / total_weight
    else:
        ensemble_score = 0.5

    return clip_score, freq_score, ensemble_score


def _run_generator(image):
    gen_data = models.get("generator")
    if not gen_data or not gen_data["ready"]:
        return None, None, None
    try:
        tensor = gen_transform(image).unsqueeze(0).to(DEVICE)
        with torch.no_grad():
            logits = gen_data["model"](tensor)
            probs = F.softmax(logits, dim=1)[0]
        label_names = gen_data["label_names"]
        top_idx = probs.argmax().item()
        raw_scores = {label_names[i]: round(float(probs[i]), 4) for i in range(len(probs))}
        return label_names[top_idx], float(probs[top_idx]), raw_scores
    except Exception as e:
        logger.error(f"Generator error: {e}")
        return None, None, None


# ─── Health Endpoint ──────────────────────────────────────────

@app.get("/health")
async def health():
    clip_loaded = models.get("clip") is not None
    freq_loaded = models.get("freq") is not None
    gen_ready = models.get("generator", {}).get("ready", False)
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
            "generator_classifier": gen_ready,
        },
        "models_trained": {
            "clip_detector": clip_trained,
            "freq_classifier": freq_trained,
            "generator_classifier": gen_ready,
        },
        "ensemble": {
            "all_trained": clip_trained and freq_trained,
            "any_trained": clip_trained or freq_trained,
        },
    }


# ─── Analyze Endpoint (original) ─────────────────────────────

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
        return JSONResponse(status_code=400, content={"success": False, "error": f"Invalid image: {e}"})

    clip_score, freq_score, ensemble_score = _run_binary(image)
    is_ai = ensemble_score > 0.5

    generator, gen_confidence, gen_scores = None, None, None
    if is_ai:
        generator, gen_confidence, gen_scores = _run_generator(image)

    clip_data = models.get("clip", {})
    freq_data = models.get("freq", {})
    elapsed = time.time() - start

    result = {
        "success": True,
        "is_ai": is_ai,
        "ai_score": round(ensemble_score, 4),
        "label": "ai" if is_ai else "real",
        "confidence": round(abs(ensemble_score - 0.5) * 200, 1),
        "ensemble": {
            "ai_probability": round(ensemble_score, 4),
            "method": "weighted_average",
            "all_trained": all(models.get(m, {}).get("ready", False) for m in ["clip", "freq"]),
        },
        "models": {},
        "gpu_inference_ms": round(elapsed * 1000, 1),
        "device": DEVICE,
    }

    if clip_score is not None:
        result["models"]["clip"] = {
            "ai_probability": round(clip_score, 4),
            "label": "ai" if clip_score > 0.5 else "real",
            "trained": clip_data.get("ready", False),
        }
    if freq_score is not None:
        result["models"]["frequency"] = {
            "ai_probability": round(freq_score, 4),
            "label": "ai" if freq_score > 0.5 else "real",
            "trained": freq_data.get("ready", False),
        }
    if generator:
        result["generator"] = generator
        result["generator_confidence"] = round(gen_confidence, 4)
        result["generator_scores"] = gen_scores

    logger.info(f"Analyze: {result['label']} ({result['ai_score']:.2%}) in {result['gpu_inference_ms']}ms")
    return result


# ─── Detect Endpoint (gpu-ai-detector.js compatible) ─────────

@app.post("/detect")
async def detect(
    file: UploadFile = File(...),
    x_gpu_api_key: str = Header(None),
):
    """Binary AI detection — returns format expected by gpu-ai-detector.js."""
    await verify_api_key(x_gpu_api_key)
    start = time.time()

    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as e:
        return JSONResponse(status_code=400, content={"success": False, "error": f"Invalid image: {e}"})

    clip_score, freq_score, ensemble_score = _run_binary(image)
    is_ai = ensemble_score > 0.5
    elapsed = time.time() - start

    return {
        "is_ai": is_ai,
        "confidence": round(ensemble_score, 4),
        "ensemble_score": round(ensemble_score, 4),
        "clip_score": round(clip_score, 4) if clip_score is not None else None,
        "freq_score": round(freq_score, 4) if freq_score is not None else None,
        "likely_ai_generated": is_ai,
        "ai_confidence": round(ensemble_score * 100, 1),
        "inference_ms": round(elapsed * 1000, 1),
        "device": DEVICE,
    }


# ─── Classify Generator Endpoint ─────────────────────────────

@app.post("/classify-generator")
async def classify_generator(
    file: UploadFile = File(...),
    x_gpu_api_key: str = Header(None),
):
    """Classify which AI generator produced the image."""
    await verify_api_key(x_gpu_api_key)
    start = time.time()

    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as e:
        return JSONResponse(status_code=400, content={"success": False, "error": f"Invalid image: {e}"})

    gen_data = models.get("generator")
    if not gen_data or not gen_data["ready"]:
        return JSONResponse(status_code=503, content={"error": "Generator classifier not available"})

    generator, gen_confidence, gen_scores = _run_generator(image)
    elapsed = time.time() - start

    if generator is None:
        return JSONResponse(status_code=500, content={"error": "Generator classification failed"})

    return {
        "generator": generator,
        "confidence": round(gen_confidence, 4),
        "raw_scores": gen_scores,
        "inference_ms": round(elapsed * 1000, 1),
        "device": DEVICE,
    }


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
            _, _, ensemble_score = _run_binary(image)
            frame_results.append({
                "ai_probability": round(ensemble_score, 4),
                "label": "ai" if ensemble_score > 0.5 else "real",
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