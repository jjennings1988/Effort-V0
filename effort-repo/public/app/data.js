/* Network layer: Open-Meteo forecast + history, air quality, geocoding, NWS
   alerts, and the offline demo dataset. Nothing here touches the model. */

import {
  clamp, r1, estWbgtF, splitPastAndFuture,
  acclimationIndex, hourLabelFull,
} from "../engine.js";
import { S, saveProfile, trainingHours } from "./state.js";
import { $, escHtml } from "./dom.js";
import { dialSignal } from "./dial.js";
import { introSeenToday, markIntroSeen, announce } from "./instrument.js";

export const PAST_DAYS = 14;      // history window used to score acclimatisation
export const FORECAST_DAYS = 8;   // enough for the 7-day planner plus a tail
export const FETCH_TIMEOUT_MS = 12000;

const HOURLY = [
  "temperature_2m", "dew_point_2m", "relative_humidity_2m", "apparent_temperature",
  "precipitation_probability", "weather_code", "wind_speed_10m", "wind_gusts_10m",
  "shortwave_radiation", "uv_index", "is_day",
].join(",");

export const OM_URL = (lat, lon, forecastDays = FORECAST_DAYS) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
  `&hourly=${HOURLY}` +
  `&minutely_15=precipitation&forecast_minutely_15=8&past_days=${PAST_DAYS}` +
  `&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph` +
  `&timezone=auto&forecast_days=${forecastDays}`;

export const GEO_URL = (q) =>
  `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;

export const AQ_URL = (lat, lon) =>
  `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
  `&hourly=us_aqi&timezone=auto&forecast_days=3`;

/* ---------- signal / status chrome ---------- */
let orbMotionToken = 0;
let orbMotionStartedAt = Date.now();
let orbMotionAnimations = [];
let orbMotionWatchdog = null;
// The full opening plays once per day. Later launches start docked: the page
// is laid out at once and the dial arrives sorted when the forecast lands.
let orbIntroComplete = introSeenToday();
if (orbIntroComplete && document.body?.classList.contains("orb-calculating")) {
  document.body.classList.replace("orb-calculating", "orb-refreshing");
}
let orbDataLoading = true;
const ORB_INTRO_MAX_MS = 6000;
const OPENING_SORT_MS = 1550;   // the compact dial's fast sort timeline, plus a beat

function clearOrbAnimations() {
  for (const animation of orbMotionAnimations) animation?.cancel?.();
  orbMotionAnimations = [];
}

function setOrbCaption(text) {
  const state = $("orbMotionState");
  if (state) state.textContent = text;
}

function clearOrbWatchdog() {
  if (orbMotionWatchdog != null) window.clearTimeout(orbMotionWatchdog);
  orbMotionWatchdog = null;
}

function releaseOrbIntro({ keepCalculating = false, label } = {}) {
  const body = document.body;
  if (!body) return;
  orbMotionToken++;
  clearOrbAnimations();
  clearOrbWatchdog();
  body.classList.remove("orb-calculating", "orb-locking", "orb-revealing", "orb-refreshing");
  orbIntroComplete = true;
  markIntroSeen();
  if (keepCalculating) body.classList.add("orb-refreshing");
  setOrbCaption(label || (keepCalculating ? "CALCULATING CONDITIONS" : "CONDITIONS LOCKED"));
}

function wireOrbSkip() {
  const skip = $("orbSkip");
  if (!skip || skip.dataset.wired) return;
  skip.dataset.wired = "true";
  skip.addEventListener("click", () => releaseOrbIntro({
    keepCalculating: orbDataLoading,
    label: orbDataLoading ? "CALCULATING CONDITIONS" : undefined,
  }));
}

function armOrbWatchdog() {
  if (orbMotionWatchdog != null || orbIntroComplete) return;
  orbMotionWatchdog = window.setTimeout(() => {
    releaseOrbIntro({
      keepCalculating: orbDataLoading,
      label: orbDataLoading ? "STILL CALCULATING" : undefined,
    });
  }, ORB_INTRO_MAX_MS);
}

function beginOrbMotion() {
  const body = document.body;
  if (!body) return;
  wireOrbSkip();
  clearOrbAnimations();
  orbMotionToken++;
  if (orbIntroComplete) {
    body.classList.remove("orb-calculating", "orb-locking", "orb-revealing");
    body.classList.add("orb-refreshing");
    setOrbCaption("CALCULATING CONDITIONS");
    return;
  }
  if (!body.classList.contains("orb-calculating")) orbMotionStartedAt = Date.now();
  body.classList.remove("orb-locking", "orb-revealing", "orb-refreshing");
  body.classList.add("orb-calculating");
  setOrbCaption("CALCULATING CONDITIONS");
  armOrbWatchdog();
}

function dockOrbToLayout(body, token, duration, reduced) {
  const orb = document.getElementById("orbDial");
  const from = orb?.getBoundingClientRect?.();

  body.classList.remove("orb-locking");
  body.classList.add("orb-revealing");

  if (reduced || !orb?.animate || !from?.width || !from?.height) return;

  // One dial: the opening instrument flies into Today's 24-hour dial and hands
  // over to it, fading as it lands on the real (already sorted) dial. Both ends
  // are measured, so phone and desktop land exactly without hard-coded geometry.
  const cur = orb.getBoundingClientRect();
  const to = document.getElementById("dialFace")?.getBoundingClientRect?.();
  if (!cur.width || !cur.height || token !== orbMotionToken) return;
  const at = (r) => `translate(${r.left - cur.left}px,${r.top - cur.top}px) scale(${r.width / cur.width},${r.height / cur.height})`;
  const easing = "cubic-bezier(.16,1,.3,1)";
  const lands = to?.width && to.top < window.innerHeight;
  // Motion and fade are separate: it flies in over the first ~55% and then
  // dissolves into the real dial, rather than sitting on top of it.
  orbMotionAnimations.push(orb.animate(lands
    ? [
      { offset: 0, transformOrigin: "top left", transform: at(from), opacity: 1, easing },
      { offset: 0.55, transformOrigin: "top left", transform: at(to), opacity: 0.92 },
      { offset: 1, transformOrigin: "top left", transform: at(to), opacity: 0 },
    ]
    : [
      { transformOrigin: "top left", transform: at(from), opacity: 1 },
      { transformOrigin: "top left", transform: at(from), opacity: 0 },
    ], { duration, fill: "both" }));

  const revealTargets = document.querySelectorAll(
    ".masthead, .status-strip, .answer-card, .dial-section .section-title-block, .dial-instrument, .metric-bank, .window-plate, .briefing",
  );
  for (const target of revealTargets) {
    if (!target.animate) continue;
    orbMotionAnimations.push(target.animate([
      { opacity: 0, transform: "translateY(12px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: Math.max(1, duration - 80), delay: 80, easing, fill: "both" }));
  }
}

function resolveOrbMotion(label) {
  const body = document.body;
  if (!body) return;
  wireOrbSkip();
  if (orbIntroComplete) {
    orbMotionToken++;
    clearOrbAnimations();
    body.classList.remove("orb-refreshing", "orb-calculating", "orb-locking", "orb-revealing");
    setOrbCaption(label);
    return;
  }
  if (!body.classList.contains("orb-calculating")) beginOrbMotion();
  const token = ++orbMotionToken;
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  // Hold long enough for the opening dial to sort the day before it locks.
  const hold = reduced ? 0 : Math.max(1250 - (Date.now() - orbMotionStartedAt), OPENING_SORT_MS);
  const lockFor = reduced ? 40 : 720;
  const revealFor = reduced ? 40 : 680;

  window.setTimeout(() => {
    if (token !== orbMotionToken || body !== document.body) return;
    body.classList.remove("orb-calculating");
    body.classList.add("orb-locking");
    setOrbCaption(label);
  }, hold);
  window.setTimeout(() => {
    if (token !== orbMotionToken || body !== document.body) return;
    dockOrbToLayout(body, token, revealFor, reduced);
  }, hold + lockFor);
  window.setTimeout(() => {
    if (token !== orbMotionToken || body !== document.body) return;
    body.classList.remove("orb-revealing");
    clearOrbAnimations();
    clearOrbWatchdog();
    orbIntroComplete = true;
    markIntroSeen();
  }, hold + lockFor + revealFor);
}

export function setSignal(mode, text) {
  const dot = $("signalDot");
  if (dot) dot.className = "signal-dot" + (mode === "demo" || mode === "failed" ? " demo" : mode === "loading" ? " loading" : mode === "stale" ? " stale" : "");
  const t = $("signalText");
  if (t) t.textContent = text;
  orbDataLoading = mode === "loading";
  dialSignal(mode);
  if (orbDataLoading) beginOrbMotion();
  else {
    const motionLabel = mode === "ready" ? "SYSTEM READY"
      : mode === "failed" || (mode === "demo" && /FAILED|BLOCKED/i.test(text)) ? "SIGNAL UNAVAILABLE"
        : mode === "stale" ? "SAVED FORECAST LOCKED"
        : mode === "demo" ? "DEMO CONDITIONS LOCKED"
          : "CONDITIONS LOCKED";
    resolveOrbMotion(motionLabel);
  }
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}
export function showStatus(msg, head = "Something needs attention") {
  const el = $("statusText");
  if (el) el.textContent = msg;
  const h = $("statusHead");
  if (h) h.textContent = head;
  $("statusStrip")?.classList.add("show");
  announce(`${head}. ${msg}`);
}
export function hideStatus() { $("statusStrip")?.classList.remove("show"); }

/* ---------- the last good forecast ----------
   Saved after every live fetch so an offline glance still works. It comes
   back only for the same place and only while it still covers the hours
   ahead, and it is always labelled with its age (render.js, stale strip). */
const SNAPSHOT_KEY = "effort-last-forecast";
const SNAPSHOT_MAX_AGE_MS = 72 * 3600e3;
function saveSnapshot(snap) {
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap)); } catch { /* quota or private mode: no offline copy */ }
}
export function loadSnapshot(lat, lon) {
  try {
    const s = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");
    if (!s?.om?.hourly || !Number.isFinite(s.fetchedAt) || Date.now() - s.fetchedAt > SNAPSHOT_MAX_AGE_MS) return null;
    if (lat != null && (Math.abs(s.lat - lat) > 0.25 || Math.abs(s.lon - lon) > 0.25)) return null;
    return s;
  } catch { return null; }
}

/* Turn an Open-Meteo payload into app state. Shared by a live fetch and a
   restored copy: "now" is re-derived either way, so a saved forecast starts
   at the current hour, not at the hour it was fetched. */
function applyForecast(om, aq, { lat, lon, label, isHome = false, fetchedAt, restored = false }) {
  const { past, future: hours } = splitPastAndFuture(om);
  if (hours.length < 12) throw new Error("short forecast payload");

  // merge AQI by local-time key (best effort — the app works without it)
  try {
    if (aq?.hourly) {
      const map = new Map();
      (aq.hourly.time || []).forEach((t, i) => map.set(t, aq.hourly.us_aqi[i]));
      hours.forEach((h) => { const v = map.get(h.iso); if (v != null) h.aqi = v; });
    }
  } catch { /* AQI is optional */ }

  const th = trainingHours();
  S.pastHours = past;
  S.acclimationAuto = past.length >= 24 * 5
    ? acclimationIndex(past, { fromH: th.from, toH: th.to })
    : null;

  S.hours = hours;
  S.meta = {
    label,
    timezone: om.timezone || null,
    lat, lon,
    tz: om.timezone_abbreviation || "",
    sunrise: om.daily?.sunrise?.[0] ? hourLabelFull(om.daily.sunrise[0]) : "",
    sunset: om.daily?.sunset?.[0] ? hourLabelFull(om.daily.sunset[0]) : "",
    todayIso: hours[0].iso.slice(0, 10),
    demo: false,
    restored,
    fetchedAt,
    elevFt: om.elevation != null ? Math.round(om.elevation * 3.28084) : 0,
    // the next-hour radar nowcast is meaningless once it is hours old
    nowcast: !restored && om.minutely_15?.precipitation
      ? om.minutely_15.precipitation.slice(0, 4).map((v) => (v == null ? null : v))
      : null,
  };
  S.startIdx = 0;
  document.body?.classList.remove("no-forecast");

  // The first location you geolocate is home: it's where your pace baselines
  // were set, so altitude is scored relative to it rather than to sea level.
  if (isHome && S.meta.elevFt != null && S.profile.homeElevFt == null) {
    S.profile.homeElevFt = S.meta.elevFt;
    saveProfile();
  }
  const mast = $("mastLocation");
  if (mast) mast.textContent = label.toUpperCase();
}

const ageWords = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 90 ? `${m} MIN` : `${Math.round(m / 60)} H`; };

/* ---------- forecast ---------- */
let fetchToken = 0;

export async function loadForecast(lat, lon, label, { isHome = false, onReady } = {}) {
  const token = ++fetchToken;
  setSignal("loading", "FETCHING FORECAST…");
  hideStatus();
  try {
    const [res, aqRes] = await Promise.allSettled([
      fetchWithTimeout(OM_URL(lat, lon)),
      fetchWithTimeout(AQ_URL(lat, lon), {}, 8000),
    ]);
    if (res.status !== "fulfilled") throw res.reason;
    if (!res.value.ok) throw new Error("forecast fetch failed");
    const om = await res.value.json();
    let aq = null;
    try { if (aqRes.status === "fulfilled" && aqRes.value.ok) aq = await aqRes.value.json(); } catch { /* AQI is optional */ }
    if (token !== fetchToken) return;

    const fetchedAt = Date.now();
    applyForecast(om, aq, { lat, lon, label, isHome, fetchedAt });
    saveSnapshot({ om, aq: aq?.hourly ? { hourly: { time: aq.hourly.time, us_aqi: aq.hourly.us_aqi } } : null, lat, lon, label, fetchedAt });
    setSignal("live", `LIVE FORECAST / ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}`);
    onReady?.({ lat, lon });
  } catch (error) {
    if (token !== fetchToken) return;
    const cause = error?.name === "AbortError" ? "The forecast request timed out."
      : navigator.onLine === false ? "You're offline." : "Couldn't reach the forecast service.";
    // Name the place, never a stale "LOCATING…".
    const mast = $("mastLocation");
    if (mast) mast.textContent = (label || "Set location").toUpperCase();

    // Nothing live on screen: bring back the last good forecast for this place.
    if (!S.hours || S.meta?.restored) {
      const snap = loadSnapshot(lat, lon);
      if (snap) {
        try {
          applyForecast(snap.om, snap.aq, { lat: snap.lat, lon: snap.lon, label: snap.label || label, fetchedAt: snap.fetchedAt, restored: true });
          setSignal("stale", `SAVED FORECAST / ${ageWords(Date.now() - snap.fetchedAt)} OLD`);
          announce(`${cause} Showing the forecast saved ${ageWords(Date.now() - snap.fetchedAt).toLowerCase().replace(" h", " hours").replace(" min", " minutes")} ago.`);
          onReady?.({ lat, lon, restored: true });
          return;
        } catch { /* too old to cover the hours ahead: fall through */ }
      }
    }

    if (S.hours) {
      setSignal("stale", `LAST FORECAST / ${ageWords(Date.now() - (S.meta?.fetchedAt ?? Date.now()))} OLD`);
      showStatus(`${cause} You're seeing the last forecast that loaded.`, "Couldn't refresh");
    } else {
      document.body?.classList.add("no-forecast");
      setSignal("failed", "NO CONNECTION");
      showStatus(`${cause} Retry, or explore the app with demo data.`, "No forecast yet");
    }
  }
}

/* ---------- NWS alerts (US only; fails silently elsewhere) ---------- */
export async function loadAlerts(lat, lon) {
  const strip = $("alertStrip");
  strip?.classList.remove("show");
  if (lat < 17 || lat > 72 || lon < -180 || lon > -60) return;
  try {
    const res = await fetchWithTimeout(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(3)},${lon.toFixed(3)}`,
      { headers: { Accept: "application/geo+json" } },
      8000,
    );
    if (!res.ok) return;
    const data = await res.json();
    const feats = (data.features || []).slice(0, 2);
    if (!feats.length || !strip) return;
    strip.innerHTML = feats.map((f) => {
      const p = f.properties || {};
      return `<strong>⚠ NWS ${escHtml(p.event || "Alert")}</strong><p>${escHtml(p.headline || "")}</p>`;
    }).join("");
    strip.classList.add("show");
  } catch { /* alerts are a bonus */ }
}

/* ---------- geocoding ---------- */
export async function searchPlaces(q) {
  const res = await fetchWithTimeout(GEO_URL(q), {}, 8000);
  if (!res.ok) throw new Error("Place search unavailable");
  const j = await res.json();
  return j.results || [];
}

const STATE_ABBR = { "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY" };
export const stateAbbr = (name) => STATE_ABBR[name] || name;

export async function reverseGeocode(lat, lon) {
  const fallback = `${lat.toFixed(2)}° / ${lon.toFixed(2)}°`;
  try {
    const res = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10`,
      {},
      8000,
    );
    if (!res.ok) return fallback;
    const j = await res.json();
    const a = j.address || {};
    const town = a.city || a.town || a.village || a.hamlet || j.name;
    if (!town) return fallback;
    return `${town}, ${a.state ? stateAbbr(a.state) : (a.country_code || "").toUpperCase()}`;
  } catch { return fallback; }
}

/* ---------- demo dataset (July heat, 8 days) ---------- */
export function demoData() {
  const hours = [];
  const today = new Date();
  const dayTemps = [86, 88, 91, 78, 74, 83, 89, 90];
  for (let d = 0; d < dayTemps.length; d++) {
    for (let hh = 0; hh < 24; hh++) {
      const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d, hh);
      const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}T${String(hh).padStart(2, "0")}:00`;
      const peak = dayTemps[d];
      const temp = Math.round(peak - 14 + 14 * Math.max(0, Math.sin(((hh - 5) / 24) * 2 * Math.PI)) - (hh < 5 ? 2 : 0));
      const dew = d === 3 || d === 4 ? 52 : 68 + (d % 3);
      const rh = clamp(100 - (temp - dew) * 3.2, 25, 100);
      const solar = hh >= 6 && hh <= 20 ? Math.max(0, Math.sin(((hh - 6) / 14) * Math.PI)) * 900 : 0;
      const wind = 3 + (hh >= 10 && hh <= 18 ? (hh - 9) * 0.8 : 0);
      const storm = d === 2 && hh >= 14 && hh <= 19 ? 65 : 5;
      hours.push({
        iso, epoch: dt.getTime(), aqi: 42 + (hh >= 12 && hh <= 18 ? (hh - 11) * 8 : 0),
        temp, dew: r1(dew), rh: Math.round(rh), feels: temp + (dew > 65 ? 4 : 0),
        precipProb: storm, code: storm > 55 ? 95 : 1,
        wind: r1(wind), gust: r1(wind * 1.6),
        solar: Math.round(solar), uv: r1(solar / 110),
        isDay: hh >= 6 && hh <= 20,
        wbgt: estWbgtF(temp, rh, solar, wind),
      });
    }
  }
  const nowH = new Date().getHours();
  const future = hours.slice(nowH);
  const past = [];
  for (let d = 14; d >= 1; d--) {
    for (let hh = 6; hh <= 20; hh++) {
      const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() - d, hh);
      const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}T${String(hh).padStart(2, "0")}:00`;
      const temp = Math.round(70 + 12 * Math.max(0, Math.sin(((hh - 5) / 24) * 2 * Math.PI)));
      past.push({ iso, epoch: dt.getTime(), temp, dew: 66, rh: 70, wind: 5, solar: hh >= 6 && hh <= 20 ? 650 : 0 });
    }
  }
  return {
    hours: future,
    past,
    meta: {
      label: "DEMO / FLETCHER, NC", tz: "", sunrise: "6:18 AM", sunset: "8:44 PM",
      demo: true, fetchedAt: Date.now(), elevFt: 2140,
      todayIso: future[0].iso.slice(0, 10), nowcast: null,
    },
  };
}

export function loadDemo() {
  document.body?.classList.remove("no-forecast");
  const d = demoData();
  const th = trainingHours();
  S.hours = d.hours;
  S.pastHours = d.past;
  S.acclimationAuto = acclimationIndex(d.past, { fromH: th.from, toH: th.to });
  S.meta = d.meta;
  S.startIdx = 0;
  setSignal("demo", "DEMO FORECAST / SAMPLE JULY HEAT");
  const mast = $("mastLocation");
  if (mast) mast.textContent = "FLETCHER, NC / DEMO";
  hideStatus();
}

/* ---------- freshness ---------- */
export function forecastAgeMinutes() {
  if (!S.meta?.fetchedAt) return null;
  return Math.max(0, Math.round((Date.now() - S.meta.fetchedAt) / 60000));
}
