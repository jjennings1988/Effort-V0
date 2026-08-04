/* Precipitation radar: RainViewer frames on a Leaflet map, loaded lazily from
   a CDN so the app shell stays dependency-free. */

import { clamp } from "../engine.js";
import { S } from "./state.js";
import { $ } from "./dom.js";

const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";
const LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";

const R = { map: null, layers: [], frames: [], nowIdx: 0, idx: 0, timer: null, marker: null, ready: null };

function loadAsset(tag, attrs) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag);
    Object.assign(el, attrs);
    el.onload = resolve;
    el.onerror = () => reject(new Error("asset failed"));
    document.head.appendChild(el);
    setTimeout(() => reject(new Error("asset timeout")), 15000);
  });
}
function ensureLeaflet() {
  if (!R.ready) {
    R.ready = Promise.all([
      loadAsset("link", { rel: "stylesheet", href: LEAFLET_CSS }),
      loadAsset("script", { src: LEAFLET_JS }),
    ]);
  }
  return R.ready;
}

export async function initRadar(lat, lon) {
  const unavail = $("radarUnavail");
  if (!unavail) return;
  unavail.hidden = false;
  unavail.textContent = "RADAR LOADING…";
  try {
    await ensureLeaflet();
    if (typeof window.L === "undefined") throw new Error("leaflet unavailable");
    const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
    if (!res.ok) throw new Error("rainviewer " + res.status);
    const j = await res.json();
    const past = (j.radar?.past || []).slice(-7);
    const nowcast = j.radar?.nowcast || [];
    if (!past.length) throw new Error("no radar frames");
    R.frames = [...past, ...nowcast];
    R.nowIdx = past.length - 1;

    const L = window.L;
    if (!R.map) {
      R.map = L.map("radarMap", { scrollWheelZoom: false, attributionControl: false, zoomSnap: 0.5 }).setView([lat, lon], 8);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { className: "base-tiles", maxZoom: 12 }).addTo(R.map);
    } else {
      R.map.setView([lat, lon], 8);
    }
    if (R.marker) R.map.removeLayer(R.marker);
    R.marker = L.circleMarker([lat, lon], { radius: 6, color: "#101310", weight: 2, fillColor: "#cfff18", fillOpacity: 1 }).addTo(R.map);

    R.layers.forEach((l) => R.map.removeLayer(l));
    R.layers = R.frames.map((f) =>
      L.tileLayer(`${j.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, { opacity: 0, maxZoom: 12, zIndex: 400 }).addTo(R.map));

    const scrub = $("radarScrub");
    if (scrub) scrub.max = String(R.frames.length - 1);
    setRadarFrame(R.nowIdx);
    unavail.hidden = true;
  } catch {
    stopRadarLoop();
    unavail.hidden = false;
    unavail.textContent = "RADAR UNAVAILABLE / CHECK CONNECTION";
  }
}

export function setRadarFrame(i) {
  R.idx = clamp(i, 0, Math.max(0, R.frames.length - 1));
  R.layers.forEach((l, k) => l.setOpacity(k === R.idx ? 0.7 : 0));
  const scrub = $("radarScrub");
  if (scrub) scrub.value = String(R.idx);
  const d = (R.idx - R.nowIdx) * 10;
  const out = $("radarTime");
  if (out) out.textContent = d === 0 ? "NOW" : d < 0 ? `−${-d} MIN` : `+${d} MIN`;
}

export function stopRadarLoop() {
  if (R.timer) { clearInterval(R.timer); R.timer = null; }
  const b = $("radarPlay");
  if (b) b.innerHTML = "&#9654;";
}

export function toggleRadarLoop() {
  if (R.timer) { stopRadarLoop(); return; }
  if (!R.layers.length) return;
  const b = $("radarPlay");
  if (b) b.innerHTML = "&#10073;&#10073;";
  R.timer = setInterval(() => setRadarFrame(R.idx + 1 > R.frames.length - 1 ? 0 : R.idx + 1), 650);
}

export function renderNowcast() {
  const chip = $("nowcastChip");
  if (!chip) return;
  const nc = S.meta?.nowcast;
  if (!nc || nc.every((v) => v == null)) {
    chip.textContent = "NEXT 60 MIN: N/A";
    chip.classList.remove("wet");
    return;
  }
  const firstWet = nc.findIndex((v) => (v ?? 0) >= 0.1);
  if (firstWet === -1) {
    chip.textContent = "NEXT 60 MIN: DRY";
    chip.classList.remove("wet");
    return;
  }
  const peak = Math.max(...nc.map((v) => v ?? 0));
  const intensity = peak >= 2 ? "HEAVY RAIN" : peak >= 0.5 ? "RAIN" : "LIGHT RAIN";
  chip.textContent = firstWet === 0 ? `${intensity} NOW` : `${intensity} ~${firstWet * 15} MIN`;
  chip.classList.add("wet");
}
