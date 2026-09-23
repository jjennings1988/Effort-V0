/* The Today dials.

   Two instances of the dial renderer share one model: the compact dial that
   opens the app (it replaces the old weather orb and docks into the poster),
   and the full instrument in "Your 24 hours". Wedge length is the same
   effort-and-risk score the decision curve plots, colour is its rating, the
   ink arc is the workout, and hours outside the athlete's training window are
   hatched out and cannot be chosen from the dial.

   Every value the canvas shows is also in the DOM: hub, stats, callouts,
   tape and ledger. */

import { sampleAt, heatStrain, strainLabel, hourLabel, hourAllowed, fmt1 } from "../engine.js";
import { S, trainingHours } from "./state.js";
import { $, escHtml } from "./dom.js";
import { requestRender } from "./bus.js";
import { DialRenderer, RADII, clockAngle } from "./dial-core.js";
import { countTo, replay, watchVisibility, setHover, onHover, reducedMotion } from "./instrument.js";
import * as U from "./units.js";

const STEPS = ["fetch", "sample", "balance", "search", "lock"];
import { STRAIN_BANDS, strainBand, EASE_OFF_STRAIN } from "./strain-bands.js";
export { STRAIN_BANDS, strainBand };

const hourOf = (iso) => Number(iso.slice(11, 13));
// Square-root radial scale: most training hours score under 40, and a linear
// scale would crush them into a sliver. Order is preserved, and the 35/55
// reference rings use the same mapping, so reading against them stays honest.
const scoreV = (score) => 0.1 + 0.9 * Math.sqrt(Math.max(0, Math.min(1, score / 100)));

function parseClock(label) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(label || "").trim());
  if (!m) return null;
  return (Number(m[1]) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0) + Number(m[2]) / 60;
}

const D = {
  main: null, hero: null, canvas: null, heroCanvas: null,
  model: null, preview: null, tapeHtml: "", isVisible: () => false,
};

/* ---------- wiring ---------- */
// Wired once per canvas element, so a replaced document gets fresh listeners
// and a canvas-less environment is not re-wired on every render.
const needsWire = () => !D.canvas || D.canvas !== $("dialCanvas");
function wire() {
  D.canvas = $("dialCanvas");
  D.heroCanvas = $("orbDialCanvas");
  if (!D.canvas) return false;
  D.main?.destroy(); D.hero?.destroy();
  D.model = null; D.preview = null; D.tapeHtml = "";
  // No IntersectionObserver means a non-visual environment (tests, very old
  // browsers): keep every DOM readout, skip the canvas pictures.
  const visual = "IntersectionObserver" in window;
  D.main = visual ? new DialRenderer(D.canvas, { onMode: setMode, onStep: setStep }) : null;
  if (!D.main?.ctx) { D.main = null; $("dialInstrument")?.classList.add("no-canvas"); }
  if (D.heroCanvas && visual) {
    D.hero = new DialRenderer(D.heroCanvas, { compact: true, timeline: "fast", perHour: 44, seed: 7 });
    if (!D.hero.ctx) D.hero = null;
  }
  if (D.main) {
    D.main.visible = false;
    D.isVisible = watchVisibility($("dialFace"), (v) => { D.main.setVisible(v); if (v) D.main.reveal(); });
  }
  if (D.hero) {
    new window.IntersectionObserver((e) => D.hero.setVisible(e[e.length - 1].isIntersecting)).observe(D.heroCanvas);
  }
  const resize = () => { D.main?.resize(); D.hero?.resize(); layoutLeaders(); };
  if ("ResizeObserver" in window) {
    const ro = new window.ResizeObserver(resize);
    ro.observe(D.canvas); if (D.heroCanvas) ro.observe(D.heroCanvas);
  } else window.addEventListener("resize", resize);
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => { D.main?.refreshColors(); D.hero?.refreshColors(); });
  wireInput();
  onHover("dial", (index) => previewIndex(index, false));
  setMode("cloud"); setStep("fetch");
  return true;
}

function wireInput() {
  const face = $("dialFace");
  const slotAt = (ev) => {
    const clock = D.main?.clockAt(ev.clientX, ev.clientY);
    if (clock == null || !D.model) return null;
    const slot = D.model.slotByClock[clock];
    return slot == null ? null : slot;
  };
  face.addEventListener("pointermove", (ev) => {
    if (ev.pointerType !== "mouse" || D.main?.mode !== "settled") return;
    const slot = slotAt(ev);
    face.style.cursor = slot == null ? "default" : D.model.allowed[slot] ? "pointer" : "not-allowed";
    previewSlot(slot, true);
  });
  face.addEventListener("pointerleave", () => previewSlot(null, true));
  let down = null;
  face.addEventListener("pointerdown", (ev) => { down = { x: ev.clientX, y: ev.clientY }; });
  face.addEventListener("pointerup", (ev) => {
    if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 10) { down = null; return; }
    down = null;
    if (D.main?.mode === "sorting") return;
    const slot = slotAt(ev);
    if (slot != null && D.model.allowed[slot]) { previewSlot(null, true); commit(slot); }
  });
  face.addEventListener("keydown", (ev) => {
    const m = D.model;
    if (!m) return;
    const choices = m.allowed.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0 && i <= m.lastSlot);
    if (!choices.length) return;
    let slot;
    if (ev.key === "ArrowRight" || ev.key === "ArrowUp") slot = choices.find((i) => i > m.selectedSlot) ?? choices.at(-1);
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") slot = [...choices].reverse().find((i) => i < m.selectedSlot) ?? choices[0];
    else if (ev.key === "Home") slot = choices[0];
    else if (ev.key === "End") slot = choices.at(-1);
    else if (ev.key === "Enter" && m.best) slot = m.best.slot;
    else return;
    ev.preventDefault();
    commit(slot);
  });
  $("orbDial")?.addEventListener("click", () => {
    if (document.body.matches(".orb-calculating, .orb-locking")) return;
    $("dialSection")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  });
}

function commit(slot) {
  const m = D.model;
  if (!m || slot == null) return;
  const idx = m.offset + slot;
  if (idx > m.maxStart || idx === S.startIdx) return;
  S.startIdx = idx;
  requestRender();
}
function previewSlot(slot, broadcast) {
  if (D.preview === slot) return;
  D.preview = slot;
  const m = D.model;
  if (!m) return;
  D.main?.setPreview(slot == null ? null : hourOf(m.readings[slot].hour.iso));
  hubFor(slot ?? m.selectedSlot, slot != null && slot !== m.selectedSlot);
  setMode(D.main?.mode ?? "settled");
  if (broadcast) setHover(slot == null ? null : m.offset + slot, "dial");
}
function previewIndex(index, broadcast) {
  const m = D.model;
  if (!m) return;
  const slot = index == null ? null : index - m.offset;
  previewSlot(slot != null && slot >= 0 && slot < m.readings.length ? slot : null, broadcast);
}

/* ---------- chrome ---------- */
function setMode(mode) {
  const chip = $("dialChip");
  const labels = { cloud: "CALCULATING", sorting: "SORTING THE DAY", morphing: "RECALCULATING", settled: "LOCKED" };
  if (chip) {
    chip.dataset.state = mode;
    $("dialChipText").textContent = D.preview != null && mode === "settled" ? "PREVIEWING" : labels[mode] ?? "LOCKED";
  }
  const inst = $("dialInstrument");
  if (inst) {
    inst.dataset.mode = mode;
    if (mode === "settled") inst.classList.add("revealed");
    if (mode === "cloud") inst.classList.remove("revealed");
  }
}
function setStep(active) {
  const idx = STEPS.indexOf(active);
  document.querySelectorAll("#dialSteps li").forEach((li, i) => {
    li.classList.toggle("done", i < idx || active === "done");
    li.classList.toggle("active", i === idx && active !== "done");
  });
  if (active === "search") $("dialInstrument")?.classList.add("revealed");
}

/* Called by the network layer: a new forecast is on its way. */
export function dialSignal(mode) {
  if (mode !== "loading") return;
  if (needsWire() && !wire()) return;
  D.main?.release();
  D.hero?.release();
  $("dialInstrument")?.classList.remove("revealed");
}

/* ---------- DOM readouts ---------- */
function hubFor(slot, previewing) {
  const m = D.model;
  const r = m?.readings[slot];
  if (!r) return;
  const off = !m.allowed[slot];
  const hub = $("dialHub");
  hub.dataset.tone = off ? "off" : r.rating.tone;
  hub.classList.toggle("previewing", previewing);
  $("dialHubKicker").textContent = previewing
    ? (off ? "OUTSIDE YOUR HOURS" : "PREVIEW · CLICK TO USE")
    : (off ? "YOUR START · OUTSIDE YOUR HOURS" : "YOUR START");
  $("dialHubTime").textContent = (m.dayPrefix(r.hour.iso) + hourLabel(r.hour.iso)).trim();
  $("dialHubScore").textContent = `${r.score}/100 · ${r.rating.rating.toUpperCase()}`;
  $("dialHubDetail").textContent = `${U.temp(r.hour.temp)} AIR · ${U.temp(r.hour.dew)} DEW · ${U.wind(r.hour.wind)} ${U.windUnit()}`;
  const heroHub = $("orbDialHub");
  if (heroHub && !previewing) heroHub.textContent = (m.dayPrefix(r.hour.iso) + hourLabel(r.hour.iso)).trim();
}

function buildCallouts() {
  const m = D.model;
  const out = [];
  const R = RADII;
  const pool = m.readings.filter((_, i) => m.allowed[i]);
  const within = pool.length ? pool : m.readings;
  const pick = (better) => within.reduce((a, r) => (!a || better(r, a) ? r : a), null);
  const add = (key, tone, label, value, sub, meter, anchor) => out.push({ key, tone, label, value, sub, meter, anchor });
  if (m.best) {
    const r = m.readings[m.best.slot];
    add("best", "acid", "BEST WINDOW", m.best.label, `${r.score}/100 · ${r.rating.rating.toUpperCase()}`, 1 - r.score / 100, [(m.best.h0 + m.best.h1) / 2, R.best + 0.03]);
  }
  const hardest = pick((r, a) => r.score > a.score);
  if (hardest && (!m.best || m.readings[m.best.slot] !== hardest)) {
    add("hard", "coral", "HARDEST IN YOUR HOURS", `${m.dayPrefix(hardest.hour.iso)}${hourLabel(hardest.hour.iso)}`,
      `${hardest.score}/100 · ${U.temp(hardest.hour.temp)} AIR`, hardest.score / 100, [hourOf(hardest.hour.iso) + 0.5, R.tones + 0.03]);
  }
  const muggy = pick((r, a) => r.hour.dew > a.hour.dew);
  if (muggy) {
    add("dew", "sky", "DEW POINT PEAK", `${U.temp(muggy.hour.dew)}`,
      `${m.dayPrefix(muggy.hour.iso)}${hourLabel(muggy.hour.iso)} · SWEAT ESCAPES SLOWEST`, Math.max(0, Math.min(1, (muggy.hour.dew - 40) / 40)), [hourOf(muggy.hour.iso) + 0.5, R.tones + 0.03]);
  }
  if (m.window) {
    add("hours", "ink", "YOUR TRAINING HOURS", m.window.label, "LATEST START SHOWN · HATCHED HOURS ARE OFF · CHANGE IN YOU", null,
      [m.window.from + ((m.window.to >= m.window.from ? m.window.to + 1 : m.window.to + 25) - m.window.from) / 2, 1.035]);
  } else if (m.sunset != null) {
    add("sun", "sun", "SUNSET", S.meta.sunset, `SUNRISE ${S.meta.sunrise || "—"} · SHADED BAND = DARK`, null, [m.sunset, R.tones + 0.03]);
  }
  const side = (c) => Math.cos(clockAngle(c.anchor[0]));
  const sorted = out.sort((a, b) => side(a) - side(b));
  const half = Math.floor(sorted.length / 2);
  const byY = (a, b) => Math.sin(clockAngle(a.anchor[0])) - Math.sin(clockAngle(b.anchor[0]));
  return { left: sorted.slice(0, half).sort(byY), right: sorted.slice(half).sort(byY) };
}
function calloutHtml(c) {
  const meter = c.meter == null ? "" : `<span class="inst-meter"><i style="width:${Math.round(Math.max(0, Math.min(1, c.meter)) * 100)}%"></i></span>`;
  return `<div class="inst-callout" data-key="${c.key}" data-tone="${c.tone}" data-h="${c.anchor[0].toFixed(3)}" data-r="${c.anchor[1].toFixed(3)}">
    <span class="inst-callout-label">${escHtml(c.label)}</span>
    <strong>${escHtml(c.value)}</strong>
    <small>${escHtml(c.sub)}</small>${meter}
  </div>`;
}
function renderCallouts() {
  const { left, right } = buildCallouts();
  const l = left.map(calloutHtml).join(""), r = right.map(calloutHtml).join("");
  if ($("dialCalloutsLeft").innerHTML !== l) $("dialCalloutsLeft").innerHTML = l;
  if ($("dialCalloutsRight").innerHTML !== r) $("dialCalloutsRight").innerHTML = r;
}
/* Leader lines run from each callout's inner edge to its anchor on the dial. */
function layoutLeaders() {
  const svg = $("dialLeaders"), stage = $("dialStage");
  if (!svg || !stage || !D.main?.size) return;
  const s = stage.getBoundingClientRect();
  if (!s.width) return;
  svg.setAttribute("viewBox", `0 0 ${s.width.toFixed(1)} ${s.height.toFixed(1)}`);
  if (window.getComputedStyle(stage).getPropertyValue("--dial-stacked").trim() === "1") { svg.innerHTML = ""; return; }
  let html = "";
  stage.querySelectorAll(".inst-callout").forEach((el) => {
    const b = el.getBoundingClientRect();
    const left = el.closest(".left") != null;
    const [ax, ay] = D.main.anchor(Number(el.dataset.h), Number(el.dataset.r));
    const tx = ax - s.left, ty = ay - s.top;
    const sx = (left ? b.right : b.left) - s.left, sy = b.top - s.top + 14;
    const ex = sx + (left ? 18 : -18);
    html += `<path class="dial-leader" d="M${sx.toFixed(1)},${sy.toFixed(1)} H${ex.toFixed(1)} L${tx.toFixed(1)},${ty.toFixed(1)}" pathLength="1"/><circle class="dial-leader-dot" cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="3"/>`;
  });
  svg.innerHTML = html;
}

/* Workout tape: thermal load through the session, one cell per slice. */
export function strainTape(hours, startIdx, durationMinutes, load) {
  const step = durationMinutes <= 90 ? 5 : durationMinutes <= 180 ? 10 : 15;
  const cells = Math.max(1, Math.round(durationMinutes / step));
  const out = [];
  for (let c = 0; c < cells; c++) {
    const mid = (c + 0.5) * step;
    const smp = sampleAt(hours, startIdx + mid / 60);
    out.push({ from: c * step, to: (c + 1) * step, strain: heatStrain(smp.temp, smp.dew, smp.solar, smp.wind, { metabolicLoad: load }) });
  }
  return { step, cells: out };
}
export function tapeCellHtml(label, value, strain, title, i) {
  const band = STRAIN_BANDS[strainBand(strain)];
  return `<span class="tape-cell band-${band.key}${strain >= EASE_OFF_STRAIN ? " hollow" : ""}" style="--i:${i}" title="${escHtml(title)}"><small>${escHtml(label)}</small><b>${escHtml(value)}</b></span>`;
}
export function ledgerRows(minutesByBand, total, unit = "MIN") {
  return STRAIN_BANDS.map((b, i) => `
    <div class="ledger-row band-${b.key}">
      <span>${b.label}</span><em>${minutesByBand[i]} ${unit}</em>
      <i><b style="width:${total ? Math.round((minutesByBand[i] / total) * 100) : 0}%"></b></i>
    </div>`).join("");
}

function renderTape() {
  const p = D.model.projection;
  const load = (p.factors.intensity ?? 1) * (p.factors.sport ?? 1) * (p.factors.structure ?? 1);
  const { step, cells } = strainTape(S.hours, S.startIdx, S.duration, load);
  const minutes = STRAIN_BANDS.map(() => 0);
  let peak = 0, html = "";
  cells.forEach((c, i) => {
    peak = Math.max(peak, c.strain);
    minutes[strainBand(c.strain)] += step;
    const v = fmt1(Math.round(c.strain * 10) / 10);
    html += tapeCellHtml(`+${String(c.from).padStart(2, "0")}`, v, c.strain, `+${c.from}–${c.to} min · load ${v} · ${strainLabel(c.strain)}`, i);
  });
  const tape = $("dialTape");
  if (D.tapeHtml !== html) {
    D.tapeHtml = html;
    tape.innerHTML = html + '<span class="tape-cursor" aria-hidden="true"></span>';
    replay(tape, "writing");
  }
  $("dialTapeTitle").textContent = ` · EVERY ${step} MIN OF YOUR ${S.duration}-MIN ${S.intensity.toUpperCase()} ${S.sport === "ride" ? "RIDE" : "RUN"}`;
  const hollow = cells.filter((c) => c.strain >= EASE_OFF_STRAIN).length;
  $("dialTapeState").textContent = hollow ? `${hollow} EASE-OFF ${hollow === 1 ? "CELL" : "CELLS"}` : "ALL CELLS COOLING";
  $("dialTapeState").classList.toggle("warn", hollow > 0);
  countTo($("dialPeak"), Math.round(peak * 10) / 10, (v) => fmt1(Math.round(v * 10) / 10));
  $("dialPeak").classList.toggle("warn", peak >= EASE_OFF_STRAIN);
  $("dialPeakWord").textContent = strainLabel(peak).toUpperCase();
  $("dialLedgerBars").innerHTML = ledgerRows(minutes, S.duration);
}

/* ---------- entry point, called from the main render pass ---------- */
export function renderDial({ readings, win, offset, maxStart, projection, todayIso }) {
  if (needsWire() && !wire()) return;
  if (!readings.length) return;
  const hours = S.hours;
  const th = trainingHours();
  const allDay = (th.from === 0 && th.to === 23) || th.from === th.to + 1;
  const allowedRaw = readings.map((r) => allDay || hourAllowed(r.hour.iso, th.from, th.to));
  // If the whole displayed range sits outside the athlete's hours, don't lock them out.
  const allowed = allowedRaw.some(Boolean) ? allowedRaw : readings.map(() => true);
  const slotByClock = new Array(24).fill(null);
  readings.forEach((r, i) => { slotByClock[hourOf(r.hour.iso)] = i; });
  const selectedSlot = Math.max(0, Math.min(readings.length - 1, S.startIdx - offset));
  const dayPrefix = (iso) => (offset ? "" : (iso.slice(0, 10) !== todayIso ? "TMRW " : ""));
  let best = null;
  if (win) {
    const lo = win.rangeLo - offset, hi = win.rangeHi - offset;
    const a = readings[Math.max(0, lo)];
    if (a) {
      const h0 = hourOf(a.hour.iso);
      const endIso = hours[Math.min(hours.length - 1, win.rangeHi + 1)].iso;
      best = { slot: win.idx - offset, h0, h1: h0 + (hi - lo) + 1,
        label: `${hourLabel(a.hour.iso)}–${hourLabel(endIso)}`.replace(/ (AM|PM)–(\d+) \1/, "–$2 $1") };
    }
  }
  const first = hours[offset];
  const nowClock = !offset && first?.epoch ? hourOf(first.iso) + Math.max(0, Math.min(1, (Date.now() - first.epoch) / 3600000)) : null;
  const shortClock = (h) => hourLabel(`2000-01-01T${String(h % 24).padStart(2, "0")}:00`).replace(" ", "");
  const trainWindow = allDay ? null : { from: th.from, to: th.to, label: `${shortClock(th.from)}–${shortClock(th.to)}` };
  const wedges = readings.map((r, i) => ({ clock: hourOf(r.hour.iso), v: scoreV(r.score), tone: r.rating.tone, dim: !allowed[i], night: !r.hour.isDay }));
  const signature = wedges.map((w) => `${w.clock}:${w.v.toFixed(3)}:${w.tone}:${w.dim ? 1 : 0}`).join("|");
  D.model = {
    readings, offset, maxStart, projection, selectedSlot, best, dayPrefix, slotByClock, allowed,
    lastSlot: Math.min(readings.length - 1, maxStart - offset),
    sunset: !offset && S.meta?.sunset ? parseClock(S.meta.sunset) : null, window: trainWindow,
  };
  const picture = {
    wedges, signature, best, window: trainWindow, now: nowClock,
    refs: [{ v: scoreV(35), label: "35" }, { v: scoreV(55), label: "55" }],
    work: { start: hourOf(readings[selectedSlot].hour.iso), span: S.duration / 60 },
    sweepFrom: nowClock ?? hourOf(readings[0].hour.iso),
  };

  /* --- DOM readouts first: the answer never waits for the motion --- */
  const face = $("dialFace");
  face.setAttribute("aria-valuemin", "0");
  face.setAttribute("aria-valuemax", String(D.model.lastSlot));
  face.setAttribute("aria-valuenow", String(selectedSlot));
  const sel = readings[selectedSlot];
  face.setAttribute("aria-valuetext", `${dayPrefix(sel.hour.iso)}${hourLabel(sel.hour.iso)}, ${sel.rating.rating}, ${sel.score} out of 100${allowed[selectedSlot] ? "" : ", outside your training hours"}`);
  hubFor(D.preview ?? selectedSlot, D.preview != null && D.preview !== selectedSlot);
  $("dialSubtitle").textContent = `${offset ? new Date(first.iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toUpperCase() : "NEXT 24 HOURS"} · ${(S.profile.location?.label || S.meta.label || "").toUpperCase()}`;
  countTo($("dialHours"), allowed.filter(Boolean).length);
  $("dialHoursLabel").textContent = trainWindow ? "IN YOUR HOURS" : "HOURS SCORED";
  $("dialBest").textContent = best ? best.label.replace(" ", " ") : "NONE CLEAR";
  const scores = readings.filter((_, i) => allowed[i]).map((r) => r.score);
  $("dialSpread").textContent = `${Math.min(...scores)}–${Math.max(...scores)}`;
  $("dialFootModel").textContent = `MODEL ${projection.modelVersion.toUpperCase()} · SCORE = 55% EFFORT + 45% RISK`;
  renderCallouts();
  renderTape();

  /* --- then the pictures --- */
  if (D.main) D.main.setModel(picture, { reveal: D.isVisible() });
  else { setMode("settled"); setStep("done"); }
  D.hero?.setModel({ ...picture, window: null, refs: [] }, { reveal: true });
  layoutLeaders();
}
