/* ============================================================
   FITNESS ANCHOR — pure functions, no DOM, no fetch, no storage.
   Covered by tests/fitness.test.mjs.

   Training paces start from things the athlete actually ran, not from a
   guess about their easy pace. Four ideas, in order:

   1. Every performance is turned into a VDOT with the published
      Daniels–Gilbert equations (oxygen cost of running at a speed, divided by
      the fraction of VO2max sustainable for that long). This is continuous
      from 1500 m to the marathon and at every ability.
   2. A performance run in heat, cold, wind or altitude is first corrected to
      neutral air with EffortCast's own weather model, using the conditions
      that were forecast for that place and time. A hot-summer 10K becomes
      usable evidence instead of a misleadingly slow anchor.
   3. Several performances define a personal curve — VDOT as a function of
      log distance — so a runner who is relatively stronger at long races gets
      long-race predictions that reflect it. One performance gives the standard
      Daniels curve. The slope is shrunk towards zero until evidence accrues.
   4. Recency, kind of effort, distance extrapolation and weather correction
      all widen an explicit uncertainty band, which is what drives the
      confidence label. A marathon predicted from short races is biased slow-
      side on purpose (Vickers & Vertosick 2016: short-race projections are
      10+ min too fast for about half of recreational marathoners).
   ============================================================ */

import { projectV4 } from "./engine.js";

export const MILE_M = 1609.344;

export const PERF_DISTANCES = {
  "1500": { label: "1500 M", short: "1500", m: 1500 },
  mile: { label: "MILE", short: "MILE", m: MILE_M },
  "3000": { label: "3000 M", short: "3K", m: 3000 },
  "2mile": { label: "2 MILE", short: "2MI", m: 2 * MILE_M },
  "5k": { label: "5K", short: "5K", m: 5000 },
  "8k": { label: "8K", short: "8K", m: 8000 },
  "10k": { label: "10K", short: "10K", m: 10000 },
  "15k": { label: "15K", short: "15K", m: 15000 },
  "10mi": { label: "10 MILE", short: "10MI", m: 10 * MILE_M },
  half: { label: "HALF MARATHON", short: "HALF", m: 21097.5 },
  full: { label: "MARATHON", short: "MARA", m: 42195 },
};

/* ---------- Daniels–Gilbert ---------- */
// Oxygen cost (ml/kg/min) of running at v metres per minute.
export function oxygenCost(vMpm) {
  return -4.60 + 0.182258 * vMpm + 0.000104 * vMpm * vMpm;
}
// Fraction of VO2max sustainable for an effort lasting t minutes.
export function sustainableFraction(tMin) {
  return 0.8 + 0.1894393 * Math.exp(-0.012778 * tMin) + 0.2989558 * Math.exp(-0.1932605 * tMin);
}
export function vdotFromPerformance(distM, seconds) {
  if (!(distM > 0) || !(seconds > 0)) return null;
  const tMin = seconds / 60;
  return oxygenCost(distM / tMin) / sustainableFraction(tMin);
}
// Running speed (m/min) whose oxygen cost is `vo2`.
export function velocityForVO2(vo2) {
  const a = 0.000104, b = 0.182258, c = -4.60 - vo2;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}
// Seconds per mile at a fraction of VO2max.
export function paceAtFraction(vdot, frac) {
  return (MILE_M / velocityForVO2(vdot * frac)) * 60;
}
// Equivalent finishing time for `distM` at a given VDOT (bisection; VDOT
// falls monotonically as time rises at fixed distance).
export function predictSeconds(vdot, distM) {
  let lo = 60, hi = 14 * 3600;
  for (let i = 0; i < 70; i++) {
    const mid = (lo + hi) / 2;
    if (vdotFromPerformance(distM, mid) > vdot) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ---------- training zones ----------
   %VO2max bands. LT2 and LT1 were placed so a fast runner's numbers match
   the threshold ratios coaches commonly use (≈1.04–1.09 and ≈1.12–1.16 × 5K
   pace), while recovery and easy keep scaling for every runner — unlike
   lookup tables that stop at an 18-minute 5K. `intensity` names the workout
   button each zone drives. */
export const ZONES = [
  { key: "recovery", label: "RECOVERY", desc: "Very easy, between hard days", lo: 0.58, hi: 0.64 },
  { key: "easy", label: "EASY", desc: "Conversational", lo: 0.64, hi: 0.70, intensity: "Easy" },
  { key: "steady", label: "STEADY", desc: "Aerobic development", lo: 0.70, hi: 0.75, intensity: "Steady" },
  { key: "marathon", label: "MARATHON", desc: "Long-race rhythm", lo: 0.75, hi: 0.80 },
  { key: "lt1", label: "LT1 / TEMPO", desc: "Comfortably hard", lo: 0.80, hi: 0.83 },
  { key: "lt2", label: "LT2 / THRESHOLD", desc: "About one-hour race effort", lo: 0.86, hi: 0.90, intensity: "Hard" },
  { key: "vo2", label: "VO2 / INTERVALS", desc: "3–5 minute repeats", lo: 0.95, hi: 1.0 },
];
// Which Today intensity the heat model should assume for each zone.
export const ZONE_HEAT_INTENSITY = { recovery: "Easy", easy: "Easy", steady: "Steady", marathon: "Steady", lt1: "Hard", lt2: "Hard", vo2: "Race" };

export function trainingZones(vdot) {
  return ZONES.map((z) => {
    const fast = paceAtFraction(vdot, z.hi), slow = paceAtFraction(vdot, z.lo);
    return { ...z, fastSec: fast, slowSec: slow, midSec: (fast + slow) / 2 };
  });
}

/* ---------- weather correction ----------
   `hours` are hourly conditions in the engine's format around the effort.
   Returns the time the same effort would have taken in neutral air, using
   model 0.5 at race effort, or null when the hours don't cover the effort. */
export function neutralizePerformance({ hours, startEpoch, seconds, distM, ...opts }) {
  if (!hours?.length || !(seconds > 0)) return null;
  const base = hours.findIndex((h, i) => i < hours.length - 1 && h.epoch <= startEpoch && hours[i + 1].epoch > startEpoch);
  if (base < 0) return null;
  const endEpoch = startEpoch + seconds * 1000;
  if (hours.at(-1).epoch < endEpoch) return null;
  for (let i = base; hours[i].epoch < endEpoch && i < hours.length - 1; i++) {
    if (hours[i + 1].epoch - hours[i].epoch !== 3600000) return null;
  }
  const startIdx = base + (startEpoch - hours[base].epoch) / 3600000;
  const p = projectV4({
    hours, startIdx, durationMinutes: seconds / 60, intensity: "Race", sport: "run",
    baselinePaceSeconds: seconds / (distM / MILE_M), structure: "continuous",
    acclimation: 0.5, terrain: "suburb", massKg: 70, personalHeatBias: 1, ...opts,
  });
  const impact = Math.max(0, p.impactMid);
  return {
    neutralSeconds: seconds / (1 + impact / 100),
    impactPct: Math.round(impact * 10) / 10,
    tempF: Math.round(p.avgTemp), dewF: Math.round(p.avgDew), windMph: Math.round(p.avgWind),
    strain: p.strain.mean, modelVersion: p.modelVersion,
  };
}

/* ---------- from history to current fitness ---------- */
const DAY = 86400000;
const KIND_WEIGHT = { race: 1, tt: 0.8 };
const KIND_SPREAD = { race: 0, tt: 0.6 };      // % added to the uncertainty band
export const ENDURANCE_LABELS = [
  { max: -0.5, label: "SPEED-LEANING", note: "Relatively stronger at shorter races" },
  { max: 0.5, label: "BALANCED", note: "Long and short races agree" },
  { max: Infinity, label: "ENDURANCE-LEANING", note: "Relatively stronger at longer races" },
];

/* Usable entries with their effective VDOT. Effort older than six weeks is
   discounted gently (0.1 VDOT a week, at most 2.5) so an old PR never anchors
   today's paces at face value. */
export function scorePerformances(performances, now = Date.now()) {
  return (performances ?? []).flatMap((p) => {
    const seconds = p.weather?.neutralSeconds ?? p.seconds;
    const vdot = vdotFromPerformance(p.distanceM, seconds);
    if (!vdot || !Number.isFinite(vdot) || vdot < 15 || vdot > 90) return [];
    const ageDays = Math.max(0, (now - Date.parse(p.dateISO + "T12:00:00Z")) / DAY);
    const ageWeeks = ageDays / 7;
    const decay = Math.min(2.5, Math.max(0, ageWeeks - 6) * 0.1);
    const kind = KIND_WEIGHT[p.kind] ? p.kind : "race";
    return [{
      ...p, kind, rawVdot: vdotFromPerformance(p.distanceM, p.seconds), vdot, effVdot: vdot - decay, decay,
      ageDays, weight: KIND_WEIGHT[kind] * Math.pow(0.5, ageDays / 75), corrected: p.weather?.neutralSeconds != null,
    }];
  });
}

/* Weighted fit of effective VDOT against ln(distance). The slope is shrunk
   towards zero (standard Daniels) by the evidence: n/(n+2), and only counts
   when the performances span at least a factor of 1.6 in distance. */
export function fitnessFromHistory(performances, { now = Date.now(), weeklyMiles = null } = {}) {
  const scored = scorePerformances(performances, now).filter((s) => s.ageDays <= 365);
  if (!scored.length) return null;
  const W = scored.reduce((a, s) => a + s.weight, 0);
  const xs = scored.map((s) => Math.log(s.distanceM));
  const xbar = scored.reduce((a, s, i) => a + s.weight * xs[i], 0) / W;
  const ybar = scored.reduce((a, s) => a + s.weight * s.effVdot, 0) / W;
  let sxx = 0, sxy = 0;
  scored.forEach((s, i) => { sxx += s.weight * (xs[i] - xbar) ** 2; sxy += s.weight * (xs[i] - xbar) * (s.effVdot - ybar); });
  const span = Math.max(...scored.map((s) => s.distanceM)) / Math.min(...scored.map((s) => s.distanceM));
  let slope = 0;
  if (scored.length >= 2 && span >= 1.6 && sxx > 0) {
    const n = scored.length;
    slope = Math.max(-3, Math.min(2, (sxy / sxx) * (n / (n + 2))));
  }
  // The level is a weighted mean, not a maximum: one lucky race shouldn't set
  // every pace. The most informative recent result still dominates through weight.
  const level = ybar;
  const vdotAt = (distM) => level + slope * (Math.log(distM) - xbar);
  const residuals = scored.map((s, i) => s.effVdot - (level + slope * (xs[i] - xbar)));
  const agreement = scored.length >= 2 ? Math.max(...residuals.map(Math.abs)) : null;
  const anchor = [...scored].sort((a, b) => b.weight - a.weight)[0];
  // Zones are set from the curve at ~15K, roughly a one-hour race for most
  // runners: the effort lactate threshold describes.
  const zoneVdot = vdotAt(15000);
  const endurance = slope && scored.length >= 2
    ? ENDURANCE_LABELS.find((e) => slope < e.max)
    : null;
  return {
    vdot: Math.round(zoneVdot * 10) / 10,
    slope, level, xbar, vdotAt, scored, anchor, agreement,
    endurance, weeklyMiles: Number.isFinite(weeklyMiles) ? weeklyMiles : null,
    zones: trainingZones(zoneVdot),
  };
}

/* Prediction for a distance, with an explicit uncertainty band.
   Spread (in % of time) grows with: extrapolation from the nearest evidence,
   age, effort kind, weather correction, and disagreement between results. */
export function predictRace(fitness, distM) {
  if (!fitness) return null;
  const vd = fitness.vdotAt(distM);
  const mid = predictSeconds(vd, distM);
  const nearest = fitness.scored.reduce((best, s) => {
    const d = Math.abs(Math.log2(distM / s.distanceM));
    return !best || d < best.d ? { s, d } : best;
  }, null);
  const s = nearest.s;
  let spread = 1.0
    + 1.5 * nearest.d
    + 0.5 * Math.max(0, s.ageDays - 42) / 28
    + KIND_SPREAD[s.kind]
    + (s.corrected ? 0.5 : 0)
    + (fitness.agreement != null ? Math.min(2, fitness.agreement * 0.6) : 0.8);
  spread = Math.min(12, spread);
  // Marathons predicted from shorter races run fast for most recreational
  // runners; lean the band slow unless there's long-race evidence or volume.
  let slowExtra = 0;
  const longest = Math.max(...fitness.scored.map((x) => x.distanceM));
  if (distM >= 30000 && longest < 25000) {
    const wm = fitness.weeklyMiles;
    slowExtra = wm == null ? 4 : wm >= 45 ? 2 : wm >= 30 ? 3.5 : 6;
  }
  const fast = mid * (1 - spread * 0.4 / 100);
  const slow = mid * (1 + (spread * 0.6 + slowExtra) / 100);
  const confidence = spread + slowExtra < 3 ? "high" : spread + slowExtra < 6 ? "medium" : "low";
  return { distM, vdot: vd, midSeconds: mid, fastSeconds: fast, slowSeconds: slow, spreadPct: spread + slowExtra, confidence, basedOn: s, slowExtra };
}

/* The pace each Today intensity uses when it follows fitness. Race follows a
   pinned race's goal when there is one, else the predicted 10K. */
export function fitnessPaceFor(fitness, intensity, raceGoal = null) {
  if (!fitness) return null;
  const zone = (k) => fitness.zones.find((z) => z.key === k).midSec;
  if (intensity === "Easy") return zone("easy");
  if (intensity === "Steady") return zone("steady");
  if (intensity === "Hard") return zone("lt2");
  if (intensity === "Race") {
    if (raceGoal?.goalSeconds && raceGoal?.distanceM) return raceGoal.goalSeconds / (raceGoal.distanceM / MILE_M);
    return predictSeconds(fitness.vdotAt(10000), 10000) / (10000 / MILE_M);
  }
  return null;
}

/* No logged results yet: estimate a VDOT from a typed easy pace (taken as the
   middle of the easy band, 67% VO2max). Clearly an estimate — the interface
   labels it and asks for a race — but it means every athlete gets a full
   pace board from the first screen. */
export function estimateFitnessFromEasyPace(easySecPerMile) {
  if (!(easySecPerMile > 180 && easySecPerMile < 1800)) return null;
  let lo = 15, hi = 90;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (paceAtFraction(mid, 0.67) > easySecPerMile) lo = mid; else hi = mid;
  }
  const vdot = (lo + hi) / 2;
  return { vdot: Math.round(vdot * 10) / 10, estimated: true, zones: trainingZones(vdot), vdotAt: () => vdot };
}

/* How a goal compares with demonstrated fitness at that distance. */
export function goalCheck(fitness, distM, goalSeconds) {
  if (!fitness || !goalSeconds) return null;
  const needed = vdotFromPerformance(distM, goalSeconds);
  const have = fitness.vdotAt(distM);
  const gap = needed - have;
  const verdict = gap > 2.5 ? "stretch" : gap > 0.8 ? "ambitious" : gap < -2.5 ? "conservative" : "matched";
  return { needed, have, gap, verdict };
}

/* Parse "1:45:00", "45:00" or "4:59" into seconds. */
export function parseDuration(text) {
  const m = String(text ?? "").trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1] ?? 0), min = Number(m[2]), s = Number(m[3]);
  if (min > 59 || s > 59) return null;
  const total = h * 3600 + min * 60 + s;
  return total >= 150 && total <= 10 * 3600 ? total : null;
}
