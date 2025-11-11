# Weather & Landmark Verification - Integration Plan

## Status: Services Ready, Integration Pending

### ✅ Completed
- Weather verification service (`services/weather-verification.js`)
- Landmark verification service (`services/landmark-verification.js`)
- WeatherAPI.com API key configured in Railway
- Services tested and working independently

### 📋 Integration Steps (Next Session)

1. **Add to index.js imports** (top of file):
```javascript
   const WeatherVerification = require('./services/weather-verification');
   const LandmarkVerification = require('./services/landmark-verification');
```

2. **Declare variables** at start of `/verify` endpoint:
```javascript
   let weatherVerification = null;
   let landmarkVerification = null;
   let exifData = null;
```

3. **Extract EXIF data** (after Google Vision analysis):
```javascript
   if (kind === 'image') {
     const ExifParser = require('exif-parser');
     const exifBuffer = fs.readFileSync(req.file.path);
     const parser = ExifParser.create(exifBuffer);
     exifData = parser.parse().tags;
     const gpsAndDate = LandmarkVerification.extractGPSAndDate(exifData);
     
     if (gpsAndDate.gps || gpsAndDate.date) {
       // Weather verification
       if (WeatherVerification.isConfigured()) {
         weatherVerification = await WeatherVerification.verifyWeatherConditions(
           gpsAndDate,
           googleVisionResult?.results?.labels || []
         );
       }
       
       // Landmark verification
       if (googleVisionResult?.results?.landmarks) {
         landmarkVerification = LandmarkVerification.verifyLandmarkLocation(
           googleVisionResult.results.landmarks,
           gpsAndDate.gps
         );
       }
     }
   }
```

4. **Add to response** (in the final res.json):
```javascript
   ...(kind === 'image' && weatherVerification && { weather_verification: weatherVerification }),
   ...(kind === 'image' && landmarkVerification && { landmark_verification: landmarkVerification }),
```

5. **Update confidence scoring** to include weather/landmark factors

### 🧪 Test Cases
- Test with GPS-tagged photo from Paris (Eiffel Tower)
- Test with photo containing weather conditions
- Test with photo without GPS data
- Verify warnings for GPS/landmark mismatches

### 📦 Dependencies
- `exif-parser` (already installed)
- `axios` (already installed)
- WeatherAPI.com key (already configured: `WEATHER_API_KEY`)

### 🎯 Expected Output Example
```json
{
  "weather_verification": {
    "enabled": true,
    "verified": true,
    "details": {
      "condition": "Partly cloudy",
      "avgtemp_c": 18.2,
      "precipitation_mm": 0
    },
    "warnings": []
  },
  "landmark_verification": {
    "enabled": true,
    "verified": true,
    "landmarks_detected": 1,
    "details": [
      {
        "name": "Eiffel Tower",
        "confidence": 95,
        "distance_km": 0.3,
        "match": "exact"
      }
    ],
    "warnings": []
  }
}
```

### ⚠️ Notes
- Integration attempted but file corruption occurred during sed operations
- Services are complete and ready - just need careful manual integration
- Use manual editing or Python script for integration (avoid sed)
