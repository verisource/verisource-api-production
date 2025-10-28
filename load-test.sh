#!/bin/bash
# ==============================================================================
# LOAD TEST - Capacity Planning
# ==============================================================================
#
# Light load test to determine capacity per pod
# Tests sustained load with realistic video sizes
#
# Usage:
#   ./load-test.sh <api-url> <api-key> <rps> <duration-minutes>
#
# Example:
#   ./load-test.sh https://stg-api.verisource.io stg_key_1 5 15
#
# ==============================================================================

set -eo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
API_URL="${1:-https://stg-api.verisource.io}"
API_KEY="${2:-$API_KEY}"
TARGET_RPS="${3:-5}"
DURATION_MINUTES="${4:-15}"
VIDEO_SIZE_MB="${5:-75}"  # 50-100MB range

DURATION_SECONDS=$((DURATION_MINUTES * 60))
TOTAL_REQUESTS=$((TARGET_RPS * DURATION_SECONDS))

# Results tracking
declare -a LATENCIES
declare -a STATUS_CODES
SUCCESS_COUNT=0
ERROR_COUNT=0
RATE_LIMITED_COUNT=0

echo ""
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Verisource API - Load Test${NC}"
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo ""
echo "Configuration:"
echo "  API URL: $API_URL"
echo "  Target RPS: $TARGET_RPS"
echo "  Duration: $DURATION_MINUTES minutes ($DURATION_SECONDS seconds)"
echo "  Total Requests: $TOTAL_REQUESTS"
echo "  Video Size: ~${VIDEO_SIZE_MB}MB"
echo ""

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Generate test video (simple MP4 of specified size)
echo -e "${BLUE}[INFO]${NC} Generating test video..."
dd if=/dev/urandom of="$TEMP_DIR/test-video.mp4" bs=1M count=$VIDEO_SIZE_MB 2>/dev/null

# Generate minimal C2PA credential
cat > "$TEMP_DIR/credential.json" <<EOF
{
  "assertions": [
    {
      "label": "c2pa.actions",
      "data": {
        "actions": [
          {
            "action": "c2pa.created"
          }
        ]
      }
    }
  ]
}
EOF

VIDEO_SIZE=$(stat -f%z "$TEMP_DIR/test-video.mp4" 2>/dev/null || stat -c%s "$TEMP_DIR/test-video.mp4")
echo -e "${GREEN}[✓]${NC} Test video generated: $(echo "scale=2; $VIDEO_SIZE / 1024 / 1024" | bc)MB"
echo ""

# Function to make single request
make_request() {
    local start=$(date +%s.%N)
    
    local response=$(curl -sf -w "\n%{http_code}" \
        -H "x-api-key: $API_KEY" \
        -F "file=@$TEMP_DIR/test-video.mp4" \
        -F "credential=@$TEMP_DIR/credential.json;type=application/json" \
        "$API_URL/verify" 2>&1)
    
    local end=$(date +%s.%N)
    local duration=$(echo "$end - $start" | bc)
    
    local http_code=$(echo "$response" | tail -n1)
    
    echo "$duration|$http_code"
}

# Start load test
echo -e "${BLUE}[INFO]${NC} Starting load test..."
echo -e "${BLUE}[INFO]${NC} Press Ctrl+C to stop early"
echo ""

START_TIME=$(date +%s)
REQUEST_COUNT=0
INTERVAL=$(echo "1.0 / $TARGET_RPS" | bc -l)

while [ $REQUEST_COUNT -lt $TOTAL_REQUESTS ]; do
    REQUEST_COUNT=$((REQUEST_COUNT + 1))
    ELAPSED=$(($(date +%s) - START_TIME))
    
    # Make request in background
    (
        RESULT=$(make_request)
        LATENCY=$(echo "$RESULT" | cut -d'|' -f1)
        STATUS=$(echo "$RESULT" | cut -d'|' -f2)
        
        echo "$LATENCY" >> "$TEMP_DIR/latencies.txt"
        echo "$STATUS" >> "$TEMP_DIR/statuses.txt"
    ) &
    
    # Progress update every 30 seconds
    if [ $((REQUEST_COUNT % (TARGET_RPS * 30))) -eq 0 ]; then
        echo -e "${BLUE}[INFO]${NC} Progress: $REQUEST_COUNT/$TOTAL_REQUESTS requests (${ELAPSED}s elapsed)"
    fi
    
    # Rate limiting
    sleep $INTERVAL
done

# Wait for all background jobs
echo -e "${BLUE}[INFO]${NC} Waiting for all requests to complete..."
wait

echo -e "${GREEN}[✓]${NC} Load test complete"
echo ""

# ==============================================================================
# Results Analysis
# ==============================================================================

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Results Analysis${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Parse results
if [ -f "$TEMP_DIR/latencies.txt" ]; then
    mapfile -t LATENCIES < "$TEMP_DIR/latencies.txt"
fi

if [ -f "$TEMP_DIR/statuses.txt" ]; then
    mapfile -t STATUS_CODES < "$TEMP_DIR/statuses.txt"
fi

# Count status codes
for code in "${STATUS_CODES[@]}"; do
    if [ "$code" == "200" ]; then
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    elif [ "$code" == "429" ]; then
        RATE_LIMITED_COUNT=$((RATE_LIMITED_COUNT + 1))
    else
        ERROR_COUNT=$((ERROR_COUNT + 1))
    fi
done

# Calculate latency percentiles
if [ ${#LATENCIES[@]} -gt 0 ]; then
    # Sort latencies
    IFS=$'\n' SORTED_LATENCIES=($(sort -n <<<"${LATENCIES[*]}"))
    unset IFS
    
    # Calculate percentiles
    P50_INDEX=$(( ${#SORTED_LATENCIES[@]} * 50 / 100 ))
    P95_INDEX=$(( ${#SORTED_LATENCIES[@]} * 95 / 100 ))
    P99_INDEX=$(( ${#SORTED_LATENCIES[@]} * 99 / 100 ))
    
    P50_LATENCY=${SORTED_LATENCIES[$P50_INDEX]}
    P95_LATENCY=${SORTED_LATENCIES[$P95_INDEX]}
    P99_LATENCY=${SORTED_LATENCIES[$P99_INDEX]}
    MIN_LATENCY=${SORTED_LATENCIES[0]}
    MAX_LATENCY=${SORTED_LATENCIES[-1]}
    
    # Calculate average
    SUM=0
    for lat in "${LATENCIES[@]}"; do
        SUM=$(echo "$SUM + $lat" | bc)
    done
    AVG_LATENCY=$(echo "scale=2; $SUM / ${#LATENCIES[@]}" | bc)
fi

# Print results
echo "Request Summary:"
echo "  Total Requests: ${#STATUS_CODES[@]}"
echo "  Successful (200): $SUCCESS_COUNT"
echo "  Rate Limited (429): $RATE_LIMITED_COUNT"
echo "  Errors (5xx): $ERROR_COUNT"
echo ""

echo "Latency (seconds):"
echo "  Min: ${MIN_LATENCY}s"
echo "  P50 (median): ${P50_LATENCY}s"
echo "  Avg: ${AVG_LATENCY}s"
echo "  P95: ${P95_LATENCY}s"
echo "  P99: ${P99_LATENCY}s"
echo "  Max: ${MAX_LATENCY}s"
echo ""

# Success rate
SUCCESS_RATE=$(echo "scale=2; $SUCCESS_COUNT * 100 / ${#STATUS_CODES[@]}" | bc)
echo "Success Rate: ${SUCCESS_RATE}%"
echo ""

# ==============================================================================
# Capacity Recommendation
# ==============================================================================

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Capacity Recommendations${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Query Kubernetes for resource usage
if command -v kubectl &> /dev/null; then
    echo "Kubernetes Metrics (during test):"
    echo ""
    
    # Get pod metrics
    POD_METRICS=$(kubectl -n verisource-stg top pods -l app=verisource-api 2>/dev/null || echo "")
    
    if [ -n "$POD_METRICS" ]; then
        echo "$POD_METRICS"
        echo ""
        
        # Parse CPU and memory usage
        AVG_CPU=$(echo "$POD_METRICS" | tail -n +2 | awk '{sum+=$2; count++} END {print sum/count}' | sed 's/m//')
        AVG_MEM=$(echo "$POD_METRICS" | tail -n +2 | awk '{sum+=$3; count++} END {print sum/count}' | sed 's/Mi//')
        
        echo "Average per pod during test:"
        echo "  CPU: ${AVG_CPU}m (millicores)"
        echo "  Memory: ${AVG_MEM}Mi"
        echo ""
    fi
fi

# Capacity estimate
if (( $(echo "$SUCCESS_RATE > 95" | bc -l) )); then
    echo -e "${GREEN}✓ Capacity Test: PASSED${NC}"
    echo ""
    echo "Recommendations:"
    echo "  • 1 pod can handle ~${TARGET_RPS} RPS"
    echo "  • P95 latency: ${P95_LATENCY}s"
    echo "  • Suggested HPA target: 70% CPU utilization"
    echo "  • Safe to increase to $((TARGET_RPS * 2)) RPS per pod"
else
    echo -e "${RED}✗ Capacity Test: MARGINAL${NC}"
    echo ""
    echo "Recommendations:"
    echo "  • 1 pod handles ${TARGET_RPS} RPS at ${SUCCESS_RATE}% success rate"
    echo "  • Consider lowering target RPS per pod"
    echo "  • Investigate errors and rate limits"
fi

echo ""
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Load Test Complete${NC}"
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
