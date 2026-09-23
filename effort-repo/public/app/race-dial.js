/* The race instrument: race day as a dial in venue-local time, the race
   window as an ink arc, and a split tape that shows where on the course the
   weather cost lands. Everything the canvas shows is also in the DOM. */

import { fmtDuration, strainLabel, fmt1 } from "../engine.js";
import { $ } from "./dom.js";
import { DialRenderer } from "./dial-core.js";
import { countTo, replay, watchVisibility } from "./instrument.js";
import { raceDialModel, raceSplitPlan, raceClock } from "./race-model.js";
import { STRAIN_BANDS, strainBand, strainV, EASE_OFF_STRAIN } from "./strain-bands.js";
import { tapeCellHtml, ledgerRows } from "./dial.js";
import { paceLabel, paceUnitShort, unit, temp } from "./units.js";

const R = { renderer: null, canvas: null, isVisible: () => false, tapeHtml: "" };

function setMode(mode) {
  const chip = $("raceChip");
  if (!chip) return;
  chip.dataset.state = mode;
  $("raceChipText").textContent = { cloud: "CALCULATING", sorting: "SORTING RACE DAY", morphing: "RECALCULATING", settled: "LOCKED" }[mode] ?? "LOCKED";
  $("raceInstrument").dataset.mode = mode;
}

function ensureRenderer() {
  const canvas = $("raceDialCanvas");
  if (!canvas || R.canvas === canvas) return;
  R.canvas = canvas;
  R.renderer?.destroy();
  R.renderer = null;
  R.tapeHtml = "";
  if (!("IntersectionObserver" in window)) { setMode("settled"); return; }
  const r = new DialRenderer(canvas, { onMode: setMode, seed: 1313 });
  if (!r.ctx) return;
  R.renderer = r;
  r.visible = false;
  R.isVisible = watchVisibility(canvas, (v) => { r.setVisible(v); if (v) { r.resize(); r.reveal(); } });
  if ("ResizeObserver" in window) new window.ResizeObserver(() => r.resize()).observe(canvas);
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => r.refreshColors());
}

export function hideRaceInstrument() {
  const inst = $("raceInstrument");
  if (inst) inst.hidden = true;
}

/* Called by renderRace once a complete race projection exists. */
export function renderRaceInstrument(race, result, weather) {
  const inst = $("raceInstrument");
  if (!inst) return;
  inst.hidden = false;
  ensureRenderer();
  const tz = race.location.timezone;
  const model = raceDialModel(race, result, weather);
  const finishEpoch = result.startEpoch + result.midSeconds * 1000;

  /* --- DOM readouts --- */
  $("raceDialSub").textContent = `${race.location.label.toUpperCase()} · ${tz}`;
  $("raceStatStart").textContent = raceClock(result.startEpoch, tz);
  $("raceStatFinish").textContent = raceClock(finishEpoch, tz);
  $("raceStatCost").textContent = `+${fmtDuration(Math.max(0, result.costSeconds))}`;
  $("raceHubTime").textContent = `${raceClock(result.startEpoch, tz)}`;
  $("raceHubLoad").textContent = `PEAK LOAD ${fmt1(model.peakStrain)}`;
  $("raceFoot").textContent = `MODEL ${result.projection.modelVersion.toUpperCase()} · GOAL ${fmtDuration(result.goalSeconds)}`;

  const u = unit("distance") === "km" ? "km" : "mi";
  const plan = raceSplitPlan(result, weather, u);
  if (plan) {
    const label = u === "km" ? "KM" : "MI";
    let html = "";
    const counts = STRAIN_BANDS.map(() => 0);
    let peak = 0;
    plan.splits.forEach((s, i) => {
      counts[strainBand(s.strain)]++;
      peak = Math.max(peak, s.strain);
      const partial = s.length < plan.splitMiles - 1e-6;
      html += tapeCellHtml(`${label} ${s.index}${partial ? "*" : ""}`, paceLabel(s.paceSeconds),
        s.strain, `${label} ${s.index} · target ${paceLabel(s.paceSeconds)}${paceUnitShort()} · load ${fmt1(s.strain)} · ${strainLabel(s.strain)} · ${temp(s.temp, { unit: true })}`, i);
    });
    const tape = $("raceTape");
    if (R.tapeHtml !== html) {
      R.tapeHtml = html;
      tape.innerHTML = html + '<span class="tape-cursor" aria-hidden="true"></span>';
      replay(tape, "writing");
    }
    const hollow = plan.splits.filter((s) => s.strain >= EASE_OFF_STRAIN).length;
    const first = plan.splits[0].paceSeconds, last = plan.splits.at(-1).paceSeconds;
    $("raceTapeTitle").textContent = ` · ${plan.splits.length} ${label} SPLITS · ${paceLabel(first)} → ${paceLabel(last)}${paceUnitShort()}`;
    $("raceTapeState").textContent = hollow ? `${hollow} EASE-OFF ${hollow === 1 ? "SPLIT" : "SPLITS"}` : "ALL SPLITS COOLING";
    $("raceTapeState").classList.toggle("warn", hollow > 0);
    countTo($("raceLedgerPeak"), Math.round(peak * 10) / 10, (v) => fmt1(Math.round(v * 10) / 10));
    $("raceLedgerPeak").classList.toggle("warn", peak >= EASE_OFF_STRAIN);
    $("raceLedgerWord").textContent = `PEAK LOAD ON COURSE · ${strainLabel(peak).toUpperCase()}`;
    $("raceLedgerUnit").textContent = `${label} SPLITS`;
    $("raceLedgerBars").innerHTML = ledgerRows(counts, plan.splits.length, label);
  }

  /* --- the picture --- */
  if (R.renderer) {
    R.renderer.setModel({
      wedges: model.wedges, signature: model.signature, refs: [{ v: strainV(EASE_OFF_STRAIN), label: "3.5" }],
      work: { start: model.start, span: model.span }, markers: model.markers, sweepFrom: model.start,
    }, { reveal: R.isVisible() });
  }
}
