/* Today → today's paces.

   The first thing an athlete reads: every training zone, adjusted for the air
   at their start. Neutral pace struck through, today's pace beside it, and the
   cost as a chip. Threshold work is broken out by rep length, because heat
   builds within a rep — a 2-minute rep costs less than an 8-minute one — and
   every number is a real run of the heat model, not a flat percentage.

   Tapping a zone makes it today's workout: it sets intensity, structure and
   duration, so the answer card, dials and Plan tab all follow. */

import { project, hourLabel, dayTag, hourAllowed, fmt1 } from "../engine.js";
import { estimateFitnessFromEasyPace, PERF_DISTANCES } from "../fitness.js";
import { S, currentFitness, currentProjectionArgs, manualPaceSeconds, trainingHours } from "./state.js";
import { $, escHtml } from "./dom.js";
import { requestRender } from "./bus.js";
import * as U from "./units.js";

/* What tapping each zone sets up. Rep zones assume ~6 reps with short
   recoveries; continuous zones use a representative session length. */
export const BOARD_ZONES = {
  lt1: { label: "LT1", badge: "AEROBIC", tone: "lt1", intensity: "Hard", structure: "intervals", duration: 45,
    reps: [["1–3 MIN", 2], ["4–6 MIN", 5], ["7–10 MIN", 8.5]] },
  lt2: { label: "LT2", badge: "THRESHOLD", tone: "lt2", intensity: "Hard", structure: "intervals", duration: 45,
    reps: [["1–3 MIN", 2], ["4–6 MIN", 5], ["7–10 MIN", 8.5]] },
  vo2: { label: "VO2", badge: "INTERVALS", tone: "vo2", intensity: "Race", structure: "intervals", duration: 40,
    reps: [["1–2 MIN", 1.5], ["3–4 MIN", 3.5], ["5–6 MIN", 5.5]] },
  easy: { label: "EASY", desc: "Conversational · self-select in the range", tone: "easy", intensity: "Easy", structure: "continuous", duration: 45 },
  long: { label: "LONG RUN", desc: "Top of the easy band · 90 min", tone: "long", zone: "easy", half: "fast", intensity: "Easy", structure: "continuous", duration: 90 },
  steady: { label: "STEADY", desc: "Fast easy, not threshold", tone: "steady", intensity: "Steady", structure: "continuous", duration: 45 },
  marathon: { label: "MARATHON", desc: "Long-race rhythm", tone: "marathon", intensity: "Steady", structure: "continuous", duration: 60 },
  recovery: { label: "RECOVERY", desc: "Very easy, between hard days", tone: "recovery", intensity: "Easy", structure: "continuous", duration: 30 },
};
const REP_KEYS = ["lt1", "lt2", "vo2"];
const RUN_KEYS = ["easy", "long", "steady", "marathon", "recovery"];

function boardFitness() {
  const f = currentFitness();
  if (f) return f;
  return estimateFitnessFromEasyPace(manualPaceSeconds("Easy"));
}

/* Today's range for a zone at a given work duration. */
function adjusted(z, preset, minutes) {
  const p = project(currentProjectionArgs({
    intensity: preset.intensity, structure: preset.structure, durationMinutes: minutes,
    sport: S.sport, baselinePaceSeconds: (z.fastSec + z.slowSec) / 2,
  }));
  const lo = p.performanceImpact.low, hi = p.performanceImpact.high;
  return { p, lo, hi, fast: z.fastSec * (1 + lo / 100), slow: z.slowSec * (1 + hi / 100), delta: Math.round(((z.fastSec + z.slowSec) / 2) * ((lo + hi) / 2) / 100) };
}
const split400 = (secPerMile) => `${fmt1(Math.round(secPerMile * 400 / 1609.344 * 10) / 10)}s/400`;

function cellHtml(z, a, label, ride) {
  if (ride) {
    return `<span class="bc-cell"><small>${label}</small><b>−${fmt1(a.lo)}–${fmt1(a.hi)}%</b><em>POWER VS NORMAL</em></span>`;
  }
  return `<span class="bc-cell">
    <small>${label}</small>
    <b>${U.paceLabel(a.fast)}–${U.paceLabel(a.slow)}</b>
    ${S.boardSplits ? `<i>${split400(a.fast)}–${split400(a.slow).replace("s/400", "")}</i>` : ""}
    <s>${U.paceLabel(z.fastSec)}–${U.paceLabel(z.slowSec)}</s>
    <em class="chip${a.delta <= 0 ? " zero" : ""}">${a.delta > 0 ? `+${a.delta} s${U.paceUnitShort()}` : "NO COST"}</em>
  </span>`;
}

export function renderBoard() {
  const host = $("boardReps");
  if (!host || !S.hours) return;
  const f = boardFitness();
  const ride = S.sport === "ride";
  const h = S.hours[S.startIdx];
  const todayIso = S.meta?.todayIso || S.hours[0].iso.slice(0, 10);
  $("boardEmpty").hidden = !!f;
  $("boardInst").classList.toggle("empty", !f);
  if (!f) return;

  /* header: when, where the paces come from */
  $("boardWhen").textContent = `AT ${(dayTag(h.iso, todayIso) + hourLabel(h.iso)).trim().toUpperCase()}`;
  if (f.estimated) {
    $("boardSource").innerHTML = `ESTIMATED FROM YOUR EASY PACE ${U.paceLabel(manualPaceSeconds("Easy"))}${U.paceUnitShort()} · <button type="button" class="board-link" data-go="you">ADD A RACE FOR ACCURACY →</button>`;
  } else {
    const a = f.anchor;
    $("boardSource").textContent = `FROM ${PERF_DISTANCES[a.distanceKey].label} · ${a.dateISO.slice(5).replace("-", "/")}${a.corrected ? " · WEATHER-CORRECTED" : ""} · VDOT ${f.vdot.toFixed(1)}`;
  }
  syncTimes();

  /* conditions line */
  const th = trainingHours();
  const lt2 = f.zones.find((z) => z.key === "lt2");
  const lt2Cost = adjusted(lt2, BOARD_ZONES.lt2, 30);
  $("boardConditions").innerHTML = [
    ["AIR", U.temp(h.temp)], ["DEW", U.temp(h.dew)], ["WIND", `${U.wind(h.wind)} ${U.windUnit()}`], ["WBGT", U.temp(h.wbgt)],
    ["THRESHOLD COST", ride ? `−${fmt1(lt2Cost.lo)}–${fmt1(lt2Cost.hi)}% POWER` : `+${lt2Cost.delta}s${U.paceUnitShort()}`],
  ].map(([k, v], i) => `<span class="${i === 4 ? "accent" : ""}"><small>${k}</small><b>${escHtml(v)}</b></span>`).join("")
    + (hourAllowed(h.iso, th.from, th.to) ? "" : `<span class="warn"><small>NOTE</small><b>OUTSIDE YOUR HOURS</b></span>`);

  /* threshold reps — the selection follows the workout, even when it was
     changed on the Plan tab */
  if (BOARD_ZONES[S.boardZone]?.intensity !== S.intensity) {
    S.boardZone = { Easy: "easy", Steady: "steady", Hard: "lt2", Race: "vo2" }[S.intensity] ?? "easy";
  }
  const sel = S.boardZone;
  setHTML(host, REP_KEYS.map((key) => {
    const preset = BOARD_ZONES[key], z = f.zones.find((x) => x.key === key);
    const cells = preset.reps.map(([label, rep]) => cellHtml(z, adjusted(z, preset, Math.min(60, rep * 6)), label, ride)).join("");
    return `<button type="button" class="board-card tone-${preset.tone}${sel === key ? " selected" : ""}" data-zone="${key}"
        aria-pressed="${sel === key}" aria-label="${escHtml(`${preset.label} ${preset.badge}: make this today's workout`)}">
      <span class="bc-head"><b>${preset.label}</b><em>${preset.badge}</em></span>
      <span class="bc-cells">${cells}</span>
    </button>`;
  }).join(""));

  /* continuous runs */
  setHTML($("boardRuns"), RUN_KEYS.map((key) => {
    const preset = BOARD_ZONES[key];
    let z = f.zones.find((x) => x.key === (preset.zone ?? key));
    if (preset.half === "fast") z = { ...z, slowSec: (z.fastSec + z.slowSec) / 2 };
    const a = adjusted(z, preset, preset.duration);
    return `<button type="button" class="board-run tone-${preset.tone}${sel === key ? " selected" : ""}" data-zone="${key}" aria-pressed="${sel === key}">
      <span class="br-name"><b>${preset.label}</b><small>${escHtml(preset.desc)}</small></span>
      <span class="br-pace">${ride
        ? `<b>−${fmt1(a.lo)}–${fmt1(a.hi)}%</b><small>POWER VS NORMAL</small>`
        : `<b>${U.paceLabel(a.fast)}–${U.paceLabel(a.slow)}<small>${U.paceUnitShort()}</small></b>
           ${S.boardSplits ? `<i>${split400(a.fast)}–${split400(a.slow).replace("s/400", "")}</i>` : ""}
           <span><s>${U.paceLabel(z.fastSec)}–${U.paceLabel(z.slowSec)}</s><em class="chip${a.delta <= 0 ? " zero" : ""}">${a.delta > 0 ? `+${a.delta} s${U.paceUnitShort()}` : "NO COST"}</em></span>`}
      </span>
    </button>`;
  }).join(""));

  $("boardModel").textContent = ride
    ? "RIDE: POWER ADJUSTMENTS AT THE SAME EFFORT"
    : `REPS ASSUME ~6 WITH SHORT RECOVERIES · MODEL ${S.lastProjection?.modelVersion?.toUpperCase() ?? ""}`;
}

/* Only touch the DOM when the content changed, so renders that don't move a
   number never restart anything on screen. */
function setHTML(el, html) {
  if (el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
}

/* The time chips. Each is a real forecast index; a chip is lit when the
   current start is that time. */
function timeTargets() {
  const hours = S.hours, th = trainingHours();
  const todayIso = S.meta?.todayIso || hours[0].iso.slice(0, 10);
  const tomorrow = new Date(Date.parse(todayIso + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  const find = (pred) => { const i = hours.findIndex(pred); return i < 0 ? null : i; };
  const hourOf = (x) => Number(x.iso.slice(11, 13));
  return {
    now: 0,
    best: S.bestWindow?.idx ?? null,
    tonight: find((x) => x.iso.startsWith(todayIso) && hourOf(x) >= 18 && hourOf(x) <= 20 && hourAllowed(x.iso, th.from, th.to)),
    tomorrow: find((x) => x.iso.startsWith(tomorrow) && hourOf(x) >= Math.max(5, th.from) && hourAllowed(x.iso, th.from, th.to)),
  };
}
function syncTimes() {
  const t = timeTargets();
  document.querySelectorAll("#boardTimes button").forEach((b) => {
    const idx = t[b.dataset.when];
    b.disabled = idx == null;
    const on = idx != null && idx === S.startIdx;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

export function applyBoardZone(key) {
  const preset = BOARD_ZONES[key];
  if (!preset) return;
  S.boardZone = key;
  S.intensity = preset.intensity;
  S.structure = preset.structure;
  S.duration = preset.duration;
  requestRender();
}

export function wireBoard() {
  const inst = $("boardInst");
  if (!inst) return;
  // The entrance plays once per visit: when the panel arrives it is marked as
  // played after the stagger finishes; leaving the tab clears the mark.
  new window.MutationObserver(() => {
    if (!inst.classList.contains("is-in")) { delete inst.dataset.played; return; }
    if (inst.dataset.played == null) window.setTimeout(() => { if (inst.classList.contains("is-in")) inst.dataset.played = ""; }, 900);
  }).observe(inst, { attributes: true, attributeFilter: ["class"] });
  inst.addEventListener("click", (e) => {
    const zone = e.target.closest("[data-zone]");
    if (zone) { applyBoardZone(zone.dataset.zone); return; }
    const when = e.target.closest("#boardTimes button");
    if (when && !when.disabled) {
      const idx = timeTargets()[when.dataset.when];
      if (idx == null) return;
      S.startIdx = idx;
      S.rangeStart = idx < 24 ? 0 : S.hours.findIndex((x) => x.iso.startsWith(S.hours[idx].iso.slice(0, 10)));
      requestRender();
      return;
    }
    if (e.target.closest('[data-go="you"]') || e.target.closest("#boardGoYou")) {
      document.querySelector('#viewTabs [data-view="profile"]')?.click();
      window.setTimeout(() => { $("fitnessSection")?.scrollIntoView({ block: "start" }); $("fitTime")?.focus({ preventScroll: true }); }, 60);
    }
  });
  $("boardSplits")?.addEventListener("change", (e) => { S.boardSplits = e.target.checked; requestRender(); });
}
