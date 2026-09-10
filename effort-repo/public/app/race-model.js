/* Race-specific time and projection rules. No browser or mutable app state. */
import { projectRace, sampleAt, fmtDuration } from "../engine.js";

export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T12:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export const validTime = value => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export function validTimezone(value) {
  if (typeof value !== "string" || value.length > 80) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}
export function cleanVenue(loc) {
  if (!loc || !Number.isFinite(loc.lat) || Math.abs(loc.lat) > 90 ||
      !Number.isFinite(loc.lon) || Math.abs(loc.lon) > 180 ||
      typeof loc.label !== "string" || !loc.label.trim() || !validTimezone(loc.timezone)) return null;
  return { lat: loc.lat, lon: loc.lon, label: loc.label.trim().slice(0, 80),
    timezone: loc.timezone, ...(loc.sample === true ? { sample: true } : {}) };
}
const formatters = new Map();
export function localISO(epoch, timezone) {
  if (!formatters.has(timezone)) {
    if (formatters.size > 32) formatters.clear();
    formatters.set(timezone, new Intl.DateTimeFormat("en-CA", { timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }));
  }
  const p = Object.fromEntries(formatters.get(timezone).formatToParts(epoch).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/* Resolve the venue's wall clock independently of the device timezone. Reject
   nonexistent or repeated DST times instead of silently moving the start. */
export function raceEpoch(date, time, timezone) {
  if (!validDate(date) || !validTime(time) || !validTimezone(timezone)) return null;
  const target = `${date}T${time}`, nominal = Date.parse(target + ":00Z");
  const offsets = new Set([-36, 0, 36].map(h => {
    const t = nominal + h * 3600000;
    return Date.parse(localISO(t, timezone) + ":00Z") - t;
  }));
  const matches = [...offsets].map(offset => nominal - offset).filter(t => localISO(t, timezone) === target);
  return matches.length === 1 ? matches[0] : null;
}
export function daysUntil(dateISO, todayISO) {
  if (!validDate(dateISO) || !validDate(todayISO)) return null;
  return Math.round((Date.parse(dateISO + "T00:00:00Z") - Date.parse(todayISO + "T00:00:00Z")) / 86400000);
}
export function finishBand(low, high) {
  const a = fmtDuration(Math.round(low / 30) * 30), b = fmtDuration(Math.round(high / 30) * 30);
  return a === b ? a : `${a}–${b}`;
}
export function raceClock(epoch, timezone, { date = false } = {}) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit",
    ...(date ? { month: "short", day: "numeric" } : {}) }).format(epoch);
}
export function raceDate(date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
    .format(new Date(date + "T12:00:00Z"));
}

export function raceProjection(race, weather, opts = {}) {
  const startEpoch = raceEpoch(race.dateISO, race.startTime, race.location?.timezone);
  const hours = weather?.hours;
  if (startEpoch == null || !hours || hours.length < 2) return null;
  const base = hours.findIndex((h, i) => i < hours.length - 1 && h.epoch <= startEpoch && hours[i + 1].epoch > startEpoch);
  if (base < 0) return null;
  const startIdx = base + (startEpoch - hours[base].epoch) / 3600000;
  // The engine interpolates evenly spaced hours; gaps must never look like a
  // complete forecast, and the solver must not extrapolate past its last hour.
  const remaining = (hours.at(-1).epoch - startEpoch) / 1000;
  if (remaining < race.goalSeconds) return null;
  const result = projectRace({ hours, startIdx, distanceKey: race.distanceKey, goalSeconds: race.goalSeconds,
    ...opts, elevFt: weather.elevFt ?? 0 });
  if (!result || remaining < result.highSeconds) return null;
  const last = Math.ceil(startIdx + result.highSeconds / 3600);
  for (let i = base; i < last; i++) {
    if (!hours[i + 1] || hours[i + 1].epoch - hours[i].epoch !== 3600000) return null;
  }
  const points = [0, .5, 1].map(f => ({ ...sampleAt(hours, startIdx + result.midSeconds * f / 3600),
    epoch: startEpoch + result.midSeconds * f * 1000 }));
  return { ...result, startEpoch, points };
}

/* Weather-only wording is safe for a public briefing. Personal impact stays in
   a separately opted-in block, and hazards always outrank playful language. */
export function raceTakeaway(result) {
  const p = result.projection, e = p.extremes;
  if (p.thunder) return { headline: "Storms in the picture.", body: "Thunderstorm signal during this window. Follow race-organizer updates and local alerts.", caution: true };
  if (e.maxAqi >= 151) return { headline: "Air quality needs attention.", body: `Forecast AQI reaches ${e.maxAqi} during this window. Check local air-quality alerts and race updates.`, caution: true };
  if (e.maxPrecip >= 60) return { headline: "Rain joins the start line.", body: `Precipitation chances reach ${e.maxPrecip}% during this window. Check footing and race-organizer updates.`, caution: true };
  if (p.riskScore >= 55 || !p.forecastClear) return e.maxTemp >= 75
    ? { headline: "Heat is part of the plan.", body: "Heat and race effort raise the caution level. Adjust by effort and follow race-organizer updates.", caution: true }
    : { headline: "Conditions need attention.", body: "Weather caution during this window. Check local alerts and the race organizer's guidance.", caution: true };
  if (e.maxDew >= 65) return { headline: "The air has opinions.", body: "A humid race window. Open patiently and let effort guide your pace.", caution: false };
  if (p.finish.temp - p.start.temp >= 5) return { headline: "A cooler start. A warmer finish.", body: "Temperatures rise during this window. Leave room to adjust as the race unfolds.", caution: false };
  if (e.maxWind >= 15) return { headline: "Wind joins the start line.", body: "Expect exposed stretches to feel different. Hold effort steady as conditions change.", caution: false };
  if (p.avgTemp < 40) return { headline: "A crisp start awaits.", body: "A cold race window. Plan your start-line layers and check local footing.", caution: false };
  return { headline: "Your race. In focus.", body: "Keep the forecast in perspective. Start controlled and adjust by effort as the day unfolds.", caution: false };
}
