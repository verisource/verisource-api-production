
# syntax=docker/dockerfile:1.6
# ==============================================================================
# Production Dockerfile for Verisource Video Verification API
# ==============================================================================
# - Multi-stage build for smaller image
# - Non-root user (UID 1001)
# - Health checks for orchestration
# - Tini for proper signal handling
# - BuildKit cache for faster builds
# - Minimal attack surface (no-install-recommends)
# - Source maps enabled (you can disable in prod later)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Builder
# ------------------------------------------------------------------------------
FROM node:20-bullseye AS builder

WORKDIR /build

# Copy package files for dependency installation
COPY package*.json ./
COPY tsconfig.json ./

# Use BuildKit cache for faster npm ci
RUN --mount=type=cache,target=/root/.npm npm ci

# Copy source code
COPY src/ ./src/
COPY worker/ ./worker/

# Build TypeScript
RUN npm run build

# Prune dev dependencies (leave only prod deps)
RUN npm prune --production

# ------------------------------------------------------------------------------
# Stage 2: Production
# ------------------------------------------------------------------------------
FROM node:20-bullseye-slim

# Install system dependencies (pin ffmpeg; hold to avoid surprise upgrades)
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ffmpeg=7:4.3.6-0+deb11u1 \
      tini \
      ca-certificates && \
    apt-mark hold ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Quick sanity check of ffmpeg tools (optional but helpful)
RUN ffmpeg -version && ffprobe -version

WORKDIR /app

# Create runtime user (UID 1001; primary group root for OpenShift compat)
RUN useradd -r -u 1001 -g root appuser

# Copy built app from builder with proper ownership
COPY --from=builder --chown=1001:0 /build/dist ./dist
COPY --from=builder --chown=1001:0 /build/node_modules ./node_modules
COPY --from=builder --chown=1001:0 /build/package*.json ./

# Copy runtime assets (workers, schema) with proper ownership
COPY --chown=1001:0 worker/ ./worker/
COPY --chown=1001:0 src/schema/ ./src/schema/

# Tighten permissions AFTER all copies
RUN chmod -R 750 /app && \
    mkdir -p /tmp && chmod 1777 /tmp

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8080

# Environment
ENV NODE_ENV=production \
    PORT=8080 \
    LOG_LEVEL=info \
    TZ=UTC \
    NODE_OPTIONS=--enable-source-maps

# Health check (expects { ok: true } from /healthz)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/healthz',r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{process.exit(JSON.parse(b).ok?0:1)}catch(e){process.exit(1)}})}).on('error',()=>process.exit(1))"

# Use tini as PID1
ENTRYPOINT ["/usr/bin/tini", "--"]

# Start application
CMD ["node", "dist/server.js"]

# ==============================================================================
# OCI Image Labels (metadata & provenance)
# ==============================================================================
LABEL org.opencontainers.image.title="Verisource Video Verification API" \
      org.opencontainers.image.description="Production API for video verification with C2PA/credential V3 support" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.vendor="Verisource" \
      org.opencontainers.image.source="https://github.com/verisource/verifier-api" \
      org.opencontainers.image.licenses="Apache-2.0" \
      maintainer="platform@verisource.io"
