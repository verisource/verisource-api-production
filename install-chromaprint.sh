#!/bin/bash
# Install Chromaprint for Railway deployment

echo "📦 Installing Chromaprint..."

# Download pre-built binary
wget -q https://github.com/acoustid/chromaprint/releases/download/v1.5.1/chromaprint-fpcalc-1.5.1-linux-x86_64.tar.gz

# Extract
tar -xzf chromaprint-fpcalc-1.5.1-linux-x86_64.tar.gz

# Move to /usr/local/bin
cp chromaprint-fpcalc-1.5.1-linux-x86_64/fpcalc /usr/local/bin/ || \
mkdir -p ./bin && cp chromaprint-fpcalc-1.5.1-linux-x86_64/fpcalc ./bin/

# Make executable
chmod +x /usr/local/bin/fpcalc 2>/dev/null || chmod +x ./bin/fpcalc

# Cleanup
rm -rf chromaprint-fpcalc-1.5.1-linux-x86_64*

# Verify
fpcalc -version || ./bin/fpcalc -version

echo "✅ Chromaprint installed"
