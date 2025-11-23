#!/usr/bin/env python3
import re

# Read the file
with open('services/jpeg-artifact-analysis.js', 'r') as f:
    content = f.read()

# FIX 1: Add ai_confidence ONLY in the analyze function's successful return
# We need to find the specific return block that has isAI, confidence, method, details

# Find the pattern: return { followed by isAI,
# This is the main analyze function return
pattern = r'(const isAI = confidence > 0\.65;.*?return \{)\s*\n(\s+isAI,)'

replacement = r'\1\n        ai_confidence: Math.round(confidence * 100),\n\2'

content = re.sub(pattern, replacement, content, count=1, flags=re.DOTALL)

# FIX 2: Add memory limit
content = content.replace(
    'jpeg.decode(buffer, { useTArray: true })',
    'jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 2048 })'
)

# Write back
with open('services/jpeg-artifact-analysis.js', 'w') as f:
    f.write(content)

print('✅ Fixes applied precisely')
