#!/bin/bash
# VeriSource GPU Service - Auto Start Script
# Runs on pod startup to restore and launch the GPU service

set -e

echo "=================================================="
echo "  VeriSource GPU Service Startup"
echo "=================================================="

# Setup directories
mkdir -p /workspace/verisource-gpu /workspace/models

# Pull latest code from GitHub
echo "Pulling latest code from GitHub..."
curl -sL https://raw.githubusercontent.com/verisource/verisource-api-production/main/services/gpu-service/app.py -o /workspace/verisource-gpu/app.py
curl -sL https://raw.githubusercontent.com/verisource/verisource-api-production/main/services/gpu-service/training_pipeline.py -o /workspace/verisource-gpu/training_pipeline.py
echo "Code pulled: $(wc -l < /workspace/verisource-gpu/app.py) lines (app.py)"

# Install dependencies
echo "Installing dependencies..."
pip install uvicorn fastapi python-multipart git+https://github.com/openai/CLIP.git --break-system-packages -q

# Check for model weights
if [ -f "/mnt/verisource/models/freq_classifier.pth" ]; then
    echo "Restoring model weights from network volume..."
    cp -r /mnt/verisource/models/. /workspace/models/
    echo "Weights restored."
elif [ -f "/workspace/models/freq_classifier.pth" ]; then
    echo "Model weights found in /workspace/models."
else
    echo "WARNING: No model weights found. Service will start in untrained mode."
    echo "Run training_pipeline.py to train models."
fi

# Start the service
echo "Starting VeriSource GPU service on port 8000..."
cd /workspace/verisource-gpu
export MODEL_DIR="/workspace/models"
python3 -m uvicorn app:app --host 0.0.0.0 --port 8000