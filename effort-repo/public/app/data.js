/* Network layer: Open-Meteo forecast + history, air quality, geocoding, NWS
   alerts, and the offline demo dataset. Nothing here touches the model. */

import {
  clamp, r1, estWbgtF, splitPastAndFuture,
  acclimationIndex, hourLabelFull,
} from "../engine.js";
import { S, saveProfile, trainingHours } from "./state.js";
import { $, escHtml } from "./dom.js";
import { dialSignal } from "./dial.js";

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
let orbIntroComplete = false;
let orbDataLoading = true;
const ORB_INTRO_MAX_MS = 6000;

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
  const orb = document.querySelector(".orb-field");
  const from = orb?.getBoundingClientRect?.();

  body.classList.remove("orb-locking");
  body.classList.add("orb-revealing");

  if (reduced || !orb?.animate || !from?.width || !from?.height) return;

  // FLIP the same instrument from its full-screen reading to its real layout
  // position. The destination is measured, so phone and desktop land exactly
  // where their responsive layouts place the orb without hard-coded geometry.
  const to = orb.getBoundingClientRect();
  if (!to.width || !to.height || token !== orbMotionToken) return;
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  const easing = "cubic-bezier(.16,1,.3,1)";

  orbMotionAnimations.push(orb.animate([
    { transformOrigin: "top left", transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` },
    { transformOrigin: "top left", transform: "translate(0,0) scale(1,1)" },
  ], { duration, easing, fill: "both" }));

  const revealTargets = document.querySelectorAll(
    ".masthead, .status-strip, .answer-card, .poster-brand, .metric-bank, .window-plate, .briefing",
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
  const hold = reduced ? 0 : Math.max(0, 1250 - (Date.now() - orbMotionStartedAt));
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
  }, hold + lockFor + revealFor);
}

export function setSignal(mode, text) {
  const dot = $("signalDot");
  if (dot) dot.className = "signal-dot" + (mode === "demo" ? " demo" : mode === "loading" ? " loading" : "");
  const t = $("signalText");
  if (t) t.textContent = text;
  orbDataLoading = mode === "loading";
  dialSignal(mode);
  if (orbDataLoading) beginOrbMotion();
  else {
    const motionLabel = mode === "ready" ? "SYSTEM READY"
      : mode === "demo" && /FAILED|BLOCKED/i.test(text) ? "SIGNAL UNAVAILABLE"
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
export function showStatus(msg) {
  const el = $("statusText");
  if (el) el.textContent = msg;
  $("statusStrip")?.classList.add("show");
}
export function hideStatus() { $("statusStrip")?.classList.remove("show"); }

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
    if (token !== fetchToken) return;

    const { past, future: hours } = splitPastAndFuture(om);
    if (hours.length < 12) throw new Error("short forecast payload");

    // merge AQI by local-time key (best effort — the app works without it)
    try {
      if (aqRes.status === "fulfilled" && aqRes.value.ok) {
        const aq = await aqRes.value.json();
        const map = new Map();
        (aq.hourly?.time || []).forEach((t, i) => map.set(t, aq.hourly.us_aqi[i]));
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
      fetchedAt: Date.now(),
      elevFt: om.elevation != null ? Math.round(om.elevation * 3.28084) : 0,
      nowcast: om.minutely_15?.precipitation
        ? om.minutely_15.precipitation.slice(0, 4).map((v) => (v == null ? null : v))
        : null,
    };
    S.startIdx = 0;

    // The first location you geolocate is home: it's where your pace baselines
    // were set, so altitude is scored relative to it rather than to sea level.
    if (isHome && S.meta.elevFt != null && S.profile.homeElevFt == null) {
      S.profile.homeElevFt = S.meta.elevFt;
      saveProfile();
    }

    setSignal("live", `LIVE FORECAST / ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()}`);
    const mast = $("mastLocation");
    if (mast) mast.textContent = label.toUpperCase();
    onReady?.({ lat, lon });
  } catch (error) {
    if (token !== fetchToken) return;
    setSignal("demo", "CONNECTION FAILED");
    showStatus(error?.name === "AbortError"
      ? "The forecast request timed out. Retry, or explore with demo data."
      : "Couldn't reach the forecast service. Retry, or explore with demo data.");
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
