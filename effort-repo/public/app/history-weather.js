/* Conditions at a past performance, for weather-correcting it.

   2022 onward uses Open-Meteo's archived forecasts (the same models the app
   forecasts with); earlier dates use its reanalysis archive. Both are
   "modeled conditions for that place and hour", never a measurement on the
   course — the interface says so. Missing values stay missing: an incomplete
   window means no correction rather than a guessed one. */
import { estWbgtF } from "../engine.js";
import { neutralizePerformance } from "../fitness.js";
import { fetchWithTimeout, demoData } from "./data.js";
import { localISO, raceEpoch } from "./race-model.js";

const HOURLY = "temperature_2m,dew_point_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,shortwave_radiation,weather_code,is_day,precipitation";
const FORECAST_ARCHIVE_FROM = "2022-01-01";

export function historyWeatherURL(venue, dateISO) {
  const next = new Date(Date.parse(dateISO + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  const u = new URL(dateISO >= FORECAST_ARCHIVE_FROM
    ? "https://historical-forecast-api.open-meteo.com/v1/forecast"
    : "https://archive-api.open-meteo.com/v1/archive");
  u.searchParams.set("latitude", String(venue.lat));
  u.searchParams.set("longitude", String(venue.lon));
  u.searchParams.set("start_date", dateISO);
  u.searchParams.set("end_date", next);
  u.searchParams.set("hourly", HOURLY);
  u.searchParams.set("temperature_unit", "fahrenheit");
  u.searchParams.set("wind_speed_unit", "mph");
  u.searchParams.set("timezone", venue.timezone);
  u.searchParams.set("timeformat", "unixtime");
  return u.href;
}

export function parseHistoryWeather(om, timezone) {
  const h = om?.hourly;
  if (!Array.isArray(h?.time)) throw new Error("Missing weather hours");
  const need = ["temperature_2m", "dew_point_2m", "relative_humidity_2m", "wind_speed_10m"];
  const hours = h.time.flatMap((time, i) => {
    if (!Number.isFinite(time) || need.some((k) => !Number.isFinite(h[k]?.[i]))) return [];
    const temp = h.temperature_2m[i], rh = h.relative_humidity_2m[i], wind = h.wind_speed_10m[i];
    const solar = Number.isFinite(h.shortwave_radiation?.[i]) ? h.shortwave_radiation[i] : 0;
    const rainMm = Number.isFinite(h.precipitation?.[i]) ? h.precipitation[i] : 0;
    return [{
      epoch: time * 1000, iso: localISO(time * 1000, timezone), temp, dew: h.dew_point_2m[i], rh, wind, solar,
      gust: Number.isFinite(h.wind_gusts_10m?.[i]) ? h.wind_gusts_10m[i] : wind,
      // An archive has what fell, not a probability of it falling.
      precipProb: rainMm >= 0.5 ? 80 : rainMm >= 0.1 ? 40 : 0,
      code: Number.isFinite(h.weather_code?.[i]) ? h.weather_code[i] : 1, uv: 0,
      isDay: Number.isFinite(h.is_day?.[i]) ? h.is_day[i] === 1 : solar > 5,
      aqi: null, wbgt: estWbgtF(temp, rh, solar, wind),
    }];
  });
  return { hours, elevFt: Number.isFinite(om.elevation) ? Math.round(om.elevation * 3.28084) : 0 };
}

/* The demo has no past: replay the sample day's shape onto the result's date,
   clearly labelled as sample conditions. */
function sampleHours(dateISO, timezone) {
  // The demo forecast starts at the current hour; rebuild a clean midnight-to-
  // midnight day from its first occurrence of each clock hour.
  const byHour = new Map();
  for (const h of demoData().hours) { const hh = h.iso.slice(11, 16); if (!byHour.has(hh)) byHour.set(hh, h); }
  const next = new Date(Date.parse(dateISO + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  const out = [];
  for (const date of [dateISO, next]) {
    for (let i = 0; i < 24; i++) {
      const hh = `${String(i).padStart(2, "0")}:00`, src = byHour.get(hh);
      const epoch = raceEpoch(date, hh, timezone);
      if (src && epoch != null) out.push({ ...src, iso: `${date}T${hh}`, epoch });
    }
  }
  return out;
}

/* Resolve a performance's weather correction. Returns the `weather` record to
   store on it. Never throws. */
export async function correctPerformance(perf, { homeElevFt = 0, massKg = 70 } = {}) {
  const venue = perf.venue;
  if (!venue || !perf.startTime) return { status: "none" };
  const startEpoch = raceEpoch(perf.dateISO, perf.startTime, venue.timezone);
  if (startEpoch == null) return { status: "unavailable", reason: "start time" };
  try {
    let hours, elevFt = 0, sample = false;
    if (venue.sample) {
      hours = sampleHours(perf.dateISO, venue.timezone); sample = true;
    } else {
      const res = await fetchWithTimeout(historyWeatherURL(venue, perf.dateISO));
      if (!res.ok) return { status: "unavailable", reason: "service" };
      ({ hours, elevFt } = parseHistoryWeather(await res.json(), venue.timezone));
    }
    const out = neutralizePerformance({ hours, startEpoch, seconds: perf.seconds, distM: perf.distanceM, elevFt, homeElevFt, massKg });
    if (!out) return { status: "unavailable", reason: "coverage" };
    return { status: "corrected", sample, ...out, neutralSeconds: Math.round(out.neutralSeconds * 10) / 10 };
  } catch {
    return { status: "unavailable", reason: "offline" };
  }
}
