import { test } from "node:test";
import assert from "node:assert/strict";
import {
  vdotFromPerformance, predictSeconds, paceAtFraction, trainingZones, fitnessFromHistory,
  predictRace, neutralizePerformance, fitnessPaceFor, goalCheck, parseDuration, PERF_DISTANCES, MILE_M,
} from "../public/fitness.js";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString().slice(0, 10);
const perf = (key, time, ago = 14, extra = {}) => ({ distanceKey: key, distanceM: PERF_DISTANCES[key].m, seconds: parseDuration(time), dateISO: daysAgo(ago), kind: "race", ...extra });
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test("VDOT reproduces the published Daniels table", () => {
  // Daniels' Running Formula, VDOT 50: 5K 19:57, 10K 41:21, half 1:31:35, marathon 3:10:49
  near(vdotFromPerformance(5000, 19 * 60 + 57), 50, 0.2, "5K");
  near(vdotFromPerformance(10000, 41 * 60 + 21), 50, 0.2, "10K");
  near(predictSeconds(50, 21097.5), 91 * 60 + 35, 45, "half");
  near(predictSeconds(50, 42195), 3 * 3600 + 10 * 60 + 49, 90, "marathon");
});

test("zones scale for every runner (no easy pace faster than race pace)", () => {
  for (const fiveK of [15 * 60, 20 * 60, 25 * 60, 30 * 60, 38 * 60]) {
    const z = trainingZones(vdotFromPerformance(5000, fiveK));
    const racePace = fiveK / (5000 / MILE_M);
    const easy = z.find((x) => x.key === "easy"), lt2 = z.find((x) => x.key === "lt2"), rec = z.find((x) => x.key === "recovery");
    assert.ok(easy.fastSec > racePace * 1.15, `easy must be well slower than 5K pace for a ${fiveK / 60}-minute 5K`);
    assert.ok(rec.fastSec >= easy.slowSec - 1, "recovery sits below easy");
    // Threshold is never faster than 5K pace, and sits within ~11% of it. For a
    // slow runner a 5K lasts longer, so it is physiologically closer to threshold.
    assert.ok(lt2.fastSec > racePace && lt2.slowSec / racePace < 1.11, `LT2 ratio for ${fiveK / 60}`);
    for (let i = 1; i < z.length; i++) assert.ok(z[i].midSec < z[i - 1].midSec, "zones get faster in order");
  }
});

test("one race gives the standard curve; recent results outweigh old ones", () => {
  const one = fitnessFromHistory([perf("10k", "41:21")], { now: NOW });
  near(one.vdot, 50, 0.3, "single 10K");
  assert.equal(one.slope, 0);
  assert.equal(one.endurance, null);
  const mixed = fitnessFromHistory([perf("10k", "41:21", 10), perf("10k", "45:00", 300)], { now: NOW });
  assert.ok(mixed.vdot > 48.5, `a ten-month-old slower race should barely move today's fitness (${mixed.vdot})`);
  const stale = fitnessFromHistory([perf("10k", "41:21", 200)], { now: NOW });
  assert.ok(stale.vdot < one.vdot - 1.5, "an old race is discounted");
  assert.equal(fitnessFromHistory([perf("10k", "41:21", 400)], { now: NOW }), null, "results older than a year are ignored");
});

test("two races at different distances define a personal endurance curve", () => {
  // Same 5K, but a much stronger half than the 5K implies: endurance-leaning.
  const endurance = fitnessFromHistory([perf("5k", "20:00", 20), perf("half", "1:29:00", 10)], { now: NOW });
  const speed = fitnessFromHistory([perf("5k", "20:00", 20), perf("half", "1:38:00", 10)], { now: NOW });
  assert.ok(endurance.slope > 0 && speed.slope < 0);
  assert.equal(endurance.endurance.label, "ENDURANCE-LEANING");
  assert.equal(speed.endurance.label, "SPEED-LEANING");
  assert.ok(predictRace(endurance, 42195).midSeconds < predictRace(speed, 42195).midSeconds - 300,
    "the marathon prediction follows the athlete's own curve");
});

test("predictions carry honest uncertainty", () => {
  const f = fitnessFromHistory([perf("10k", "41:21", 7)], { now: NOW });
  const tenK = predictRace(f, 10000), mara = predictRace(f, 42195);
  assert.equal(tenK.confidence, "high");
  assert.ok(mara.spreadPct > tenK.spreadPct + 4);
  assert.ok(mara.slowSeconds - mara.midSeconds > 8 * 60, "marathon from a 10K leans slow");
  const volume = fitnessFromHistory([perf("10k", "41:21", 7)], { now: NOW, weeklyMiles: 55 });
  assert.ok(predictRace(volume, 42195).slowSeconds < mara.slowSeconds, "high mileage narrows the slow side");
  for (const p of [tenK, mara]) assert.ok(p.fastSeconds < p.midSeconds && p.midSeconds < p.slowSeconds);
});

function hours(tempF, dewF, solar = 0) {
  const start = Date.parse("2026-07-12T10:00:00Z");
  return Array.from({ length: 8 }, (_, i) => ({
    epoch: start + i * 3600000, iso: new Date(start + i * 3600000).toISOString().slice(0, 16),
    temp: tempF, dew: dewF, rh: 70, wind: 4, gust: 6, solar, precipProb: 0, code: 1, uv: 0, isDay: true, aqi: null, wbgt: 70,
  }));
}

test("weather correction removes the heat cost and leaves cool races alone", () => {
  const startEpoch = Date.parse("2026-07-12T11:30:00Z");
  const hot = neutralizePerformance({ hours: hours(86, 72, 500), startEpoch, seconds: 45 * 60, distM: 10000 });
  const cool = neutralizePerformance({ hours: hours(48, 38), startEpoch, seconds: 45 * 60, distM: 10000 });
  assert.ok(hot.neutralSeconds < 45 * 60 - 45, `a muggy 10K is worth more than its clock time (${hot.neutralSeconds})`);
  assert.ok(hot.impactPct > 2);
  assert.ok(45 * 60 - cool.neutralSeconds < 15, "near-ideal air barely changes the time");
  assert.equal(neutralizePerformance({ hours: hours(70, 60), startEpoch: Date.parse("2026-07-12T16:30:00Z"), seconds: 2 * 3600, distM: 21097.5 }), null,
    "no correction when the forecast doesn't cover the whole effort");
});

test("workout buttons follow fitness, and goals are checked against it", () => {
  const f = fitnessFromHistory([perf("10k", "41:21", 7)], { now: NOW });
  const easy = fitnessPaceFor(f, "Easy"), steady = fitnessPaceFor(f, "Steady"), hard = fitnessPaceFor(f, "Hard"), race = fitnessPaceFor(f, "Race");
  assert.ok(easy > steady && steady > hard && hard > race);
  assert.equal(Math.round(fitnessPaceFor(f, "Race", { goalSeconds: 3600 * 1.5, distanceM: 21097.5 })), Math.round(5400 / (21097.5 / MILE_M)));
  assert.equal(goalCheck(f, 21097.5, 80 * 60).verdict, "stretch");
  assert.equal(goalCheck(f, 21097.5, predictRace(f, 21097.5).midSeconds).verdict, "matched");
  assert.equal(goalCheck(f, 21097.5, 110 * 60).verdict, "conservative");
});

test("durations parse like a stopwatch", () => {
  assert.equal(parseDuration("19:57"), 1197);
  assert.equal(parseDuration("1:31:35"), 5495);
  assert.equal(parseDuration("4:59"), 299);
  assert.equal(parseDuration("61:00"), null);
  assert.equal(parseDuration("abc"), null);
  near(paceAtFraction(50, 1), 6 * 60 + 10, 4, "vVO2max pace at VDOT 50 is about 6:10/mi");
});
