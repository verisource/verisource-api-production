#!/bin/bash
# ==============================================================================
# SNAPSHOT TESTING - Golden Test Results
# ==============================================================================
#
# Runs golden tests and saves JSON snapshots for regression testing
# Validates response structure and values against saved snapshots
#
# Usage:
#   ./snapshot-tests.sh <api-url> <api-key> [update]
#
# Arguments:
#   update - Update snapshots instead of validating against them
#
# ==============================================================================

set -eo pipefail

# Configuration
API_URL="${1:-https://stg-api.verisource.io}"
API_KEY="${2:-$API_KEY}"
UPDATE_SNAPSHOTS="${3:-}"
SNAPSHOTS_DIR="./test-snapshots"
TEST_VECTORS_BASE="${TEST_VECTORS_BASE:-https://test-vectors.verisource.io}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Results
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
declare -a FAILED_TESTS

echo ""
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Snapshot Testing - Golden Test Results${NC}"
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo ""
echo "Configuration:"
echo "  API URL: $API_URL"
echo "  Snapshots: $SNAPSHOTS_DIR"
if [ "$UPDATE_SNAPSHOTS" == "update" ]; then
    echo -e "  Mode: ${YELLOW}UPDATE SNAPSHOTS${NC}"
else
    echo "  Mode: VALIDATE"
fi
echo ""

# Create snapshots directory
mkdir -p "$SNAPSHOTS_DIR"
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# ==============================================================================
# Helper Functions
# ==============================================================================

normalize_json() {
    # Normalize JSON for comparison (remove dynamic fields)
    jq 'del(.requestId, .timestamp, .metadata.processingTimeMs)' | \
    jq --sort-keys .
}

save_snapshot() {
    local test_name="$1"
    local response="$2"
    local snapshot_file="$SNAPSHOTS_DIR/${test_name}.json"
    
    echo "$response" | normalize_json > "$snapshot_file"
    echo -e "${YELLOW}[SAVED]${NC} Snapshot saved: $snapshot_file"
}

compare_snapshot() {
    local test_name="$1"
    local response="$2"
    local snapshot_file="$SNAPSHOTS_DIR/${test_name}.json"
    
    if [ ! -f "$snapshot_file" ]; then
        echo -e "${RED}[ERROR]${NC} Snapshot not found: $snapshot_file"
        echo -e "${YELLOW}[TIP]${NC} Run with 'update' to create snapshots"
        return 1
    fi
    
    # Normalize response and compare
    echo "$response" | normalize_json > "$TEMP_DIR/actual.json"
    
    if diff -u "$snapshot_file" "$TEMP_DIR/actual.json" > "$TEMP_DIR/diff.txt"; then
        echo -e "${GREEN}[✓]${NC} Snapshot matches: $test_name"
        return 0
    else
        echo -e "${RED}[✗]${NC} Snapshot mismatch: $test_name"
        echo ""
        echo "Differences:"
        cat "$TEMP_DIR/diff.txt"
        echo ""
        return 1
    fi
}

run_test() {
    local test_name="$1"
    local endpoint="$2"
    local method="$3"
    shift 3
    
    TESTS_RUN=$((TESTS_RUN + 1))
    
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Test: $test_name${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # Make request
    if [ "$method" == "POST_MULTIPART" ]; then
        local video_file="$1"
        local credential_file="$2"
        
        RESPONSE=$(curl -sf \
            -H "x-api-key: $API_KEY" \
            -F "file=@$video_file" \
            -F "credential=@$credential_file;type=application/json" \
            "$API_URL$endpoint" 2>&1 || echo '{"error":"request_failed"}')
    elif [ "$method" == "POST_JSON" ]; then
        local json_data="$1"
        
        RESPONSE=$(curl -sf \
            -H "x-api-key: $API_KEY" \
            -H "Content-Type: application/json" \
            -d "$json_data" \
            "$API_URL$endpoint" 2>&1 || echo '{"error":"request_failed"}')
    fi
    
    # Check for request failure
    if echo "$RESPONSE" | jq -e '.error == "request_failed"' > /dev/null 2>&1; then
        echo -e "${RED}[✗]${NC} Request failed"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        FAILED_TESTS+=("$test_name")
        return 1
    fi
    
    # Display response summary
    VERDICT=$(echo "$RESPONSE" | jq -r '.verdict // "N/A"')
    COVERAGE=$(echo "$RESPONSE" | jq -r '.coverage // "N/A"')
    echo "Response: verdict=$VERDICT, coverage=$COVERAGE"
    
    # Update or validate snapshot
    if [ "$UPDATE_SNAPSHOTS" == "update" ]; then
        save_snapshot "$test_name" "$RESPONSE"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        if compare_snapshot "$test_name" "$RESPONSE"; then
            TESTS_PASSED=$((TESTS_PASSED + 1))
        else
            TESTS_FAILED=$((TESTS_FAILED + 1))
            FAILED_TESTS+=("$test_name")
        fi
    fi
}

# ==============================================================================
# Download Test Vectors
# ==============================================================================

echo -e "${BLUE}Preparing test vectors...${NC}"

# Download test files (or use local if available)
download_if_needed() {
    local url="$1"
    local output="$2"
    
    if [ -f "$output" ]; then
        echo "  Using existing: $output"
    else
        echo "  Downloading: $url"
        curl -sf -o "$output" "$url" || {
            echo -e "${RED}  Failed to download: $url${NC}"
            return 1
        }
    fi
}

# Create test vectors directory
mkdir -p "$TEMP_DIR/vectors"

# For demonstration, create minimal test files
# In production, these would be downloaded from your test vector repository

# Create test video (minimal MP4)
echo "  Creating test video..."
dd if=/dev/urandom of="$TEMP_DIR/vectors/test.mp4" bs=1M count=1 2>/dev/null

# Create test credentials
cat > "$TEMP_DIR/vectors/proven-strong.credential.json" << 'EOF'
{
  "assertions": [
    {
      "label": "c2pa.actions",
      "data": {
        "actions": [
          {"action": "c2pa.created", "softwareAgent": "TestTool/1.0"}
        ]
      }
    }
  ],
  "claim_generator": "TestGenerator/1.0"
}
EOF

cat > "$TEMP_DIR/vectors/proven-moderate.credential.json" << 'EOF'
{
  "assertions": [
    {
      "label": "c2pa.actions",
      "data": {
        "actions": [
          {"action": "c2pa.created"}
        ]
      }
    }
  ]
}
EOF

cat > "$TEMP_DIR/vectors/mismatch.credential.json" << 'EOF'
{
  "assertions": [
    {
      "label": "c2pa.actions",
      "data": {
        "actions": [
          {"action": "c2pa.edited", "when": "2025-01-01T00:00:00Z"}
        ]
      }
    }
  ]
}
EOF

cat > "$TEMP_DIR/vectors/no-credential.credential.json" << 'EOF'
{}
EOF

echo -e "${GREEN}Test vectors ready${NC}"

# ==============================================================================
# Run Snapshot Tests
# ==============================================================================

echo ""
echo -e "${BLUE}Running snapshot tests...${NC}"

# Test 1: PROVEN_STRONG - Upload
run_test "proven-strong-upload" \
    "/verify" \
    "POST_MULTIPART" \
    "$TEMP_DIR/vectors/test.mp4" \
    "$TEMP_DIR/vectors/proven-strong.credential.json"

# Test 2: PROVEN_STRONG - URL
VIDEO_URL="$TEST_VECTORS_BASE/golden/proven-strong.mp4"
CREDENTIAL=$(cat "$TEMP_DIR/vectors/proven-strong.credential.json")
run_test "proven-strong-url" \
    "/verify-by-url" \
    "POST_JSON" \
    "{\"url\":\"$VIDEO_URL\",\"credential\":$CREDENTIAL}"

# Test 3: PROVEN_MODERATE - Upload
run_test "proven-moderate-upload" \
    "/verify" \
    "POST_MULTIPART" \
    "$TEMP_DIR/vectors/test.mp4" \
    "$TEMP_DIR/vectors/proven-moderate.credential.json"

# Test 4: PROVEN_MODERATE - URL
CREDENTIAL=$(cat "$TEMP_DIR/vectors/proven-moderate.credential.json")
run_test "proven-moderate-url" \
    "/verify-by-url" \
    "POST_JSON" \
    "{\"url\":\"$VIDEO_URL\",\"credential\":$CREDENTIAL}"

# Test 5: MISMATCH - Upload
run_test "mismatch-upload" \
    "/verify" \
    "POST_MULTIPART" \
    "$TEMP_DIR/vectors/test.mp4" \
    "$TEMP_DIR/vectors/mismatch.credential.json"

# Test 6: MISMATCH - URL
CREDENTIAL=$(cat "$TEMP_DIR/vectors/mismatch.credential.json")
run_test "mismatch-url" \
    "/verify-by-url" \
    "POST_JSON" \
    "{\"url\":\"$VIDEO_URL\",\"credential\":$CREDENTIAL}"

# Test 7: NO_CREDENTIAL_FOUND - Upload
run_test "no-credential-upload" \
    "/verify" \
    "POST_MULTIPART" \
    "$TEMP_DIR/vectors/test.mp4" \
    "$TEMP_DIR/vectors/no-credential.credential.json"

# ==============================================================================
# Summary
# ==============================================================================

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Tests Run: $TESTS_RUN"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"
echo ""

if [ "$UPDATE_SNAPSHOTS" == "update" ]; then
    echo -e "${GREEN}Snapshots updated successfully${NC}"
    echo "Location: $SNAPSHOTS_DIR"
    echo ""
    echo "Snapshots created:"
    ls -lh "$SNAPSHOTS_DIR"
else
    if [ $TESTS_FAILED -gt 0 ]; then
        echo -e "${RED}Failed tests:${NC}"
        for test in "${FAILED_TESTS[@]}"; do
            echo "  - $test"
        done
        echo ""
        echo -e "${RED}Snapshot validation FAILED${NC}"
        exit 1
    else
        echo -e "${GREEN}All snapshots validated successfully${NC}"
    fi
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
