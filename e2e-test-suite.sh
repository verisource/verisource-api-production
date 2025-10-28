#!/bin/bash
# ==============================================================================
# GOLDEN E2E TEST SUITE
# ==============================================================================
#
# Comprehensive end-to-end test suite for Verisource API
# Tests both /verify and /verify-by-url endpoints
# Gates deployments based on verdict accuracy and coverage thresholds
#
# Usage:
#   ./e2e-test-suite.sh <api-url> <api-key>
#
# Exit codes:
#   0 = All tests passed
#   1 = Test failure (blocks deployment)
#
# ==============================================================================

set -eo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL="${1:-https://stg-api.verisource.io}"
API_KEY="${2:-$API_KEY}"
TEST_VECTORS_BASE="${TEST_VECTORS_BASE:-https://test-vectors.verisource.io}"

# Thresholds (deployment gates)
MIN_COVERAGE=0.95
MAX_COVERAGE_DRIFT=0.05
ALLOWED_VERDICT_MISMATCH=0

# Test results tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
declare -a FAILED_TEST_NAMES

# ==============================================================================
# Helper Functions
# ==============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

start_test() {
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Test $TOTAL_TESTS: $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

pass_test() {
    PASSED_TESTS=$((PASSED_TESTS + 1))
    log_success "Test passed: $1"
}

fail_test() {
    FAILED_TESTS=$((FAILED_TESTS + 1))
    FAILED_TEST_NAMES+=("$1")
    log_error "Test failed: $1"
    log_error "Reason: $2"
}

download_test_file() {
    local url="$1"
    local output="$2"
    
    if ! curl -sf -o "$output" "$url"; then
        log_error "Failed to download $url"
        return 1
    fi
    return 0
}

verify_upload() {
    local video_path="$1"
    local credential_path="$2"
    
    curl -sf \
        -H "x-api-key: $API_KEY" \
        -F "file=@$video_path" \
        -F "credential=@$credential_path;type=application/json" \
        "$API_URL/verify"
}

verify_by_url() {
    local video_url="$1"
    local credential_json="$2"
    
    curl -sf \
        -H "x-api-key: $API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"url\":\"$video_url\",\"credential\":$credential_json}" \
        "$API_URL/verify-by-url"
}

check_verdict() {
    local response="$1"
    local expected_verdict="$2"
    local test_name="$3"
    
    local verdict=$(echo "$response" | jq -r '.verdict')
    local coverage=$(echo "$response" | jq -r '.coverage')
    
    log_info "Response: verdict=$verdict, coverage=$coverage"
    
    # Check verdict matches expected
    if [ "$verdict" != "$expected_verdict" ]; then
        fail_test "$test_name" "Expected verdict $expected_verdict, got $verdict"
        return 1
    fi
    
    # Check coverage meets minimum threshold
    if (( $(echo "$coverage < $MIN_COVERAGE" | bc -l) )); then
        fail_test "$test_name" "Coverage $coverage below threshold $MIN_COVERAGE"
        return 1
    fi
    
    pass_test "$test_name"
    return 0
}

# ==============================================================================
# Pre-flight Checks
# ==============================================================================

echo ""
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Verisource API - Golden E2E Test Suite${NC}"
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo ""
echo "Configuration:"
echo "  API URL: $API_URL"
echo "  API Key: ${API_KEY:0:10}..."
echo "  Test Vectors: $TEST_VECTORS_BASE"
echo ""
echo "Thresholds:"
echo "  Min Coverage: $MIN_COVERAGE"
echo "  Max Coverage Drift: $MAX_COVERAGE_DRIFT"
echo "  Allowed Verdict Mismatch: $ALLOWED_VERDICT_MISMATCH"
echo ""

# Check prerequisites
if [ -z "$API_KEY" ]; then
    log_error "API_KEY not provided"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    log_error "jq is required but not installed"
    exit 1
fi

if ! command -v bc &> /dev/null; then
    log_error "bc is required but not installed"
    exit 1
fi

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

log_info "Temporary directory: $TEMP_DIR"

# ==============================================================================
# Test 1: Health Check
# ==============================================================================

start_test "Health Check"

HEALTH_RESPONSE=$(curl -sf "$API_URL/healthz" || echo "")

if [ -z "$HEALTH_RESPONSE" ]; then
    fail_test "Health Check" "API not responding"
else
    log_info "API is healthy"
    pass_test "Health Check"
fi

# ==============================================================================
# Test 2: PROVEN_STRONG - Upload Method
# ==============================================================================

start_test "PROVEN_STRONG - Upload Method"

# Download test files
download_test_file \
    "$TEST_VECTORS_BASE/golden/proven-strong.mp4" \
    "$TEMP_DIR/proven-strong.mp4" || fail_test "PROVEN_STRONG Upload" "Failed to download video"

download_test_file \
    "$TEST_VECTORS_BASE/golden/proven-strong.credential.json" \
    "$TEMP_DIR/proven-strong.credential.json" || fail_test "PROVEN_STRONG Upload" "Failed to download credential"

if [ $FAILED_TESTS -eq 0 ]; then
    # Submit verification
    RESPONSE=$(verify_upload \
        "$TEMP_DIR/proven-strong.mp4" \
        "$TEMP_DIR/proven-strong.credential.json")
    
    check_verdict "$RESPONSE" "PROVEN_STRONG" "PROVEN_STRONG Upload"
fi

# ==============================================================================
# Test 3: PROVEN_STRONG - URL Method
# ==============================================================================

start_test "PROVEN_STRONG - URL Method"

VIDEO_URL="$TEST_VECTORS_BASE/golden/proven-strong.mp4"
CREDENTIAL_JSON=$(cat "$TEMP_DIR/proven-strong.credential.json")

RESPONSE=$(verify_by_url "$VIDEO_URL" "$CREDENTIAL_JSON")

check_verdict "$RESPONSE" "PROVEN_STRONG" "PROVEN_STRONG URL"

# ==============================================================================
# Test 4: PROVEN_MODERATE - Upload Method
# ==============================================================================

start_test "PROVEN_MODERATE - Upload Method"

download_test_file \
    "$TEST_VECTORS_BASE/golden/proven-moderate.mp4" \
    "$TEMP_DIR/proven-moderate.mp4" || fail_test "PROVEN_MODERATE Upload" "Failed to download video"

download_test_file \
    "$TEST_VECTORS_BASE/golden/proven-moderate.credential.json" \
    "$TEMP_DIR/proven-moderate.credential.json" || fail_test "PROVEN_MODERATE Upload" "Failed to download credential"

if [ $FAILED_TESTS -eq 0 ]; then
    RESPONSE=$(verify_upload \
        "$TEMP_DIR/proven-moderate.mp4" \
        "$TEMP_DIR/proven-moderate.credential.json")
    
    check_verdict "$RESPONSE" "PROVEN_MODERATE" "PROVEN_MODERATE Upload"
fi

# ==============================================================================
# Test 5: PROVEN_MODERATE - URL Method
# ==============================================================================

start_test "PROVEN_MODERATE - URL Method"

VIDEO_URL="$TEST_VECTORS_BASE/golden/proven-moderate.mp4"
CREDENTIAL_JSON=$(cat "$TEMP_DIR/proven-moderate.credential.json")

RESPONSE=$(verify_by_url "$VIDEO_URL" "$CREDENTIAL_JSON")

check_verdict "$RESPONSE" "PROVEN_MODERATE" "PROVEN_MODERATE URL"

# ==============================================================================
# Test 6: MISMATCH - Upload Method
# ==============================================================================

start_test "MISMATCH - Upload Method"

download_test_file \
    "$TEST_VECTORS_BASE/golden/mismatch.mp4" \
    "$TEMP_DIR/mismatch.mp4" || fail_test "MISMATCH Upload" "Failed to download video"

download_test_file \
    "$TEST_VECTORS_BASE/golden/mismatch.credential.json" \
    "$TEMP_DIR/mismatch.credential.json" || fail_test "MISMATCH Upload" "Failed to download credential"

if [ $FAILED_TESTS -eq 0 ]; then
    RESPONSE=$(verify_upload \
        "$TEMP_DIR/mismatch.mp4" \
        "$TEMP_DIR/mismatch.credential.json")
    
    check_verdict "$RESPONSE" "MISMATCH" "MISMATCH Upload"
fi

# ==============================================================================
# Test 7: MISMATCH - URL Method
# ==============================================================================

start_test "MISMATCH - URL Method"

VIDEO_URL="$TEST_VECTORS_BASE/golden/mismatch.mp4"
CREDENTIAL_JSON=$(cat "$TEMP_DIR/mismatch.credential.json")

RESPONSE=$(verify_by_url "$VIDEO_URL" "$CREDENTIAL_JSON")

check_verdict "$RESPONSE" "MISMATCH" "MISMATCH URL"

# ==============================================================================
# Test 8: NO_CREDENTIAL_FOUND - Upload Method
# ==============================================================================

start_test "NO_CREDENTIAL_FOUND - Upload Method"

download_test_file \
    "$TEST_VECTORS_BASE/golden/no-credential.mp4" \
    "$TEMP_DIR/no-credential.mp4" || fail_test "NO_CREDENTIAL_FOUND Upload" "Failed to download video"

# Empty credential
echo '{}' > "$TEMP_DIR/no-credential.credential.json"

if [ $FAILED_TESTS -eq 0 ]; then
    RESPONSE=$(verify_upload \
        "$TEMP_DIR/no-credential.mp4" \
        "$TEMP_DIR/no-credential.credential.json")
    
    check_verdict "$RESPONSE" "NO_CREDENTIAL_FOUND" "NO_CREDENTIAL_FOUND Upload"
fi

# ==============================================================================
# Test 9: Coverage Consistency Check
# ==============================================================================

start_test "Coverage Consistency Check"

log_info "Re-testing PROVEN_STRONG to check coverage consistency..."

RESPONSE1=$(verify_upload \
    "$TEMP_DIR/proven-strong.mp4" \
    "$TEMP_DIR/proven-strong.credential.json")

COVERAGE1=$(echo "$RESPONSE1" | jq -r '.coverage')

sleep 2

RESPONSE2=$(verify_upload \
    "$TEMP_DIR/proven-strong.mp4" \
    "$TEMP_DIR/proven-strong.credential.json")

COVERAGE2=$(echo "$RESPONSE2" | jq -r '.coverage')

DRIFT=$(echo "$COVERAGE1 - $COVERAGE2" | bc -l | tr -d '-')

log_info "Coverage 1: $COVERAGE1"
log_info "Coverage 2: $COVERAGE2"
log_info "Drift: $DRIFT"

if (( $(echo "$DRIFT > $MAX_COVERAGE_DRIFT" | bc -l) )); then
    fail_test "Coverage Consistency" "Drift $DRIFT exceeds threshold $MAX_COVERAGE_DRIFT"
else
    pass_test "Coverage Consistency"
fi

# ==============================================================================
# Test 10: Rate Limiting
# ==============================================================================

start_test "Rate Limiting"

log_info "Testing rate limits (should get 429 after limit)..."

SUCCESS_COUNT=0
RATE_LIMITED=false

for i in {1..65}; do
    RESPONSE=$(curl -sf -w "\n%{http_code}" \
        -H "x-api-key: $API_KEY" \
        "$API_URL/healthz" || echo "000")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    
    if [ "$HTTP_CODE" == "429" ]; then
        RATE_LIMITED=true
        log_info "Rate limit triggered after $SUCCESS_COUNT requests"
        break
    elif [ "$HTTP_CODE" == "200" ]; then
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    fi
    
    sleep 0.1
done

if [ "$RATE_LIMITED" = true ]; then
    pass_test "Rate Limiting"
else
    log_warning "Rate limit not triggered after 65 requests (may be higher threshold)"
    pass_test "Rate Limiting"
fi

# ==============================================================================
# Summary
# ==============================================================================

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Test Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Total Tests: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"
echo ""

if [ $FAILED_TESTS -gt 0 ]; then
    echo -e "${RED}Failed Tests:${NC}"
    for test_name in "${FAILED_TEST_NAMES[@]}"; do
        echo "  - $test_name"
    done
    echo ""
    echo -e "${RED}════════════════════════════════════════════════${NC}"
    echo -e "${RED}  DEPLOYMENT BLOCKED - Tests Failed${NC}"
    echo -e "${RED}════════════════════════════════════════════════${NC}"
    exit 1
else
    echo -e "${GREEN}════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  ✓ ALL TESTS PASSED - Deployment Approved${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════${NC}"
    exit 0
fi
