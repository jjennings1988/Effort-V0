/* Application state and the persisted athlete profile.

   Everything the athlete has told us lives in ONE versioned localStorage entry
   with a migration path from the five ad-hoc keys v0.3 used. That makes the
   profile exportable, importable, and safe to evolve. */

import { clamp, DEFAULT_PACES, parsePace, personalBias } from "../engine.js";

export const PROFILE_KEY = "effortcast-profile";
export const PROFILE_VERSION = 7;

export const TERRAIN_LABELS = {
  open: "OPEN / COAST", field: "RURAL", park: "PARK", suburb: "SUBURB", city: "CITY",
};
export const RIBBON_METRICS = ["temp", "dew", "wind", "wbgt", "aqi"];

export const SLIDER_HOURS = 24;   // selectable start range shown in the UI
export const SEARCH_HOURS = 24;   // best-window scan range for today
export const PLANNER_DAYS = 7;

function defaultProfile() {
  return {
    version: PROFILE_VERSION,
    paces: { ...DEFAULT_PACES },
    location: null,                       // {lat, lon, label}
    homeElevFt: null,                     // where the pace baselines were set
    trainingHours: { from: 6, to: 22 },
    ribbonMetric: "temp",
    terrain: "suburb",
    acclimation: { mode: "auto", manual: 0.5 },
    race: null,                           // {name, dateISO, distanceKey, goalSeconds}
    feedback: [],                         // post-run reconciliation log
    units: null,                          // {temperature,distance,weight}; null = infer from locale
    massKg: 70,                           // used by the aerodynamic drag model
    setupDone: false,                     // has the athlete completed first-run setup
    seenBuild: null,                      // last build whose release note was shown
    seenHints: [],                        // one-time explainers already dismissed
  };
}

/* ---------- validation ----------
   Anything loaded from disk or an import file is untrusted. */
function sanitise(raw) {
  const p = defaultProfile();
  if (!raw || typeof raw !== "object") return p;

  if (raw.paces && typeof raw.paces === "object") {
    for (const k of Object.keys(DEFAULT_PACES)) {
      const v = raw.paces[k];
      if (typeof v === "string" && parsePace(v)) p.paces[k] = v;
    }
  }
  const loc = raw.location;
  if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) && typeof loc.label === "string") {
    p.location = { lat: loc.lat, lon: loc.lon, label: loc.label.slice(0, 80) };
  }
  if (Number.isFinite(raw.homeElevFt)) p.homeElevFt = clamp(raw.homeElevFt, -1500, 20000);
  const th = raw.trainingHours;
  if (th && Number.isInteger(th.from) && Number.isInteger(th.to)) {
    p.trainingHours = { from: clamp(th.from, 0, 23), to: clamp(th.to, 0, 23) };
  }
  if (RIBBON_METRICS.includes(raw.ribbonMetric)) p.ribbonMetric = raw.ribbonMetric;
  if (Object.keys(TERRAIN_LABELS).includes(raw.terrain)) p.terrain = raw.terrain;

  const a = raw.acclimation;
  if (a && (a.mode === "auto" || a.mode === "manual")) {
    p.acclimation = { mode: a.mode, manual: Number.isFinite(a.manual) ? clamp(a.manual, 0, 1) : 0.5 };
  }
  const r = raw.race;
  if (r && typeof r.dateISO === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.dateISO) && Number.isFinite(r.goalSeconds)) {
    p.race = {
      name: typeof r.name === "string" ? r.name.slice(0, 60) : "",
      dateISO: r.dateISO,
      distanceKey: ["5k", "10k", "half", "full"].includes(r.distanceKey) ? r.distanceKey : "full",
      goalSeconds: clamp(r.goalSeconds, 480, 12 * 3600),
    };
  }
  // v6 stored a single "imperial"/"metric" string. Expand it so nobody loses
  // their setting, then let them split the three apart if they want to.
  const LEGACY_UNITS = {
    imperial: { temperature: "f", distance: "mi", weight: "lb" },
    metric: { temperature: "c", distance: "km", weight: "kg" },
  };
  const ALLOWED = { temperature: ["f", "c"], distance: ["mi", "km"], weight: ["lb", "kg"] };
  if (typeof raw.units === "string" && LEGACY_UNITS[raw.units]) {
    p.units = { ...LEGACY_UNITS[raw.units] };
  } else if (raw.units && typeof raw.units === "object") {
    const picked = {};
    for (const [field, options] of Object.entries(ALLOWED)) {
      if (options.includes(raw.units[field])) picked[field] = raw.units[field];
    }
    if (Object.keys(picked).length) p.units = picked;
  }
  if (Number.isFinite(raw.massKg)) p.massKg = clamp(raw.massKg, 30, 200);
  p.setupDone = raw.setupDone === true;
  if (typeof raw.seenBuild === "string") p.seenBuild = raw.seenBuild.slice(0, 40);
  if (Array.isArray(raw.seenHints)) {
    p.seenHints = raw.seenHints.filter((h) => typeof h === "string").slice(0, 20);
  }
  if (Array.isArray(raw.feedback)) {
    p.feedback = raw.feedback
      .filter((e) => e && Number.isFinite(e.ts) && [-1, 0, 1].includes(e.feltDelta))
      .slice(-60)
      .map((e) => ({
        ts: e.ts,
        feltDelta: e.feltDelta,
        predictedMid: Number.isFinite(e.predictedMid) ? e.predictedMid : 0,
        tempF: Number.isFinite(e.tempF) ? Math.round(e.tempF) : null,
        dewF: Number.isFinite(e.dewF) ? Math.round(e.dewF) : null,
        intensity: typeof e.intensity === "string" ? e.intensity : null,
        durationMinutes: Number.isFinite(e.durationMinutes) ? e.durationMinutes : null,
      }));
  }
  return p;
}

/* ---------- migration from the v0.3 keys ---------- */
const LEGACY_KEYS = [
  "effort-runner-pace-profile", "effort-location-v2",
  "effort-settings-v2", "effort-ribbon-metric", "effort-athlete-v4",
];

function migrateLegacy() {
  const out = {};
  const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const json = (k) => { try { return JSON.parse(read(k)); } catch { return null; } };

  const paces = json("effort-runner-pace-profile");
  if (paces) out.paces = paces;
  const loc = json("effort-location-v2");
  if (loc) out.location = loc;
  const settings = json("effort-settings-v2");
  if (settings) out.trainingHours = { from: settings.hoursFrom, to: settings.hoursTo };
  const metric = read("effort-ribbon-metric");
  if (metric) out.ribbonMetric = metric;
  const athlete = json("effort-athlete-v4");
  if (athlete) {
    if (athlete.terrain) out.terrain = athlete.terrain;
    if (Number.isFinite(athlete.homeElevFt)) out.homeElevFt = athlete.homeElevFt;
    out.acclimation = {
      mode: athlete.acclimationMode === "manual" ? "manual" : "auto",
      manual: Number.isFinite(athlete.acclimationManual) ? athlete.acclimationManual : 0.5,
    };
  }
  return Object.keys(out).length ? out : null;
}

export function loadProfile() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(PROFILE_KEY)); } catch { raw = null; }
  if (!raw) {
    const legacy = migrateLegacy();
    if (legacy) {
      const migrated = sanitise({ ...legacy, setupDone: true });
      saveProfile(migrated);
      // leave the old keys in place — harmless, and a safety net if this build
      // is rolled back. They are ignored from here on.
      return migrated;
    }
    return defaultProfile();
  }
  return sanitise(raw);
}

export function saveProfile(profile = S.profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ ...profile, version: PROFILE_VERSION }));
  } catch { /* private browsing, quota — the app still works, it just forgets */ }
}

export function exportProfile(profile = S.profile) {
  return JSON.stringify({ ...profile, version: PROFILE_VERSION, exportedAt: new Date().toISOString() }, null, 2);
}

export function importProfile(text) {
  const parsed = JSON.parse(text);
  const clean = sanitise(parsed);
  S.profile = clean;
  saveProfile(clean);
  return clean;
}

export function resetProfile() {
  S.profile = defaultProfile();
  saveProfile();
  return S.profile;
}

/* ---------- session state (not persisted) ---------- */
export const S = {
  profile: defaultProfile(),
  sport: "run",
  intensity: "Easy",
  duration: 60,
  structure: "continuous",
  startIdx: 0,
  hours: null,
  pastHours: null,
  meta: null,
  bestWindow: null,
  acclimationAuto: null,   // what the last 14 days of weather implies
  lastProjection: null,
  view: "today",           // "today" | "week" | "race" | "profile"
};

export function initState() {
  S.profile = loadProfile();
  return S;
}

/* ---------- derived ---------- */
export function trainingHours() {
  return S.profile.trainingHours;
}

export function effectiveAcclimation() {
  const a = S.profile.acclimation;
  if (a.mode === "manual") return a.manual;
  return S.acclimationAuto ?? 0.5;
}

export function bias() {
  return personalBias(S.profile.feedback);
}

export function baselinePaceSeconds(intensity = S.intensity) {
  return parsePace(S.profile.paces[intensity]) ?? parsePace(DEFAULT_PACES[intensity]) ?? 480;
}

/* Everything the engine needs beyond the raw forecast. */
export function modelOpts() {
  return {
    elevFt: S.meta?.elevFt || 0,
    homeElevFt: S.profile.homeElevFt ?? S.meta?.elevFt ?? 0,
    acclimation: effectiveAcclimation(),
    terrain: S.profile.terrain,
    personalHeatBias: bias().multiplier,
    massKg: S.profile.massKg ?? 70,
  };
}

/* One-time explainers. */
export function hintSeen(id) { return (S.profile.seenHints ?? []).includes(id); }
export function markHintSeen(id) {
  if (hintSeen(id)) return;
  S.profile.seenHints = [...(S.profile.seenHints ?? []), id];
  saveProfile();
}

/* The full argument set for a projection of the currently selected workout. */
export function currentProjectionArgs(overrides = {}) {
  return {
    hours: S.hours,
    startIdx: S.startIdx,
    durationMinutes: S.duration,
    intensity: S.intensity,
    sport: S.sport,
    baselinePaceSeconds: S.sport === "run" ? baselinePaceSeconds() : null,
    structure: S.structure,
    ...modelOpts(),
    ...overrides,
  };
}
