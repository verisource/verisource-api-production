const axios = require("axios");
const WEATHER_API_KEY = process.env.WEATHER_API_KEY || "";
const WEATHER_API_BASE = "https://api.weatherapi.com/v1";

async function getHistoricalWeather(gps, date) {
  if (!WEATHER_API_KEY || !gps || !date) return null;
  try {
    console.log("Fetching weather for " + date + " at " + gps.lat + "," + gps.lon);
    const response = await axios.get(WEATHER_API_BASE + "/history.json", {
      params: { key: WEATHER_API_KEY, q: gps.lat + "," + gps.lon, dt: date },
      timeout: 10000
    });

     // Check if response has expected structure
    if (!response.data || !response.data.forecast || !response.data.forecast.forecastday) {
      console.error('Unexpected API response structure:', response.data);
      return { error: "invalid_response", message: "Unexpected API response" };
    }

    const day = response.data.forecast.forecastday[0].day;
    console.log("Weather retrieved: " + day.condition.text + ", " + day.avgtemp_c + "°C");
   
    return {
      condition: day.condition.text,
      avgtemp_c: day.avgtemp_c,
      precipitation_mm: day.totalprecip_mm,
      is_sunny: day.condition.text.toLowerCase().includes("sunny"),
      is_rainy: day.totalprecip_mm > 0
    };
  } catch (error) {
    const errorCode = error.response?.data?.error?.code;
    console.error('Weather API error:', errorCode, error.response?.data?.error?.message || error.message);
    
    // Error 1008 = API key doesn't have historical access
    if (errorCode === 1008) {
      return { 
        error: "historical_not_available", 
        message: "Historical weather data not available - upgrade API plan"
      };
    }
    
    return {
         error: "api_error",
         message: error.message,
         status: error.response?.status,
         details: error.response?.data
     };
  }
}

async function verifyWeatherConditions(imageData, visionLabels = []) {
  const { weatherData } = imageData;
  if (!weatherData) return { verified: false, reason: "No weather data", confidence: 0 };
  if (weatherData.error) return { verified: false, reason: weatherData.message, confidence: 0 };
  return { verified: true, confidence: 50, historical_weather: weatherData };
}

function isConfigured() {
  return !!WEATHER_API_KEY;
}
module.exports = { getHistoricalWeather, verifyWeatherConditions, isConfigured };
