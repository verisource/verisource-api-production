#!/bin/bash

echo "Testing GIF AI detection..."
echo ""

# Test with a known AI image but as different formats
echo "Converting test image to GIF..."
convert test-all-images/test_2.jpg /tmp/test_ai.gif 2>/dev/null || {
    echo "ImageMagick not installed, skipping conversion test"
}

if [ -f /tmp/test_ai.gif ]; then
    echo "Testing AI image as GIF:"
    curl -s -X POST https://api.verisource.io/verify \
      -F "file=@/tmp/test_ai.gif" | jq '{
        kind: .kind,
        ai_confidence: .ai_detection.ai_confidence,
        likely_ai: .ai_detection.likely_ai_generated,
        label: .confidence.label
      }'
else
    echo "Can't test GIF conversion"
fi

echo ""
echo "The issue might be:"
echo "1. Beta site JavaScript is cached in browser"
echo "2. The specific FaceSwap GIF has some unique property"
echo "3. API is working but beta site isn't refreshing"
echo ""
echo "SOLUTION: Hard refresh the beta site!"
echo "  • Windows: Ctrl + Shift + R + F5"
echo "  • Mac: Cmd + Shift + R"
echo "  • Or: Clear browser cache completely"
