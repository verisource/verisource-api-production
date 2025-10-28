# Kubernetes Deployment Guide

Complete guide to deploying Verisource Video Verification API on Kubernetes.

## 🎯 Overview

**Production-ready Kubernetes deployment featuring:**
- ✅ High availability (2+ replicas)
- ✅ Zero-downtime rolling updates
- ✅ Horizontal Pod Autoscaling (2-10 pods)
- ✅ Cloud-native secret management (IRSA/Workload Identity)
- ✅ Network policies (ingress/egress restrictions)
- ✅ Resource limits and requests
- ✅ Health checks (readiness, liveness, startup)
- ✅ Pod disruption budgets
- ✅ Security contexts (read-only FS, non-root)
- ✅ Prometheus monitoring integration

## 📋 Prerequisites

### Required

- **Kubernetes cluster** (v1.24+)
  - AWS EKS, GCP GKE, Azure AKS, or self-managed
- **kubectl** configured for your cluster
- **Docker image** pushed to container registry
  - `ghcr.io/verisource/verifier-api:1.0.0`
- **Cloud CLI** (for secret management)
  - AWS CLI (for EKS)
  - gcloud CLI (for GKE)
  - az CLI (for AKS)

### Optional (Recommended)

- **Ingress Controller**
  - NGINX Ingress Controller
  - AWS Load Balancer Controller
  - GCP GKE Ingress
- **cert-manager** (for automatic TLS)
- **Prometheus Operator** (for monitoring)

## 🚀 Quick Start

### 1. Choose Your Cloud Provider

**AWS EKS:**
```bash
./k8s/aws-iam-setup.sh my-cluster us-west-2
```

**GCP GKE:**
```bash
./k8s/gcp-iam-setup.sh my-project my-cluster us-west1
```

**Azure AKS:**
```bash
# Manual setup required - see Azure section below
```

### 2. Deploy Application

```bash
# Create namespace
kubectl create namespace verisource

# Deploy all resources
kubectl apply -f k8s/deployment.yml
kubectl apply -f k8s/ingress.yml

# Verify deployment
kubectl -n verisource get pods
kubectl -n verisource get svc
kubectl -n verisource get ingress
```

### 3. Verify Deployment

```bash
# Check pod status
kubectl -n verisource get pods -w

# Check logs
kubectl -n verisource logs -f deployment/verisource-api

# Test health endpoint
kubectl -n verisource port-forward svc/verisource-api 8080:8080
curl http://localhost:8080/healthz
```

## ☁️ Cloud Provider Setup

### AWS EKS - IAM Roles for Service Accounts (IRSA)

**Prerequisites:**
- EKS cluster with OIDC provider enabled
- AWS CLI installed and configured

**Setup:**

```bash
# Run automated setup script
./k8s/aws-iam-setup.sh <cluster-name> <region> <account-id>

# Or manually:

# 1. Enable OIDC provider (if not already enabled)
eksctl utils associate-iam-oidc-provider \
  --cluster=my-cluster \
  --region=us-west-2 \
  --approve

# 2. Create IAM policy
aws iam create-policy \
  --policy-name VerisourceAPISecretsPolicy \
  --policy-document file://aws-secrets-policy.json

# 3. Create IAM role with trust policy
aws iam create-role \
  --role-name verisource-api-prod \
  --assume-role-policy-document file://aws-trust-policy.json

# 4. Attach policy to role
aws iam attach-role-policy \
  --role-name verisource-api-prod \
  --policy-arn arn:aws:iam::<ACCOUNT>:policy/VerisourceAPISecretsPolicy

# 5. Create secret in Secrets Manager
aws secretsmanager create-secret \
  --name verisource/api/keys \
  --secret-string '{"keys":[{"key":"vsk_...","name":"prod-key-1"}]}'

# 6. Annotate service account
kubectl annotate serviceaccount verisource-api \
  -n verisource \
  eks.amazonaws.com/role-arn=arn:aws:iam::<ACCOUNT>:role/verisource-api-prod
```

**Update deployment.yml:**
```yaml
env:
  - name: AWS_REGION
    value: "us-west-2"
  - name: API_KEYS_SECRET_NAME
    value: "verisource/api/keys"
```

**Test secret access:**
```bash
kubectl run -n verisource test --rm -it \
  --image=amazon/aws-cli \
  --serviceaccount=verisource-api -- \
  secretsmanager get-secret-value \
    --secret-id verisource/api/keys \
    --region us-west-2
```

---

### GCP GKE - Workload Identity

**Prerequisites:**
- GKE cluster with Workload Identity enabled
- gcloud CLI installed and configured

**Setup:**

```bash
# Run automated setup script
./k8s/gcp-iam-setup.sh <project-id> <cluster-name> <region>

# Or manually:

# 1. Enable Workload Identity on cluster (if not already)
gcloud container clusters update my-cluster \
  --region=us-west1 \
  --workload-pool=my-project.svc.id.goog

# 2. Create Google Service Account
gcloud iam service-accounts create verisource-api \
  --display-name="Verisource API Service Account"

# 3. Grant Secret Manager permissions
gcloud projects add-iam-policy-binding my-project \
  --member="serviceAccount:verisource-api@my-project.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# 4. Bind Kubernetes SA to Google SA
gcloud iam service-accounts add-iam-policy-binding \
  verisource-api@my-project.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:my-project.svc.id.goog[verisource/verisource-api]"

# 5. Create secret in Secret Manager
echo '{"keys":[{"key":"vsk_...","name":"prod-key-1"}]}' | \
  gcloud secrets create api-keys \
    --data-file=- \
    --replication-policy="automatic"

# 6. Annotate service account
kubectl annotate serviceaccount verisource-api \
  -n verisource \
  iam.gke.io/gcp-service-account=verisource-api@my-project.iam.gserviceaccount.com
```

**Update deployment.yml:**
```yaml
env:
  - name: GCP_PROJECT_ID
    value: "my-project"
  - name: API_KEYS_SECRET_NAME
    value: "projects/my-project/secrets/api-keys/versions/latest"
```

**Test secret access:**
```bash
kubectl run -n verisource test --rm -it \
  --image=gcr.io/google.com/cloudsdktool/cloud-sdk:slim \
  --serviceaccount=verisource-api -- \
  gcloud secrets versions access latest \
    --secret=api-keys \
    --project=my-project
```

---

### Azure AKS - Workload Identity (Preview)

**Prerequisites:**
- AKS cluster with Workload Identity enabled
- Azure CLI installed and configured

**Setup:**

```bash
# 1. Enable Workload Identity on AKS
az aks update \
  --resource-group my-rg \
  --name my-cluster \
  --enable-oidc-issuer \
  --enable-workload-identity

# 2. Get OIDC issuer URL
OIDC_ISSUER=$(az aks show \
  --resource-group my-rg \
  --name my-cluster \
  --query "oidcIssuerProfile.issuerUrl" \
  -o tsv)

# 3. Create managed identity
az identity create \
  --resource-group my-rg \
  --name verisource-api-identity

# 4. Get identity client ID
IDENTITY_CLIENT_ID=$(az identity show \
  --resource-group my-rg \
  --name verisource-api-identity \
  --query "clientId" \
  -o tsv)

# 5. Create Key Vault
az keyvault create \
  --name verisource-kv \
  --resource-group my-rg \
  --location eastus

# 6. Grant Key Vault access
az keyvault set-policy \
  --name verisource-kv \
  --object-id $(az identity show --resource-group my-rg --name verisource-api-identity --query principalId -o tsv) \
  --secret-permissions get list

# 7. Create secret
az keyvault secret set \
  --vault-name verisource-kv \
  --name api-keys \
  --value '{"keys":[{"key":"vsk_...","name":"prod-key-1"}]}'

# 8. Create federated identity credential
az identity federated-credential create \
  --name verisource-api-federated \
  --identity-name verisource-api-identity \
  --resource-group my-rg \
  --issuer "$OIDC_ISSUER" \
  --subject "system:serviceaccount:verisource:verisource-api"

# 9. Annotate service account
kubectl annotate serviceaccount verisource-api \
  -n verisource \
  azure.workload.identity/client-id="$IDENTITY_CLIENT_ID"
```

**Update deployment.yml:**
```yaml
env:
  - name: AZURE_KEY_VAULT_NAME
    value: "verisource-kv"
  - name: API_KEYS_SECRET_NAME
    value: "api-keys"
```

## 🔧 Configuration

### Resource Limits

**Default configuration:**
```yaml
resources:
  requests:
    cpu: "500m"      # 0.5 CPU
    memory: "1Gi"    # 1 GB
  limits:
    cpu: "2000m"     # 2 CPU
    memory: "2Gi"    # 2 GB
```

**Tune based on workload:**

| Scenario | CPU Request | Memory Request | CPU Limit | Memory Limit |
|----------|-------------|----------------|-----------|--------------|
| Light (< 10 req/min) | 250m | 512Mi | 1000m | 1Gi |
| Medium (< 100 req/min) | 500m | 1Gi | 2000m | 2Gi |
| Heavy (> 100 req/min) | 1000m | 2Gi | 4000m | 4Gi |

---

### Horizontal Pod Autoscaler

**Configure autoscaling:**
```yaml
spec:
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

**Custom metrics (Prometheus):**
```yaml
metrics:
  - type: Pods
    pods:
      metric:
        name: http_requests_per_second
      target:
        type: AverageValue
        averageValue: "100"
```

---

### Ingress Configuration

**NGINX Ingress:**
```yaml
annotations:
  nginx.ingress.kubernetes.io/ssl-redirect: "true"
  nginx.ingress.kubernetes.io/proxy-body-size: "250m"
  nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
  cert-manager.io/cluster-issuer: "letsencrypt-prod"
```

**AWS ALB:**
```yaml
annotations:
  alb.ingress.kubernetes.io/scheme: internet-facing
  alb.ingress.kubernetes.io/target-type: ip
  alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:...
  alb.ingress.kubernetes.io/healthcheck-path: /healthz
```

**GCP GCE:**
```yaml
annotations:
  kubernetes.io/ingress.class: gce
  ingress.gcp.kubernetes.io/pre-shared-cert: verisource-api-cert
  kubernetes.io/ingress.global-static-ip-name: verisource-api-ip
```

## 📊 Monitoring

### Prometheus Integration

**ServiceMonitor (Prometheus Operator):**
```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: verisource-api
  namespace: verisource
spec:
  selector:
    matchLabels:
      app: verisource-api
  endpoints:
    - port: http
      path: /metrics
      interval: 30s
```

**Verify metrics:**
```bash
# Port-forward to pod
kubectl -n verisource port-forward deployment/verisource-api 8080:8080

# Check metrics endpoint
curl http://localhost:8080/metrics
```

---

### Grafana Dashboards

**Import dashboard:**
1. Open Grafana
2. Navigate to **Dashboards → Import**
3. Upload `grafana-dashboard.json`
4. Select Prometheus data source
5. Set `job=verisource-api` variable

## 🔍 Troubleshooting

### Pods Not Starting

**Check pod status:**
```bash
kubectl -n verisource describe pod <pod-name>
```

**Common issues:**

1. **ImagePullBackOff**
   ```bash
   # Check image name and registry auth
   kubectl -n verisource get events
   ```

2. **CrashLoopBackOff**
   ```bash
   # Check logs
   kubectl -n verisource logs <pod-name>
   
   # Check previous container logs
   kubectl -n verisource logs <pod-name> --previous
   ```

3. **Pending (insufficient resources)**
   ```bash
   # Check node resources
   kubectl top nodes
   
   # Describe pod to see scheduling constraints
   kubectl -n verisource describe pod <pod-name>
   ```

---

### Secret Access Issues

**Test AWS IRSA:**
```bash
kubectl run -n verisource debug --rm -it \
  --image=amazon/aws-cli \
  --serviceaccount=verisource-api -- \
  sts get-caller-identity
```

**Test GCP Workload Identity:**
```bash
kubectl run -n verisource debug --rm -it \
  --image=gcr.io/google.com/cloudsdktool/cloud-sdk:slim \
  --serviceaccount=verisource-api -- \
  gcloud auth list
```

**Check IAM bindings:**
- AWS: Verify trust policy and role ARN
- GCP: Verify workloadIdentityUser binding
- Azure: Verify federated identity credential

---

### Network Issues

**Test pod networking:**
```bash
# DNS resolution
kubectl run -n verisource test --rm -it --image=busybox -- nslookup google.com

# External connectivity
kubectl run -n verisource test --rm -it --image=curlimages/curl -- curl -I https://google.com

# Service connectivity
kubectl run -n verisource test --rm -it --image=curlimages/curl -- \
  curl http://verisource-api.verisource.svc.cluster.local:8080/healthz
```

**Check network policy:**
```bash
kubectl -n verisource get networkpolicies
kubectl -n verisource describe networkpolicy verisource-api-np
```

## 🎯 Best Practices

### 1. Use Resource Requests & Limits

**Always set:**
- CPU requests (for scheduling)
- Memory requests (for scheduling)
- Memory limits (prevent OOM)
- CPU limits (prevent noisy neighbor)

### 2. Implement Health Checks

**Three probe types:**
- **Startup**: For slow-starting containers
- **Liveness**: Restart unhealthy containers
- **Readiness**: Remove from load balancer

### 3. Enable Pod Disruption Budgets

**Ensure availability during:**
- Node drains
- Cluster upgrades
- Voluntary disruptions

### 4. Use Rolling Updates

**Zero-downtime deployments:**
```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

### 5. Implement Autoscaling

**Scale based on:**
- CPU utilization
- Memory utilization
- Custom metrics (request rate)

### 6. Secure Your Pods

**Security best practices:**
- Run as non-root
- Read-only root filesystem
- Drop all capabilities
- Use security contexts
- Apply network policies

## 🎉 Summary

**Production-ready Kubernetes deployment:**
- ✅ High availability (2+ replicas)
- ✅ Auto-scaling (HPA)
- ✅ Zero-downtime deployments
- ✅ Cloud-native secrets
- ✅ Network isolation
- ✅ Resource management
- ✅ Health monitoring
- ✅ Prometheus integration
- ✅ Security hardening

**Deploy with confidence! 🚀☸️**
