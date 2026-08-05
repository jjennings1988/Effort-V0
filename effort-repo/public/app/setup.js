/* First-run setup.

   Not a feature tour. A tour teaches nothing and gets dismissed; the real
   problem on first launch is that the app gives a *wrong* answer — the default
   paces are 8:00/7:30/7:00/6:30, which belong to nobody. Three questions and
   the first screen the athlete sees is correct.

   Everything here is skippable. Nothing is asked that the model does not use. */

import { parsePace, DEFAULT_PACES } from "../engine.js";
import { S, saveProfile } from "./state.js";
import { $, $$ } from "./dom.js";
import { requestRender } from "./bus.js";
import { paceUnit, paceInputValue, parsePaceInput } from "./units.js";
import { currentBuild, syncUnitControls, wireUnitControls } from "./profile.js";

const STEPS = ["units", "pace", "hours"];
let step = 0;
let onLocate = null;

export function needsSetup() {
  return !S.profile.setupDone;
}

function show() {
  const overlay = $("setupOverlay");
  if (!overlay) return;
  overlay.hidden = false;
  STEPS.forEach((name, i) => {
    const panel = $(`setupStep-${name}`);
    if (panel) panel.hidden = i !== step;
  });
  $("setupProgress").textContent = `${step + 1} / ${STEPS.length}`;
  $$("#setupDots span").forEach((d, i) => d.classList.toggle("on", i <= step));
  $("setupBack").hidden = step === 0;
  $("setupNext").textContent = step === STEPS.length - 1 ? "START" : "NEXT";

  // keep each step's inputs in sync with whatever is already stored
  syncUnitControls("setupUnitsCtl");
  const paceInput = $("setupPace");
  if (paceInput) {
    paceInput.placeholder = paceInputValue(parsePace(DEFAULT_PACES.Easy));
    $("setupPaceUnit").textContent = paceUnit();
    if (!paceInput.value) paceInput.value = paceInputValue(parsePace(S.profile.paces.Easy));
  }
  const from = $("setupFrom"), to = $("setupTo");
  if (from) from.value = String(S.profile.trainingHours.from);
  if (to) to.value = String(S.profile.trainingHours.to);
}

function commitStep() {
  const name = STEPS[step];
  if (name === "pace") {
    const seconds = parsePaceInput($("setupPace").value);
    if (seconds) {
      // Derive the other three from the easy pace using conventional offsets, so
      // the athlete answers one question instead of four. All editable later.
      S.profile.paces = {
        Easy: fmt(seconds),
        Steady: fmt(Math.round(seconds * 0.94)),
        Hard: fmt(Math.round(seconds * 0.88)),
        Race: fmt(Math.round(seconds * 0.82)),
      };
    }
  }
  if (name === "hours") {
    S.profile.trainingHours = {
      from: Number($("setupFrom").value),
      to: Number($("setupTo").value),
    };
  }
  saveProfile();
}

function fmt(totalSeconds) {
  const t = Math.round(totalSeconds);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export function finishSetup() {
  commitStep();
  S.profile.setupDone = true;
  // A brand-new athlete has not missed any release notes.
  S.profile.seenBuild = currentBuild();
  saveProfile();
  const overlay = $("setupOverlay");
  if (overlay) overlay.hidden = true;
  requestRender();
  onLocate?.();
}

export function wireSetup(locateFn) {
  onLocate = locateFn;
  const overlay = $("setupOverlay");
  if (!overlay) return;

  wireUnitControls("setupUnitsCtl", show);

  $("setupNext")?.addEventListener("click", () => {
    commitStep();
    if (step === STEPS.length - 1) { finishSetup(); return; }
    step++;
    show();
  });
  $("setupBack")?.addEventListener("click", () => {
    if (step > 0) { step--; show(); }
  });
  $("setupSkip")?.addEventListener("click", finishSetup);

  $("setupPace")?.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^0-9:]/g, "").slice(0, 5);
  });

  // populate the hour selects
  for (const id of ["setupFrom", "setupTo"]) {
    const sel = $(id);
    if (!sel || sel.options.length) continue;
    for (let h = 0; h < 24; h++) {
      const label = `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
      sel.insertAdjacentHTML("beforeend", `<option value="${h}">${label}</option>`);
    }
  }

  if (needsSetup()) show();
}
