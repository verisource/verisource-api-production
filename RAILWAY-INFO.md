# Railway Deployment Information

## Production URL
https://verisource-api-production-production.up.railway.app

## API Endpoints

### Health Check
```
GET https://verisource-api-production-production.up.railway.app/health
```

### Verification Endpoint (Example)
```
POST https://verisource-api-production-production.up.railway.app/api/verify
```

### Test the API
```bash
# Health check
curl https://verisource-api-production-production.up.railway.app/health

# Or in browser
https://verisource-api-production-production.up.railway.app
```

## Environment Variables Needed

To enable full functionality, set these in Railway dashboard:

### Required for AI Detection
```
HIVE_API_KEY=your_hive_api_key_here
# OR
ILLUMINARTY_API_KEY=your_illuminarty_api_key_here
```

### Optional
```
HIVE_API_URL=https://api.thehive.ai/api/v2/task/sync
ILLUMINARTY_API_URL=https://api.illuminarty.ai/v1/detect
```

## Next Steps

1. **Test Current Deployment:**
```bash
   curl https://verisource-api-production-production.up.railway.app/health
```

2. **Get Illuminarty API Key:**
   - Go to https://illuminarty.ai
   - Sign up for free trial (50 detections)
   - Get API key
   - Add to Railway environment variables

3. **Deploy Trust Score System:**
```bash
   git add .
   git commit -m "Add trust score system with 15% AI weighting"
   git push origin main
   # Railway will auto-deploy
```

4. **Test Trust Score:**
   Upload an image and verify trust score calculation works

## Railway Dashboard
https://railway.app/dashboard

Find your project: verisource-api-production-production

