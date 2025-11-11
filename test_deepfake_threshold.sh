#!/bin/bash
# Test different images to understand AI detection scoring

echo "📊 AI Detection Threshold Analysis"
echo "==================================="
echo ""

# Test the images we know work
echo "Testing known AI image (test_1.jpg - should be high):"
curl -s -X POST https://api.verisource.io/verify \
  -F "file=@test-all-images/test_1.jpg" | jq '{
    filename: "test_1.jpg (AI face)",
    ai_confidence: .ai_detection.ai_confidence,
    likely_ai: .ai_detection.likely_ai_generated,
    label: .confidence.label
  }'

echo ""
echo "Testing known real image (test_4.jpg - should be low):"
curl -s -X POST https://api.verisource.io/verify \
  -F "file=@test-all-images/test_4.jpg" | jq '{
    filename: "test_4.jpg (real cat)",
    ai_confidence: .ai_detection.ai_confidence,
    likely_ai: .ai_detection.likely_ai_generated,
    label: .confidence.label
  }'

echo ""
echo "=========================================="
echo "ANALYSIS:"
echo "=========================================="
echo ""
echo "Current threshold: 50 points"
echo ""
echo "If FaceShifter scores 40-49:"
echo "  → It's a BORDERLINE case"
echo "  → Need to lower threshold to 40"
echo ""
echo "If FaceShifter scores 30-39:"
echo "  → It's SOPHISTICATED deepfake"
echo "  → Need more aggressive detection"
echo ""
echo "If FaceShifter scores < 30:"
echo "  → Our detector can't catch it with images"
echo "  → Need video-based testing instead"
