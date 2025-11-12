/**
 * Weather Verification Service
 * Verifies photo authenticity by comparing image conditions with historical weather data
 * API: WeatherAPI.com (PRO TIER - Historical data back to 2015)
 * Requires: WEATHER_API_KEY in .env
 */

const axios = require('axios');

const WEATHER_API_KEY = process.env.WEATHER_API_KEY || '';
const WEATHER_API_BASE = 'https://api.weatherapi.com/v1';

async function getHistoricalWeather(gps, date) {
  if (!WEATHER_API_KEY || !gps || !date) return null;
  
  try {
    console.log(`🌤️ Fetching weather for ${date} at ${gps.lat},${gps.lon}`);
    const response = await axios.get(`${WEATHER_API_BASE}/history.json`, {
      params: { 
        key: WEATHER_API_KEY, 
        q: `${gps.lat},${gps.lon}`, 
        dt: date 
      },
      timeout: 10000
    });

    const day = response.data.forecast.forecastday[0].day;
    console.log(`✅ Weather retrieved: ${day.condition.text}, ${day.avgtemp_c}°C`);
    
    return {
      condition: day.condition.text,
      avgtemp_c: day.avgtemp_c,
      precipitation_mm: day.totalprecip_mm,
      is_sunny: day.condition.text.toLowerCase().includes('sunny') || day.condition.text.toLowerCase().includes('clear'),
      is_rainy: day.totalprecip_mm > 0
    };
  } catch (error) {
    console.error('❌ Weather API error:', error.response?.data || error.message);
    if (error.response?.status === 400) {
      console.error('  Request params:', { lat: gps.lat, lon: gps.lon, date });
      return { error: 'invalid_request', message: error.response?.data?.error?.message || 'Invalid request format' };
    }
    if (error.response?.status === 401 || error.response?.status === 403) {
      return { error: 'auth_error', message: 'Invalid API key or insufficient permissions' };
    }
    return { error: 'api_error', message: error.message };
  }
}

async function verifyWeatherConditions(imageData, visionLabels = []) {
  const result = { enabled: !!WEATHER_API_KEY, verified: false, warnings: [] };
  
  if (!WEATHER_API_KEY) {
    result.warnings.push('Weather verification disabled - API key not configured');
    return result;
  }

  const weather = await getHistoricalWeather(imageData.gps, imageData.date);
  if (!weather) {
    result.warnings.push('Unable to retrieve weather data');
    return result;
  }

  if (weather.error) {
    result.warnings.push(weather.message);
    result.details = weather;
    return result;
  }

  result.details = weather;
  
  const labels = visionLabels.map(l => (typeof l === 'string' ? l : l.description).toLowerCase());
  const imageSunny = labels.some(l => l.includes('sun') || l.includes('clear') || l.includes('sky'));
  const imageRainy = labels.some(l => l.includes('rain') || l.includes('storm') || l.includes('cloud'));

  if (imageSunny && weather.is_rainy) {
    result.warnings.push('Image appears sunny but weather was rainy - possible manipulation');
  } else if (imageRainy && weather.is_sunny) {
    result.warnings.push('Image appears rainy but weather was sunny - possible manipulation');
  } else {
    result.verified = true;
  }

  return result;
}

module.exports = { getHistoricalWeather, verifyWeatherConditions, isConfigured: () => !!WEATHER_API_KEY };
