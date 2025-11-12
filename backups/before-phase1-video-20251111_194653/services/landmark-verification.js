/**
 * Landmark Verification Service
 * Identifies famous landmarks and verifies location consistency
 */

function verifyLandmarkLocation(landmarks, gps) {
  const result = { enabled: true, verified: false, landmarks_detected: landmarks ? landmarks.length : 0, details: [], warnings: [] };

  if (!landmarks || landmarks.length === 0) {
    result.warnings.push('No landmarks detected in image');
    return result;
  }

  landmarks.forEach(landmark => {
    const landmarkGPS = landmark.locations?.[0]?.latLng;
    
    if (landmarkGPS && gps) {
      const distance = calculateDistance(gps.lat, gps.lon, landmarkGPS.latitude, landmarkGPS.longitude);
      
      result.details.push({
        name: landmark.description,
        confidence: Math.round((landmark.score || 0) * 100),
        distance_km: Math.round(distance * 10) / 10,
        match: distance < 1 ? 'exact' : distance < 10 ? 'close' : 'distant'
      });

      if (distance > 50) {
        result.warnings.push(`Landmark "${landmark.description}" detected but GPS is ${Math.round(distance)}km away - possible manipulation`);
      }
    } else {
      result.details.push({
        name: landmark.description,
        confidence: Math.round((landmark.score || 0) * 100),
        match: 'unknown'
      });
    }
  });

  return result;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function toRadians(degrees) { return degrees * Math.PI / 180; }

function extractGPSAndDate(exifData) {
  const result = { gps: null, date: null };
  if (!exifData) return result;

  // Handle GPS coordinates - exif-parser already returns decimal degrees
  if (exifData.GPSLatitude !== undefined && exifData.GPSLongitude !== undefined) {
    // Check if already in decimal format (number)
    if (typeof exifData.GPSLatitude === 'number') {
      result.gps = {
        lat: exifData.GPSLatitude,
        lon: exifData.GPSLongitude
      };
    } else if (Array.isArray(exifData.GPSLatitude)) {
      // DMS format [degrees, minutes, seconds]
      result.gps = {
        lat: convertDMSToDD(exifData.GPSLatitude, exifData.GPSLatitudeRef),
        lon: convertDMSToDD(exifData.GPSLongitude, exifData.GPSLongitudeRef)
      };
    }
  }

  // Handle date - exif-parser returns Unix timestamp
  if (exifData.DateTimeOriginal) {
    // If it's a Unix timestamp (number), convert to date string
    if (typeof exifData.DateTimeOriginal === 'number') {
      const date = new Date(exifData.DateTimeOriginal * 1000);
      result.date = date.toISOString().split('T')[0]; // YYYY-MM-DD
    } else {
      // String format like "2024:06:15 14:30:00"
      const dateString = String(exifData.DateTimeOriginal);
      if (dateString.includes(' ')) {
        result.date = dateString.split(' ')[0].replace(/:/g, '-');
      } else {
        result.date = dateString;
      }
    }
  }

  return result;
}

function convertDMSToDD(dms, ref) {
  if (!dms || !Array.isArray(dms) || dms.length < 3) return null;
  let dd = dms[0] + dms[1]/60 + dms[2]/3600;
  if (ref === 'S' || ref === 'W') dd = dd * -1;
  return dd;
}

module.exports = { verifyLandmarkLocation, extractGPSAndDate };
