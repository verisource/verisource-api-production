#!/bin/bash
# Quick runner script for golden tests

# Usage:
#   ./RUN_GOLDEN_TESTS.sh                    # Validate snapshots
#   ./RUN_GOLDEN_TESTS.sh update             # Create/update snapshots

set -e

API_URL="${API_URL:-https://stg-api.verisource.io}"
API_KEY="${API_KEY:-stg_key_1}"

if [ "$1" == "update" ]; then
    export UPDATE_SNAPSHOTS=true
    echo "🔄 Running in UPDATE mode - will create/update snapshots"
else
    export UPDATE_SNAPSHOTS=false
    echo "✅ Running in VALIDATE mode - will check against snapshots"
fi

echo ""
echo "Configuration:"
echo "  API_URL: $API_URL"
echo "  API_KEY: ${API_KEY:0:10}..."
echo ""

# Run the tests
API_URL="$API_URL" \
API_KEY="$API_KEY" \
UPDATE_SNAPSHOTS="$UPDATE_SNAPSHOTS" \
node golden-test-runner.js

echo ""
echo "Done! 🎉"
