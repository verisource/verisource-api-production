# Docker Deployment Guide

Complete guide to deploying the Verisource Video Verification API with Docker.

## 🎯 Features

**Production-Ready Dockerfile:**
- ✅ Multi-stage build (smaller images)
- ✅ Non-root user (security)
- ✅ Health checks (orchestration)
- ✅ Tini init system (proper signal handling)
- ✅ Pinned FFmpeg version (reproducibility)
- ✅ Minimal attack surface

## 🚀 Quick Start

### 1. Build Image

```bash
# Build the image
docker build -t verisource-api:latest .

# Check image size
docker images verisource-api:latest
# Expected: ~400-500MB
```

### 2. Run Container

```bash
# Create .env file
cat > .env << EOF
NODE_ENV=production
API_KEYS=your-secret-key-here
ALLOWED_ORIGINS=https://app.example.com
ALLOWED_FETCH_HOSTS=cdn.example.com
MAX_FILE_MB=250
MAX_DURATION_SECONDS=300
EOF

# Run with environment file
docker run -d \
  --name verisource-api \
  -p 8080:8080 \
  --env-file .env \
  verisource-api:latest

# Check status
docker ps
docker logs verisource-api
```

### 3. Verify Health

```bash
# Check health status
docker inspect --format='{{json .State.Health}}' verisource-api | jq

# Manual health check
curl http://localhost:8080/healthz
```

## 📦 Dockerfile Breakdown

### Multi-Stage Build

**Stage 1: Builder**
```dockerfile
FROM node:20-bullseye AS builder

WORKDIR /build

# Install all dependencies (including dev)
COPY package*.json ./
RUN npm ci

# Build TypeScript
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --production
```

**Benefits:**
- Separate build and runtime environments
- Smaller final image (no dev dependencies)
- Faster builds (layer caching)

---

**Stage 2: Production**
```dockerfile
FROM node:20-bullseye-slim

# Install FFmpeg + Tini
RUN apt-get update && apt-get install -y \
    ffmpeg=7:4.3.6-0+deb11u1 \
    tini=0.19.0-1 \
    ca-certificates \
 && apt-mark hold ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Copy from builder
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
```

**Benefits:**
- Slim base image (~200MB vs ~900MB)
- Only runtime dependencies
- Pinned FFmpeg version

### Non-Root User

```dockerfile
# Create non-root user
RUN useradd -r -u 1001 -g root appuser \
 && chown -R appuser:root /app \
 && chmod -R 750 /app

# Switch to non-root user
USER appuser
```

**Why:**
- **Security:** Limits damage if container compromised
- **Best practice:** Never run as root in production
- **Compliance:** Required by many security standards

**UID 1001:**
- Arbitrary non-root UID
- Can be customized if needed
- Compatible with OpenShift, Kubernetes security contexts

### Health Check

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/healthz', (r) => { \
        let body = ''; \
        r.on('data', chunk => body += chunk); \
        r.on('end', () => { \
            try { \
                const j = JSON.parse(body); \
                process.exit(j.ok ? 0 : 1); \
            } catch(e) { \
                process.exit(1); \
            } \
        }); \
    }).on('error', () => process.exit(1))"
```

**Parameters:**
- `--interval=30s` - Check every 30 seconds
- `--timeout=5s` - Fail if check takes >5s
- `--start-period=30s` - Grace period during startup
- `--retries=3` - Mark unhealthy after 3 failures

**What it checks:**
1. Makes HTTP GET to `/healthz`
2. Parses JSON response
3. Checks `ok: true`
4. Exits 0 (healthy) or 1 (unhealthy)

**Benefits:**
- **Docker:** Can restart unhealthy containers
- **Kubernetes:** Automatic pod replacement
- **Load balancers:** Remove unhealthy instances

### Tini Init System

```dockerfile
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
```

**What is Tini?**
- Minimal init system for containers
- Handles zombie processes
- Forwards signals correctly

**Why use it?**
- Node.js runs as PID 1 without it
- PID 1 has special signal handling
- Tini ensures SIGTERM is handled correctly

**Without Tini:**
```bash
docker stop verisource-api
# Node.js might not receive SIGTERM
# Container force-killed after 10s
# Connections dropped, no cleanup
```

**With Tini:**
```bash
docker stop verisource-api
# Tini forwards SIGTERM to Node.js
# Graceful shutdown runs
# Connections drained properly
# Clean exit
```

## 🔒 Security Features

### Read-Only Root Filesystem

```yaml
# docker-compose.yml
read_only: true
tmpfs:
  - /tmp:noexec,nosuid,size=512m
```

**Benefits:**
- Prevents runtime file modifications
- Limits malware persistence
- Forces stateless containers

### Dropped Capabilities

```yaml
cap_drop:
  - ALL
cap_add:
  - CHOWN
  - SETGID
  - SETUID
```

**What are capabilities?**
- Fine-grained privileges
- Alternative to full root

**Why drop all?**
- Minimizes attack surface
- Container can't bind privileged ports
- Can't modify kernel settings

**Why add back specific ones?**
- `CHOWN`: Change file ownership
- `SETGID`: Set group ID
- `SETUID`: Set user ID
- Required for proper user switching

### Security Options

```yaml
security_opt:
  - no-new-privileges:true
```

**What it does:**
- Prevents privilege escalation
- Setuid/setgid binaries ignored
- Extra protection layer

## 🐳 Docker Compose

### Basic Usage

```bash
# Start services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f api

# Stop services
docker-compose down
```

### With Monitoring

```bash
# Start with Prometheus + Grafana
docker-compose --profile monitoring up -d

# Access services
# - API: http://localhost:8080
# - Prometheus: http://localhost:9090
# - Grafana: http://localhost:3000 (admin/admin)

# Stop all
docker-compose --profile monitoring down
```

### Environment Variables

**Required:**
```bash
API_KEYS=key1,key2
ALLOWED_ORIGINS=https://app.example.com
ALLOWED_FETCH_HOSTS=cdn.example.com
```

**Optional:**
```bash
MAX_FILE_MB=250
MAX_DURATION_SECONDS=300
MAX_INFLIGHT=2
LOG_LEVEL=info
ALLOWED_CODECS=h264,hevc,vp9,av1
ALLOWED_CONTAINERS=mp4,mov,mkv,webm
```

### Resource Limits

```yaml
deploy:
  resources:
    limits:
      cpus: '2.0'      # Max 2 CPUs
      memory: 2G       # Max 2GB RAM
    reservations:
      cpus: '1.0'      # Reserved 1 CPU
      memory: 1G       # Reserved 1GB RAM
```

**Why set limits?**
- Prevents resource exhaustion
- Fair scheduling in multi-tenant environments
- Predictable performance

## 🔍 Health Check Monitoring

### Check Health Status

```bash
# View health in docker ps
docker ps
# Look for: (healthy) or (unhealthy)

# Detailed health info
docker inspect --format='{{json .State.Health}}' verisource-api | jq

# Example output:
{
  "Status": "healthy",
  "FailingStreak": 0,
  "Log": [
    {
      "Start": "2025-10-26T10:30:00Z",
      "End": "2025-10-26T10:30:01Z",
      "ExitCode": 0,
      "Output": ""
    }
  ]
}
```

### Health Check Logs

```bash
# Last health check
docker inspect --format='{{json .State.Health.Log}}' verisource-api | jq '.[-1]'

# All health checks
docker inspect --format='{{json .State.Health.Log}}' verisource-api | jq
```

### Health Check Failures

**Scenario:** Container becomes unhealthy

```bash
# Check status
docker ps
# Shows: (unhealthy)

# View logs
docker logs verisource-api --tail 100

# Restart container
docker restart verisource-api

# Or, if configured with restart policy
# Docker will restart automatically
```

## ☸️ Kubernetes Deployment

### Convert Health Check to Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: verisource-api
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: api
        image: verisource-api:latest
        
        # Liveness probe (like Docker HEALTHCHECK)
        livenessProbe:
          httpGet:
            path: /livez
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 30
          timeoutSeconds: 5
          failureThreshold: 3
        
        # Readiness probe (traffic routing)
        readinessProbe:
          httpGet:
            path: /readyz
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 2
        
        # Security context (non-root user)
        securityContext:
          runAsUser: 1001
          runAsNonRoot: true
          allowPrivilegeEscalation: false
          readOnlyRootFilesystem: true
          capabilities:
            drop:
            - ALL
```

**Differences from Docker:**
- Kubernetes uses `/livez` and `/readyz`
- Docker uses `/healthz`
- Kubernetes has separate probes for liveness vs readiness

## 🧪 Testing Docker Build

### Build and Test Locally

```bash
# Build
docker build -t verisource-api:test .

# Run tests
docker run --rm \
  -e NODE_ENV=test \
  -e API_KEYS=test-key \
  verisource-api:test \
  npm test

# Run with shell (debugging)
docker run --rm -it \
  --entrypoint /bin/bash \
  verisource-api:test

# Inside container:
$ whoami
appuser

$ id
uid=1001(appuser) gid=0(root) groups=0(root)

$ ls -la /app
drwxr-x--- 1 appuser root 4096 Oct 26 10:00 .

$ node dist/server.js
# Should fail with "PRODUCTION without API_KEYS is unsafe"
```

### Verify Security

```bash
# Check user
docker run --rm verisource-api:latest id
# uid=1001(appuser) gid=0(root)

# Check writable directories
docker run --rm verisource-api:latest find / -writable -type d 2>/dev/null
# Should only show /tmp and user home

# Check FFmpeg
docker run --rm verisource-api:latest ffmpeg -version
# Should show version 4.3.6
```

## 📊 Image Size Optimization

### Before Multi-Stage Build

```dockerfile
FROM node:20-bullseye
# ... build and run in same stage
# Result: ~1.2GB
```

### After Multi-Stage Build

```dockerfile
FROM node:20-bullseye AS builder
# ... build here

FROM node:20-bullseye-slim
# ... run here
# Result: ~450MB
```

### Further Optimization (Optional)

```dockerfile
# Use Alpine (smallest)
FROM node:20-alpine

# Pros: ~200MB final image
# Cons: Alpine uses musl libc, may have compatibility issues
```

**Recommendation:** Stick with `bullseye-slim` for compatibility.

## 🔄 CI/CD Integration

### GitHub Actions

```yaml
name: Docker Build

on:
  push:
    tags:
      - 'v*'

jobs:
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Login to Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
      
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

## 📚 Best Practices

### 1. Always Use Tags

```bash
# Bad
docker build -t verisource-api .

# Good
docker build -t verisource-api:1.0.0 .
docker tag verisource-api:1.0.0 verisource-api:latest
```

### 2. Use .dockerignore

```
# .dockerignore
node_modules/
dist/
.git/
.env
*.log
coverage/
tests/
.github/
docs/
```

### 3. Layer Caching

```dockerfile
# Copy package files first (changes less often)
COPY package*.json ./
RUN npm ci

# Copy source last (changes more often)
COPY src/ ./src/
```

### 4. Scan for Vulnerabilities

```bash
# Using Trivy
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy:latest image verisource-api:latest

# Using Docker Scout
docker scout cves verisource-api:latest
```

### 5. Health Check Best Practices

```dockerfile
# ✅ Good - lightweight check
HEALTHCHECK CMD node -e "require('http').get('http://localhost:8080/healthz'...)"

# ❌ Bad - heavy check that starts full app
HEALTHCHECK CMD npm test

# ❌ Bad - external dependencies
HEALTHCHECK CMD curl http://external-service.com/check
```

## 🎉 Summary

**Docker image includes:**
- ✅ Multi-stage build (~450MB)
- ✅ Non-root user (UID 1001)
- ✅ Health checks (/healthz)
- ✅ Tini init system
- ✅ Pinned FFmpeg (4.3.6)
- ✅ Security hardening
- ✅ Graceful shutdown
- ✅ Prometheus metrics
- ✅ Production labels

**Deploy with confidence! 🚀🐳**
