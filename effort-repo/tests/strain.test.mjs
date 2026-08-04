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
  strainLabel, project, projectV3, projectV4, estWbgtF,
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
