/* ============================================================
   EFFORT ENGINE — model 0.3-live
   Pure functions only: no DOM, no fetch, no storage.
   Everything here is covered by tests/engine.test.mjs.
   ============================================================ */
/* ---------- utils ---------- */
const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const r1 = (v) => Math.round(v * 10) / 10;
const fmt1 = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const lerp = (a, b, t) => a + (b - a) * t;

function parsePace(str) {
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const min = Number(m[1]), sec = Number(m[2]);
  if (min < 3 || min > 30 || sec > 59) return null;
  return min * 60 + sec;
}
function fmtPace(totalSec) {
  const t = Math.round(totalSec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/* ---------- physics: wet bulb + estimated WBGT ---------- */
const f2c = (f) => (f - 32) * 5 / 9;
const c2f = (c) => c * 9 / 5 + 32;

// Stull (2011) wet-bulb approximation. T in °C, RH in %
function wetBulbC(Tc, RH) {
  const rh = clamp(RH, 1, 100);
  return Tc * Math.atan(0.151977 * Math.sqrt(rh + 8.313659))
    + Math.atan(Tc + rh) - Math.atan(rh - 1.676331)
    + 0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh)
    - 4.686035;
}
// Estimated black-globe excess above air temp from solar + wind.
// Full sun (~1000 W/m²) in near-calm air runs ~10-12°C above ambient;
// wind strips that roughly in half by ~10 mph. Smooth, bounded heuristic.
function globeC(Tc, solarWm2, windMph) {
  const windMs = windMph * 0.44704;
  const excess = (clamp(solarWm2, 0, 1100) / 1000) * (11 / (1 + 0.45 * windMs));
  return Tc + excess;
}
// Outdoor WBGT = 0.7 Tw + 0.2 Tg + 0.1 Ta → returned in °F
function estWbgtF(tempF, RH, solarWm2, windMph) {
  const Tc = f2c(tempF);
  const Tw = wetBulbC(Tc, RH);
  const Tg = globeC(Tc, solarWm2, windMph);
  return Math.round(c2f(0.7 * Tw + 0.2 * Tg + 0.1 * Tc));
}

/* ---------- engine v0.3 ---------- */
const INTENSITY_MULT = { Easy: 0.9, Steady: 1, Hard: 1.12, Race: 1.2 };
const INTENSITY_RISK = { Easy: 0, Steady: 5, Hard: 12, Race: 18 };
const DEFAULT_PACES = { Easy: "8:00", Steady: "7:30", Hard: "7:00", Race: "6:30" };
const THUNDER_CODES = new Set([95, 96, 99]);
const RAIN_CODES = new Set([51,53,55,56,57,61,63,65,66,67,80,81,82]);
const SNOW_CODES = new Set([71,73,75,77,85,86]);

// v1-compatible heat benchmark grid: combined = temp + dew (°F)
function heatBand(combined) {
  const g = Math.round(combined / 5) * 5;
  if (g <= 100) return { low: 0, high: 0.5 };
  if (g <= 110) return { low: 0.5, high: 1 };
  if (g <= 120) return { low: 1, high: 2 };
  if (g <= 130) return { low: 1.5, high: 2.5 };
  if (g <= 140) return { low: 2, high: 3 };
  if (g <= 150) return { low: 3, high: 4.5 };
  if (g <= 160) return { low: 4.5, high: 6 };
  if (g <= 170) return { low: 6, high: 8 };
  if (g <= 180) return { low: 8, high: 10 };
  return { low: 10, high: 15 };
}
// Cold slows you too: optimal ≈ 40–60°F; impact grows below 40.
function coldBand(tempF) {
  if (tempF >= 40) return { low: 0, high: 0 };
  if (tempF >= 30) return { low: 0.3, high: 1 };
  if (tempF >= 20) return { low: 0.8, high: 2 };
  if (tempF >= 10) return { low: 1.5, high: 3 };
  return { low: 2.5, high: 4.5 };
}
// Sustained wind: out-and-back nets a loss (headwind costs > tailwind saves).
// Rides feel roughly 3× the aero penalty of runs.
function windBand(windMph, sport) {
  const excess = Math.max(0, windMph - (sport === "ride" ? 8 : 10));
  const k = sport === "ride" ? { lo: 0.35, hi: 0.55, cap: 8 } : { lo: 0.1, hi: 0.18, cap: 3 };
  return { low: r1(Math.min(k.cap, excess * k.lo)), high: r1(Math.min(k.cap * 1.4, excess * k.hi)) };
}
// Air quality: breathing load rises with AQI; standard exercise guidance bands
function airBand(aqi) {
  if (aqi == null) return { low: 0, high: 0 };
  if (aqi >= 151) return { low: 1, high: 3 };
  if (aqi >= 101) return { low: 0.5, high: 1.5 };
  return { low: 0, high: 0 };
}
// Altitude: aerobic penalty above ~3,000 ft, roughly 1–2% per 1,000 ft
function altitudeBand(elevFt) {
  const excess = Math.max(0, (elevFt || 0) - 3000) / 1000;
  return { low: r1(Math.min(6, excess * 1.0)), high: r1(Math.min(10, excess * 1.8)) };
}
function rainBand(precipProb, code) {
  const raining = RAIN_CODES.has(code) || SNOW_CODES.has(code) || precipProb >= 55;
  if (!raining) return { low: 0, high: 0 };
  return SNOW_CODES.has(code) ? { low: 1, high: 3 } : { low: 0, high: 1 };
}

function dewPointLabel(dewF) {
  if (dewF < 50) return "Dry / efficient cooling";
  if (dewF < 60) return "Comfortable";
  if (dewF < 65) return "Noticeable";
  if (dewF < 70) return "Difficult for hard efforts";
  if (dewF < 75) return "Very taxing";
  return "Oppressive";
}
function wbgtRiskCurve(wbgtF) {
  if (wbgtF < 70) return clamp(6 + Math.max(0, wbgtF - 60) * 1.1);
  if (wbgtF < 74) return 18 + (wbgtF - 70) * 3;
  if (wbgtF < 82) return 30 + (wbgtF - 74) * 4;
  return clamp(62 + (wbgtF - 82) * 7);
}
function riskLabel(score) {
  if (score < 35) return "Low";
  if (score < 55) return "Elevated";
  if (score < 75) return "High";
  return "Very high";
}
function ratingFor(score, thunder) {
  if (thunder) return { rating: "Storm risk", tone: "storm" };
  if (score < 22) return { rating: "Ideal", tone: "ideal" };
  if (score < 34) return { rating: "Good", tone: "good" };
  if (score < 48) return { rating: "Adjust", tone: "adjust" };
  if (score < 60) return { rating: "Caution", tone: "caution" };
  if (score < 74) return { rating: "High effort", tone: "high" };
  return { rating: "Avoid", tone: "avoid" };
}

/* Which of the five headline metrics deserve attention through the workout.
   0 = fine, 1 = watch (amber), 2 = driver (coral) */
function metricSeverity(x, sport) {
  const sev = { temp: 0, dew: 0, wind: 0, wbgt: 0, precip: 0 };
  if (x.maxTemp >= 88) sev.temp = 2; else if (x.maxTemp >= 80) sev.temp = 1;
  if (x.minTemp <= 20) sev.temp = 2; else if (x.minTemp <= 32) sev.temp = Math.max(sev.temp, 1);
  if (x.maxDew >= 70) sev.dew = 2; else if (x.maxDew >= 65) sev.dew = 1;
  const wt = sport === "ride" ? { hi: 18, mid: 12 } : { hi: 22, mid: 15 };
  if (x.maxWind >= wt.hi) sev.wind = 2; else if (x.maxWind >= wt.mid) sev.wind = 1;
  if (x.maxWbgt >= 82) sev.wbgt = 2; else if (x.maxWbgt >= 76) sev.wbgt = 1;
  if (x.thunder || x.maxPrecip >= 60) sev.precip = 2; else if (x.maxPrecip >= 35) sev.precip = 1;
  sev.aqi = 0;
  if (x.maxAqi != null) { if (x.maxAqi >= 151) sev.aqi = 2; else if (x.maxAqi >= 101) sev.aqi = 1; }
  return sev;
}

/* Sample interpolated conditions at fractional hour offset from hours[] */
function sampleAt(hours, idxFloat) {
  const i = Math.min(hours.length - 2, Math.max(0, Math.floor(idxFloat)));
  const t = clamp(idxFloat - i, 0, 1);
  const a = hours[i], b = hours[i + 1];
  return {
    temp: lerp(a.temp, b.temp, t),
    dew: lerp(a.dew, b.dew, t),
    rh: lerp(a.rh, b.rh, t),
    wind: lerp(a.wind, b.wind, t),
    gust: lerp(a.gust, b.gust, t),
    solar: lerp(a.solar, b.solar, t),
    precipProb: lerp(a.precipProb, b.precipProb, t),
    uv: lerp(a.uv, b.uv, t),
    wbgt: lerp(a.wbgt, b.wbgt, t),
    code: t < 0.5 ? a.code : b.code,
    isDay: t < 0.5 ? a.isDay : b.isDay,
    aqi: a.aqi == null || b.aqi == null ? (a.aqi ?? b.aqi ?? null) : lerp(a.aqi, b.aqi, t),
  };
}

/* Core projection: integrates conditions across the workout. */
function project({ hours, startIdx, durationMinutes, intensity, sport, baselinePaceSeconds, structure = "continuous", elevFt = 0 }) {
  const steps = 5; // start, 25, 50, 75, finish
  const durH = durationMinutes / 60;
  const samples = [];
  for (let s = 0; s < steps; s++) samples.push(sampleAt(hours, startIdx + durH * (s / (steps - 1))));
  const avg = (k) => samples.reduce((a, s) => a + s[k], 0) / steps;
  const maxOf = (k) => Math.max(...samples.map((s) => s[k]));
  const start = samples[0], finish = samples[steps - 1];

  const avgTemp = avg("temp"), avgDew = avg("dew"), avgWind = avg("wind");
  const combined = avgTemp + avgDew;
  const thunder = samples.some((s) => THUNDER_CODES.has(s.code));

  const aqiVals = samples.map((s) => s.aqi).filter((v) => v != null);
  const maxAqi = aqiVals.length ? Math.round(Math.max(...aqiVals)) : null;

  // Impact components (percent slower / power down)
  const hb = heatBand(combined);
  const cb = coldBand(avgTemp);
  const wb = windBand(avgWind, sport);
  const rb = rainBand(maxOf("precipProb"), finish.code);
  const ab = airBand(maxAqi);
  const eb = altitudeBand(elevFt);

  const durF = clamp(1 + (durationMinutes - 60) / 240, 0.9, 1.25);
  const im = INTENSITY_MULT[intensity];
  const sportF = sport === "ride" ? 0.88 : 1; // heat translates to power a bit less directly
  const structF = structure === "intervals" ? 0.72 : 1; // recoveries shed sustained thermal load
  const thermalLow = (hb.low + cb.low + rb.low) * im * durF * sportF * structF;
  const thermalHigh = (hb.high + cb.high + rb.high) * im * durF * sportF * structF;
  const airLow = ab.low * im * durF, airHigh = ab.high * im * durF;
  const altLow = eb.low * im, altHigh = eb.high * im;
  const impact = { low: r1(thermalLow + wb.low + airLow + altLow), high: r1(thermalHigh + wb.high + airHigh + altHigh) };
  const impactMid = (impact.low + impact.high) / 2;

  const rpe = { low: r1(Math.max(0.1, impact.low * 0.16)), high: r1(Math.max(0.2, impact.high * 0.2)) };

  // Effort score (0–100): environmental cost of holding intended effort
  const effortScore = Math.round(clamp(
    impactMid * 7.2
    + Math.max(0, avgDew - 60) * 0.9
    + Math.max(0, avg("wbgt") - 72) * 0.5
  ));

  // Risk score (0–100): worst conditions through finish + hazards
  const maxWbgt = maxOf("wbgt");
  const durRisk = Math.max(0, durationMinutes - 60) * 0.12;
  const gustRisk = Math.max(0, maxOf("gust") - 25) * 0.6;
  const uvRisk = maxOf("uv") >= 8 ? 4 : 0;
  const coldRisk = avgTemp < 15 ? (15 - avgTemp) * 1.2 : 0;
  const precipRisk = maxOf("precipProb") * (thunder ? 0.55 : 0.18);
  const aqiRisk = maxAqi == null ? 0 : maxAqi >= 201 ? 30 : maxAqi >= 151 ? 18 : maxAqi >= 101 ? 8 : 0;
  const riskScore = Math.round(clamp(
    wbgtRiskCurve(maxWbgt) + precipRisk + INTENSITY_RISK[intensity] + durRisk + gustRisk + uvRisk + coldRisk + aqiRisk
  ));

  const finishSafe = riskScore < 55 && !thunder && finish.precipProb < 60;

  // Pace translation
  let adjustedPace = null;
  if (sport === "run" && baselinePaceSeconds) {
    const lo = Math.round(baselinePaceSeconds * (1 + impact.low / 100));
    const hi = Math.round(baselinePaceSeconds * (1 + impact.high / 100));
    adjustedPace = {
      baselineSeconds: baselinePaceSeconds, baselineLabel: fmtPace(baselinePaceSeconds),
      lowSeconds: lo, highSeconds: hi, lowLabel: fmtPace(lo), highLabel: fmtPace(hi),
    };
  }
  const adjustment = sport === "run" && adjustedPace
    ? `${adjustedPace.lowLabel}–${adjustedPace.highLabel} min/mi at the same effort`
    : sport === "run"
      ? `Run ${impact.low}–${impact.high}% slower at the same effort`
      : `Lower target power ${impact.low}–${impact.high}% at the same effort`;

  const extremes = {
    maxTemp: Math.round(maxOf("temp")), minTemp: Math.round(Math.min(...samples.map((s) => s.temp))),
    maxDew: Math.round(maxOf("dew")), maxWind: Math.round(maxOf("wind")), maxGust: Math.round(maxOf("gust")),
    maxWbgt: Math.round(maxWbgt), maxPrecip: Math.round(maxOf("precipProb")), thunder,
    maxAqi,
  };

  return {
    modelVersion: "0.3-live",
    start, finish, avgTemp, avgDew, avgWind, extremes, combined: Math.round(combined),
    benchmarkLoad: Math.round(combined / 5) * 5, benchmarkBand: hb,
    components: {
      heat: { low: r1(hb.low * im * durF * sportF), high: r1(hb.high * im * durF * sportF) },
      cold: { low: r1(cb.low * im * durF * sportF), high: r1(cb.high * im * durF * sportF) },
      wind: wb,
      rain: { low: r1(rb.low * im * durF * sportF * structF), high: r1(rb.high * im * durF * sportF * structF) },
      air: { low: r1(airLow), high: r1(airHigh) },
      alt: { low: r1(altLow), high: r1(altHigh) },
    },
    dewPointLabel: dewPointLabel(avgDew),
    performanceImpact: impact, adjustedPace, rpeDelta: rpe,
    effortScore, adjustment, riskScore, riskLabel: riskLabel(riskScore),
    thunder, finishSafe,
  };
}

/* Quick per-hour score for ribbon + window search (uses current inputs). */
function hourScore(hours, idx, durationMinutes, intensity, sport, structure, elevFt) {
  const p = project({ hours, startIdx: idx, durationMinutes, intensity, sport, baselinePaceSeconds: null, structure, elevFt });
  return { score: Math.round(p.effortScore * 0.55 + p.riskScore * 0.45), thunder: p.thunder, p };
}
function hourAllowed(iso, fromH, toH) {
  const h = Number(iso.slice(11, 13));
  return fromH <= toH ? h >= fromH && h <= toH : h >= fromH || h <= toH;
}

/* Best-window search across searchable range. */
function findBestWindow(hours, durationMinutes, intensity, sport, maxStartIdx, opts = {}) {
  const { fromH = 0, toH = 23, structure = "continuous", elevFt = 0 } = opts;
  let best = null;
  const scores = [];
  const anyAllowed = hours.slice(0, maxStartIdx + 1).some((h) => hourAllowed(h.iso, fromH, toH));
  for (let i = 0; i <= maxStartIdx; i++) {
    const s = hourScore(hours, i, durationMinutes, intensity, sport, structure, elevFt);
    // small practicality penalty for starting in the dark — night only wins when clearly better
    const score = s.score + (hours[i].isDay ? 0 : 6);
    scores.push(score);
    if (s.thunder) continue;
    if (anyAllowed && !hourAllowed(hours[i].iso, fromH, toH)) continue; // respect training hours
    if (!best || score < best.score) best = { idx: i, score };
  }
  if (!best) return null;
  // Expand to contiguous near-best hours, capped to a practical band, inside training hours
  let lo = best.idx, hi = best.idx;
  while (lo > 0 && lo > best.idx - 1 && scores[lo - 1] <= best.score + 7 && (!anyAllowed || hourAllowed(hours[lo - 1].iso, fromH, toH))) lo--;
  while (hi < maxStartIdx && hi < best.idx + 2 && scores[hi + 1] <= best.score + 7 && (!anyAllowed || hourAllowed(hours[hi + 1].iso, fromH, toH))) hi++;
  return { idx: best.idx, score: best.score, rangeLo: lo, rangeHi: hi };
}

function buildHours(om) {
  const h = om.hourly;
  const offset = om.utc_offset_seconds || 0;
  const nowEpoch = Date.now();
  const out = [];
  for (let i = 0; i < h.time.length; i++) {
    // hourly times are location-local ISO strings; convert to true epoch
    const epoch = Date.parse(h.time[i] + "Z") - offset * 1000;
    out.push({
      iso: h.time[i], epoch,
      temp: h.temperature_2m[i], dew: h.dew_point_2m[i], rh: h.relative_humidity_2m[i],
      feels: h.apparent_temperature[i],
      precipProb: h.precipitation_probability[i] ?? 0,
      code: h.weather_code[i],
      wind: h.wind_speed_10m[i], gust: h.wind_gusts_10m[i] ?? h.wind_speed_10m[i],
      solar: h.shortwave_radiation[i] ?? 0, uv: h.uv_index[i] ?? 0,
      isDay: h.is_day[i] === 1, aqi: null,
      wbgt: estWbgtF(h.temperature_2m[i], h.relative_humidity_2m[i], h.shortwave_radiation[i] ?? 0, h.wind_speed_10m[i]),
    });
  }
  // trim to: first hour = the hour containing "now" at the location
  let firstIdx = out.findIndex((x) => x.epoch + 3600 * 1000 > nowEpoch);
  if (firstIdx < 0) firstIdx = 0;
  return out.slice(firstIdx);
}

function hourLabel(iso) {
  const hh = Number(iso.slice(11, 13));
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12} ${hh < 12 ? "AM" : "PM"}`;
}
function dayTag(iso, todayIso) {
  return iso.slice(0, 10) === todayIso ? "" : "+1 ";
}
/* "8—11 PM" · "TOMORROW 6—8 AM" · "8 PM — 7 AM +1" */
function windowLabelText(aIso, bIso, todayIso) {
  const aTomorrow = aIso.slice(0, 10) !== todayIso;
  const bTomorrow = bIso.slice(0, 10) !== todayIso;
  const a = hourLabel(aIso), b = hourLabel(bIso);
  if (aTomorrow && bTomorrow) return { prefix: "TOMORROW", time: joinTimes(a, b) };
  if (!aTomorrow && bTomorrow) return { prefix: "", time: `${a} — ${b} +1` };
  return { prefix: "", time: joinTimes(a, b) };
}
function joinTimes(a, b) {
  const [ah, am] = a.split(" "), [bh, bm] = b.split(" ");
  return am === bm ? `${ah}—${bh} ${am}` : `${a} — ${b}`;
}

function hourLabelFull(iso) {
  const hh = Number(iso.slice(11, 13)), mm = iso.slice(14, 16);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${mm} ${hh < 12 ? "AM" : "PM"}`;
}

export {
  clamp,
  r1,
  fmt1,
  lerp,
  parsePace,
  fmtPace,
  f2c,
  c2f,
  wetBulbC,
  globeC,
  estWbgtF,
  INTENSITY_MULT,
  INTENSITY_RISK,
  DEFAULT_PACES,
  THUNDER_CODES,
  RAIN_CODES,
  SNOW_CODES,
  heatBand,
  coldBand,
  windBand,
  rainBand,
  airBand,
  altitudeBand,
  dewPointLabel,
  wbgtRiskCurve,
  riskLabel,
  ratingFor,
  metricSeverity,
  sampleAt,
  project,
  hourScore,
  hourAllowed,
  findBestWindow,
  buildHours,
  hourLabel,
  hourLabelFull,
  dayTag,
  windowLabelText,
  joinTimes,
};
