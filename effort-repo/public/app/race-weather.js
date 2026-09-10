/* Dedicated race forecast: never changes the athlete's training location. */
import { estWbgtF } from "../engine.js";
import { fetchWithTimeout, OM_URL, AQ_URL, demoData } from "./data.js";
import { localISO, raceEpoch } from "./race-model.js";

export function raceWeatherURL(venue) {
  const u = new URL(OM_URL(venue.lat, venue.lon));
  for (const key of ["past_days", "daily", "minutely_15", "forecast_minutely_15"]) u.searchParams.delete(key);
  u.searchParams.set("timezone", venue.timezone);
  u.searchParams.set("timeformat", "unixtime");
  return u.href;
}
export function parseRaceWeather(om, timezone) {
  const h = om?.hourly;
  if (!Array.isArray(h?.time)) throw new Error("Missing forecast hours");
  const required = ["temperature_2m", "dew_point_2m", "relative_humidity_2m", "wind_speed_10m",
    "wind_gusts_10m", "shortwave_radiation", "precipitation_probability", "weather_code", "uv_index", "is_day"];
  const hours = h.time.flatMap((time, i) => {
    if (!Number.isFinite(time) || required.some(k => !Number.isFinite(h[k]?.[i]))) return [];
    const temp = h.temperature_2m[i], rh = h.relative_humidity_2m[i], solar = h.shortwave_radiation[i], wind = h.wind_speed_10m[i];
    return [{ epoch: time * 1000, iso: localISO(time * 1000, timezone), temp,
      dew: h.dew_point_2m[i], rh, wind, solar, gust: h.wind_gusts_10m[i],
      precipProb: h.precipitation_probability[i], code: h.weather_code[i], uv: h.uv_index[i],
      isDay: h.is_day[i] === 1, aqi: null, wbgt: estWbgtF(temp, rh, solar, wind) }];
  });
  if (hours.length < 2) throw new Error("Incomplete forecast");
  return { hours, fetchedAt: Date.now(), elevFt: Number.isFinite(om.elevation) ? Math.round(om.elevation * 3.28084) : 0, demo: false };
}
export async function fetchRaceWeather(venue) {
  if (venue.sample) {
    const d = demoData();
    return { hours: d.hours.map(h => ({ ...h, epoch: raceEpoch(h.iso.slice(0, 10), h.iso.slice(11, 16), venue.timezone) })),
      fetchedAt: d.meta.fetchedAt, elevFt: d.meta.elevFt, demo: true };
  }
  const aqURL = new URL(AQ_URL(venue.lat, venue.lon));
  aqURL.searchParams.set("timezone", venue.timezone);
  aqURL.searchParams.set("timeformat", "unixtime");
  const [forecast, air] = await Promise.allSettled([
    fetchWithTimeout(raceWeatherURL(venue)), fetchWithTimeout(aqURL.href, {}, 8000),
  ]);
  if (forecast.status !== "fulfilled" || !forecast.value.ok) throw new Error("Race forecast unavailable");
  const weather = parseRaceWeather(await forecast.value.json(), venue.timezone);
  try {
    if (air.status === "fulfilled" && air.value.ok) {
      const aq = (await air.value.json()).hourly;
      const map = new Map((aq?.time ?? []).map((t, i) => [t * 1000, aq.us_aqi?.[i]]));
      for (const h of weather.hours) if (Number.isFinite(map.get(h.epoch))) h.aqi = map.get(h.epoch);
    }
  } catch { /* AQI coverage is explicitly reported separately in the briefing. */ }
  return weather;
}
