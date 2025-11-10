#!/bin/bash

# FaceForensics++ Video Testing Script
# Tests videos against VeriSource API and records results

API_URL="https://api.verisource.io/verify"
RESULTS_DIR="./results"
REAL_DIR="./videos/real"
FAKE_DIR="./videos/fake"

mkdir -p "$RESULTS_DIR"

echo "🧪 VeriSource FaceForensics++ Testing"
echo "======================================"
echo ""

# Test real videos
echo "📹 Testing REAL videos..."
real_count=0
for video in "$REAL_DIR"/*.mp4 "$REAL_DIR"/*.avi; do
    if [ -f "$video" ]; then
        filename=$(basename "$video")
        echo "  Testing: $filename"
        
        curl -s -X POST "$API_URL" \
            -F "file=@$video" \
            > "$RESULTS_DIR/real_${filename}.json"
        
        real_count=$((real_count + 1))
        sleep 1  # Rate limiting
    fi
done

echo "  ✅ Tested $real_count real videos"
echo ""

# Test fake videos
echo "🎭 Testing FAKE videos (deepfakes)..."
fake_count=0
for video in "$FAKE_DIR"/*.mp4 "$FAKE_DIR"/*.avi; do
    if [ -f "$video" ]; then
        filename=$(basename "$video")
        echo "  Testing: $filename"
        
        curl -s -X POST "$API_URL" \
            -F "file=@$video" \
            > "$RESULTS_DIR/fake_${filename}.json"
        
        fake_count=$((fake_count + 1))
        sleep 1  # Rate limiting
    fi
done

echo "  ✅ Tested $fake_count fake videos"
echo ""
echo "✅ Testing complete!"
echo "📊 Total: $((real_count + fake_count)) videos tested"
echo ""
echo "Results saved to: $RESULTS_DIR/"
