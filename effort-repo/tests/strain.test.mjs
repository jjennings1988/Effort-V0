/* v0.4 strain-model test suite — run with: npm test
   Guards every calibration constant in the continuous heat-balance model.
   Anchors come from MODEL.md; if one of these moves, the science moved. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  heatStrain, heatSlowdownPct, coldSlowdownPct, windChillF,
  groundWindMph, windSlowdownPct, frontalAreaM2, airDensity,
  altitudeVo2DropPct, altitudeSlowdownPct, airQualitySlowdownPct,
  acclimationMultiplier, acclimationIndex, durationFactor, abilityFactor,
  strainLabel, project, projectV3, projectV4, estWbgtF, parsePace,
} from "../public/engine.js";

function mkHour(hh, temp, { dew = 62, rh = 70, wind = 5, solar = 400, pp = 8, code = 1, isDay = true, aqi = 45, day = "2026-07-11" } = {}) {
  return {
    iso: `${day}T${String(hh).padStart(2, "0")}:00`,
    temp, dew, rh, wind, gust: wind * 1.5, solar, precipProb: pp, uv: solar / 110,
    code, isDay, aqi, wbgt: estWbgtF(temp, rh, solar, wind),
  };
}
function flatDay(temp = 70, n = 30, opts = {}) {
  return Array.from({ length: n }, (_, i) => mkHour((6 + i) % 24, temp, { ...opts, isDay: ((6 + i) % 24) >= 6 && ((6 + i) % 24) <= 20 }));
}
const marathonRef = { intensity: "Race", durationMinutes: 180, sport: "run", baselinePaceSeconds: 480 };

/* ---------- the heat surface ---------- */
test("strain is dimensionless and ordered: cool < warm < hot", () => {
  const cool = heatStrain(48, 38, 500, 5);
  const warm = heatStrain(75, 60, 500, 5);
  const hot = heatStrain(92, 76, 500, 5);
  assert.ok(cool < warm && warm < hot, `${cool} ${warm} ${hot}`);
  assert.equal(cool, 0, "48F/38F dew is free cooling");
});

test("heat and humidity compound multiplicatively, not additively", () => {
  const base = heatSlowdownPct(heatStrain(70, 45, 500, 5));
  const hotOnly = heatSlowdownPct(heatStrain(90, 45, 500, 5));
  const humidOnly = heatSlowdownPct(heatStrain(70, 68, 500, 5));
  const both = heatSlowdownPct(heatStrain(90, 75, 500, 5));
  // if the effects merely added, both would equal the sum of the two deltas
  const additive = base + (hotOnly - base) + (humidOnly - base);
  assert.ok(both > additive * 1.15, `both ${both} vs additive ${additive}`);
});

test("humidity barely matters in cool air but bites in warm air", () => {
  const coolDry = heatSlowdownPct(heatStrain(55, 35, 400, 5));
  const coolWet = heatSlowdownPct(heatStrain(55, 53, 400, 5));
  const warmDry = heatSlowdownPct(heatStrain(88, 45, 400, 5));
  const warmWet = heatSlowdownPct(heatStrain(88, 75, 400, 5));
  assert.ok(coolWet - coolDry < 0.35, `cool spread ${coolWet - coolDry}`);
  assert.ok(warmWet - warmDry > 1.0, `warm spread ${warmWet - warmDry}`);
  // ...but dry heat is never cheap, because sweat rate caps you either way
  assert.ok(warmDry > 3, `dry heat floor ${warmDry}`);
});

test("dry heat still costs: the sweat-rate ceiling binds in desert air", () => {
  // 95F at 15% RH has near-infinite evaporative capacity in the air,
  // but you cannot sweat fast enough to use it.
  const desert = heatSlowdownPct(heatStrain(95, 40, 500, 5));
  assert.ok(desert > 3.5, `desert heat should still cost >3.5%, got ${desert}`);
});

test("heat surface matches published marathon anchors within 0.6%", () => {
  const anchors = [[58, 40, 0.38], [75, 55, 2.2], [85, 70, 4.5], [95, 50, 4.9], [100, 70, 6.88]];
  for (const [t, d, expected] of anchors) {
    const got = heatSlowdownPct(heatStrain(t, d, 500, 5));
    assert.ok(Math.abs(got - expected) < 0.6, `${t}F/${d}F dew: got ${got.toFixed(2)}, expected ~${expected}`);
  }
});

test("the surface is continuous — no band snapping", () => {
  let worst = 0;
  for (let t = 40; t <= 100; t++) {
    for (let d = 20; d <= Math.min(78, t - 2); d++) {
      const here = heatSlowdownPct(heatStrain(t, d, 500, 5));
      worst = Math.max(
        worst,
        Math.abs(heatSlowdownPct(heatStrain(t + 1, d, 500, 5)) - here),
        Math.abs(heatSlowdownPct(heatStrain(t, d + 1, 500, 5)) - here),
      );
    }
  }
  assert.ok(worst < 0.35, `a 1F forecast wobble moved pace by ${worst.toFixed(2)}%`);
});

test("shade and darkness both cut radiant load", () => {
  const sun = heatStrain(88, 70, 900, 5);
  const shaded = heatStrain(88, 70, 900, 5, { shade: 1 });
  const night = heatStrain(88, 70, 0, 5);
  assert.ok(shaded < sun && night < sun);
  assert.ok(Math.abs(shaded - night) < 0.01, "full shade should equal no sun");
});

test("wind helps evaporation but never below the sweat ceiling", () => {
  const calm = heatStrain(88, 72, 500, 0);
  const breezy = heatStrain(88, 72, 500, 12);
  assert.ok(breezy < calm, "moving air should reduce heat strain");
  assert.ok(strainLabel(heatStrain(48, 38, 0, 5)) === "Free cooling");
});

/* ---------- cold ---------- */
test("cold costs little pace but is driven by wind chill, not air temp", () => {
  assert.ok(coldSlowdownPct(45, 10) < 0.05, "a mild day is effectively free");
  assert.equal(coldSlowdownPct(55, 20), 0, "above 50F there is no chill at all");
  const calm = coldSlowdownPct(25, 0);
  const windy = coldSlowdownPct(25, 20);
  assert.ok(windy > calm * 1.3, `wind chill must compound: ${calm} vs ${windy}`);
  assert.ok(calm < 1.2, `25F calm should stay under ~1%, got ${calm}`);
});
test("wind chill formula matches the NWS table", () => {
  assert.ok(Math.abs(windChillF(20, 15) - 6) < 1.5, windChillF(20, 15));
  assert.equal(windChillF(60, 20), 60, "no chill above 50F");
  assert.equal(windChillF(20, 1), 20, "no chill in still air");
});

/* ---------- wind as drag ---------- */
test("nominal 10m wind is scaled down to torso height by terrain", () => {
  assert.ok(groundWindMph(10, "city") < groundWindMph(10, "suburb"));
  assert.ok(groundWindMph(10, "suburb") < groundWindMph(10, "open"));
  assert.ok(Math.abs(groundWindMph(10, "suburb") - 5.66) < 0.1, groundWindMph(10, "suburb"));
});
test("a moderate wind is not free, unlike the v0.3 band", () => {
  const pct = windSlowdownPct(10, 3.35, { terrain: "suburb", massKg: 70 });
  assert.ok(pct > 0.6 && pct < 2.0, `10 mph out-and-back: ${pct}`);
});
test("drag scales with the square of wind speed", () => {
  const a = windSlowdownPct(8, 3.35), b = windSlowdownPct(16, 3.35);
  assert.ok(b / a > 3.2 && b / a < 4.2, `doubling wind should ~4x the cost, got ${b / a}`);
});
test("bigger runners catch more wind but pay relatively less for it", () => {
  assert.ok(frontalAreaM2(90) > frontalAreaM2(60), "more mass, more frontal area");
  assert.ok(airDensity(0) > airDensity(8000), "thin air, less drag");
  assert.ok(windSlowdownPct(15, 3.35, { elevFt: 0 }) > windSlowdownPct(15, 3.35, { elevFt: 8000 }));
  // Frontal area grows as mass^0.65 but bodyweight grows as mass^1, and metabolic
  // cost tracks force *relative to bodyweight* — so the big runner wins the trade.
  assert.ok(windSlowdownPct(15, 3.35, { massKg: 90 }) < windSlowdownPct(15, 3.35, { massKg: 60 }));
});
test("a loop route sheds some, but not all, of the wind tax", () => {
  const ob = windSlowdownPct(14, 3.35, { route: "outAndBack" });
  const loop = windSlowdownPct(14, 3.35, { route: "loop" });
  assert.ok(loop < ob && loop > ob * 0.7);
});

/* ---------- altitude ---------- */
test("altitude decrement follows the two-regime VO2max curve", () => {
  assert.ok(altitudeVo2DropPct(3280) < 1.2, "1000m is nearly free");
  const denver = altitudeVo2DropPct(5280);
  assert.ok(denver > 1.8 && denver < 2.8, `Denver: ${denver}`);
  assert.ok(altitudeVo2DropPct(10000) > altitudeVo2DropPct(5280) * 2.5, "steepens above 1500m");
});
test("living at altitude zeroes the penalty — your baseline already includes it", () => {
  assert.equal(altitudeSlowdownPct(5280, 5280), 0);
  assert.ok(altitudeSlowdownPct(5280, 0) > 1.5, "a visitor still pays");
  assert.equal(altitudeSlowdownPct(0, 5280), 0, "going down never costs");
});

/* ---------- air quality ---------- */
test("air quality is continuous and capped", () => {
  assert.equal(airQualitySlowdownPct(45), 0);
  assert.equal(airQualitySlowdownPct(null), 0);
  assert.ok(airQualitySlowdownPct(151) > airQualitySlowdownPct(150), "no step at the AQI boundary");
  assert.equal(airQualitySlowdownPct(500), 3);
});

/* ---------- acclimatisation ---------- */
test("acclimatisation multiplier is centred on the population average", () => {
  assert.ok(Math.abs(acclimationMultiplier(0.5) - 1.0) < 0.01);
  assert.ok(acclimationMultiplier(0) > 1.4, "first hot day of spring costs more");
  assert.ok(acclimationMultiplier(1) < 0.6, "a heat-adapted athlete costs less");
  assert.ok(acclimationMultiplier(0) / acclimationMultiplier(1) > 2.4, "spread should be ~2.5x");
});
test("acclimation index reads the athlete's own recent weather", () => {
  const hotFortnight = [], mildFortnight = [];
  for (let d = 1; d <= 14; d++) {
    for (let h = 6; h <= 20; h++) {
      const day = `2026-07-${String(d).padStart(2, "0")}`;
      hotFortnight.push(mkHour(h, 95, { dew: 75, solar: 800, day }));
      mildFortnight.push(mkHour(h, 58, { dew: 45, solar: 400, day }));
    }
  }
  const hot = acclimationIndex(hotFortnight);
  const mild = acclimationIndex(mildFortnight);
  assert.ok(hot > 0.85, `two hot weeks should read acclimatised, got ${hot}`);
  assert.ok(mild < 0.1, `a cool fortnight should read unacclimatised, got ${mild}`);
  assert.equal(acclimationIndex([]), 0.5, "no history falls back to the population average");
});
test("recent heat outweighs heat from a fortnight ago", () => {
  const build = (hotFirst) => {
    const out = [];
    for (let d = 1; d <= 14; d++) {
      const hot = hotFirst ? d <= 7 : d > 7;
      for (let h = 6; h <= 20; h++) {
        out.push(mkHour(h, hot ? 95 : 58, { dew: hot ? 75 : 45, solar: 700, day: `2026-07-${String(d).padStart(2, "0")}` }));
      }
    }
    return out;
  };
  assert.ok(acclimationIndex(build(false)) > acclimationIndex(build(true)) + 0.3);
});

/* ---------- scaling factors ---------- */
test("heat cost grows sublinearly with duration, normalised at 180 min", () => {
  assert.ok(Math.abs(durationFactor(180) - 1) < 0.001);
  assert.ok(durationFactor(30) < 0.45, "a half hour is far cheaper than a third of a marathon");
  assert.ok(durationFactor(60) < durationFactor(90) && durationFactor(90) < durationFactor(120));
});
test("slower runners lose more to heat, but the effect is damped", () => {
  const elite = abilityFactor(330), mid = abilityFactor(480), back = abilityFactor(660);
  assert.ok(Math.abs(mid - 1) < 0.01, "8:00/mi is the reference");
  assert.ok(elite < mid && mid < back);
  assert.ok(back / elite < 2.2, "not the raw empirical slope — duration already covers time on course");
  assert.equal(abilityFactor(null), 1);
});

/* ---------- projection wiring ---------- */
test("project defaults to v0.4 and can still reproduce v0.3", () => {
  const hrs = flatDay(85, 30, { dew: 72 });
  const args = { hours: hrs, startIdx: 2, ...marathonRef };
  assert.equal(project(args).modelVersion, "0.4-strain");
  assert.equal(project({ ...args, model: "0.3" }).modelVersion, "0.3-live");
  assert.equal(projectV4(args).modelVersion, "0.4-strain");
  assert.equal(projectV3(args).modelVersion, "0.3-live");
});

test("acclimatisation changes the projection, not just the label", () => {
  const hrs = flatDay(84, 30, { dew: 70, solar: 550 });
  const args = { hours: hrs, startIdx: 2, ...marathonRef, intensity: "Steady", durationMinutes: 90 };
  const raw = projectV4({ ...args, acclimation: 0 });
  const adapted = projectV4({ ...args, acclimation: 1 });
  assert.ok(raw.performanceImpact.high > adapted.performanceImpact.high * 1.8);
  assert.ok(raw.riskScore > adapted.riskScore, "unacclimatised is also a safety story");
  assert.equal(adapted.acclimation.label, "Fully heat-adapted");
});

test("a rising afternoon reads hotter than its own average", () => {
  // strain is convex in temperature, so integrating it beats averaging inputs
  const rising = Array.from({ length: 30 }, (_, i) => mkHour((6 + i) % 24, 70 + i * 3, { dew: 68 }));
  const p = projectV4({ hours: rising, startIdx: 0, ...marathonRef, durationMinutes: 120 });
  const flatAtMean = projectV4({
    hours: flatDay(Math.round(p.avgTemp), 30, { dew: 68 }), startIdx: 0, ...marathonRef, durationMinutes: 120,
  });
  assert.ok(p.performanceImpact.high >= flatAtMean.performanceImpact.high);
});

test("a Denver local is not told they are slow every day of their life", () => {
  const hrs = flatDay(60, 30, { dew: 45 });
  const visitor = projectV4({ hours: hrs, startIdx: 2, ...marathonRef, elevFt: 5280, homeElevFt: 0 });
  const local = projectV4({ hours: hrs, startIdx: 2, ...marathonRef, elevFt: 5280, homeElevFt: 5280 });
  assert.ok(visitor.components.alt.high > 1.5);
  assert.equal(local.components.alt.high, 0);
});

test("the model exposes its own working for the UI", () => {
  const p = projectV4({ hours: flatDay(88, 30, { dew: 73 }), startIdx: 2, ...marathonRef, acclimation: 0.3 });
  assert.ok(p.strain.mean > 0 && p.strain.peak >= p.strain.mean);
  assert.equal(typeof p.strain.label, "string");
  assert.ok(p.factors.duration > 0 && p.factors.intensity > 0 && p.factors.ability > 0);
  assert.ok(p.impactMid > 0);
  for (const k of ["heat", "cold", "wind", "rain", "air", "alt"]) {
    assert.ok(p.components[k].high >= p.components[k].low, `${k} band is inverted`);
  }
});

test("v0.4 is calmer than v0.3 on an ordinary humid easy run", () => {
  const hrs = flatDay(78, 30, { dew: 70, solar: 300 });
  const args = { hours: hrs, startIdx: 2, durationMinutes: 45, intensity: "Easy", sport: "run", baselinePaceSeconds: 540 };
  const v4 = projectV4(args), v3 = projectV3(args);
  assert.ok(v4.performanceImpact.high < v3.performanceImpact.high,
    `v0.3 over-taxes short easy runs: v3 ${v3.performanceImpact.high} vs v4 ${v4.performanceImpact.high}`);
});

/* ============================================================
   v0.4 PLANNING, RACE, COUNTERFACTUAL AND CALIBRATION LAYERS
   ============================================================ */
import {
  dailyHeatDose, acclimationOutlook, findDailyWindows, projectRace,
  counterfactuals, personalBias, fmtDuration, RACE_DISTANCES,
} from "../public/engine.js";

function week(peaks, { dew = 68, startDay = 15 } = {}) {
  const out = [];
  peaks.forEach((peak, d) => {
    const day = `2026-07-${String(startDay + d).padStart(2, "0")}`;
    for (let h = 0; h < 24; h++) {
      const t = Math.round(peak - 14 + 14 * Math.max(0, Math.sin(((h - 5) / 24) * 2 * Math.PI)));
      out.push(mkHour(h, t, { dew, solar: h >= 6 && h <= 20 ? 700 : 0, day }));
    }
  });
  return out;
}

test("daily heat dose collapses hours into one score per day", () => {
  const days = dailyHeatDose(week([95, 60, 95]), { fromH: 6, toH: 20 });
  assert.equal(days.length, 3);
  assert.ok(days[0].dose > days[1].dose, "a hot day should out-dose a cool one");
  assert.ok(days[0].peakStrain >= days[0].meanStrain);
  assert.ok(days.every((d) => d.dose >= 0 && d.dose <= 1), "dose must stay in 0..1");
});

test("acclimation outlook projects the index forward through the forecast", () => {
  const past = week([58, 58, 58, 58, 58, 58, 58], { dew: 40, startDay: 8 });
  const ahead = week([95, 95, 95, 95, 95, 95, 95], { dew: 74, startDay: 15 });
  const o = acclimationOutlook(past, ahead, { fromH: 6, toH: 20, targetIndex: 0.6 });
  assert.ok(o.current < 0.2, `a cool fortnight should read unadapted, got ${o.current}`);
  assert.ok(o.projected.at(-1).index > o.current + 0.3, "a hot week ahead should raise the projection");
  assert.equal(o.usefulDaysAhead, 7);
  assert.ok(o.readyOn, "should name the day the athlete crosses the target");
  // one week of heat is not two: the model must not promise full adaptation early
  const strict = acclimationOutlook(past, ahead, { fromH: 6, toH: 20, targetIndex: 0.75 });
  assert.equal(strict.readyOn, null, "seven days should not reach fully-adapted from cold");
});

test("the planner picks the genuinely better day out of a week", () => {
  // Wednesday is the cool one
  const hours = week([92, 92, 62, 92, 92, 92, 92]);
  const days = findDailyWindows(hours, 90, "Steady", "run", { days: 7, fromH: 5, toH: 21 });
  assert.equal(days.length, 7);
  const best = days.reduce((a, b) => (a.score <= b.score ? a : b));
  assert.equal(best.day, "2026-07-17", `expected the cool day, got ${best.day}`);
  assert.ok(days.every((d) => d.iso), "every day should offer a window here");
});

test("the planner refuses to recommend a day that is all storms", () => {
  const hours = week([80, 80]);
  hours.forEach((h) => { if (h.iso.startsWith("2026-07-16")) { h.code = 95; h.precipProb = 80; } });
  const days = findDailyWindows(hours, 60, "Easy", "run", { days: 2, fromH: 0, toH: 23 });
  const stormy = days.find((d) => d.day === "2026-07-16");
  assert.equal(stormy.thunder, true);
  assert.equal(stormy.idx, null);
});

test("race projection solves the duration/impact fixed point", () => {
  const hours = week([88, 88, 88], { dew: 72 });
  const r = projectRace({ hours, startIdx: 7, distanceKey: "full", goalSeconds: 3 * 3600 + 30 * 60 });
  assert.ok(r.midSeconds > r.goalSeconds, "heat should cost time");
  assert.ok(r.highSeconds > r.lowSeconds);
  assert.ok(r.iterations <= 6 && r.iterations >= 1, `converged in ${r.iterations}`);
  assert.match(r.midLabel, /^\d:\d\d:\d\d$/);
  // the projected pace must be consistent with the projected finish
  const impliedPace = r.midSeconds / RACE_DISTANCES.full.miles;
  assert.ok(Math.abs(impliedPace - parsePaceish(r.realisticPaceLabel)) < 2, "pace and finish disagree");
});
function parsePaceish(label) {
  const [m, s] = label.split(":").map(Number);
  return m * 60 + s;
}

test("a cool race day costs almost nothing", () => {
  const hours = week([50, 50, 50], { dew: 38 });
  const r = projectRace({ hours, startIdx: 7, distanceKey: "half", goalSeconds: 95 * 60 });
  assert.ok(Math.abs(r.costSeconds) < 90, `expected a near-neutral day, got ${r.costSeconds}s`);
});

test("fmtDuration handles both sides of an hour", () => {
  assert.equal(fmtDuration(12600), "3:30:00");
  assert.equal(fmtDuration(1471), "24:31");
  assert.equal(fmtDuration(0), "0:00");
});

test("counterfactuals are real re-runs, ranked, and never negative", () => {
  const hours = week([94, 94], { dew: 74 });
  const base = {
    hours, startIdx: 10, durationMinutes: 90, intensity: "Steady", sport: "run",
    baselinePaceSeconds: 510, acclimation: 0.2, terrain: "suburb",
  };
  const out = counterfactuals(base, { fromH: 4, toH: 22, maxStartIdx: 20 });
  assert.ok(out.length >= 3, `expected several levers, got ${out.length}`);
  assert.ok(out.every((o) => o.savedPct > 0), "a counterfactual should never cost you time");
  assert.deepEqual(out.map((o) => o.savedPct), [...out.map((o) => o.savedPct)].sort((a, b) => b - a));
  const accl = out.find((o) => o.key === "acclimation");
  assert.ok(accl && accl.savedPct > 0.5, "being adapted should matter on a 94/74 day");
  const time = out.find((o) => o.key === "time");
  assert.ok(time && Number.isInteger(time.startIdx), "the time lever should say which hour");
});

test("an already-optimal setup offers nothing to change", () => {
  // Flat 50F/38F dew all day: no heat, no cold, nothing to trade.
  const hours = Array.from({ length: 48 }, (_, i) =>
    mkHour(i % 24, 50, { dew: 38, solar: 200, day: `2026-07-${15 + Math.floor(i / 24)}` }));
  const out = counterfactuals(
    { hours, startIdx: 4, durationMinutes: 45, intensity: "Easy", sport: "run", baselinePaceSeconds: 480, acclimation: 1, terrain: "city" },
    { fromH: 0, toH: 23, maxStartIdx: 20 },
  );
  assert.equal(out.length, 0, `perfect conditions should offer no levers, got ${JSON.stringify(out)}`);
});

test("a freezing dawn makes moving the start the obvious lever", () => {
  // week() peaks at 48F, so its nights dip near freezing — cold, not heat, is the story
  const hours = week([48, 48], { dew: 34 });
  const out = counterfactuals(
    { hours, startIdx: 4, durationMinutes: 45, intensity: "Easy", sport: "run", baselinePaceSeconds: 480, acclimation: 1, terrain: "city" },
    { fromH: 0, toH: 23, maxStartIdx: 20 },
  );
  assert.ok(out.length >= 1, "a near-freezing start should be improvable");
  assert.equal(out[0].key, "time", `expected the clock to be the top lever, got ${out[0].key}`);
});

test("personal bias needs evidence before it moves the model", () => {
  const mk = (n, v, mid = 2.5) => Array.from({ length: n }, () => ({ feltDelta: v, predictedMid: mid }));
  assert.equal(personalBias(mk(3, 1)).multiplier, 1, "three samples is not evidence");
  assert.equal(personalBias([]).ready, false);
  assert.ok(personalBias(mk(10, 1)).multiplier > 1.2, "consistently harder should raise the multiplier");
  assert.ok(personalBias(mk(10, -1)).multiplier < 0.85, "consistently easier should lower it");
  assert.equal(personalBias(mk(10, 0)).multiplier, 1, "matching the model should leave it alone");
});

test("feedback from mild days carries no signal", () => {
  // 0.2% predicted impact means the weather said nothing — how it felt is noise
  const noise = Array.from({ length: 12 }, () => ({ feltDelta: 1, predictedMid: 0.2 }));
  assert.equal(personalBias(noise).ready, false, "mild days should not be counted as evidence");
});

test("personal bias flows through to the projection", () => {
  const hours = week([90, 90], { dew: 72 });
  const args = { hours, startIdx: 8, durationMinutes: 60, intensity: "Steady", sport: "run", baselinePaceSeconds: 510 };
  const neutral = projectV4({ ...args, personalHeatBias: 1 });
  const sensitive = projectV4({ ...args, personalHeatBias: 1.3 });
  assert.ok(sensitive.performanceImpact.high > neutral.performanceImpact.high);
  assert.equal(sensitive.factors.personal, 1.3);
});
