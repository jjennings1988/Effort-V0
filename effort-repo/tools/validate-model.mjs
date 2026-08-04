/* ============================================================
   MODEL VALIDATION — v0.3 bands vs v0.4 strain
   Run with: npm run validate

   Scores both engines against the published marathon slowdown
   table in Davis (2025), a re-analysis of Mantzios et al. (2022)
   covering 3,891 marathon performances across 754 races:
   https://runningwritings.com/2025/04/heat-humidity-marathon-times.html

   Both models are evaluated at the same reference condition the
   table describes: race effort, ~180 minutes, an 8:00/mi runner.
   ============================================================ */
import {
  f2c, c2f, satVapKPa, heatStrain, heatSlowdownPct, coldSlowdownPct,
  heatBand, coldBand, HEAT_INTENSITY, durationFactor, acclimationMultiplier,
} from "../public/engine.js";

/* ---------- reference table: heat index °F → % slower ---------- */
const DAVIS = [
  [25, 0.83], [30, 0.63], [35, 0.00], [40, 0.00], [45, 0.00], [50, 0.00],
  [55, 0.00], [60, 0.63], [65, 1.04], [70, 1.67], [75, 2.29], [80, 3.13],
  [85, 3.75], [90, 4.58], [95, 5.42], [100, 6.04], [105, 6.88],
];
function davisExpected(hiF) {
  if (hiF <= DAVIS[0][0]) return DAVIS[0][1];
  if (hiF >= DAVIS.at(-1)[0]) return DAVIS.at(-1)[1];
  for (let i = 0; i < DAVIS.length - 1; i++) {
    const [x0, y0] = DAVIS[i], [x1, y1] = DAVIS[i + 1];
    if (hiF >= x0 && hiF <= x1) return y0 + (y1 - y0) * ((hiF - x0) / (x1 - x0));
  }
  return 0;
}

/* ---------- meteorology helpers ---------- */
function rhFromDew(tempF, dewF) {
  const e = satVapKPa(f2c(dewF)), es = satVapKPa(f2c(tempF));
  return Math.min(100, Math.max(1, (e / es) * 100));
}
// NWS Rothfusz heat index, with the standard low-end fallback
function heatIndexF(T, RH) {
  const simple = 0.5 * (T + 61 + (T - 68) * 1.2 + RH * 0.094);
  if ((simple + T) / 2 < 80) return (simple + T) / 2;
  let hi = -42.379 + 2.04901523 * T + 10.14333127 * RH - 0.22475541 * T * RH
    - 0.00683783 * T * T - 0.05481717 * RH * RH + 0.00122874 * T * T * RH
    + 0.00085282 * T * RH * RH - 0.00000199 * T * T * RH * RH;
  if (RH < 13 && T >= 80 && T <= 112) hi -= ((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  if (RH > 85 && T >= 80 && T <= 87) hi += ((RH - 85) / 10) * ((87 - T) / 5);
  return hi;
}

/* ---------- marathon-equivalent predictions ---------- */
const SOLAR = 500;   // partly-cloudy daytime, the regime race-day averages sit in
const WIND = 5;

function v4Pct(tempF, dewF) {
  const strain = heatStrain(tempF, dewF, SOLAR, WIND);
  const heat = heatSlowdownPct(strain) * HEAT_INTENSITY.Race * durationFactor(180)
    * acclimationMultiplier(0.5);
  return heat + coldSlowdownPct(tempF, WIND) * durationFactor(180);
}

function v3Pct(tempF, dewF) {
  // v0.3 at race effort / 180 min: intensity 1.2 × duration factor clamped to 1.25
  const scale = 1.2 * 1.25;
  const hb = heatBand(tempF + dewF), cb = coldBand(tempF);
  const heat = ((hb.low + hb.high) / 2) * scale;
  const cold = ((cb.low + cb.high) / 2) * scale;
  return heat + cold;
}

/* ---------- evaluation grid ----------
   Realistic (temp, dew) pairs inside the range the reference table covers
   (25–105 °F heat index). Dew point can never exceed air temp. */
const GRID = [];
for (let t = 30; t <= 100; t += 2) {
  for (let d = 0; d <= 82; d += 2) {
    if (d > t - 2) continue;              // dew must sit below air temp
    if (rhFromDew(t, d) < 12) continue;   // desert extremes are out of sample
    GRID.push([t, d]);
  }
}

const rows = GRID.map(([t, d]) => {
  const rh = rhFromDew(t, d);
  const hi = heatIndexF(t, rh);
  const expected = davisExpected(t <= 65 ? t : hi);
  return { t, d, rh, hi, expected, v3: v3Pct(t, d), v4: v4Pct(t, d) };
});

function stats(key) {
  const errs = rows.map((r) => r[key] - r.expected);
  const abs = errs.map(Math.abs);
  const mae = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rmse = Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / errs.length);
  const bias = errs.reduce((a, b) => a + b, 0) / errs.length;
  return { mae, rmse, bias, worst: Math.max(...abs) };
}

const s3 = stats("v3"), s4 = stats("v4");
const pad = (v, n = 7) => String(v).padStart(n);

console.log(`\nEFFORTCAST model validation — ${rows.length} temperature/dew-point combinations`);
console.log(`Reference: Davis (2025) marathon slowdown table\n`);
console.log("            MAE     RMSE     BIAS    WORST");
console.log(`v0.3   ${pad(s3.mae.toFixed(2))}  ${pad(s3.rmse.toFixed(2))}  ${pad(s3.bias.toFixed(2))}  ${pad(s3.worst.toFixed(2))}`);
console.log(`v0.4   ${pad(s4.mae.toFixed(2))}  ${pad(s4.rmse.toFixed(2))}  ${pad(s4.bias.toFixed(2))}  ${pad(s4.worst.toFixed(2))}`);
console.log(`\nv0.4 reduces mean absolute error by ${(100 * (1 - s4.mae / s3.mae)).toFixed(0)}%\n`);

/* ---------- the cases that separate the two models ---------- */
const SHOWCASE = [
  ["Cool humid dawn", 58, 56],
  ["Cool dry dawn", 58, 34],
  ["Perfect race day", 48, 38],
  ["Warm and dry (desert)", 88, 45],
  ["Warm and sticky (gulf)", 88, 75],
  ["Hot dry afternoon", 95, 50],
  ["Mild but saturated", 70, 68],
  ["Hard freeze", 18, 10],
];
console.log("Where the models disagree");
console.log("                            TEMP  DEW    EXPECTED    v0.3    v0.4");
for (const [name, t, d] of SHOWCASE) {
  const rh = rhFromDew(t, d);
  const exp = davisExpected(t <= 65 ? t : heatIndexF(t, rh));
  console.log(
    `${name.padEnd(26)}${pad(t, 5)}${pad(d, 5)}${pad(exp.toFixed(2), 11)}` +
    `${pad(v3Pct(t, d).toFixed(2))}${pad(v4Pct(t, d).toFixed(2))}`
  );
}

/* ---------- continuity: does a 1°F forecast wobble move the answer? ---------- */
function maxJump(fn) {
  let worst = 0;
  for (let t = 40; t <= 100; t += 1) {
    for (let d = 20; d <= Math.min(78, t - 2); d += 1) {
      worst = Math.max(worst, Math.abs(fn(t + 1, d) - fn(t, d)), Math.abs(fn(t, d + 1) - fn(t, d)));
    }
  }
  return worst;
}
const j3 = maxJump(v3Pct), j4 = maxJump(v4Pct);
console.log(`\nLargest jump from a 1 °F change in the forecast`);
console.log(`  v0.3  ${j3.toFixed(2)} %   (step bands snap at grid edges)`);
console.log(`  v0.4  ${j4.toFixed(2)} %   (continuous surface)\n`);

const failures = [];
if (s4.mae >= s3.mae) failures.push("v0.4 did not improve mean absolute error");
if (s4.rmse >= s3.rmse) failures.push("v0.4 did not improve RMSE");
if (j4 > j3 * 0.5) failures.push("v0.4 is not meaningfully smoother than v0.3");
if (failures.length) {
  console.error("FAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("PASS — v0.4 is closer to the reference data and free of band discontinuities.\n");
