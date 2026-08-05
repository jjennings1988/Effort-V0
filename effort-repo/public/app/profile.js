/* The profile view.

   Split by how often a thing changes, not by what kind of thing it is. Sport,
   intent, duration and start time change every session and stay on Today.
   Paces, body, training hours, terrain and the acclimatisation *control* change
   almost never and live here.

   The acclimatisation *reading* deliberately stays in This Week: it changes
   daily and it is the app's most distinctive output. Move the knob, keep the
   gauge. */

import { acclimationLabel, DEFAULT_PACES, parsePace } from "../engine.js";
import {
  S, saveProfile, effectiveAcclimation, bias,
} from "./state.js";
import { $, $$ } from "./dom.js";
import { requestRender } from "./bus.js";
import {
  unit, paceUnit, paceInputValue, parsePaceInput,
  massValue, massUnit, massToKg, elevation,
} from "./units.js";

/* ---------- release notes ----------
   Shown once per build, inline, never as an interstitial. Interrupting someone
   who opened the app at 5am to check whether they should run is hostile.
   The one exception is a model recalibration, which changes their numbers —
   flag those with `recalibration: true` and the note is pinned until read. */
export const RELEASE_NOTES = [
  {
    build: "2026.08.06-1",
    recalibration: false,
    lines: [
      "Each tab now opens on its own content. Today keeps the forecast hero; Week opens straight on the planner; You opens straight on your settings.",
      "Radar fixed — RainViewer caps tiles at zoom 7, so the map was asking for tiles that do not exist.",
    ],
  },
  {
    build: "2026.08.05-2",
    recalibration: false,
    lines: [
      "New PROFILE tab — paces, body, training hours and heat settings all live here now.",
      "Units are three separate switches: temperature, distance and weight. °C with miles is a normal combination and now a supported one.",
      "First-run setup, so your very first projection uses your paces rather than ours.",
    ],
  },
];

export function currentBuild() {
  return document.documentElement.dataset.build || "dev";
}

export function pendingRelease() {
  const note = RELEASE_NOTES.find((n) => n.build === currentBuild());
  if (!note) return null;
  return S.profile.seenBuild === note.build ? null : note;
}

export function dismissRelease() {
  S.profile.seenBuild = currentBuild();
  saveProfile();
}

/* ---------- unit toggles ----------
   Shared by the profile panel and the setup overlay. */
export function syncUnitControls(hostId) {
  const host = $(hostId);
  if (!host) return;
  host.querySelectorAll("button[data-field]").forEach((b) => {
    const on = b.dataset.value === unit(b.dataset.field);
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

export function wireUnitControls(hostId, onChange) {
  const host = $(hostId);
  if (!host) return;
  host.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-field]");
    if (!b) return;
    // Start from the resolved defaults so setting one field does not leave the
    // other two undefined and silently locale-dependent.
    S.profile.units = {
      temperature: unit("temperature"),
      distance: unit("distance"),
      weight: unit("weight"),
      [b.dataset.field]: b.dataset.value,
    };
    saveProfile();
    syncUnitControls(hostId);
    onChange?.();
  });
}

/* ---------- pace fields ---------- */
export function buildPaceFields() {
  const container = $("paceProfile");
  const resultEl = container?.querySelector(".pace-profile-result");
  if (!container || !resultEl || container.querySelector(".pace-field")) return;

  ["Easy", "Steady", "Hard", "Race"].forEach((k) => {
    const label = document.createElement("label");
    label.className = "pace-field";
    label.dataset.pace = k;
    label.innerHTML = `
      <span>${k === "Hard" ? "HARD / TEMPO" : k.toUpperCase()}</span>
      <div><input aria-label="${k} pace" inputmode="numeric" /><small class="pace-unit">${paceUnit()}</small></div>
      <em>PROFILE PACE</em>`;
    const input = label.querySelector("input");
    input.addEventListener("input", () => {
      const clean = input.value.replace(/[^0-9:]/g, "").slice(0, 5);
      input.value = clean;
      const canonical = parsePaceInput(clean);
      input.setAttribute("aria-invalid", canonical == null ? "true" : "false");
      if (canonical != null) {
        S.profile.paces[k] = new Date(canonical * 1000).toISOString().slice(14, 19);
        saveProfile();
        requestRender();
      }
    });
    input.addEventListener("blur", () => {
      const canonical = parsePaceInput(input.value) ?? parsePace(S.profile.paces[k]) ?? parsePace(DEFAULT_PACES[k]);
      S.profile.paces[k] = new Date(canonical * 1000).toISOString().slice(14, 19);
      input.value = paceInputValue(canonical);
      input.setAttribute("aria-invalid", "false");
      saveProfile();
      requestRender();
    });
    container.insertBefore(label, resultEl);
  });
}

/* ---------- render ---------- */
export function renderProfile() {
  if (!$("profileSection")) return;

  // paces — reformatted whenever units change
  $$(".pace-field").forEach((f) => {
    const key = f.dataset.pace;
    const input = f.querySelector("input");
    const seconds = parsePace(S.profile.paces[key]);
    if (document.activeElement !== input) input.value = paceInputValue(seconds);
    input.placeholder = paceInputValue(parsePace(DEFAULT_PACES[key]));
    const unit = f.querySelector(".pace-unit");
    if (unit) unit.textContent = paceUnit();
    const active = key === S.intensity && S.sport === "run";
    f.classList.toggle("active", active);
    f.querySelector("em").textContent = active ? "ACTIVE BASELINE" : "PROFILE PACE";
  });

  const host = $("paceProfile");
  if (host) host.classList.toggle("inactive", S.sport === "ride");
  const hint = $("paceHint");
  if (hint) {
    hint.textContent = S.sport === "run"
      ? `${S.intensity.toUpperCase()} PACE DRIVES TODAY'S PROJECTION`
      : "SELECT RUN ON THE TODAY TAB TO APPLY THESE BASELINES";
  }

  // units — three independent settings
  syncUnitControls("unitsCtl");

  // body mass
  const mass = $("massInput");
  if (mass && document.activeElement !== mass) mass.value = massValue(S.profile.massKg ?? 70);
  const massU = $("massUnit");
  if (massU) massU.textContent = massUnit();

  // home elevation — set automatically, shown so it is not a mystery
  const homeEl = $("homeElev");
  if (homeEl) {
    homeEl.textContent = S.profile.homeElevFt == null
      ? "NOT SET — USE MY LOCATION TO CAPTURE IT"
      : elevation(S.profile.homeElevFt);
  }

  // training hours
  const from = $("hoursFrom"), to = $("hoursTo");
  if (from) from.value = String(S.profile.trainingHours.from);
  if (to) to.value = String(S.profile.trainingHours.to);

  // terrain
  $$("#terrainCtl button").forEach((b) => {
    const on = b.dataset.terrain === S.profile.terrain;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });

  // acclimatisation control
  const slider = $("acclSlider");
  if (slider) {
    const v = effectiveAcclimation();
    slider.value = String(Math.round(v * 100));
    $("acclOut").textContent = acclimationLabel(v).toUpperCase();
    const isAuto = S.profile.acclimation.mode === "auto";
    const autoBtn = $("acclAutoBtn");
    autoBtn.classList.toggle("active", isAuto);
    autoBtn.setAttribute("aria-pressed", String(isAuto));
    $("acclSourceNote").textContent = S.acclimationAuto == null
      ? "NO HISTORY YET"
      : `LAST 14 DAYS READ ${acclimationLabel(S.acclimationAuto).toUpperCase()}`;
    $("acclHint").textContent = isAuto
      ? "READ FROM THE WEATHER YOU HAVE ACTUALLY BEEN TRAINING IN. THE DAILY READING LIVES IN THIS WEEK."
      : "MANUAL OVERRIDE. TAP AUTOMATIC TO GO BACK TO READING YOUR OWN WEATHER.";
  }

  // calibration summary
  const b = bias();
  const cal = $("profileCalibration");
  if (cal) {
    cal.textContent = b.ready
      ? `${b.label}. Heat projections are scaled ×${b.multiplier} for you, from ${b.samples} logged workouts.`
      : `Not enough data yet — ${b.samples} of 6 workouts logged. Rate a few runs on the Today tab and the heat model starts calibrating to you specifically.`;
  }

  // release note
  const note = pendingRelease();
  const noteEl = $("releaseNote");
  if (noteEl) {
    noteEl.hidden = !note;
    if (note) {
      $("releaseBuild").textContent = note.build;
      $("releaseList").innerHTML = note.lines.map((l) => `<li>${l}</li>`).join("");
    }
  }

  const stamp = $("profileBuild");
  if (stamp) stamp.textContent = currentBuild();
}

/* ---------- wiring ---------- */
export function wireProfile() {
  buildPaceFields();

  wireUnitControls("unitsCtl", () => requestRender());

  const mass = $("massInput");
  mass?.addEventListener("change", () => {
    const kg = massToKg(mass.value);
    if (kg == null) { mass.value = massValue(S.profile.massKg ?? 70); return; }
    S.profile.massKg = Math.min(200, Math.max(30, kg));
    saveProfile();
    requestRender();
  });

  $("releaseDismiss")?.addEventListener("click", () => {
    dismissRelease();
    requestRender();
  });
}
