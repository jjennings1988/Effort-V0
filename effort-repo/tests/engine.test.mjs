/* Effort engine test suite — run with: npm test
   Guards the calibration math. If a change breaks a pace number,
   a WBGT estimate, or the window search, this fails loudly. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePace, fmtPace, estWbgtF, wetBulbC,
  heatBand, coldBand, windBand, airBand, altitudeBand,
  project, findBestWindow, hourAllowed, buildHours,
  windowLabelText, metricSeverity,
} from "../public/engine.js";

/* ---------- helpers ---------- */
function mkHour(hh, temp, { dew = 62, rh = 70, wind = 5, solar = 400, pp = 8, code = 1, isDay = true, aqi = 45 } = {}) {
  return {
    iso: `2026-07-11T${String(hh).padStart(2, "0")}:00`,
    temp, dew, rh, wind, gust: wind * 1.5, solar, precipProb: pp, uv: solar / 110,
    code, isDay, aqi, wbgt: estWbgtF(temp, rh, solar, wind),
  };
}
function flatDay(temp = 70, n = 30, opts = {}) {
  return Array.from({ length: n }, (_, i) => mkHour((6 + i) % 24, temp, { ...opts, isDay: ((6 + i) % 24) >= 6 && ((6 + i) % 24) <= 20 }));
}
const baseRun = { durationMinutes: 60, intensity: "Easy", sport: "run", baselinePaceSeconds: 480 };

/* ---------- pace parsing ---------- */
test("parsePace accepts mm:ss, rejects junk and implausible paces", () => {
  assert.equal(parsePace("8:00"), 480);
  assert.equal(parsePace("12:35"), 755);
  assert.equal(parsePace("2:59"), null);   // faster than world class
  assert.equal(parsePace("31:00"), null);  // slower than walking
  assert.equal(parsePace("8:60"), null);
  assert.equal(parsePace("abc"), null);
});
test("fmtPace round-trips", () => {
  assert.equal(fmtPace(505), "8:25");
  assert.equal(fmtPace(parsePace("6:45")), "6:45");
});

/* ---------- WBGT estimation ---------- */
test("Stull wet-bulb matches published reference point (30C/50% -> ~22C)", () => {
  const tw = wetBulbC(30, 50);
  assert.ok(Math.abs(tw - 22) < 0.6, `got ${tw}`);
});
test("estimated WBGT lands in sane bands", () => {
  const hotHumidSun = estWbgtF(90, 70, 900, 4);
  assert.ok(hotHumidSun >= 84 && hotHumidSun <= 90, `hot humid sun: ${hotHumidSun}`); // black-flag territory
  const overcast = estWbgtF(90, 70, 100, 4);
  assert.ok(overcast < hotHumidSun, "clouds must lower WBGT");
  const windy = estWbgtF(90, 70, 900, 20);
  assert.ok(windy < hotHumidSun, "wind must lower WBGT");
  const cold = estWbgtF(35, 60, 0, 8);
  assert.ok(cold >= 25 && cold <= 36, `cold day: ${cold}`);
});

/* ---------- impact bands ---------- */
test("heat benchmark grid matches published table anchors", () => {
  assert.deepEqual(heatBand(100), { low: 0, high: 0.5 });
  assert.deepEqual(heatBand(140), { low: 2, high: 3 });
  assert.deepEqual(heatBand(160), { low: 4.5, high: 6 });
  assert.deepEqual(heatBand(185), { low: 10, high: 15 });
});
test("cold band kicks in below 40F and grows", () => {
  assert.deepEqual(coldBand(50), { low: 0, high: 0 });
  assert.ok(coldBand(25).low > 0 && coldBand(5).high > coldBand(25).high);
});
test("wind penalizes rides roughly 3x runs", () => {
  const run = windBand(20, "run"), ride = windBand(20, "ride");
  assert.ok(ride.high > run.high * 2, `ride ${ride.high} vs run ${run.high}`);
});
test("air quality bands follow exercise guidance thresholds", () => {
  assert.deepEqual(airBand(50), { low: 0, high: 0 });
  assert.deepEqual(airBand(120), { low: 0.5, high: 1.5 });
  assert.deepEqual(airBand(175), { low: 1, high: 3 });
  assert.deepEqual(airBand(null), { low: 0, high: 0 });
});
test("altitude free below 3000ft, ~1-2%/1000ft above", () => {
  assert.deepEqual(altitudeBand(2100), { low: 0, high: 0 });
  const denver = altitudeBand(5280);
  assert.ok(denver.low >= 2 && denver.high <= 5, JSON.stringify(denver));
});

/* ---------- project() integration ---------- */
test("mild morning easy run: small adjustment, finish-safe", () => {
  const p = project({ hours: flatDay(68, 30, { dew: 60 }), startIdx: 0, ...baseRun });
  assert.ok(p.performanceImpact.high < 4);
  assert.ok(p.finishSafe);
  assert.ok(p.adjustedPace.lowSeconds >= 480);
});
test("thunder inside window kills finish-safe and flags", () => {
  const hrs = flatDay(80);
  hrs[2] = mkHour(8, 82, { code: 95, pp: 70 });
  const p = project({ hours: hrs, startIdx: 1, durationMinutes: 120, intensity: "Easy", sport: "run", baselinePaceSeconds: 480 });
  assert.ok(p.thunder);
  assert.equal(p.finishSafe, false);
  assert.ok(p.riskScore >= 55);
});
test("intervals shed sustained thermal load vs continuous", () => {
  const hot = flatDay(88, 30, { dew: 70 });
  const pc = project({ hours: hot, startIdx: 2, durationMinutes: 60, intensity: "Hard", sport: "run", baselinePaceSeconds: 420, structure: "continuous" });
  const pi = project({ hours: hot, startIdx: 2, durationMinutes: 60, intensity: "Hard", sport: "run", baselinePaceSeconds: 420, structure: "intervals" });
  assert.ok(pi.performanceImpact.high < pc.performanceImpact.high);
});
test("smoky air raises impact and risk; clean air does not", () => {
  const clean = project({ hours: flatDay(70), startIdx: 2, ...baseRun });
  const smoky = project({ hours: flatDay(70, 30, { aqi: 160 }), startIdx: 2, ...baseRun });
  assert.ok(smoky.performanceImpact.high > clean.performanceImpact.high);
  assert.ok(smoky.riskScore >= clean.riskScore + 15);
  assert.equal(smoky.extremes.maxAqi, 160);
});
test("altitude passes through to impact for a race effort", () => {
  const sea = project({ hours: flatDay(60), startIdx: 2, durationMinutes: 60, intensity: "Race", sport: "run", baselinePaceSeconds: 390, elevFt: 0 });
  const denver = project({ hours: flatDay(60), startIdx: 2, durationMinutes: 60, intensity: "Race", sport: "run", baselinePaceSeconds: 390, elevFt: 5280 });
  assert.ok(denver.performanceImpact.low > sea.performanceImpact.low + 1.5);
});
test("longer workouts in rising heat cost more (integration works)", () => {
  const rising = Array.from({ length: 30 }, (_, i) => mkHour((6 + i) % 24, 70 + i * 2.5, { dew: 66 }));
  const short = project({ hours: rising, startIdx: 0, ...baseRun });
  const long = project({ hours: rising, startIdx: 0, ...baseRun, durationMinutes: 120 });
  assert.ok(long.performanceImpact.high > short.performanceImpact.high);
});

/* ---------- training hours + window search ---------- */
test("hourAllowed handles normal and overnight ranges", () => {
  assert.equal(hourAllowed("2026-07-11T03:00", 6, 22), false);
  assert.equal(hourAllowed("2026-07-11T07:00", 6, 22), true);
  assert.equal(hourAllowed("2026-07-11T03:00", 20, 5), true); // night-shift athlete
});
test("the 3AM trap: constraint redirects to earliest allowed hour", () => {
  // only 2-4 AM is cool; everything else is brutal
  const hrs = [];
  for (let i = 0; i < 30; i++) {
    const h = (14 + i) % 24;
    const temp = h >= 2 && h <= 4 ? 66 : h >= 5 && h <= 7 ? 76 : h >= 22 || h <= 1 ? 84 : 91;
    hrs.push(mkHour(h, temp, { dew: 70, solar: h >= 6 && h <= 20 ? 650 : 0, isDay: h >= 6 && h <= 20 }));
  }
  const free = findBestWindow(hrs, 60, "Easy", "run", 24, { fromH: 0, toH: 23 });
  const fenced = findBestWindow(hrs, 60, "Easy", "run", 24, { fromH: 6, toH: 22 });
  assert.equal(hrs[free.idx].iso.slice(11, 13), "02");
  assert.equal(hrs[fenced.idx].iso.slice(11, 13), "06");
});
test("thunder hours are never recommended", () => {
  const hrs = flatDay(75);
  hrs.forEach((h, i) => { if (i < 5) { h.code = 95; h.precipProb = 70; } });
  const w = findBestWindow(hrs, 60, "Easy", "run", 20, { fromH: 0, toH: 23 });
  assert.ok(w.idx >= 5, `picked idx ${w.idx}`);
});

/* ---------- data shaping ---------- */
test("buildHours trims to the location's current hour", () => {
  const offset = -14400;
  const startMs = Date.now() - 3 * 3600e3;
  const times = [], arr = (n) => Array(72).fill(n);
  for (let i = 0; i < 72; i++) {
    const loc = new Date(startMs + i * 3600e3 + offset * 1000);
    times.push(loc.toISOString().slice(0, 13) + ":00");
  }
  const om = { utc_offset_seconds: offset, hourly: { time: times, temperature_2m: arr(70), dew_point_2m: arr(60), relative_humidity_2m: arr(70), apparent_temperature: arr(70), precipitation_probability: arr(5), weather_code: arr(1), wind_speed_10m: arr(5), wind_gusts_10m: arr(8), shortwave_radiation: arr(300), uv_index: arr(3), is_day: arr(1) } };
  const hrs = buildHours(om);
  const delta = (hrs[0].epoch - Date.now()) / 3600e3;
  assert.ok(delta > -1 && delta <= 0, `first hour delta ${delta}`);
});
test("window labels format cleanly across day boundaries", () => {
  assert.deepEqual(windowLabelText("2026-07-11T06:00", "2026-07-11T09:00", "2026-07-11"), { prefix: "", time: "6—9 AM" });
  assert.deepEqual(windowLabelText("2026-07-12T06:00", "2026-07-12T08:00", "2026-07-11"), { prefix: "TOMORROW", time: "6—8 AM" });
  assert.equal(windowLabelText("2026-07-11T20:00", "2026-07-12T07:00", "2026-07-11").time, "8 PM — 7 AM +1");
});

/* ---------- severity flags ---------- */
test("metric severity tiers match design thresholds", () => {
  const x = { maxTemp: 91, minTemp: 70, maxDew: 71, maxWind: 10, maxGust: 14, maxWbgt: 83, maxPrecip: 20, thunder: false, maxAqi: 130 };
  const sev = metricSeverity(x, "run");
  assert.equal(sev.temp, 2);
  assert.equal(sev.dew, 2);
  assert.equal(sev.wind, 0);
  assert.equal(sev.wbgt, 2);
  assert.equal(sev.aqi, 1);
  assert.equal(sev.precip, 0);
});
