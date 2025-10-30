# 🎯 VeriSource Media Verification API

A complete media authentication and fingerprinting API supporting **images**, **videos**, and **audio files**.

## 🌟 Features

- ✅ **Image Verification** - Perceptual hashing and canonicalization
- ✅ **Video Verification** - Segment-based fingerprinting resistant to tampering
- ✅ **Audio Verification** - Chromaprint + SHA256 normalized hashing
- ✅ **Tamper Detection** - Detect edits, crops, filters, and manipulations
- ✅ **Multiple Formats** - Support for common media formats
- ✅ **Rate Limiting** - Built-in API protection
- ✅ **Production Ready** - Secure, fast, and scalable

## 🚀 Quick Start

### Installation
```bash
# Clone repository
git clone https://github.com/yourusername/verisource-api.git
cd verisource-api

# Install dependencies
npm install

# Start server
npm start
```

### Docker (Alternative)
```bash
docker build -t verisource-api .
docker run -p 8080:8080 verisource-api
```

## 📖 API Documentation

### Base URL
```
http://localhost:8080
```

### Endpoints

#### `GET /` - API Information
Returns API status and available endpoints.

#### `GET /health` - Health Check
Returns server health and uptime.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-10-30T12:00:00.000Z",
  "uptime": 3600.5
}
```

#### `POST /verify` - Verify Media File

Upload a media file for verification and fingerprinting.

**Request:**
```bash
curl -X POST http://localhost:8080/verify \
  -F "file=@image.png"
```

**Response (Image):**
```json
{
  "kind": "image",
  "filename": "photo.jpg",
  "size_bytes": 245832,
  "mime_type": "image/jpeg",
  "processed_at": "2025-10-30T12:00:00.000Z",
  "canonical": {
    "v1": { "hash": "abc123..." },
    "v2": { "hash": "def456..." }
  },
  "processing_time_ms": 145
}
```

**Response (Video):**
```json
{
  "kind": "video",
  "filename": "video.mp4",
  "size_bytes": 5242880,
  "canonical": {
    "algorithm": "sha256+segphash",
    "segmentHashes": ["seg_0:abc...", "seg_1:def..."],
    "canonicalization": "vid:v1:deint=yadif|bt709|..."
  },
  "processing_time_ms": 3420
}
```

**Response (Audio):**
```json
{
  "kind": "audio",
  "filename": "song.mp3",
  "size_bytes": 4194304,
  "canonical": {
    "algorithm": "chromaprint+sha256",
    "sha256_normalized": "abc123...",
    "duration": 180.5,
    "sample_rate": 44100,
    "channels": 2
  },
  "processing_time_ms": 892
}
```

## 🔧 Configuration

Create a `.env` file:
```env
PORT=8080
NODE_ENV=production
MAX_UPLOAD_SIZE_MB=50
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

## 📊 Supported Formats

### Images
- PNG, JPEG, GIF, WebP, BMP, TIFF

### Videos
- MP4, MOV, AVI, MKV, WebM, M4V

### Audio
- MP3, WAV, M4A, FLAC, OGG, AAC

## 🛡️ Security Features

- ✅ Rate limiting (100 requests per 15 minutes)
- ✅ File size limits (50MB default)
- ✅ File type validation
- ✅ Helmet.js security headers
- ✅ CORS enabled
- ✅ Input sanitization

## 💡 Use Cases

- **Content Authenticity** - Verify news photos/videos haven't been altered
- **Copyright Protection** - Prove ownership of original media
- **Evidence Verification** - Authenticate legal evidence
- **Deepfake Detection** - Compare media against known originals
- **Social Media Moderation** - Detect reuploaded banned content
- **Music Rights** - Identify copyrighted audio

## 🏗️ Architecture
```
verisource-api/
├── index.js                 # Main API server
├── canonicalization.js      # Image processing
├── worker/
│   ├── video-worker.js      # Video fingerprinting
│   └── audio-worker.js      # Audio fingerprinting
├── uploads/                 # Temporary upload directory
└── package.json
```

## 🚀 Deployment

### Railway
```bash
# Install Railway CLI
npm install -g @railway/cli

# Deploy
railway login
railway init
railway up
```

### Heroku
```bash
heroku create your-app-name
git push heroku main
```

### DigitalOcean App Platform

Connect your GitHub repository and deploy automatically.

## 📈 Performance

- **Image processing:** ~100-300ms
- **Video processing:** ~2-5 seconds per minute of video
- **Audio processing:** ~500ms-2s per minute of audio

## 🤝 Contributing

Contributions welcome! Please open an issue or submit a PR.

## 📄 License

MIT License - See LICENSE file for details.

## 🆘 Support

- Documentation: [https://docs.verisource.com](https://docs.verisource.com)
- Issues: [GitHub Issues](https://github.com/yourusername/verisource-api/issues)
- Email: support@verisource.com

## 🎉 Credits

Built with:
- Express.js
- FFmpeg
- Multer
- Sharp
- Chromaprint

---

**Made with ❤️ by the VeriSource team**

---

## 🔒 Security Features

### Built-in Protection

- ✅ **Rate Limiting**: 100 requests per 15 minutes per IP
- ✅ **Daily Limits**: 10,000 requests per day (configurable)
- ✅ **DDoS Protection**: Automatic IP blocking after 1000 requests/hour
- ✅ **File Validation**: Blocks executables and malicious files
- ✅ **Size Limits**: 50MB maximum file size
- ✅ **Resource Management**: Max 3 concurrent processing jobs
- ✅ **Helmet.js**: Security headers enabled
- ✅ **CORS**: Configured and enabled
- ✅ **Privacy**: Files deleted immediately after processing

### Monitoring

- Real-time stats: `GET /stats`
- Health checks: `GET /health`
- Hourly performance logs
- Error tracking and alerts
- Memory usage monitoring

### Compliance

- ✅ GDPR compliant (no data storage)
- ✅ Privacy policy included
- ✅ Terms of service included
- ✅ Graceful shutdown handling

### Best Practices

1. Set Railway spending limit: $10-20/month
2. Enable Railway email alerts
3. Monitor `/stats` endpoint daily
4. Review error logs weekly
5. Update dependencies monthly

---

## ⚠️ Important Notes

### Before Going Public

1. **Set API Keys** (coming soon - optional for v1)
2. **Configure Alerts**: Set up email notifications
3. **Monitor Costs**: Check Railway dashboard daily
4. **Review Logs**: Watch for suspicious activity
5. **Backup Strategy**: No backups needed (stateless API)

### Cost Management

- Free tier: ~$5/month Railway credit
- Expected costs (100 users): $10-25/month
- With 1000 users: $50-100/month
- Daily limit prevents runaway costs

### Support

- Security issues: security@verisource.com
- General support: support@verisource.com
- Bug reports: GitHub Issues

