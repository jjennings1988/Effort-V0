/* Every input in the app: workout controls, athlete profile, location search,
   view tabs, calendar export, and profile import/export. */

import { clamp } from "../engine.js";
import {
  S, saveProfile, exportProfile, importProfile, resetProfile,
  RIBBON_METRICS, markHintSeen,
} from "./state.js";
import { $, $$, escHtml } from "./dom.js";
import { requestRender, onSyncControls } from "./bus.js";
import {
  loadForecast, loadAlerts, loadDemo, searchPlaces, reverseGeocode, stateAbbr,
  setSignal, showStatus,
} from "./data.js";
import { initRadar, toggleRadarLoop, stopRadarLoop, setRadarFrame, refreshRadarSize } from "./radar.js";
import { wireRace } from "./race.js";
import { wireProfile, renderProfile } from "./profile.js";
import { wireSetup } from "./setup.js";
import { wireFeedback } from "./feedback.js";
import { wireBriefing } from "./briefing.js";

/* ---------- generic segmented control ---------- */
function segmented(id, attr, apply) {
  const host = $(id);
  if (!host) return;
  host.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    apply(b.dataset[attr]);
    host.querySelectorAll("button").forEach((x) => {
      const on = x === b;
      x.classList.toggle("active", on);
      x.setAttribute("aria-pressed", String(on));
    });
    requestRender();
  });
}

/* ---------- location ---------- */
function afterForecast({ lat, lon }) {
  requestRender();
  loadAlerts(lat, lon);
  initRadar(lat, lon);
}

function useGeolocation() {
  if (!navigator.geolocation) {
    showStatus("Geolocation isn't available in this browser. Search a city instead.");
    return;
  }
  setSignal("loading", "LOCATING…");
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lon } = pos.coords;
    const label = await reverseGeocode(lat, lon);
    S.profile.location = { lat, lon, label };
    saveProfile();
    const bar = $("locbar");
    if (bar) { bar.hidden = true; $("mastLocation")?.setAttribute("aria-expanded", "false"); }
    loadForecast(lat, lon, label, { isHome: true, onReady: afterForecast });
  }, () => {
    setSignal("demo", "LOCATION BLOCKED");
    showStatus("Location permission was denied. Search a city, or explore with demo data.");
  }, { timeout: 12000, maximumAge: 600000 });
}

/* The location controls used to occupy a permanent strip at the top of every
   screen, for something most athletes set once. Now they live behind the
   location name in the masthead. */
function wireLocationDrawer() {
  const toggle = $("mastLocation"), bar = $("locbar");
  if (!toggle || !bar) return;
  const setOpen = (open) => {
    bar.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) $("locInput")?.focus();
  };
  toggle.addEventListener("click", () => setOpen(bar.hidden));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !bar.hidden) { setOpen(false); toggle.focus(); }
  });
  return setOpen;
}

let searchTimer = null;
function wireSearch() {
  const input = $("locInput"), results = $("locResults");
  if (!input || !results) return;
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { results.innerHTML = ""; return; }
    searchTimer = setTimeout(async () => {
      try {
        const items = await searchPlaces(q);
        results.innerHTML = items.map((r, i) =>
          `<button type="button" data-i="${i}">${escHtml(r.name)}${r.admin1 ? ", " + escHtml(r.admin1) : ""} · ${escHtml(r.country_code || "")}</button>`).join("");
        results.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
          const r = items[Number(b.dataset.i)];
          const label = `${r.name}, ${r.admin1 ? stateAbbr(r.admin1) : r.country_code}`;
          S.profile.location = { lat: r.latitude, lon: r.longitude, label };
          saveProfile();
          results.innerHTML = "";
          input.value = "";
          const bar = $("locbar");
          if (bar) { bar.hidden = true; $("mastLocation")?.setAttribute("aria-expanded", "false"); }
          loadForecast(r.latitude, r.longitude, label, { onReady: afterForecast });
        }));
      } catch { results.innerHTML = ""; }
    }, 320);
  });
  document.addEventListener("click", (e) => {
    if (!results.contains(e.target) && e.target !== input) results.innerHTML = "";
  });
}

/* ---------- view tabs ---------- */
function wireViews() {
  const tabs = $("viewTabs");
  if (!tabs) return;
  const apply = () => {
    $$("[data-view-panel]").forEach((el) => { el.hidden = el.dataset.viewPanel !== S.view; });
    tabs.querySelectorAll("button").forEach((b) => {
      const on = b.dataset.view === S.view;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
  };
  tabs.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (S.view === b.dataset.view) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    S.view = b.dataset.view;
    apply();
    requestRender();
    if (S.view === "today") refreshRadarSize();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  apply();
}

/* ---------- calendar export ---------- */
function downloadIcs() {
  if (!S.hours) return;
  const h = S.hours[S.startIdx];
  const [y, mo, d] = [Number(h.iso.slice(0, 4)), Number(h.iso.slice(5, 7)), Number(h.iso.slice(8, 10))];
  const hh = Number(h.iso.slice(11, 13));
  const start = new Date(y, mo - 1, d, hh, 0, 0);
  const end = new Date(start.getTime() + S.duration * 60000);
  const compact = (dt) =>
    `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}T${String(dt.getHours()).padStart(2, "0")}${String(dt.getMinutes()).padStart(2, "0")}00`;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const title = `${S.sport === "run" ? "Run" : "Ride"} — ${S.intensity} ${S.duration} min (EffortCast)`;
  const desc = `Planned with EffortCast.\\nAdjustment: ${$("adjustment").textContent}\\nStart: ${Math.round(h.temp)}F / dew ${Math.round(h.dew)}F / est. WBGT ${h.wbgt}F${h.aqi != null ? ` / AQI ${Math.round(h.aqi)}` : ""}`;
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Effort//Athlete Weather//EN", "BEGIN:VEVENT",
    `UID:effort-${Date.now()}@effort.app`, `DTSTAMP:${stamp}`, `DTSTART:${compact(start)}`, `DTEND:${compact(end)}`,
    `SUMMARY:${title}`, `DESCRIPTION:${desc}`,
    `LOCATION:${(S.profile.location?.label || S.meta.label || "").replace(/,/g, "\\,")}`,
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  downloadBlob(ics, "text/calendar;charset=utf-8", "effort-workout.ics");
}

function downloadBlob(text, type, filename) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch { /* download blocked */ }
}

/* ---------- profile import / export ---------- */
function wireProfileIo() {
  $("profileExport")?.addEventListener("click", () => {
    downloadBlob(exportProfile(), "application/json", "effortcast-profile.json");
  });
  $("profileImport")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const note = $("profileNote");
    try {
      importProfile(await file.text());
      if (note) note.textContent = "PROFILE IMPORTED — RELOADING FORECAST";
      const loc = S.profile.location;
      if (loc) loadForecast(loc.lat, loc.lon, loc.label, { onReady: afterForecast });
      else requestRender();
    } catch {
      if (note) note.textContent = "THAT FILE DIDN'T LOOK LIKE AN EFFORTCAST PROFILE";
    }
    e.target.value = "";
  });
  $("profileReset")?.addEventListener("click", () => {
    if (!window.confirm("Reset paces, race, feedback and settings to defaults? This cannot be undone.")) return;
    resetProfile();
    location.reload();
  });
}

/* ---------- boot wiring ---------- */
export function wireControls() {
  segmented("sportCtl", "sport", (v) => { S.sport = v; });
  segmented("intentCtl", "intent", (v) => { S.intensity = v; });
  segmented("durCtl", "dur", (v) => { S.duration = Number(v); });
  segmented("structCtl", "struct", (v) => { S.structure = v; });
  segmented("terrainCtl", "terrain", (v) => { S.profile.terrain = v; saveProfile(); });
  segmented("ribbonMetricCtl", "metric", (v) => {
    if (RIBBON_METRICS.includes(v)) { S.profile.ribbonMetric = v; saveProfile(); }
  });

  const fromSel = $("hoursFrom"), toSel = $("hoursTo");
  if (fromSel && toSel) {
    const hLabel = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
    for (let h = 0; h < 24; h++) {
      fromSel.insertAdjacentHTML("beforeend", `<option value="${h}">${hLabel(h)}</option>`);
      toSel.insertAdjacentHTML("beforeend", `<option value="${h}">${hLabel(h)}</option>`);
    }
    fromSel.value = String(S.profile.trainingHours.from);
    toSel.value = String(S.profile.trainingHours.to);
    fromSel.addEventListener("change", () => {
      S.profile.trainingHours.from = Number(fromSel.value); saveProfile(); requestRender();
    });
    toSel.addEventListener("change", () => {
      S.profile.trainingHours.to = Number(toSel.value); saveProfile(); requestRender();
    });
  }

  $("acclSlider")?.addEventListener("input", (e) => {
    S.profile.acclimation = { mode: "manual", manual: clamp(Number(e.target.value) / 100, 0, 1) };
    saveProfile(); requestRender();
  });
  $("acclAutoBtn")?.addEventListener("click", () => {
    S.profile.acclimation = { ...S.profile.acclimation, mode: "auto" };
    saveProfile(); requestRender();
  });

  $("start-time")?.addEventListener("input", (e) => { S.startIdx = Number(e.target.value); requestRender(); });
  $("useWindowBtn")?.addEventListener("click", () => {
    if (!S.bestWindow) return;
    S.startIdx = clamp(S.bestWindow.idx, 0, Number($("start-time").max));
    requestRender();
    $("readout")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("icsBtn")?.addEventListener("click", downloadIcs);
  $("radarPlay")?.addEventListener("click", toggleRadarLoop);
  $("radarScrub")?.addEventListener("input", (e) => { stopRadarLoop(); setRadarFrame(Number(e.target.value)); });
  $("geoBtn")?.addEventListener("click", useGeolocation);
  $("retryBtn")?.addEventListener("click", () => {
    const loc = S.profile.location;
    if (loc) loadForecast(loc.lat, loc.lon, loc.label, { onReady: afterForecast });
    else useGeolocation();
  });
  $("demoBtn")?.addEventListener("click", () => {
    loadDemo();
    requestRender();
    const loc = S.profile.location;
    initRadar(loc?.lat ?? 35.43, loc?.lon ?? -82.5);
  });
  $("strainHintDismiss")?.addEventListener("click", () => { markHintSeen("strain"); requestRender(); });
  $("errorReload")?.addEventListener("click", () => location.reload());
  $("staleRefresh")?.addEventListener("click", () => {
    const loc = S.profile.location;
    if (loc) loadForecast(loc.lat, loc.lon, loc.label, { onReady: afterForecast });
  });

  wireProfile();
  wireLocationDrawer();
  wireSearch();
  wireViews();
  wireRace();
  wireFeedback();
  wireProfileIo();
  wireBriefing(() => requestRender());
  onSyncControls(renderProfile);
  renderProfile();
  wireSetup(() => { if (!S.profile.location) useGeolocation(); });

  return { useGeolocation, afterForecast };
}
