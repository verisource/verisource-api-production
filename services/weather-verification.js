/**
 * Weather Verification Service
 * Verifies photo authenticity by comparing image conditions with historical weather data
 * API: WeatherAPI.com
 * FREE TIER LIMIT: Only last 7 days of historical data available
 * Requires: WEATHER_API_KEY in .env
 */

const axios = require('axios');

const WEATHER_API_KEY = process.env.WEATHER_API_KEY || '';
const WEATHER_API_BASE = 'https://api.weatherapi.com/v1';

async function getHistoricalWeather(gps, date) {
  if (!WEATHER_API_KEY || !gps || !date) return null;
  
  // Check if date is within last 7 days (free tier limitation)
  const photoDate = new Date(date);
  const today = new Date();
  const daysAgo = Math.floor((today - photoDate) / (1000 * 60 * 60 * 24));
  
  if (daysAgo > 7) {
    console.log(`⚠️ Photo date (${date}) is ${daysAgo} days old - beyond free tier 7-day limit`);
    return { error: 'historical_data_unavailable', message: 'Photo older than 7 days (free tier limit)' };
  }
  
  try {
    const response = await axios.get(`${WEATHER_API_BASE}/history.json`, {
      params: { 
        key: WEATHER_API_KEY, 
        q: `${gps.lat},${gps.lon}`, 
        dt: date 
      },
      timeout: 5000
    });

    const day = response.data.forecast.forecastday[0].day;
    return {
      condition: day.condition.text,
      avgtemp_c: day.avgtemp_c,
      precipitation_mm: day.totalprecip_mm,
      is_sunny: day.condition.text.toLowerCase().includes('sunny') || day.condition.text.toLowerCase().includes('clear'),
      is_rainy: day.totalprecip_mm > 0
    };
  } catch (error) {
    console.error('Weather API error:', error.response?.data || error.message);
    if (error.response?.status === 400) {
      return { error: 'invalid_request', message: 'Date may be too old or invalid format' };
    }
    return null;
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
  const imageSunny = labels.some(l => l.includes('sun') || l.includes('clear'));
  const imageRainy = labels.some(l => l.includes('rain') || l.includes('storm'));

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
