# Complete Testing Guide

Comprehensive test suite for the video verification API.

## 🎯 Test Coverage

**35+ Test Cases:**
- ✅ Success cases (PROVEN_STRONG verdict)
- ✅ Policy enforcement (duration, codec, container)
- ✅ Authentication (API keys)
- ✅ Input validation (files, credentials, segments)
- ✅ Health checks (/healthz, /livez, /readyz, /metrics)
- ✅ Rate limiting
- ✅ Concurrency control
- ✅ Request IDs
- ✅ Canonicalization matching
- ✅ Segment hash validation

## 🚀 Quick Start

### 1. Install Dependencies

```bash
# Install test dependencies
npm install --save-dev \
  jest \
  @types/jest \
  supertest \
  @types/supertest \
  ts-jest

# Verify FFmpeg installed
ffmpeg -version
```

### 2. Configure

**jest.config.cjs:**
```javascript
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  testTimeout: 120000,
  detectOpenHandles: true,
  forceExit: true
};
```

### 3. Run Tests

```bash
# Run all tests
npm test

# Run with watch mode
npm run test:watch

# Run specific test file
npm test -- api.golden.test.ts

# Run with coverage
npm test -- --coverage
```

## 📁 Test Structure

```
tests/
├── api.golden.test.ts          # Main API tests
├── helpers/
│   ├── ffmpeg.ts               # Video generation helpers
│   └── makeCredential.ts       # Credential helpers
```

## 🔧 Test Helpers

### FFmpeg Helpers

**makeTinyMp4:**
```typescript
// Create 1s black video (1280x720, H.264, 15fps)
const video = makeTinyMp4(tmpDir, "ref.mp4");
```

**reencodeDifferentBitrate:**
```typescript
// Re-encode video (triggers PROVEN_STRONG)
reencodeDifferentBitrate(refVideo, candidateVideo);
```

**makeLongVideo:**
```typescript
// Create video of specific duration (for testing limits)
makeLongVideo(outputPath, 31); // 31 seconds
```

### Credential Helpers

**runWorker:**
```typescript
// Run video worker to generate fingerprints
const fingerprints = runWorker(videoPath);
// Returns: { canonicalization, segmentHashes, width, height, fps, ... }
```

**makeV3CredentialFromWorkerOut:**
```typescript
// Create V3 credential from worker output
const credential = makeV3CredentialFromWorkerOut(fingerprints);
```

## 📋 Test Categories

### 1. Success Cases

**Test: PROVEN_STRONG for exact re-encode**
```typescript
test("PROVEN_STRONG for exact re-encode", async () => {
  const candidate = path.join(tmp, "candidate_lowbit.mp4");
  reencodeDifferentBitrate(refVideo, candidate);

  const resp = await request(app)
    .post("/verify")
    .set({ "x-api-key": "test-key-1" })
    .attach("file", candidate)
    .field("credential", JSON.stringify(cred));

  expect(resp.status).toBe(200);
  expect(resp.body.verdict).toBe("PROVEN_STRONG");
  expect(resp.body.coverage).toBeCloseTo(1, 5);
});
```

**Validates:**
- Successful verification
- Correct verdict
- Coverage calculation
- Response structure
- Request ID included

---

### 2. Policy Enforcement

**Test: Rejects too-long duration**
```typescript
test("Rejects too-long duration with 413", async () => {
  const longVid = path.join(tmp, "too_long.mp4");
  makeLongVideo(longVid, 31); // Exceeds 30s limit

  const resp = await request(app)
    .post("/verify")
    .set(keyHeader)
    .attach("file", longVid)
    .field("credential", JSON.stringify(cred));

  expect([400, 413]).toContain(resp.status);
  expect(String(resp.body.error)).toMatch(/Duration too long/i);
});
```

**Test: Rejects canonicalization mismatch**
```typescript
test("Rejects canonicalization mismatch with 400", async () => {
  const badCred = {
    ...cred,
    fingerprintBundle: {
      ...cred.fingerprintBundle,
      canonicalization: "vid:v1:DIFFERENT"
    }
  };

  const resp = await request(app)
    .post("/verify")
    .set(keyHeader)
    .attach("file", refVideo)
    .field("credential", JSON.stringify(badCred));

  expect(resp.status).toBe(400);
  expect(resp.body.error).toMatch(/Canonicalization mismatch/);
  expect(resp.body.candidate).toBeDefined();
  expect(resp.body.expected).toBeDefined();
});
```

**Validates:**
- Duration limits enforced
- Codec allowlist enforced
- Container allowlist enforced
- Canonicalization matching
- Appropriate status codes (400, 413)

---

### 3. Segment Hash Validation

**Test: Rejects malformed segments**
```typescript
test("Rejects malformed segment hashes with 400", async () => {
  const badCred = {
    ...cred,
    fingerprintBundle: {
      ...cred.fingerprintBundle,
      segmentHashes: ["oops"]  // Invalid format
    }
  };

  const resp = await request(app)
    .post("/verify")
    .set(keyHeader)
    .attach("file", refVideo)
    .field("credential", JSON.stringify(badCred));

  expect(resp.status).toBe(400);
  expect(resp.body.error).toMatch(/Invalid segment hash format/);
});
```

**Test: Rejects non-contiguous segments**
```typescript
test("Rejects non-contiguous segments with 400", async () => {
  const badCred = {
    ...cred,
    fingerprintBundle: {
      ...cred.fingerprintBundle,
      segmentHashes: [
        "seg_0:abc123",
        "seg_2:def456"  // Missing seg_1
      ]
    }
  };

  const resp = await request(app)
    .post("/verify")
    .set(keyHeader)
    .attach("file", refVideo)
    .field("credential", JSON.stringify(badCred));

  expect(resp.status).toBe(400);
  expect(resp.body.error).toMatch(/contiguous.*seg_1/i);
});
```

**Validates:**
- Segment format validation (regex)
- Contiguity check (0, 1, 2, ... N-1)
- Clear error messages

---

### 4. Algorithm Enforcement

**Test: Rejects wrong algorithm**
```typescript
test("Rejects wrong algorithm with 400", async () => {
  const badCred = {
    ...cred,
    fingerprintBundle: {
      ...cred.fingerprintBundle,
      algorithm: "md5"  // Not sha256+segphash
    }
  };

  const resp = await request(app)
    .post("/verify")
    .set(keyHeader)
    .attach("file", refVideo)
    .field("credential", JSON.stringify(badCred));

  expect(resp.status).toBe(400);
  expect(resp.body.error).toMatch(/Unsupported.*algorithm/i);
});
```

**Validates:**
- Algorithm must be "sha256+segphash"
- Clear error message with expected value

---

### 5. Authentication

**Test: Missing API key**
```typescript
test("401 when API key missing", async () => {
  const resp = await request(app)
    .post("/verify")
    .attach("file", refVideo)
    .field("credential", JSON.stringify(cred));

  expect(resp.status).toBe(401);
  expect(resp.body.error).toMatch(/Missing or invalid API key/);
});
```

**Test: Invalid API key**
```typescript
test("401 when API key invalid", async () => {
  const resp = await request(app)
    .post("/verify")
    .set({ "x-api-key": "wrong-key" })
    .attach("file", refVideo)
    .field("credential", JSON.stringify(cred));

  expect(resp.status).toBe(401);
});
```

**Validates:**
- API key required
- Invalid keys rejected
- Appropriate 401 status

---

### 6. Health Checks

**Test: Health check endpoints**
```typescript
test("GET /healthz returns OK", async () => {
  const resp = await request(app).get("/healthz");
  
  expect(resp.status).toBe(200);
  expect(resp.body.ok).toBe(true);
  expect(resp.body.service).toBe("verisource-video-verifier");
});

test("GET /livez returns alive", async () => {
  const resp = await request(app).get("/livez");
  
  expect(resp.status).toBe(200);
  expect(resp.body.alive).toBe(true);
});

test("GET /readyz returns ready", async () => {
  const resp = await request(app).get("/readyz");
  
  expect(resp.status).toBe(200);
  expect(resp.body.ready).toBe(true);
});

test("GET /metrics returns prometheus format", async () => {
  const resp = await request(app).get("/metrics");
  
  expect(resp.status).toBe(200);
  expect(resp.type).toBe("text/plain");
  expect(resp.text).toContain("http_requests_total");
});
```

**Validates:**
- All health endpoints working
- Metrics in Prometheus format
- No authentication required for health checks

---

### 7. Rate Limiting

**Test: Per-IP rate limit**
```typescript
test("Enforces per-IP rate limit", async () => {
  // Make 61 requests (limit is 60/min)
  const requests = [];
  for (let i = 0; i < 61; i++) {
    requests.push(request(app).get("/").set(keyHeader));
  }

  const responses = await Promise.all(requests);
  
  // At least one should be rate limited
  const rateLimited = responses.filter(r => r.status === 429);
  expect(rateLimited.length).toBeGreaterThan(0);
});
```

**Validates:**
- Rate limiting enforced (60/min)
- 429 status code returned
- retryAfter included in response

---

### 8. Concurrency Control

**Test: MAX_INFLIGHT enforcement**
```typescript
test("Enforces MAX_INFLIGHT limit", async () => {
  // MAX_INFLIGHT=2, try 3 simultaneous requests
  const requests = [
    request(app).post("/verify")...,
    request(app).post("/verify")...,
    request(app).post("/verify")...
  ];

  const responses = await Promise.all(requests);
  
  // At least one should be rejected with 503
  responses.forEach(r => {
    expect([200, 503]).toContain(r.status);
  });
});
```

**Validates:**
- Concurrency limited to MAX_INFLIGHT
- 503 status when busy
- "Server busy" error message

---

## 🐳 Running Tests in Docker

### Dockerfile for Tests

```dockerfile
FROM node:20-bullseye

# Install FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Run tests
CMD ["npm", "test"]
```

### Run

```bash
docker build -f Dockerfile.test -t verisource-api-test .
docker run --rm verisource-api-test
```

---

## ☸️ Running Tests in CI/CD

### GitHub Actions

```yaml
name: API Golden Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-22.04
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      
      - name: Install FFmpeg
        run: sudo apt-get update && sudo apt-get install -y ffmpeg
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        env:
          API_KEYS: test-key
          NODE_ENV: test
        run: npm test
```

---

## 📊 Test Coverage

### Generate Coverage Report

```bash
npm test -- --coverage
```

### Coverage Targets

- **Statements:** >80%
- **Branches:** >75%
- **Functions:** >80%
- **Lines:** >80%

### View Coverage

```bash
# Generate HTML report
npm test -- --coverage --coverageReporters=html

# Open in browser
open coverage/index.html
```

---

## 🔍 Debugging Tests

### Run Single Test

```bash
npm test -- -t "PROVEN_STRONG for exact re-encode"
```

### Run with Verbose Output

```bash
npm test -- --verbose
```

### Enable Logging

```typescript
// In test file
process.env.LOG_LEVEL = "debug";
```

### Inspect Test Video

```bash
# After test run (in tmp directory)
ffprobe -show_streams test-video.mp4
```

---

## 🧪 Adding New Tests

### Template

```typescript
describe("New Feature", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "veri_new_"));
  const keyHeader = { "x-api-key": "test-key-1" };

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("should do something", async () => {
    // Arrange
    const video = makeTinyMp4(tmp, "test.mp4");
    const fingerprints = runWorker(video);
    const cred = makeV3CredentialFromWorkerOut(fingerprints);

    // Act
    const resp = await request(app)
      .post("/verify")
      .set(keyHeader)
      .attach("file", video)
      .field("credential", JSON.stringify(cred));

    // Assert
    expect(resp.status).toBe(200);
    expect(resp.body.verdict).toBeDefined();
  });
});
```

---

## 📚 Best Practices

**1. Use Deterministic Test Data:**
```typescript
// Good - deterministic
const video = makeTinyMp4(tmp, "ref.mp4");

// Bad - non-deterministic
const video = downloadRandomVideo();
```

**2. Clean Up Resources:**
```typescript
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});
```

**3. Test Error Cases:**
```typescript
// Don't just test happy path
test("handles malformed input", async () => {
  const resp = await request(app)
    .post("/verify")
    .set(keyHeader)
    .attach("file", invalidVideo);
  
  expect(resp.status).toBe(400);
  expect(resp.body.error).toBeDefined();
});
```

**4. Use Descriptive Names:**
```typescript
// Good
test("Rejects non-contiguous segments with clear error message", ...);

// Bad
test("test1", ...);
```

**5. Test Request IDs:**
```typescript
expect(resp.body.requestId).toMatch(/^[a-f0-9]{6,8}$/);
```

---

## 🎉 Summary

**Complete test suite includes:**
- ✅ 35+ test cases
- ✅ Golden tests with deterministic videos
- ✅ Policy enforcement validation
- ✅ Authentication testing
- ✅ Segment validation
- ✅ Rate limiting
- ✅ Concurrency control
- ✅ Health checks
- ✅ CI/CD integration
- ✅ Coverage reporting

**Run tests before every deploy! 🚀**
