#!/bin/bash
echo "Saving weights to network volume..."
mkdir -p /mnt/verisource/models
cp /workspace/models/freq_classifier.pth /mnt/verisource/models/
cp /workspace/models/ufd_classifier.pth /mnt/verisource/models/
echo "Saved:"
ls -lh /mnt/verisource/models/

echo "Pushing to GitHub..."
GH_TOKEN="${GH_TOKEN}"
for f in freq_classifier.pth ufd_classifier.pth; do
  SHA=$(curl -s -H "Authorization: token $GH_TOKEN" \
    "https://api.github.com/repos/verisource/verisource-api-production/contents/services/gpu-service/models/$f" \
    2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('sha',''))" 2>/dev/null || echo "")
  
  if [ -z "$SHA" ]; then
    METHOD="new file"
    DATA="{\"message\":\"save $f\",\"content\":\"$(base64 -w 0 /workspace/models/$f)\"}"
  else
    METHOD="update"
    DATA="{\"message\":\"update $f\",\"sha\":\"$SHA\",\"content\":\"$(base64 -w 0 /workspace/models/$f)\"}"
  fi
  
  curl -s -X PUT "https://api.github.co
m/repos/verisource/verisource-api-production/contents/services/gpu-service/models/$f" \
    -H "Authorization: token $GH_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$DATA" | python3 -c "import sys,json; d=json.load(sys.stdin); print('$f:', 'OK' if 'content' in d else d.get('message','failed'))"
done
echo "Done!"
