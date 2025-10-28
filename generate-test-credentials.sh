#!/bin/bash
# Generate test credentials from real videos using video worker

set -e

echo "========================================="
echo "  Generating Real Test Credentials"
echo "========================================="
echo ""

# Configuration
export ALLOWED_FETCH_HOSTS=samplelib.com
WORKER_SCRIPT="worker/video-worker.js"
OUTPUT_DIR="/tmp"

# Check if worker script exists
if [ ! -f "$WORKER_SCRIPT" ]; then
    echo "ERROR: Worker script not found at $WORKER_SCRIPT"
    echo "Please run this script from your API project root"
    exit 1
fi

# Test videos from samplelib.com
declare -A VIDEOS=(
    ["proven-strong"]="https://samplelib.com/lib/preview/mp4/sample-5s.mp4"
    ["proven-moderate"]="https://samplelib.com/lib/preview/mp4/sample-10s.mp4"
    ["mismatch"]="https://samplelib.com/lib/preview/mp4/sample-15s.mp4"
    ["no-credential"]="https://samplelib.com/lib/preview/mp4/sample-3s.mp4"
)

echo "Processing videos..."
echo ""

# Process each video
for name in "${!VIDEOS[@]}"; do
    url="${VIDEOS[$name]}"
    output="${OUTPUT_DIR}/${name}-worker.json"
    
    echo "[$name] Processing: $url"
    
    if node "$WORKER_SCRIPT" "$url" > "$output" 2>&1; then
        # Verify output is valid JSON
        if jq empty "$output" 2>/dev/null; then
            echo "[$name] ✓ Success - Output saved to: $output"
            
            # Show key metrics
            canonical=$(jq -r '.sha256_canonical' "$output" 2>/dev/null || echo "N/A")
            segments=$(jq -r '.segmentsTotal' "$output" 2>/dev/null || echo "0")
            duration=$(jq -r '.duration' "$output" 2>/dev/null || echo "0")
            
            echo "[$name]   Canonical: ${canonical:0:16}..."
            echo "[$name]   Segments: $segments"
            echo "[$name]   Duration: ${duration}s"
        else
            echo "[$name] ✗ Failed - Invalid JSON output"
            cat "$output"
            exit 1
        fi
    else
        echo "[$name] ✗ Failed - Worker error"
        cat "$output"
        exit 1
    fi
    
    echo ""
done

echo "========================================="
echo "  Worker Processing Complete"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Review worker outputs in: $OUTPUT_DIR/*-worker.json"
echo "  2. Run: ./build-v3-credentials.sh"
echo ""
