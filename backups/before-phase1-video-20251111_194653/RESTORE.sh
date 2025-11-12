#!/bin/bash
echo "🔄 Restoring from backup..."
cp -r services/* ../../../services/
cp index.js ../../../index.js
cp package.json ../../../package.json
cp package-lock.json ../../../package-lock.json
echo "✅ Restored! Don't forget to: npm install"
