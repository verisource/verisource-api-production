# 📚 VeriSource API Documentation

## Base URL
```
Production: https://verisource-api.railway.app
Development: http://localhost:8080
```

## Authentication

Currently no authentication required. Coming soon: API key authentication.

## Rate Limits

- 100 requests per 15 minutes per IP address
- 429 error returned when limit exceeded

## Error Responses

All errors return JSON with this format:
```json
{
  "error": "Error description",
  "detail": "Additional details (optional)"
}
```

### HTTP Status Codes

- `200` - Success
- `400` - Bad request (invalid input)
- `413` - File too large
- `415` - Unsupported media type
- `429` - Rate limit exceeded
- `500` - Internal server error

## Endpoints

### GET /

Get API information and available endpoints.

**Response:**
```json
{
  "status": "ok",
  "service": "VeriSource Media Verification API",
  "version": "1.0.0",
  "supports": ["image", "video", "audio"],
  "endpoints": {
    "health": "GET /health",
    "verify": "POST /verify"
  }
}
```

---

### GET /health

Health check endpoint for monitoring.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-10-30T12:00:00.000Z",
  "uptime": 3600.5,
  "memory": {
    "rss": 52428800,
    "heapTotal": 20971520,
    "heapUsed": 15728640
  },
  "environment": "production"
}
```

---

### POST /verify

Upload and verify a media file (image, video, or audio).

**Request:**

- Method: `POST`
- Content-Type: `multipart/form-data`
- Field name: `file`
- Max size: 50MB

**cURL Example:**
```bash
curl -X POST https://verisource-api.railway.app/verify \
  -F "file=@photo.jpg"
```

**JavaScript Example:**
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

fetch('https://verisource-api.railway.app/verify', {
  method: 'POST',
  body: formData
})
.then(res => res.json())
.then(data => console.log(data));
```

**Python Example:**
```python
import requests

with open('photo.jpg', 'rb') as f:
    files = {'file': f}
    response = requests.post(
        'https://verisource-api.railway.app/verify',
        files=files
    )
    print(response.json())
```

---

## Response Format

### Image Response
```json
{
  "kind": "image",
  "filename": "photo.jpg",
  "mime_type": "image/jpeg",
  "size_bytes": 245832,
  "processed_at": "2025-10-30T12:00:00.000Z",
  "canonical": {
    "kind": "image",
    "path": "/tmp/upload_abc123",
    "filename": "photo.jpg",
    "size_bytes": 245832,
    "sha256_hex": "abc123...",
    "mime_type": "image/jpeg",
    "v1": {
      "hash": "def456...",
      "size": 64
    },
    "v2": {
      "hash": "ghi789...",
      "size": 144
    }
  },
  "processing_time_ms": 145
}
```

### Video Response
```json
{
  "kind": "video",
  "filename": "video.mp4",
  "mime_type": "video/mp4",
  "size_bytes": 5242880,
  "processed_at": "2025-10-30T12:00:00.000Z",
  "canonical": {
    "algorithm": "sha256+segphash",
    "segmentHashes": [
      "seg_0:abc123...",
      "seg_1:def456...",
      "seg_2:ghi789..."
    ],
    "canonicalization": "vid:v1:deint=yadif|bt709|full|rgb24|max720|fps15.000|resize=lanczos3",
    "metadata": {
      "duration": 10.5,
      "width": 1280,
      "height": 720,
      "fps": 30
    }
  },
  "processing_time_ms": 3420
}
```

### Audio Response
```json
{
  "kind": "audio",
  "filename": "song.mp3",
  "mime_type": "audio/mpeg",
  "size_bytes": 4194304,
  "processed_at": "2025-10-30T12:00:00.000Z",
  "canonical": {
    "algorithm": "chromaprint+sha256",
    "chromaprint": "AQAAf0mUaEkSRYnC...",
    "sha256_normalized": "abc123...",
    "duration": 180.5,
    "sample_rate": 44100,
    "channels": 2,
    "canonicalization": "audio:v1:mono|16khz|wav"
  },
  "processing_time_ms": 892
}
```

---

## Use Cases

### 1. Compare Two Files

Upload both files and compare their canonical hashes:
```javascript
// Upload file 1
const file1 = await uploadFile('original.jpg');
const hash1 = file1.canonical.v2.hash;

// Upload file 2
const file2 = await uploadFile('suspect.jpg');
const hash2 = file2.canonical.v2.hash;

// Compare
if (hash1 === hash2) {
  console.log('Files are identical!');
} else {
  console.log('Files differ - possible tampering');
}
```

### 2. Detect Video Segments
```javascript
const video = await uploadFile('video.mp4');
const segments = video.canonical.segmentHashes;

// Store segments in database
segments.forEach((segment, index) => {
  db.insert({
    segment_number: index,
    hash: segment,
    video_id: video.id
  });
});
```

### 3. Audio Matching
```javascript
const audio1 = await uploadFile('song.mp3');
const audio2 = await uploadFile('suspect.mp3');

// Compare chromaprint fingerprints
const similarity = compareFingerprints(
  audio1.canonical.chromaprint,
  audio2.canonical.chromaprint
);

if (similarity > 0.9) {
  console.log('Very similar audio!');
}
```

---

## SDKs

### Official SDKs (Coming Soon)

- Node.js SDK
- Python SDK
- Ruby SDK
- Go SDK

### Community SDKs

Contributions welcome!

---

## Support

- Email: support@verisource.com
- Issues: GitHub Issues
- Docs: https://docs.verisource.com

