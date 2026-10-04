/* Week → the whole week as one heatmap.

   Seven rows, twenty-four columns: every start the forecast allows, coloured
   by the same score the dial and decision curve use. Hours outside the
   athlete's training window are hatched, night is shaded, each day's best
   start is outlined, and the current start is ringed. Choosing a cell loads it
   and flies to that day's dial on Today.

   Cells are rebuilt only when the data changes; selection and hover are class
   toggles, so the fill-in wave plays for new data, not for every render. */

import { hourScore, hourAllowed, ratingFor, hourLabel, findDailyWindows } from "../engine.js";
import { S, modelOpts, trainingHours, PLANNER_DAYS } from "./state.js";
import { $, escHtml, scrollBehavior } from "./dom.js";
import { requestRender } from "./bus.js";
import { temp } from "./units.js";

let signature = "", cells = [];

function dayName(dayIso, todayIso) {
  if (dayIso === todayIso) return "TODAY";
  return new Date(dayIso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}

export function renderWeekHeat() {
  const grid = $("weekHeat");
  if (!grid || !S.hours) return;
  const hours = S.hours, th = trainingHours();
  const todayIso = S.meta?.todayIso ?? hours[0].iso.slice(0, 10);
  const lastStart = hours.length - Math.max(2, Math.ceil(S.duration / 60) + 1);
  const opts = modelOpts();
  const days = [...new Set(hours.slice(0, lastStart + 1).map((h) => h.iso.slice(0, 10)))].slice(0, PLANNER_DAYS);
  const best = new Set(findDailyWindows(hours, S.duration, S.intensity, S.sport, {
    days: PLANNER_DAYS, fromH: th.from, toH: th.to, structure: S.structure, ...opts,
  }).filter((d) => d.idx != null).map((d) => d.idx));

  cells = [];
  const rows = days.map((day, r) => {
    const row = new Array(24).fill(null);
    for (let i = 0; i <= lastStart; i++) {
      if (!hours[i].iso.startsWith(day)) continue;
      const hh = Number(hours[i].iso.slice(11, 13));
      const s = hourScore(hours, i, S.duration, S.intensity, S.sport, S.structure, S.meta?.elevFt || 0, opts);
      const cell = { idx: i, r, c: hh, score: s.score, rating: ratingFor(s.score, s.thunder), hour: hours[i],
        off: !hourAllowed(hours[i].iso, th.from, th.to), best: best.has(i) };
      row[hh] = cell; cells.push(cell);
    }
    return { day, row };
  });
  const sig = JSON.stringify([days, cells.map((c) => [c.idx, c.score, c.rating.tone, c.off, c.best]), S.profile.units]);

  if (sig !== signature) {
    signature = sig;
    const head = `<div class="wh-row wh-head" role="row"><span class="wh-day" role="columnheader"></span>${Array.from({ length: 24 }, (_, h) =>
      `<span class="wh-hour" role="columnheader">${h % 3 === 0 ? hourLabel(`2000-01-01T${String(h).padStart(2, "0")}:00`).replace(" ", "") : ""}</span>`).join("")}</div>`;
    grid.innerHTML = head + rows.map(({ day, row }, r) => `<div class="wh-row" role="row">
      <span class="wh-day" role="rowheader">${escHtml(dayName(day, todayIso))}<small>${day.slice(5).replace("-", "/")}</small></span>
      ${row.map((c, h) => c
        ? `<button type="button" role="gridcell" class="wh-cell tone-${c.rating.tone}${c.off ? " off" : ""}${c.hour.isDay ? "" : " night"}${c.best ? " best" : ""}"
            data-idx="${c.idx}" data-r="${r}" data-c="${h}" style="--d:${(r * 3 + h) * 13}ms" tabindex="-1"
            aria-label="${escHtml(`${dayName(day, todayIso)} ${hourLabel(c.hour.iso)}, ${c.rating.rating}, ${c.score} of 100${c.off ? ", outside your hours" : ""}${c.best ? ", best start that day" : ""}`)}"></button>`
        : `<span class="wh-cell empty" role="gridcell" aria-hidden="true"></span>`).join("")}
    </div>`).join("");
  }

  // Selection ring and roving focus — no rebuild needed.
  const sel = grid.querySelector(`.wh-cell[data-idx="${S.startIdx}"]`) ?? grid.querySelector(".wh-cell.best") ?? grid.querySelector("button.wh-cell");
  grid.querySelectorAll("button.wh-cell").forEach((b) => {
    const on = Number(b.dataset.idx) === S.startIdx;
    b.classList.toggle("selected", on);
    b.tabIndex = b === sel ? 0 : -1;
  });
  describe(cells.find((c) => c.idx === S.startIdx), false);
  $("weekHeatSub").textContent = `${S.intensity.toUpperCase()} · ${S.duration} MIN · ${S.sport === "ride" ? "RIDE" : "RUN"} · ${cells.length} STARTS SCORED`;
}

function describe(c, preview) {
  const out = $("weekHeatReadout");
  if (!out) return;
  out.classList.toggle("previewing", preview);
  if (!c) { out.textContent = "Point at a cell to read it. Tap to load that start."; return; }
  const todayIso = S.meta?.todayIso ?? S.hours[0].iso.slice(0, 10);
  out.innerHTML = `<b>${preview ? "PREVIEW" : "SELECTED"} / ${escHtml(dayName(c.hour.iso.slice(0, 10), todayIso))} ${escHtml(hourLabel(c.hour.iso))}</b>
    <span>${escHtml(c.rating.rating)} · ${c.score}/100 · ${escHtml(temp(c.hour.temp))} air · ${escHtml(temp(c.hour.dew))} dew${c.off ? " · outside your hours" : ""}${c.best ? " · best that day" : ""}</span>`;
}

function choose(idx) {
  S.startIdx = idx;
  const day = S.hours[idx].iso.slice(0, 10);
  S.rangeStart = S.hours.findIndex((h) => h.iso.startsWith(day));
  document.querySelector('#viewTabs [data-view="today"]')?.click();
  S.view = "today";
  requestRender();
  // Fly to that day's dial on Today: it morphs to the chosen day as it arrives.
  window.setTimeout(() => $("dialSection")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }), 40);
}

export function wireWeekHeat() {
  const grid = $("weekHeat");
  if (!grid) return;
  signature = "";
  const cellOf = (el) => cells.find((c) => c.idx === Number(el?.dataset.idx));
  grid.addEventListener("pointerover", (e) => {
    const b = e.target.closest("button.wh-cell");
    if (b && e.pointerType === "mouse") describe(cellOf(b), true);
  });
  grid.addEventListener("pointerleave", () => describe(cells.find((c) => c.idx === S.startIdx), false));
  grid.addEventListener("focusin", (e) => { const b = e.target.closest("button.wh-cell"); if (b) describe(cellOf(b), true); });
  grid.addEventListener("click", (e) => {
    const b = e.target.closest("button.wh-cell");
    if (b) choose(Number(b.dataset.idx));
  });
  grid.addEventListener("keydown", (e) => {
    const b = e.target.closest("button.wh-cell");
    if (!b) return;
    const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    if (!moves[e.key]) return;
    e.preventDefault();
    let r = Number(b.dataset.r), c = Number(b.dataset.c);
    for (let step = 0; step < 30; step++) {
      r += moves[e.key][0]; c += moves[e.key][1];
      if (c < 0) { c = 23; r--; } if (c > 23) { c = 0; r++; }
      const next = grid.querySelector(`button.wh-cell[data-r="${r}"][data-c="${c}"]`);
      if (r < 0 || r > 6) return;
      if (next) { b.tabIndex = -1; next.tabIndex = 0; next.focus(); return; }
    }
  });
}
