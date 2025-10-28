# 🎬 VeriSource - Video Verification & Content Authentication System

## 🎯 What is VeriSource?

VeriSource is a comprehensive content authenticity and verification system that provides:

1. **Video Verification API** - Verify videos haven't been tampered with using cryptographic hashing
2. **Content Origin Credentials** - Digital credentials for content authentication
3. **Blockchain Integration** (Optional) - Immutable audit trail via blockchain anchoring
4. **AI Content Transparency** - Track and label AI-generated content
5. **Chain of Custody** - Complete provenance tracking

## 📦 What's Included in This Bundle

```
verisource-api-complete/
├── server/                    # Main API server
│   ├── index.js              # Express HTTP server (vid:v1)
│   └── generate-credential-endpoint.ts
├── worker/                    # Video processing worker
├── cli/                       # Command-line tools
│   ├── generate-image-credential.js
│   └── verify-video.js
├── src/                       # Core source code
│   └── metrics.ts            # Prometheus metrics
├── tests/                     # Test suites
│   ├── api.golden.test.ts
│   └── api.snapshot.test.ts
├── k8s/                       # Kubernetes deployments
├── grafana/                   # Monitoring dashboards
├── docs/                      # Comprehensive documentation
├── Dockerfile                 # Docker containerization
├── docker-compose.yml         # Local development stack
├── openapi.yaml              # API specification
├── package.json              # Node.js dependencies
├── credential_system_v3.py   # Python credential generator
└── *.sh                      # Deployment & testing scripts
```

## 🚀 Quick Start

### Option 1: Run Locally (Simplest)

**Prerequisites:**
- Node.js 18+ 
- FFmpeg (for video processing)

**Steps:**
```bash
# 1. Install dependencies
npm install

# 2. Start the server
node server/index.js

# 3. Test it's running
curl http://localhost:8080/health
```

The API will be available at `http://localhost:8080`

### Option 2: Run with Docker

```bash
# Build the image
docker build -t verisource-api .

# Run the container
docker run -p 8080:8080 verisource-api

# Test
curl http://localhost:8080/health
```

### Option 3: Full Stack with Docker Compose

```bash
# Start all services (API + Prometheus + Grafana)
docker-compose up

# Access:
# - API: http://localhost:8080
# - Grafana: http://localhost:3000
# - Prometheus: http://localhost:9090
```

## 🔌 API Endpoints

### Health Check
```bash
GET /health
```

### Verify Video
```bash
POST /verify
Content-Type: multipart/form-data

# Parameters:
# - file: video file (binary)
# - reference: JSON with segmentHashes and canonicalization
```

**Response:**
```json
{
  "verdict": "PROVEN_STRONG",
  "coverage": 1.0,
  "segmentsMatched": 150,
  "segmentsCompared": 150,
  "candidateSegmentsTotal": 150,
  "referenceSegmentsTotal": 150,
  "canonicalization": "vid:v1:...",
  "notes": ["VFR→CFR resample", "De-interlaced"]
}
```

**Verdict Types:**
- `PROVEN_STRONG` - 100% match
- `PROVEN_DERIVED` - 80-99% match (likely edited)
- `INCONCLUSIVE` - 30-79% match
- `NOT_PROVEN` - <30% match

## 📚 Documentation

### Core Guides
- **[QUICKSTART.md](QUICKSTART.md)** - Get started in 5 minutes
- **[DOCUMENTATION.md](DOCUMENTATION.md)** - Complete system documentation
- **[DOCKER_GUIDE.md](DOCKER_GUIDE.md)** - Docker deployment
- **[K8S_DEPLOYMENT_GUIDE.md](K8S_DEPLOYMENT_GUIDE.md)** - Kubernetes deployment
- **[PRODUCTION_DEPLOYMENT_GUIDE.md](PRODUCTION_DEPLOYMENT_GUIDE.md)** - Production setup
- **[TESTING_GUIDE.md](TESTING_GUIDE.md)** - Testing strategies

### Additional Docs (in /docs/)
- Complete execution guides
- Security audit improvements
- Monitoring and alerting setup
- CI/CD integration
- Golden test documentation

## 🔧 Configuration

### Environment Variables

Create a `.env` file (see `.env.example`):

```bash
PORT=8080
NODE_ENV=production

# Optional: Blockchain anchoring
BLOCKCHAIN_ENABLED=false
BLOCKCHAIN_RPC_URL=https://...

# Optional: Metrics
PROMETHEUS_ENABLED=true
METRICS_PORT=9090

# Optional: Content credentials
CREATOR_DID=did:key:z6Mk...
REVOCATION_BASE=https://revocation.example.com/v1/cred
```

## 🧪 Running Tests

### Golden Tests (API Regression Tests)
```bash
# Run golden tests
./RUN_GOLDEN_TESTS.sh

# Or manually
cd tests
npm test
```

### Snapshot Tests
```bash
./snapshot-tests.sh
```

### E2E Tests
```bash
./e2e-test-suite.sh
```

### Load Tests
```bash
./load-test.sh
```

## 🏗️ Architecture

### Video Verification Flow

```
1. Client uploads video + reference hashes
2. API receives request at /verify endpoint
3. Worker processes video:
   - Extracts frames at intervals
   - Normalizes to CFR (constant frame rate)
   - Generates perceptual hashes for each segment
4. API compares hashes:
   - Matches segments between candidate and reference
   - Calculates coverage percentage
5. Returns verdict based on match coverage
```

### Content Credential System

```
1. Content is hashed (SHA-256)
2. Metadata is collected (creator, timestamp, etc.)
3. Credential is signed with private key
4. (Optional) Transaction anchored to blockchain
5. Credential is stored and can be verified
```

## 🔐 Security Features

- ✅ Cryptographic hashing (SHA-256, SHA-512)
- ✅ RSA digital signatures
- ✅ Optional blockchain anchoring
- ✅ API rate limiting
- ✅ Input validation
- ✅ Secure file handling with cleanup
- ✅ CORS protection
- ✅ Helmet.js security headers

## 📊 Monitoring

### Prometheus Metrics
- Request rates and latency
- Verification verdicts distribution
- Error rates
- System resource usage

### Grafana Dashboards
Pre-configured dashboards included:
- API performance
- Video processing metrics
- System health
- Alert status

## 🌐 Deployment Options

### Cloud Platforms
- **AWS**: ECS, EKS, Lambda
- **Google Cloud**: GKE, Cloud Run
- **Azure**: AKS, Container Instances
- **Heroku, Railway, Render**: Simple deployments

### Kubernetes
Complete K8s manifests included:
```bash
kubectl apply -f k8s/deployment.yml
kubectl apply -f k8s/service.yml
kubectl apply -f k8s/ingress.yml
```

## 🆘 Troubleshooting

### "Worker failed" error
- Ensure FFmpeg is installed: `ffmpeg -version`
- Check video file format is supported
- Verify sufficient disk space in /tmp

### API not responding
- Check if port 8080 is available
- Review logs: `docker logs <container-id>`
- Verify Node.js version: `node --version` (need 18+)

### Memory issues
- Increase Docker memory limit
- Adjust `maxBuffer` in server/index.js
- Process videos in smaller chunks

## 📝 License

See LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📞 Support

For issues and questions:
- Check the documentation in `/docs/`
- Review the troubleshooting guide
- Open an issue on the repository

## 🎓 Learn More

- **Video Canonicalization**: Read `video-canonicalization.ts`
- **Credential System**: Read `credential_system_v3.py`
- **API Spec**: Review `openapi.yaml`
- **Architecture**: See `DOCUMENTATION.md`

---

**Built with ❤️ for content authenticity and verification**
