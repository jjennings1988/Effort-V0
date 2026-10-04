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
import { toast } from "./instrument.js";
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

/* Today's range for a zone at a given work duration (and, optionally, at a
   different start than the selected one). */
function adjusted(z, preset, minutes, startIdx = S.startIdx) {
  const p = project(currentProjectionArgs({
    startIdx, intensity: preset.intensity, structure: preset.structure, durationMinutes: minutes,
    sport: S.sport, baselinePaceSeconds: (z.fastSec + z.slowSec) / 2,
  }));
  const lo = p.performanceImpact.low, hi = p.performanceImpact.high;
  return { p, lo, hi, fast: z.fastSec * (1 + lo / 100), slow: z.slowSec * (1 + hi / 100), delta: Math.round(((z.fastSec + z.slowSec) / 2) * ((lo + hi) / 2) / 100) };
}
/* The zone band a preset describes ("long" is the fast half of easy). */
function zoneFor(f, key) {
  const preset = BOARD_ZONES[key];
  let z = f.zones.find((x) => x.key === (preset.zone ?? key));
  if (preset.half === "fast") z = { ...z, slowSec: (z.fastSec + z.slowSec) / 2 };
  return z;
}
/* The work duration a zone is scored at. The selected continuous zone is
   today's actual workout, so it uses the session length (tunable on Plan);
   every other zone uses its representative length. Rep zones are scored by
   rep: the middle rep length stands for the session. */
function minutesFor(key, selected) {
  const preset = BOARD_ZONES[key];
  if (preset.reps) return Math.min(60, preset.reps[1][1] * 6);
  return selected ? S.duration : preset.duration;
}

/* Today's workout, as one set of numbers the answer card and the board share.
   Includes the best-window alternative when it is meaningfully cheaper. */
export function workoutSummary() {
  if (!S.hours) return null;
  const f = boardFitness();
  if (!f) return null;
  syncZoneToIntensity();
  const key = S.boardZone, preset = BOARD_ZONES[key], z = zoneFor(f, key);
  const minutes = minutesFor(key, true);
  const a = adjusted(z, preset, minutes);
  const label = preset.reps ? `${preset.label} · ${preset.reps[1][0]} REPS` : `${preset.label} · ${minutes} MIN`;
  // What the briefing calls it ("today's easy pace") and how it is read aloud.
  const name = preset.reps ? preset.label : preset.label.toLowerCase();
  const speech = preset.reps
    ? `${preset.label}, ${preset.reps[1][0].toLowerCase().replace("–", " to ").replace("min", "minute")} reps`
    : `${preset.label.toLowerCase()}, ${minutes} minutes`;
  let alt = null;
  const best = S.bestWindow?.idx;
  if (best != null && best !== S.startIdx && S.sport === "run") {
    const b = adjusted(z, preset, minutes, best);
    const saved = Math.round(((a.fast + a.slow) - (b.fast + b.slow)) / 2);
    if (saved >= 3) alt = { idx: best, fast: b.fast, slow: b.slow, saved };
  }
  return { key, label, name, speech, minutes, fast: a.fast, slow: a.slow, lo: a.lo, hi: a.hi, delta: a.delta, strain: a.p.strain.label, alt, estimated: !!f.estimated };
}
function syncZoneToIntensity() {
  if (BOARD_ZONES[S.boardZone]?.intensity !== S.intensity) {
    S.boardZone = { Easy: "easy", Steady: "steady", Hard: "lt2", Race: "vo2" }[S.intensity] ?? "easy";
  }
}

const split400 = (secPerMile) => `${fmt1(Math.round(secPerMile * 400 / 1609.344 * 10) / 10)}s/400`;

function cellHtml(z, a, label, ride) {
  if (ride) {
    return `<span class="bc-cell"><small>${label}</small><b>−${fmt1(a.lo)}–${fmt1(a.hi)}%</b><em>POWER VS NORMAL</em></span>`;
  }
  return `<span class="bc-cell">
    <small>${label}</small>
    <b>${U.paceRange(a.fast, a.slow)}</b>
    ${S.boardSplits ? `<i>${split400(a.fast)}–${split400(a.slow).replace("s/400", "")}</i>` : ""}
    <s>${U.paceRange(z.fastSec, z.slowSec)}</s>
    <em class="chip${a.delta <= 0 ? " zero" : ""}">${a.delta > 0 ? `+${U.paceDelta(a.delta)} s${U.paceUnitShort()}` : "NO COST"}</em>
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
    ["THRESHOLD COST", ride ? `−${fmt1(lt2Cost.lo)}–${fmt1(lt2Cost.hi)}% POWER` : `+${U.paceDelta(lt2Cost.delta)}s${U.paceUnitShort()}`],
  ].map(([k, v], i) => `<span class="${i === 4 ? "accent" : ""}"><small>${k}</small><b>${escHtml(v)}</b></span>`).join("")
    + (hourAllowed(h.iso, th.from, th.to) ? "" : `<span class="warn"><small>NOTE</small><b>OUTSIDE YOUR HOURS</b></span>`);

  /* threshold reps — the selection follows the workout, even when it was
     changed on the Plan tab */
  syncZoneToIntensity();
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
    const preset = BOARD_ZONES[key], z = zoneFor(f, key);
    const minutes = minutesFor(key, sel === key);
    const a = adjusted(z, preset, minutes);
    const desc = sel === key && minutes !== preset.duration ? `${preset.desc.replace(/ · \d+ min$/, "")} · ${minutes} min today` : preset.desc;
    return `<button type="button" class="board-run tone-${preset.tone}${sel === key ? " selected" : ""}" data-zone="${key}" aria-pressed="${sel === key}">
      <span class="br-name"><b>${preset.label}</b><small>${escHtml(desc)}</small></span>
      <span class="br-pace">${ride
        ? `<b>−${fmt1(a.lo)}–${fmt1(a.hi)}%</b><small>POWER VS NORMAL</small>`
        : `<b>${U.paceRange(a.fast, a.slow)}<small>${U.paceUnitShort()}</small></b>
           ${S.boardSplits ? `<i>${split400(a.fast)}–${split400(a.slow).replace("s/400", "")}</i>` : ""}
           <span><s>${U.paceRange(z.fastSec, z.slowSec)}</s><em class="chip${a.delta <= 0 ? " zero" : ""}">${a.delta > 0 ? `+${U.paceDelta(a.delta)} s${U.paceUnitShort()}` : "NO COST"}</em></span>`}
      </span>
    </button>`;
  }).join(""));

  $("boardModel").textContent = ride
    ? "Ride: power adjustments at the same effort."
    : `Reps assume about six, with short recoveries · model ${S.lastProjection?.modelVersion ?? ""}`;
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
  const changed = S.boardZone !== key || S.duration !== preset.duration || S.structure !== preset.structure;
  S.boardZone = key;
  S.intensity = preset.intensity;
  S.structure = preset.structure;
  S.duration = preset.duration;
  requestRender();
  // Say what changed: a tap quietly resetting duration and structure on Plan
  // would otherwise be invisible.
  if (changed) {
    toast(`Today's workout: ${preset.reps ? `${preset.label} reps` : preset.label.toLowerCase()} · ${preset.duration} min`, {
      action: "EDIT IN PLAN", announce: false,
      onAction: () => document.querySelector('#viewTabs [data-view="plan"]')?.click(),
    });
  }
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
      if (idx != null) setStart(idx);
      return;
    }
    if (e.target.closest('[data-go="you"]') || e.target.closest("#boardGoYou")) {
      document.querySelector('#viewTabs [data-view="profile"]')?.click();
      window.setTimeout(() => { $("fitnessSection")?.scrollIntoView({ block: "start" }); $("fitTime")?.focus({ preventScroll: true }); }, 60);
    }
  });
  $("boardSplits")?.addEventListener("change", (e) => { S.boardSplits = e.target.checked; requestRender(); });
  // The answer card's "better start" line is the same move as the BEST chip.
  $("answerAlt")?.addEventListener("click", (e) => {
    const idx = Number(e.currentTarget.dataset.idx);
    if (Number.isInteger(idx) && S.hours?.[idx]) setStart(idx);
  });
}

function setStart(idx) {
  S.startIdx = idx;
  S.rangeStart = idx < 24 ? 0 : S.hours.findIndex((x) => x.iso.startsWith(S.hours[idx].iso.slice(0, 10)));
  requestRender();
}
