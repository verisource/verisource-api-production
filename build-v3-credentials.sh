#!/usr/bin/env bash
# Build V3 credentials from video-worker outputs
# Requirements: bash, jq, uuidgen
# Usage:
#   CREATOR_DID="did:key:z6Mk..." \
#   CREATOR_TYPE="human" \
#   REVOCATION_BASE="https://revocation.example.com/v1/cred" \
#   MEDIA_TYPE="video/mp4" \
#   INPUT_DIR="/tmp" \
#   OUTPUT_DIR="./golden-tests/test-vectors" \
#   VERSION="3.0.0" \
#   ./build-v3-credentials.sh
#
# Notes:
# - Uses worker's canonicalization & segmentHashes as-is.
# - Fills sha256_canonical with a placeholder (not used by your verifier).
# - Writes one credential per *-worker.json with the same base name.

set -euo pipefail

echo "========================================="
echo "  Building V3 Credentials from Worker JSON"
echo "========================================="
echo ""

# ---------- Config ----------
CREATOR_DID="${CREATOR_DID:-did:key:z6MkExampleCreatorDid}"
CREATOR_TYPE="${CREATOR_TYPE:-human}"          # human | ai-system | human-ai-collaboration
REVOCATION_BASE="${REVOCATION_BASE:-https://revocation.example.com/v1/cred}"
MEDIA_TYPE="${MEDIA_TYPE:-video/mp4}"
INPUT_DIR="${INPUT_DIR:-/tmp}"
OUTPUT_DIR="${OUTPUT_DIR:-./golden-tests/test-vectors}"
VERSION="${VERSION:-3.0.0}"

# ---------- Preflight ----------
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required"; exit 1; }
command -v uuidgen >/dev/null 2>&1 || { echo "ERROR: uuidgen is required"; exit 1; }

mkdir -p "$OUTPUT_DIR"

# ---------- Helpers ----------
is_valid_uuid() {
  [[ "$1" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]
}

now_rfc3339_sec() {
  # UTC, seconds precision
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# ---------- Build loop ----------
shopt -s nullglob
files=("$INPUT_DIR"/*-worker.json)

if [ ${#files[@]} -eq 0 ]; then
  echo "No *-worker.json files found in $INPUT_DIR"
  echo "Run your worker first (e.g., node worker/video-worker.js <url> > /tmp/name-worker.json)"
  exit 1
fi

for w in "${files[@]}"; do
  base="$(basename "$w")"
  name="${base%-worker.json}"
  out="$OUTPUT_DIR/${name}.credential.json"

  echo "[${name}] Reading $w"

  # Extract fields from worker output
  CANON=$(jq -r '.canonicalization // empty' "$w")
  SEGMENTS=$(jq -r '.segmentHashes // empty' "$w")
  DUR=$(jq -r '.duration // empty' "$w" 2>/dev/null || echo "")

  # Basic validation of worker fields
  if [[ -z "$CANON" ]]; then
    echo "[${name}] ERROR: canonicalization missing in worker JSON"
    exit 1
  fi
  if [[ "$CANON" != vid:v1* ]]; then
    echo "[${name}] ERROR: canonicalization must start with 'vid:v1' (got: $CANON)"
    exit 1
  fi
  if [[ -z "$SEGMENTS" || "$(jq 'length' <<<"$SEGMENTS")" -eq 0 ]]; then
    echo "[${name}] ERROR: segmentHashes[] missing or empty"
    exit 1
  fi

  CREATED="$(now_rfc3339_sec)"
  ISSUED="$CREATED"
  CID="$(uuidgen | tr 'A-Z' 'a-z')"

  # Assemble credential JSON via jq
  # Note: sha256_canonical is a placeholder; replace with a computed value later if desired.
  jq -n --arg cid "$CID" \
        --arg ver "$VERSION" \
        --arg mt "$MEDIA_TYPE" \
        --arg did "$CREATOR_DID" \
        --arg ctype "$CREATOR_TYPE" \
        --arg created "$CREATED" \
        --arg issued "$ISSUED" \
        --arg canon "$CANON" \
        --arg revbase "$REVOCATION_BASE" \
        --arg title "Golden: ${name}" \
        --argjson seg "$(jq '.segmentHashes' "$w")" \
        --argjson dur "$(jq -n --arg d "$DUR" 'if ($d|length)>0 then ($d|tonumber) else empty end')" '
  {
    credentialId: $cid,
    version: $ver,
    mediaType: $mt,
    fingerprintBundle: {
      sha256_canonical: ("0" * 64),
      algorithm: "sha256+rolling_segments",
      canonicalization: $canon,
      segmentHashes: $seg
    },
    creator: { did: $did, type: $ctype },
    timestamp: { created: $created, issued: $issued },
    contentMetadata: (
      if $dur == null then
        { title: $title }
      else
        { title: $title, dimensions: { duration: $dur } }
      end
    ),
    revocationPointer: ($revbase + "/" + $cid)
  }' > "$out"

  echo "[${name}] Wrote credential → $out"
done

echo ""
echo "========================================="
echo "  Done."
echo "========================================="
echo ""
echo "Next:"
echo "  1) (Optional) Validate against your V3 schema with ajv/ci."
echo "  2) Point your golden test runner at these credentials:"
echo "       ./golden-tests/test-vectors/*.credential.json"
echo "  3) Record snapshots, then validate:"
echo "       UPDATE_SNAPSHOTS=true node golden-test-runner.js"
echo "       node golden-test-runner.js"
