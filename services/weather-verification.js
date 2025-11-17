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
    const day = response.data.forecast.forecastday[0].day;
    return {
      condition: day.condition.text,
      avgtemp_c: day.avgtemp_c,
      precipitation_mm: day.totalprecip_mm,
      is_sunny: day.condition.text.toLowerCase().includes("sunny"),
      is_rainy: day.totalprecip_mm > 0
    };
  } catch (error) {
    return { error: "api_error", message: error.message };
  }
}

async function verifyWeatherConditions(imageData, visionLabels = []) {
  const { weatherData } = imageData;
  if (!weatherData) return { verified: false, reason: "No weather data", confidence: 0 };
  if (weatherData.error) return { verified: false, reason: weatherData.message, confidence: 0 };
  return { verified: true, confidence: 50, historical_weather: weatherData };
}

module.exports = { getHistoricalWeather, verifyWeatherConditions };
