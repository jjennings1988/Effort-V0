/* ============================================================
   EFFORT ENGINE — model 0.4-strain
   Pure functions only: no DOM, no fetch, no storage.
   Everything here is covered by tests/engine.test.mjs.

   v0.4 replaces the v0.3 step-band lookup with a continuous
   heat-balance model. See MODEL.md for the calibration sources.
   v0.3 functions are retained below under "legacy" so the old
   numbers stay reproducible and testable.
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

// NWS wind chill (°F). Only defined for cold + moving air; passes through otherwise.
function windChillF(tempF, windMph) {
  if (tempF > 50 || windMph < 3) return tempF;
  const v = Math.pow(windMph, 0.16);
  return 35.74 + 0.6215 * tempF - 35.75 * v + 0.4275 * tempF * v;
}

/* ============================================================
   V0.4 — CONTINUOUS HEAT-BALANCE STRAIN MODEL

   The core idea: dew point does not "add to" temperature. Dew
   point sets the vapour-pressure gradient between skin and air,
   which caps how much heat you can shed by evaporation. Air
   temperature and solar load set how much heat you must shed.
   Strain is the ratio of the two — which is why heat and
   humidity compound multiplicatively rather than additively,
   and why humidity is nearly irrelevant in cool air.

   Calibration anchors (marathon / race effort / 180 min):
     60 °F heat index  → +0.63 %
     80 °F heat index  → +3.13 %
     90 °F heat index  → +4.58 %
    100 °F heat index  → +6.04 %
   from Davis (2025) re-analysis of Mantzios et al. (2022),
   3,891 marathon performances across 754 races.
   ============================================================ */

const KPA_SKIN = 5.6158;         // saturation vapour pressure of wet skin at 35 °C
const KPA_REF_GRADIENT = 4.78;   // (Psk − Pa) at the reference condition: 48 °F air / 40 °F dew
const REF_WIND_MS = 2.235;       // 5 mph — the wind speed the anchors were fit at
const SWEAT_CAP = 0.590;         // evaporative ceiling set by max sustainable sweat rate
const STRAIN_SCALE = 2.082;      // normalises the index so 1.0 = onset of measurable pace cost
const HEAT_A0 = 0.965;           // scale: % slower at race effort over 180 min
const HEAT_S0 = 1.0;             // strain below this is free
const HEAT_P = 0.958;            // very slightly sublinear above threshold
const C_DRY = 0.44;              // convective heat gain/loss per 10 °C of skin-air gradient
const C_SOLAR = 0.424;           // radiant load at 1000 W/m², unsheltered, at REF_WIND_MS

// Heat cost scales with relative intensity. 1.0 = race effort (the calibration reference).
const HEAT_INTENSITY = { Easy: 0.72, Steady: 0.85, Hard: 0.95, Race: 1.0 };

// Magnus-Tetens saturation vapour pressure, kPa, T in °C
function satVapKPa(Tc) {
  return 0.61094 * Math.exp((17.625 * Tc) / (Tc + 243.04));
}
// Ambient vapour pressure is, by definition, the saturation pressure at the dew point.
function vapourPressureKPa(dewF) {
  return satVapKPa(f2c(dewF));
}

/* Thermal Strain Index — required heat loss ÷ available evaporative capacity,
   normalised so that 1.0 is the point where pace starts to cost you.
   Roughly: <1 free cooling, 3 working, 5 near capacity, 7+ overwhelmed. */
function heatStrain(tempF, dewF, solarWm2 = 0, windMph = 0, { shade = 0 } = {}) {
  const Tc = f2c(tempF);
  const windMs = Math.max(0, windMph) * 0.44704;

  // Evaporative capacity has two independent ceilings: how much moisture the air
  // can accept, and how fast you can physically sweat. In dry heat the second one
  // binds — which is why 95 °F desert air still wrecks a marathon. Combined as a
  // harmonic (smooth) minimum so the surface stays differentiable.
  const gradient = Math.max(0.25, KPA_SKIN - vapourPressureKPa(dewF));
  const windEvap = Math.sqrt((1 + 0.10 * windMs) / (1 + 0.10 * REF_WIND_MS));
  const emaxAir = (gradient / KPA_REF_GRADIENT) * windEvap;
  const emax = 1 / (1 / emaxAir + 1 / SWEAT_CAP);

  // Required heat loss: metabolic (normalised to 1) + dry gain/loss + radiant load.
  const dry = C_DRY * (Tc - 35) / 10;
  const radiant = C_SOLAR * (clamp(solarWm2, 0, 1200) / 1000) * (1 - clamp(shade, 0, 1)) / (1 + 0.4 * windMs);
  const ereq = 1 + dry + radiant;

  return STRAIN_SCALE * Math.max(0, ereq) / Math.max(0.06, emax);
}

// Strain → percent slower at race effort over 180 minutes.
function heatSlowdownPct(strain) {
  return HEAT_A0 * Math.pow(Math.max(0, strain - HEAT_S0), HEAT_P);
}

/* Cold. Empirically small for pace — 25 °F costs a marathoner well under 1 % —
   but it is driven by felt temperature, not air temperature, so a cold wind
   compounds. Grows superlinearly as you get further below 40 °F. */
function coldSlowdownPct(tempF, windMph = 0) {
  const felt = windChillF(tempF, windMph);
  const deficit = Math.max(0, 40 - felt) / 10;
  if (deficit <= 0) return 0;
  return 0.44 * Math.pow(deficit, 0.85);
}

/* ---------- wind as drag, not as a penalty table ----------
   Weather stations report wind at 10 m. A runner's torso is at ~1.5 m,
   where the wind is much weaker — how much weaker depends on terrain. */
const TERRAIN_ALPHA = { open: 0.11, field: 0.16, park: 0.20, suburb: 0.30, city: 0.40 };
const RUNNER_CD = 0.80;          // drag coefficient, mean of Pugh/Davies/Marro/Schickenhofer
const DRAG_TO_METABOLIC = 6.13;  // % metabolic cost per 1 % bodyweight of horizontal force (da Silva 2022)
const METABOLIC_TO_PACE = 1.15;  // marginal cost of speed is superlinear, so pace moves less than cost

function groundWindMph(nominalMph, terrain = "suburb") {
  const a = TERRAIN_ALPHA[terrain] ?? TERRAIN_ALPHA.suburb;
  return Math.max(0, nominalMph) * Math.pow(1.5 / 10, a);
}
// Livingston & Lee body surface area × Pugh's 0.266 frontal fraction
function frontalAreaM2(massKg = 70) {
  return 0.266 * 0.1173 * Math.pow(Math.max(30, massKg), 0.6466);
}
function airDensity(elevFt = 0) {
  return 1.225 * Math.exp(-(Math.max(0, elevFt) * 0.3048) / 8500);
}

/* On an out-and-back, drag cost ∝ relative-velocity². Averaging the outbound
   and return legs, the headwind and tailwind terms cancel except for a residual
   of exactly wind² — which is why a headwind always costs more than the
   matching tailwind gives back, no matter how fast you run. */
function windSlowdownPct(nominalMph, runSpeedMps = 3.35, opts = {}) {
  const { terrain = "suburb", massKg = 70, elevFt = 0, route = "outAndBack" } = opts;
  const vw = groundWindMph(nominalMph, terrain) * 0.44704;
  const vr = Math.max(0.5, runSpeedMps);
  let vsq = vw <= vr ? vw * vw : 2 * vr * vw - vr * vr;
  if (route === "loop") vsq *= 0.85;      // a closed loop sheds a little, never all, of the tax
  if (route === "outBackHead") vsq *= 1.0;
  const fd = 0.5 * airDensity(elevFt) * Math.max(0, vsq) * RUNNER_CD * frontalAreaM2(massKg);
  const pctBodyweight = (fd / (massKg * 9.80665)) * 100;
  return Math.max(0, DRAG_TO_METABOLIC * pctBodyweight / METABOLIC_TO_PACE);
}

/* ---------- altitude, measured against where you live ----------
   Your pace baseline was set at home. What matters is the *difference*
   in air, not the absolute elevation — a Denver resident training in
   Denver should carry no penalty at all. */
function altitudeVo2DropPct(elevFt = 0) {
  const m = Math.max(0, elevFt) * 0.3048;
  return m <= 1500 ? (m / 1000) * 1.0 : 1.5 + ((m - 1500) / 1000) * 6.3;
}
function altitudeSlowdownPct(elevFt = 0, homeElevFt = 0) {
  // Performance falls less than VO2max does: thinner air also cuts aerodynamic drag.
  const here = altitudeVo2DropPct(elevFt) * 0.85;
  const home = altitudeVo2DropPct(homeElevFt ?? 0) * 0.85;
  return Math.max(0, here - home);
}

/* Air quality. Continuous rather than stepped. Deliberately conservative:
   the published marathon regressions on PM2.5 are heavily confounded with
   heat and urban effects, so this is scaled to practitioner guidance. */
function airQualitySlowdownPct(aqi) {
  if (aqi == null) return 0;
  return Math.min(3, 0.012 * Math.max(0, aqi - 50));
}

/* ---------- heat acclimatisation ----------
   The single largest source of person-to-person variance in heat.
   Racinais et al.: cycling power decrement fell from −16 % unacclimatised
   to −8 % after one week and −3 % after two. The published marathon
   anchors are a population average, so 0.5 here means "typical" and the
   multiplier is centred on 1.0 there. */
function acclimationMultiplier(a = 0.5) {
  return 1.45 - 0.90 * clamp(a, 0, 1);
}

/* Derive acclimatisation from the athlete's own recent weather. Feed this the
   past 14 days of hourly conditions (Open-Meteo's forecast endpoint returns
   them free via &past_days=14) and it scores the heat dose actually available
   to them during their training hours, weighted toward the last few days. */
function acclimationIndex(pastHours, opts = {}) {
  const { fromH = 6, toH = 22, halfLifeDays = 6 } = opts;
  if (!pastHours || !pastHours.length) return 0.5;
  const byDay = new Map();
  for (const h of pastHours) {
    if (!hourAllowed(h.iso, fromH, toH)) continue;
    const day = h.iso.slice(0, 10);
    const s = heatStrain(h.temp, h.dew, h.solar ?? 0, h.wind ?? 0);
    byDay.set(day, Math.max(byDay.get(day) ?? 0, s));
  }
  const days = [...byDay.keys()].sort();
  if (!days.length) return 0.5;
  const latest = Date.parse(days[days.length - 1] + "T00:00:00Z");
  let num = 0, den = 0;
  for (const d of days) {
    const age = Math.max(0, Math.round((latest - Date.parse(d + "T00:00:00Z")) / 86400000));
    const w = Math.pow(0.5, age / halfLifeDays);
    const dose = clamp((byDay.get(d) - 2.5) / 3.0, 0, 1);
    num += w * dose;
    den += w;
  }
  return den ? clamp(num / den, 0, 1) : 0.5;
}

/* Heat is accumulated fatigue, not a fixed tax — a 30-minute run in brutal air
   costs far less than a third of what a 90-minute run costs. Normalised to 1.0
   at 180 minutes, the duration the marathon anchors were fit at. */
function durationFactor(minutes) {
  return clamp(Math.pow(Math.max(5, minutes) / 180, 0.55), 0.2, 1.7);
}

/* Slower runners lose more to heat in percentage terms (Ely 2007; Davis 2025).
   Damped from the raw empirical slope because much of that effect is simply
   longer time on course, which durationFactor already accounts for. */
function abilityFactor(baselinePaceSeconds) {
  if (!baselinePaceSeconds) return 1;
  return clamp(Math.pow(baselinePaceSeconds / 480, 1.2), 0.72, 1.4);
}

/* ============================================================
   v0.3 LEGACY BANDS — retained so old projections stay reproducible
   ============================================================ */
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

/* ---------- labels + scales ---------- */
function dewPointLabel(dewF) {
  if (dewF < 50) return "Dry / efficient cooling";
  if (dewF < 60) return "Comfortable";
  if (dewF < 65) return "Noticeable";
  if (dewF < 70) return "Difficult for hard efforts";
  if (dewF < 75) return "Very taxing";
  return "Oppressive";
}
function strainLabel(strain) {
  if (strain < 1.0) return "Free cooling";
  if (strain < 2.0) return "Mild load";
  if (strain < 3.5) return "Working to stay cool";
  if (strain < 5.0) return "Cooling near capacity";
  if (strain < 7.0) return "Cooling outrun";
  return "Cooling overwhelmed";
}
function acclimationLabel(a) {
  if (a < 0.2) return "Unacclimatised";
  if (a < 0.4) return "Lightly exposed";
  if (a < 0.6) return "Partly acclimatised";
  if (a < 0.8) return "Well acclimatised";
  return "Fully heat-adapted";
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

/* ============================================================
   PROJECTION
   ============================================================ */

const V4_STEPS = 9; // integrate strain across the workout, not just its endpoints

/* Core projection: integrates conditions across the workout.
   Pass model: "0.3" to reproduce the legacy band output. */
function project(opts) {
  return (opts.model === "0.3" ? projectV3 : projectV4)(opts);
}

function projectV4({
  hours, startIdx, durationMinutes, intensity, sport, baselinePaceSeconds,
  structure = "continuous", elevFt = 0, homeElevFt = null,
  acclimation = 0.5, terrain = "suburb", massKg = 70, route = "outAndBack", shade = 0,
}) {
  const durH = durationMinutes / 60;
  const samples = [];
  for (let s = 0; s < V4_STEPS; s++) samples.push(sampleAt(hours, startIdx + durH * (s / (V4_STEPS - 1))));
  const avg = (k) => samples.reduce((a, s) => a + s[k], 0) / V4_STEPS;
  const maxOf = (k) => Math.max(...samples.map((s) => s[k]));
  const start = samples[0], finish = samples[V4_STEPS - 1];

  const avgTemp = avg("temp"), avgDew = avg("dew"), avgWind = avg("wind");
  const thunder = samples.some((s) => THUNDER_CODES.has(s.code));
  const aqiVals = samples.map((s) => s.aqi).filter((v) => v != null);
  const maxAqi = aqiVals.length ? Math.round(Math.max(...aqiVals)) : null;

  // Strain is convex in temperature, so integrate it per-sample rather than
  // averaging the inputs first. This is what makes a rising afternoon read
  // hotter than its mean condition — which is exactly how it feels.
  const strains = samples.map((s) => heatStrain(s.temp, s.dew, s.solar, s.wind, { shade }));
  const meanStrain = strains.reduce((a, v) => a + v, 0) / strains.length;
  const peakStrain = Math.max(...strains);
  const rawHeat = strains.reduce((a, v) => a + heatSlowdownPct(v), 0) / strains.length;

  // Modifiers
  const im = HEAT_INTENSITY[intensity] ?? HEAT_INTENSITY.Steady;
  const durF = durationFactor(durationMinutes);
  const abF = abilityFactor(sport === "run" ? baselinePaceSeconds : null);
  const acclF = acclimationMultiplier(acclimation);
  const sportF = sport === "ride" ? 0.88 : 1;        // airflow on a bike aids evaporation
  const structF = structure === "intervals" ? 0.78 : 1; // recoveries shed sustained thermal load

  const heatPct = rawHeat * im * durF * abF * acclF * sportF * structF;

  const coldRaw = samples.reduce((a, s) => a + coldSlowdownPct(s.temp, s.wind), 0) / V4_STEPS;
  const coldPct = coldRaw * durF * (sport === "ride" ? 1.15 : 1);

  const runSpeedMps = baselinePaceSeconds ? 1609.344 / baselinePaceSeconds : 3.35;
  const windOpts = { terrain, massKg, elevFt, route };
  const windPct = sport === "ride"
    ? windSlowdownPct(avgWind, 8.94, windOpts) * 2.4   // reported as a speed cost, not a power cost
    : windSlowdownPct(avgWind, runSpeedMps, windOpts);

  const altPct = altitudeSlowdownPct(elevFt, homeElevFt ?? 0);
  const airPct = airQualitySlowdownPct(maxAqi) * durF;
  const rb = rainBand(maxOf("precipProb"), finish.code);
  const rainPct = ((rb.low + rb.high) / 2) * durF;

  const mid = heatPct + coldPct + windPct + altPct + airPct + rainPct;

  // Uncertainty band. Heat is the least predictable term (individual variation
  // in sweat rate and tolerance); altitude and drag are close to deterministic.
  const band = (v, lo, hi) => ({ low: r1(v * lo), high: r1(v * hi) });
  const heatB = band(heatPct, 0.78, 1.30);
  const coldB = band(coldPct, 0.75, 1.35);
  const windB = band(windPct, 0.80, 1.25);
  const altB = band(altPct, 0.85, 1.20);
  const airB = band(airPct, 0.60, 1.60);
  const rainB = band(rainPct, 0.60, 1.50);

  const impact = {
    low: r1(heatB.low + coldB.low + windB.low + altB.low + airB.low + rainB.low),
    high: r1(heatB.high + coldB.high + windB.high + altB.high + airB.high + rainB.high),
  };
  const impactMid = r1(mid);
  const rpe = { low: r1(Math.max(0.1, impact.low * 0.16)), high: r1(Math.max(0.2, impact.high * 0.2)) };

  // Effort score (0–100): environmental cost of holding intended effort.
  // Single source of truth now — no double-counting dew point and WBGT on top.
  const effortScore = Math.round(clamp(impactMid * 8.5 + Math.max(0, meanStrain - 1.0) * 3.2));

  // Risk score (0–100): worst conditions through finish + hazards
  const maxWbgt = maxOf("wbgt");
  const durRisk = Math.max(0, durationMinutes - 60) * 0.12;
  const gustRisk = Math.max(0, maxOf("gust") - 25) * 0.6;
  const uvRisk = maxOf("uv") >= 8 ? 4 : 0;
  const coldRisk = avgTemp < 15 ? (15 - avgTemp) * 1.2 : 0;
  const precipRisk = maxOf("precipProb") * (thunder ? 0.55 : 0.18);
  const aqiRisk = maxAqi == null ? 0 : maxAqi >= 201 ? 30 : maxAqi >= 151 ? 18 : maxAqi >= 101 ? 8 : 0;
  // Being unacclimatised is a genuine safety factor, not just a pace factor.
  const acclRisk = Math.max(0, peakStrain - 3.5) * (1 - clamp(acclimation, 0, 1)) * 3.5;
  const riskScore = Math.round(clamp(
    wbgtRiskCurve(maxWbgt) + precipRisk + INTENSITY_RISK[intensity] + durRisk
    + gustRisk + uvRisk + coldRisk + aqiRisk + acclRisk
  ));

  const finishSafe = riskScore < 55 && !thunder && finish.precipProb < 60;

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
      : `Lower target power ${r1(heatB.low + coldB.low + altB.low + airB.low)}–${r1(heatB.high + coldB.high + altB.high + airB.high)}% at the same effort`;

  const extremes = {
    maxTemp: Math.round(maxOf("temp")), minTemp: Math.round(Math.min(...samples.map((s) => s.temp))),
    maxDew: Math.round(maxOf("dew")), maxWind: Math.round(maxOf("wind")), maxGust: Math.round(maxOf("gust")),
    maxWbgt: Math.round(maxWbgt), maxPrecip: Math.round(maxOf("precipProb")), thunder,
    maxAqi,
  };

  return {
    modelVersion: "0.4-strain",
    start, finish, avgTemp, avgDew, avgWind, extremes,
    combined: Math.round(avgTemp + avgDew),
    benchmarkLoad: Math.round((avgTemp + avgDew) / 5) * 5,
    benchmarkBand: heatBand(avgTemp + avgDew),
    strain: { mean: r1(meanStrain), peak: r1(peakStrain), label: strainLabel(meanStrain) },
    acclimation: { index: r1(acclimation), multiplier: r1(acclF), label: acclimationLabel(acclimation) },
    factors: { intensity: im, duration: r1(durF), ability: r1(abF), sport: sportF, structure: structF },
    components: {
      heat: heatB, cold: coldB, wind: windB, rain: rainB, air: airB, alt: altB,
    },
    dewPointLabel: dewPointLabel(avgDew),
    performanceImpact: impact, impactMid, adjustedPace, rpeDelta: rpe,
    effortScore, adjustment, riskScore, riskLabel: riskLabel(riskScore),
    thunder, finishSafe,
  };
}

/* ---------- v0.3 projection, preserved verbatim ---------- */
function projectV3({ hours, startIdx, durationMinutes, intensity, sport, baselinePaceSeconds, structure = "continuous", elevFt = 0 }) {
  const steps = 5;
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

  const hb = heatBand(combined);
  const cb = coldBand(avgTemp);
  const wb = windBand(avgWind, sport);
  const rb = rainBand(maxOf("precipProb"), finish.code);
  const ab = airBand(maxAqi);
  const eb = altitudeBand(elevFt);

  const durF = clamp(1 + (durationMinutes - 60) / 240, 0.9, 1.25);
  const im = INTENSITY_MULT[intensity];
  const sportF = sport === "ride" ? 0.88 : 1;
  const structF = structure === "intervals" ? 0.72 : 1;
  const thermalLow = (hb.low + cb.low + rb.low) * im * durF * sportF * structF;
  const thermalHigh = (hb.high + cb.high + rb.high) * im * durF * sportF * structF;
  const airLow = ab.low * im * durF, airHigh = ab.high * im * durF;
  const altLow = eb.low * im, altHigh = eb.high * im;
  const impact = { low: r1(thermalLow + wb.low + airLow + altLow), high: r1(thermalHigh + wb.high + airHigh + altHigh) };
  const impactMid = (impact.low + impact.high) / 2;

  const rpe = { low: r1(Math.max(0.1, impact.low * 0.16)), high: r1(Math.max(0.2, impact.high * 0.2)) };

  const effortScore = Math.round(clamp(
    impactMid * 7.2
    + Math.max(0, avgDew - 60) * 0.9
    + Math.max(0, avg("wbgt") - 72) * 0.5
  ));

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
    performanceImpact: impact, impactMid: r1(impactMid), adjustedPace, rpeDelta: rpe,
    effortScore, adjustment, riskScore, riskLabel: riskLabel(riskScore),
    thunder, finishSafe,
  };
}

/* Quick per-hour score for ribbon + window search (uses current inputs). */
function hourScore(hours, idx, durationMinutes, intensity, sport, structure, elevFt, extra = {}) {
  const p = project({ hours, startIdx: idx, durationMinutes, intensity, sport, baselinePaceSeconds: null, structure, elevFt, ...extra });
  return { score: Math.round(p.effortScore * 0.55 + p.riskScore * 0.45), thunder: p.thunder, p };
}
function hourAllowed(iso, fromH, toH) {
  const h = Number(iso.slice(11, 13));
  return fromH <= toH ? h >= fromH && h <= toH : h >= fromH || h <= toH;
}

/* Best-window search across searchable range. */
function findBestWindow(hours, durationMinutes, intensity, sport, maxStartIdx, opts = {}) {
  const { fromH = 0, toH = 23, structure = "continuous", elevFt = 0, ...extra } = opts;
  let best = null;
  const scores = [];
  const anyAllowed = hours.slice(0, maxStartIdx + 1).some((h) => hourAllowed(h.iso, fromH, toH));
  for (let i = 0; i <= maxStartIdx; i++) {
    const s = hourScore(hours, i, durationMinutes, intensity, sport, structure, elevFt, extra);
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
      precipProb: h.precipitation_probability?.[i] ?? 0,
      code: h.weather_code[i],
      wind: h.wind_speed_10m[i], gust: h.wind_gusts_10m?.[i] ?? h.wind_speed_10m[i],
      solar: h.shortwave_radiation?.[i] ?? 0, uv: h.uv_index?.[i] ?? 0,
      isDay: h.is_day[i] === 1, aqi: null,
      wbgt: estWbgtF(h.temperature_2m[i], h.relative_humidity_2m[i], h.shortwave_radiation?.[i] ?? 0, h.wind_speed_10m[i]),
    });
  }
  // trim to: first hour = the hour containing "now" at the location
  let firstIdx = out.findIndex((x) => x.epoch + 3600 * 1000 > nowEpoch);
  if (firstIdx < 0) firstIdx = 0;
  return out.slice(firstIdx);
}

/* Split a payload fetched with &past_days=N into history and forecast.
   History feeds acclimationIndex(); forecast feeds project(). */
function splitPastAndFuture(om) {
  // buildHours() trims to "now" and drops the history, so rebuild the
  // untrimmed list here with just the fields acclimationIndex() needs.
  const h = om.hourly, offset = om.utc_offset_seconds || 0, now = Date.now();
  const past = [];
  for (let i = 0; i < h.time.length; i++) {
    const epoch = Date.parse(h.time[i] + "Z") - offset * 1000;
    if (epoch >= now) break;
    past.push({
      iso: h.time[i], epoch,
      temp: h.temperature_2m[i], dew: h.dew_point_2m[i], rh: h.relative_humidity_2m[i],
      wind: h.wind_speed_10m[i], solar: h.shortwave_radiation?.[i] ?? 0,
    });
  }
  return { past, future: buildHours(om) };
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
  windChillF,
  // v0.4 model
  satVapKPa,
  vapourPressureKPa,
  heatStrain,
  heatSlowdownPct,
  coldSlowdownPct,
  groundWindMph,
  frontalAreaM2,
  airDensity,
  windSlowdownPct,
  altitudeVo2DropPct,
  altitudeSlowdownPct,
  airQualitySlowdownPct,
  acclimationMultiplier,
  acclimationIndex,
  durationFactor,
  abilityFactor,
  strainLabel,
  acclimationLabel,
  HEAT_INTENSITY,
  TERRAIN_ALPHA,
  // v0.3 legacy
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
  projectV3,
  projectV4,
  hourScore,
  hourAllowed,
  findBestWindow,
  buildHours,
  splitPastAndFuture,
  hourLabel,
  hourLabelFull,
  dayTag,
  windowLabelText,
  joinTimes,
};
