#!/bin/bash
# ==============================================================================
# SECURITY VALIDATION CHECKLIST
# ==============================================================================
#
# Validates all security controls are in place
# Run before promoting to production
#
# Usage:
#   ./security-validation.sh <namespace>
#
# ==============================================================================

set -eo pipefail

NAMESPACE="${1:-verisource-stg}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_WARNING=0

check_pass() {
    echo -e "${GREEN}[✓]${NC} $1"
    CHECKS_PASSED=$((CHECKS_PASSED + 1))
}

check_fail() {
    echo -e "${RED}[✗]${NC} $1"
    echo -e "    Reason: $2"
    CHECKS_FAILED=$((CHECKS_FAILED + 1))
}

check_warn() {
    echo -e "${YELLOW}[!]${NC} $1"
    echo -e "    Warning: $2"
    CHECKS_WARNING=$((CHECKS_WARNING + 1))
}

echo ""
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Security Validation Checklist${NC}"
echo -e "${GREEN}════════════════════════════════════════════════${NC}"
echo ""
echo "Namespace: $NAMESPACE"
echo ""

# ==============================================================================
# 1. Read-Only Root Filesystem
# ==============================================================================

echo -e "${BLUE}1. Read-Only Root Filesystem${NC}"

READONLY_FS=$(kubectl -n "$NAMESPACE" get deployment verisource-api \
    -o jsonpath='{.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem}')

if [ "$READONLY_FS" == "true" ]; then
    check_pass "Read-only root filesystem enabled"
else
    check_fail "Read-only root filesystem NOT enabled" "Set readOnlyRootFilesystem: true"
fi

# ==============================================================================
# 2. /tmp tmpfs Volume
# ==============================================================================

echo -e "${BLUE}2. /tmp tmpfs Volume${NC}"

TMPFS_VOLUME=$(kubectl -n "$NAMESPACE" get deployment verisource-api \
    -o jsonpath='{.spec.template.spec.volumes[?(@.name=="tmp")].emptyDir.medium}')

if [ "$TMPFS_VOLUME" == "Memory" ]; then
    check_pass "/tmp mounted as tmpfs (memory-backed)"
    
    # Check size limit
    SIZE_LIMIT=$(kubectl -n "$NAMESPACE" get deployment verisource-api \
        -o jsonpath='{.spec.template.spec.volumes[?(@.name=="tmp")].emptyDir.sizeLimit}')
    echo "    Size limit: $SIZE_LIMIT"
else
    check_fail "/tmp NOT mounted as tmpfs" "Set emptyDir.medium: Memory"
fi

# ==============================================================================
# 3. Non-Root User
# ==============================================================================

echo -e "${BLUE}3. Non-Root User${NC}"

RUN_AS_USER=$(kubectl -n "$NAMESPACE" get deployment verisource-api \
    -o jsonpath='{.spec.template.spec.securityContext.runAsUser}')

if [ "$RUN_AS_USER" == "1001" ]; then
    check_pass "Running as non-root user (UID 1001)"
else
    check_fail "NOT running as expected non-root user" "Expected UID 1001, got $RUN_AS_USER"
fi

# ==============================================================================
# 4. Capabilities Dropped
# ==============================================================================

echo -e "${BLUE}4. Capabilities Dropped${NC}"

CAPABILITIES=$(kubectl -n "$NAMESPACE" get deployment verisource-api \
    -o jsonpath='{.spec.template.spec.containers[0].securityContext.capabilities.drop[0]}')

if [ "$CAPABILITIES" == "ALL" ]; then
    check_pass "All capabilities dropped"
else
    check_fail "Capabilities not properly dropped" "Set capabilities.drop: [ALL]"
fi

# ==============================================================================
# 5. Network Policy
# ==============================================================================

echo -e "${BLUE}5. Network Policy${NC}"

NP_EXISTS=$(kubectl -n "$NAMESPACE" get networkpolicy verisource-api-np \
    -o name 2>/dev/null || echo "")

if [ -n "$NP_EXISTS" ]; then
    check_pass "NetworkPolicy exists"
    
    # Check ingress rules
    INGRESS_COUNT=$(kubectl -n "$NAMESPACE" get networkpolicy verisource-api-np \
        -o jsonpath='{.spec.ingress}' | jq 'length')
    echo "    Ingress rules: $INGRESS_COUNT"
    
    # Check egress rules
    EGRESS_COUNT=$(kubectl -n "$NAMESPACE" get networkpolicy verisource-api-np \
        -o jsonpath='{.spec.egress}' | jq 'length')
    echo "    Egress rules: $EGRESS_COUNT"
else
    check_fail "NetworkPolicy NOT found" "Apply NetworkPolicy manifest"
fi

# ==============================================================================
# 6. CORS Allowlist
# ==============================================================================

echo -e "${BLUE}6. CORS Allowlist${NC}"

CORS_ORIGINS=$(kubectl -n "$NAMESPACE" get deployment verisource-api \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="ALLOWED_ORIGINS")].value}')

if [ -n "$CORS_ORIGINS" ]; then
    check_pass "CORS allowlist configured"
    echo "    Origins: $CORS_ORIGINS"
    
    # Check for wildcards
    if [[ "$CORS_ORIGINS" == *"*"* ]]; then
        check_warn "CORS contains wildcard" "Use explicit origins in production"
    fi
else
    check_warn "CORS allowlist not set" "Consider setting ALLOWED_ORIGINS"
fi

# ==============================================================================
# 7. Fetch URL Allowlist
# ==============================================================================

echo -e "${BLUE}7. Fetch URL Allowlist${NC}"

FETCH_HOSTS=$(kubectl -n "$NAMESPACE" get deployment verisource-api \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="ALLOWED_FETCH_HOSTS")].value}')

if [ -n "$FETCH_HOSTS" ]; then
    check_pass "Fetch URL allowlist configured"
    echo "    Hosts: $FETCH_HOSTS"
    
    # Count hosts
    HOST_COUNT=$(echo "$FETCH_HOSTS" | tr ',' '\n' | wc -l)
    if [ "$HOST_COUNT" -gt 10 ]; then
        check_warn "Large fetch allowlist ($HOST_COUNT hosts)" "Keep allowlist minimal"
    fi
else
    check_fail "Fetch URL allowlist NOT set" "Set ALLOWED_FETCH_HOSTS"
fi

# ==============================================================================
# 8. TLS/HTTPS
# ==============================================================================

echo -e "${BLUE}8. TLS/HTTPS${NC}"

INGRESS_TLS=$(kubectl -n "$NAMESPACE" get ingress verisource-api \
    -o jsonpath='{.spec.tls}' 2>/dev/null || echo "")

if [ -n "$INGRESS_TLS" ]; then
    check_pass "TLS configured on Ingress"
    
    # Check certificate
    CERT_NAME=$(echo "$INGRESS_TLS" | jq -r '.[0].secretName')
    CERT_STATUS=$(kubectl -n "$NAMESPACE" get certificate "$CERT_NAME" \
        -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "")
    
    if [ "$CERT_STATUS" == "True" ]; then
        check_pass "TLS certificate is ready"
    else
        check_fail "TLS certificate not ready" "Check cert-manager"
    fi
else
    check_fail "TLS NOT configured" "Add TLS section to Ingress"
fi

# ==============================================================================
# 9. Secrets Management
# ==============================================================================

echo -e "${BLUE}9. Secrets Management${NC}"

SA_ANNOTATION=$(kubectl -n "$NAMESPACE" get serviceaccount verisource-api \
    -o jsonpath='{.metadata.annotations}' | jq -r 'keys[]' | grep -E '(eks\.amazonaws\.com|iam\.gke\.io|azure\.workload\.identity)' || echo "")

if [ -n "$SA_ANNOTATION" ]; then
    check_pass "Cloud Workload Identity configured"
    echo "    Annotation: $SA_ANNOTATION"
else
    check_warn "Cloud Workload Identity not detected" "Verify IRSA/Workload Identity setup"
fi

# ==============================================================================
# 10. Resource Limits
# ==============================================================================

echo -e "${BLUE}10. Resource Limits${NC}"

CPU_LIMIT=$(kubectl -n "$NAMESPACE" get deployment verisource-api \
    -o jsonpath='{.spec.template.spec.containers[0].resources.limits.cpu}')

MEM_LIMIT=$(kubectl -n "$NAMESPACE" get deployment verisource-api \
    -o jsonpath='{.spec.template.spec.containers[0].resources.limits.memory}')

if [ -n "$CPU_LIMIT" ] && [ -n "$MEM_LIMIT" ]; then
    check_pass "Resource limits configured"
    echo "    CPU limit: $CPU_LIMIT"
    echo "    Memory limit: $MEM_LIMIT"
else
    check_fail "Resource limits NOT set" "Set CPU and memory limits"
fi

# ==============================================================================
# 11. Edge Rate Limiting
# ==============================================================================

echo -e "${BLUE}11. Edge Rate Limiting${NC}"

INGRESS_RATE_LIMIT=$(kubectl -n "$NAMESPACE" get ingress verisource-api \
    -o jsonpath='{.metadata.annotations.nginx\.ingress\.kubernetes\.io/limit-rps}' 2>/dev/null || echo "")

if [ -n "$INGRESS_RATE_LIMIT" ]; then
    check_pass "Ingress rate limiting configured"
    echo "    RPS limit: $INGRESS_RATE_LIMIT"
else
    check_warn "Ingress rate limiting not set" "Add nginx rate limit annotations"
fi

# ==============================================================================
# 12. /metrics Access Control
# ==============================================================================

echo -e "${BLUE}12. /metrics Access Control${NC}"

METRICS_CONFIG=$(kubectl -n "$NAMESPACE" get ingress verisource-api \
    -o jsonpath='{.metadata.annotations.nginx\.ingress\.kubernetes\.io/server-snippet}' | grep -c "location = /metrics" || echo "0")

if [ "$METRICS_CONFIG" -gt 0 ]; then
    check_pass "/metrics endpoint access restricted"
else
    check_warn "/metrics may be publicly accessible" "Restrict /metrics in Ingress config"
fi

# ==============================================================================
# Summary
# ==============================================================================

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Security Validation Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}Passed: $CHECKS_PASSED${NC}"
echo -e "${YELLOW}Warnings: $CHECKS_WARNING${NC}"
echo -e "${RED}Failed: $CHECKS_FAILED${NC}"
echo ""

if [ $CHECKS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ Security validation passed${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Security validation failed${NC}"
    echo -e "${RED}Fix the failed checks before promoting to production${NC}"
    echo ""
    exit 1
fi
