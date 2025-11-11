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

  if (exifData.GPSLatitude && exifData.GPSLongitude) {
    result.gps = {
      lat: convertDMSToDD(exifData.GPSLatitude, exifData.GPSLatitudeRef),
      lon: convertDMSToDD(exifData.GPSLongitude, exifData.GPSLongitudeRef)
    };
  }

  const dateStr = exifData.DateTimeOriginal || exifData.DateTime;
  if (dateStr) result.date = dateStr.split(' ')[0].replace(/:/g, '-');

  return result;
}

function convertDMSToDD(dms, ref) {
  if (!dms || dms.length < 3) return null;
  let dd = dms[0] + dms[1]/60 + dms[2]/3600;
  if (ref === 'S' || ref === 'W') dd = dd * -1;
  return dd;
}

module.exports = { verifyLandmarkLocation, extractGPSAndDate };
