#!/bin/bash
echo "🔄 Restoring backup..."
cp index.js ../../../index.js
cp confidence-scoring.js ../../../services/confidence-scoring.js
cp ai-detection.js ../../../services/ai-detection.js
cp video-analysis.js ../../../services/video-analysis.js
cp package.json ../../../package.json
echo "✅ Backup restored!"
echo "⚠️ Remember to: git add . && git commit -m 'Restore backup' && git push"
