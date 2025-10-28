# 🚀 Quick Start Guide - TL;DR

**Get Verisource API running in 5 steps.**

## Order of Operations

### 1️⃣ Apply Kubernetes Manifests

```bash
# Create namespace
kubectl create namespace verisource-stg

# Deploy everything
kubectl apply -f k8s/staging/

# Verify
kubectl -n verisource-stg get pods,svc,ingress
```

**What you get:**
- ✅ 2 pods (HPA: 2-6)
- ✅ Read-only FS + tmpfs `/tmp`
- ✅ Network policies
- ✅ Service + Ingress
- ✅ ServiceMonitor

---

### 2️⃣ Provide API Keys

**Option A: Secrets Manager (Production)**

**AWS:**
```bash
# Create secret
aws secretsmanager create-secret \
  --name verisource/staging/api-keys \
  --secret-string '{"keys":[{"key":"stg_abc123","name":"key-1"}]}' \
  --region us-west-2

# Verify pod can access
kubectl -n verisource-stg logs -l app=verisource-api | grep -i "loaded.*key"
```

**GCP:**
```bash
# Create secret
echo '{"keys":[{"key":"stg_abc123","name":"key-1"}]}' | \
  gcloud secrets create api-keys-staging --data-file=-

# Verify
kubectl -n verisource-stg logs -l app=verisource-api | grep -i "loaded.*key"
```

**Option B: Local `.env` (Dev Only)**
```bash
# Create secret from file
kubectl create secret generic api-keys \
  -n verisource-stg \
  --from-literal=API_KEYS='{"keys":[{"key":"stg_abc123","name":"key-1"}]}'

# Patch deployment to use secret
kubectl -n verisource-stg set env deployment/verisource-api \
  --from=secret/api-keys
```

---

### 3️⃣ Expose via Ingress + CDN

**Wait for TLS:**
```bash
kubectl -n verisource-stg get certificate verisource-stg-tls -w
# Wait for READY=True
```

**Test direct access:**
```bash
curl -s https://stg-api.verisource.io/healthz
```

**Configure CDN (CloudFront/Cloudflare):**

**CloudFront:**
- Origin: `stg-api.verisource.io`
- Cache: **DO NOT cache `/verify*` endpoints**
- Forward headers: `x-api-key`
- Body size: 256MB

**Cloudflare:**
- Page Rules → `*stg-api.verisource.io/verify*`
- Cache Level: **Bypass**
- Forward `x-api-key` header

---

### 4️⃣ Add Monitoring

**Prometheus + Grafana already running?**

```bash
# ServiceMonitor is already applied in step 1
# Just verify Prometheus is scraping

# Port-forward to Prometheus
kubectl -n monitoring port-forward svc/prometheus 9090:9090

# Open: http://localhost:9090/targets
# Look for: verisource-stg/verisource-api
```

**Import Grafana dashboard:**
```bash
# Open Grafana
# Dashboards → Import → Upload grafana-dashboard.json
# Set job filter: namespace=verisource-stg
```

**Load alert rules** (if using Prometheus Alertmanager):
```bash
# Alerts are in servicemonitor.yml (already applied)
# Or use prometheus-alerting-rules.yml for Alertmanager

# Verify alerts loaded
kubectl -n monitoring get prometheusrules
```

---

### 5️⃣ Test & Verify

**Test health:**
```bash
curl -s https://stg-api.verisource.io/healthz | jq
```

**Test verification (replace with your test video):**
```bash
curl -H "x-api-key: stg_abc123" \
     -F "file=@test-video.mp4" \
     -F "credential=@credential.json;type=application/json" \
     https://stg-api.verisource.io/verify | jq
```

**Expected response:**
```json
{
  "verdict": "PROVEN_STRONG",
  "coverage": 0.98,
  "requestId": "req_...",
  "timestamp": "2025-10-26T..."
}
```

**Watch metrics:**
```bash
# Port-forward to pod
kubectl -n verisource-stg port-forward svc/verisource-api 8080:8080

# Check metrics
curl -s http://localhost:8080/metrics | grep verisource_

# Should see:
# - verisource_verify_verdict_total{verdict="PROVEN_STRONG"} 1
# - http_request_duration_seconds_count 1
# - verisource_process_resident_memory_bytes ...
```

**Check Grafana:**
- Open dashboard
- Filter: `namespace=verisource-stg`
- Verify:
  - ✅ RPS > 0
  - ✅ P95 latency < 30s
  - ✅ Error rate = 0%
  - ✅ Verdicts incrementing

---

## 📊 Quick Reference

### Useful Commands

```bash
# Watch pods
kubectl -n verisource-stg get pods -w

# Logs (all pods)
kubectl -n verisource-stg logs -f -l app=verisource-api

# Logs (specific pod)
kubectl -n verisource-stg logs -f <pod-name>

# Exec into pod
kubectl -n verisource-stg exec -it <pod-name> -- sh

# Check events
kubectl -n verisource-stg get events --sort-by='.lastTimestamp'

# Scale manually
kubectl -n verisource-stg scale deployment/verisource-api --replicas=4

# Rollout new version
kubectl -n verisource-stg set image deployment/verisource-api \
  api=ghcr.io/verisource/verifier-api:1.1.0

# Rollback
kubectl -n verisource-stg rollout undo deployment/verisource-api
```

### Test Endpoints

```bash
# Health check
curl -s https://stg-api.verisource.io/healthz

# Verify (upload)
curl -H "x-api-key: KEY" \
     -F "file=@video.mp4" \
     -F "credential=@cred.json;type=application/json" \
     https://stg-api.verisource.io/verify

# Verify (URL)
curl -H "x-api-key: KEY" \
     -H "Content-Type: application/json" \
     -d '{"url":"https://cdn.example.com/video.mp4","credential":{...}}' \
     https://stg-api.verisource.io/verify-by-url

# Metrics (from inside cluster)
kubectl -n verisource-stg port-forward svc/verisource-api 8080:8080
curl http://localhost:8080/metrics
```

### Monitoring

```bash
# Prometheus queries
sum(rate(http_request_duration_seconds_count{namespace="verisource-stg"}[5m]))
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{namespace="verisource-stg"}[5m])) by (le))
sum by (verdict) (rate(verisource_verify_verdict_total{namespace="verisource-stg"}[5m]))

# Check alerts
kubectl -n verisource-stg get prometheusrules
kubectl -n monitoring port-forward svc/alertmanager 9093:9093
# Open: http://localhost:9093
```

---

## 🚨 Troubleshooting

**Pods not starting?**
```bash
kubectl -n verisource-stg describe pod <pod-name>
kubectl -n verisource-stg logs <pod-name>
```

**Can't load secrets?**
```bash
# Test AWS
kubectl run -n verisource-stg test --rm -it \
  --image=amazon/aws-cli --serviceaccount=verisource-api -- \
  sts get-caller-identity

# Test GCP
kubectl run -n verisource-stg test --rm -it \
  --image=gcr.io/google.com/cloudsdktool/cloud-sdk:slim \
  --serviceaccount=verisource-api -- \
  gcloud auth list
```

**High error rate?**
```bash
kubectl -n verisource-stg logs -l app=verisource-api --tail=100 | grep ERROR
```

**TLS not working?**
```bash
kubectl -n verisource-stg describe certificate verisource-stg-tls
kubectl -n verisource-stg describe certificaterequest
kubectl -n verisource-stg get challenges
```

---

## ✅ Success Checklist

After deployment, verify:

- [ ] 2 pods running
- [ ] TLS certificate issued (READY=True)
- [ ] Health endpoint returns 200
- [ ] Test verification succeeds
- [ ] Metrics endpoint accessible (from inside cluster)
- [ ] Grafana shows metrics
- [ ] No alerts firing
- [ ] Logs show no errors
- [ ] CDN configured (no caching on POST)

---

## 🎯 Production Promotion

**Before promoting to production:**

1. Run conformance test:
   ```bash
   kubectl create job -n verisource-stg \
     --from=cronjob/verisource-conformance-test \
     manual-test
   
   kubectl -n verisource-stg logs job/manual-test
   ```

2. Verify metrics (24h):
   - Error rate < 1%
   - P95 latency < 30s
   - No critical alerts

3. Load test (optional):
   ```bash
   # Use your load testing tool
   # Target: 100 RPS for 30 minutes
   ```

4. Deploy to prod:
   ```bash
   # Update namespace to production
   kubectl apply -f k8s/production/
   ```

---

## 📚 Full Documentation

For detailed guides, see:
- [STAGING_DEPLOYMENT_GUIDE.md](./STAGING_DEPLOYMENT_GUIDE.md) - Complete staging guide
- [K8S_DEPLOYMENT_GUIDE.md](./K8S_DEPLOYMENT_GUIDE.md) - Kubernetes deployment
- [GRAFANA_SETUP_GUIDE.md](./GRAFANA_SETUP_GUIDE.md) - Monitoring setup
- [ALERTING_GUIDE.md](./ALERTING_GUIDE.md) - Alert configuration

---

## 🎉 Summary

**5 steps to production:**
1. ✅ Apply manifests (`kubectl apply -f k8s/staging/`)
2. ✅ Provide API keys (Secrets Manager or env)
3. ✅ Configure CDN (don't cache POST, forward `x-api-key`)
4. ✅ Verify monitoring (Prometheus scraping, Grafana showing data)
5. ✅ Test & validate (health check, verify request, metrics)

**You're live! 🚀**
