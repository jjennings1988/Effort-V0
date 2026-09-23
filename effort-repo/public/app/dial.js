/* The 24-hour dial.

   The day as one instrument: a clock face where every hour is a wedge of
   particles. Wedge length is the same effort-and-risk score the decision curve
   plots (longer = costlier), colour is its rating, and the ink arc is your
   workout from start to finish. While the forecast loads the particles drift as
   an unsorted grey cloud; when the numbers land they sort themselves clockwise
   into the day.

   Motion rules: every animated number moves between two real values, the
   answer is readable before the motion ends, nothing animates off-screen, and
   reduced-motion preferences get the settled instrument immediately. Canvas
   draws only the picture; every value on it is also in the DOM. */

import { sampleAt, heatStrain, strainLabel, hourLabel, fmt1 } from "../engine.js";
import { S } from "./state.js";
import { $, escHtml } from "./dom.js";
import { requestRender } from "./bus.js";
import * as U from "./units.js";

const PER_HOUR = 90;                 // particles per hour wedge: 9 across × 10 deep
const N = PER_HOUR * 24;
const TAU = Math.PI * 2;

// Radii as fractions of the dial radius.
const R_SUN = 0.30, R_BASE = 0.335, R_MAX = 0.80, R_WORK = 0.855, R_TONES = 0.91, R_BEST = 0.952;

const STEPS = ["fetch", "sample", "balance", "search", "lock"];
const STRAIN_BANDS = [
  { max: 1, key: "free", label: "FREE COOLING" },
  { max: 2, key: "mild", label: "MILD LOAD" },
  { max: 3.5, key: "working", label: "WORKING TO COOL" },
  { max: 5, key: "near", label: "NEAR CAPACITY" },
  { max: Infinity, key: "outrun", label: "COOLING OUTRUN" },
];

/* ---------- small math ---------- */
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => { const c = 1.25; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
// Seeded, so the cloud and the stipple are identical on every load.
function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Clock hours (0–24, midnight at the top, clockwise) → canvas angle.
const clockAngle = (h) => (h / 24) * TAU - Math.PI / 2;
const hourOf = (iso) => Number(iso.slice(11, 13));
const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function parseClock(label) {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(label || "").trim());
  if (!m) return null;
  const h = (Number(m[1]) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
  return h + Number(m[2]) / 60;
}
function hexToRgb(hex) {
  const h = String(hex).trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [16, 19, 16];
}

/* ---------- module state ---------- */
const P = {
  x: new Float32Array(N), y: new Float32Array(N),
  sx: new Float32Array(N), sy: new Float32Array(N),
  tx: new Float32Array(N), ty: new Float32Array(N),
  delay: new Float32Array(N),
  size: new Float32Array(N),
  // cloud orbit parameters (unit-radius space)
  cr: new Float32Array(N), cphi: new Float32Array(N), cw: new Float32Array(N), cwob: new Float32Array(N),
  // stipple coordinates inside a wedge
  ua: new Float32Array(N), ur: new Float32Array(N),
  colFrom: new Array(N), colTo: new Array(N),
  live: new Uint8Array(N),
};
{
  const rnd = mulberry(20260923);
  for (let i = 0; i < N; i++) {
    P.cr[i] = Math.sqrt(rnd()) * 0.72;
    P.cphi[i] = rnd() * TAU;
    P.cw[i] = (0.05 + rnd() * 0.16) * (rnd() < 0.5 ? -1 : 1);
    P.cwob[i] = rnd() * TAU;
    const k = i % PER_HOUR;
    P.ua[i] = ((k % 9) + rnd()) / 9;
    P.ur[i] = (Math.floor(k / 9) + rnd()) / 10;
    P.size[i] = 0.8 + rnd() * 0.45;
  }
}

const D = {
  wired: false, ctx: null, canvas: null, size: 0, dpr: 1, R: 0, cx: 0, cy: 0,
  colors: null,
  model: null,            // latest data from render
  signature: "",          // what the particles currently show
  mode: "empty",          // empty | cloud | sorting | settled | morphing
  visible: false, pendingSort: false,
  t0: 0, raf: 0,
  sel: { from: 0, to: 0, t0: 0, dur: 0 },    // workout-start angle tween (clock hours)
  preview: null,          // slot index under the pointer
  counters: new Map(),
};

/* ---------- colours come from the live CSS tokens, so dark mode just works ---------- */
function readColors() {
  const css = window.getComputedStyle(document.documentElement);
  const v = (name, fallback) => (css.getPropertyValue(name) || fallback).trim() || fallback;
  const tones = {};
  for (const t of ["ideal", "good", "adjust", "caution", "high", "storm", "avoid"]) tones[t] = v(`--tone-${t}`, "#5d8a3c");
  D.colors = {
    ink: v("--ink", "#101310"), paper: v("--paper-light", "#faf8f1"),
    acid: v("--acid", "#cfff18"), coral: v("--coral", "#ff725e"), sky: v("--sky", "#a8d2ff"), sun: v("--sun", "#ffdf77"),
    tones, grey: hexToRgb(v("--ink", "#101310")),
  };
}
const rgbCache = new Map();
function mixColor(a, b, t) {
  const q = Math.round(clamp01(t) * 8) / 8;
  const key = `${a}|${b}|${q}`;
  let out = rgbCache.get(key);
  if (!out) {
    const ca = hexToRgb(a), cb = hexToRgb(b);
    out = `rgb(${Math.round(lerp(ca[0], cb[0], q))},${Math.round(lerp(ca[1], cb[1], q))},${Math.round(lerp(ca[2], cb[2], q))})`;
    rgbCache.set(key, out);
  }
  return out;
}

/* ---------- geometry ---------- */
function slotForClockHour(h) {
  const m = D.model;
  if (!m) return -1;
  const target = Math.floor(((h % 24) + 24) % 24);
  return m.readings.findIndex((r) => hourOf(r.hour.iso) === target);
}
// Wedge length at a fractional clock hour, interpolated between hour centres
// so the silhouette is a smooth contour rather than a staircase.
function lengthAt(h) {
  const m = D.model;
  const byHour = m.scoreByClock;
  const x = (((h - 0.5) % 24) + 24) % 24;
  const a = Math.floor(x), b = (a + 1) % 24, t = x - a;
  const sa = byHour[a], sb = byHour[b];
  if (sa == null && sb == null) return null;
  const s = sa == null ? sb : sb == null ? sa : lerp(sa, sb, t * t * (3 - 2 * t));
  return scoreRadius(s);
}
// Square-root radial scale: most training hours score under 40, and a linear
// scale would crush them into a sliver. Order is preserved; the 35 and 55
// reference rings use the same mapping, so reading against them stays honest.
function scoreRadius(score) { return R_BASE + (0.1 + 0.9 * Math.sqrt(clamp01(score / 100))) * (R_MAX - R_BASE); }
function polar(h, r) {
  const a = clockAngle(h);
  return [D.cx + Math.cos(a) * r * D.R, D.cy + Math.sin(a) * r * D.R];
}

function computeTargets() {
  const m = D.model;
  const pad = 0.11;
  for (let i = 0; i < N; i++) {
    const clock = Math.floor(i / PER_HOUR);
    const slot = m.slotByClock[clock];
    const h = clock + pad + P.ua[i] * (1 - 2 * pad);
    if (slot == null) {
      // No forecast for this clock position: park the particles on the base ring.
      const [x, y] = polar(h, R_BASE - 0.012 + P.ur[i] * 0.02);
      P.tx[i] = x; P.ty[i] = y; P.live[i] = 0;
      P.colTo[i] = D.colors.ink;
      continue;
    }
    const L = lengthAt(h) ?? R_BASE;
    // Biased outward so each wedge has a crisp rim and an airy root.
    const r = R_BASE + 0.012 + Math.pow(P.ur[i], 0.42) * (L - R_BASE - 0.012);
    const [x, y] = polar(h, r);
    P.tx[i] = x; P.ty[i] = y; P.live[i] = 1;
    P.colTo[i] = D.colors.tones[m.readings[slot].rating.tone] ?? D.colors.ink;
  }
}
function cloudPos(i, t) {
  const phi = P.cphi[i] + P.cw[i] * t;
  const r = P.cr[i] * (1 + 0.05 * Math.sin(t * 0.9 + P.cwob[i]));
  return [D.cx + Math.cos(phi) * r * D.R, D.cy + Math.sin(phi) * r * D.R * 0.96];
}

/* ---------- canvas ---------- */
function resize() {
  if (!D.canvas) return;
  const rect = D.canvas.getBoundingClientRect();
  const size = Math.round(rect.width);
  if (!size) return;
  D.dpr = Math.min(2, window.devicePixelRatio || 1);
  if (size !== D.size) {
    D.size = size;
    D.canvas.width = size * D.dpr;
    D.canvas.height = size * D.dpr;
  }
  D.R = (size / 2) * 0.88;
  D.cx = size / 2; D.cy = size / 2;
  if (D.model && D.colors) {
    computeTargets();
    if (D.mode === "settled") for (let i = 0; i < N; i++) { P.x[i] = P.tx[i]; P.y[i] = P.ty[i]; P.colFrom[i] = P.colTo[i]; }
  }
  layoutLeaders();
  draw(performance.now());
}

function arc(ctx, h0, h1, r, width, color, alpha = 1, cap = "butt") {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = cap;
  ctx.beginPath();
  ctx.arc(D.cx, D.cy, r * D.R, clockAngle(h0), clockAngle(h1));
  ctx.stroke();
  ctx.restore();
}
function sector(ctx, h0, h1, r0, r1, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(D.cx, D.cy, r1 * D.R, clockAngle(h0), clockAngle(h1));
  ctx.arc(D.cx, D.cy, r0 * D.R, clockAngle(h1), clockAngle(h0), true);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

// Phase progress helpers: how far along a named stretch of the intro we are.
function phase(t, start, dur) { return clamp01((t - start) / dur); }
const SORT = { sample: 0, fly: 260, flyDur: 820, spread: 900, search: 1500, lock: 2050, end: 2500 };

function draw(now) {
  const ctx = D.ctx;
  if (!ctx || !D.size || !D.colors) return false;
  const C = D.colors;
  const t = (now - D.t0);
  const secs = now / 1000;
  ctx.setTransform(D.dpr, 0, 0, D.dpr, 0, 0);
  ctx.clearRect(0, 0, D.size, D.size);

  const m = D.model;
  const settledish = D.mode === "settled" || D.mode === "morphing";
  // How much of the "instrument" (rings, arcs, labels) is drawn.
  const chrome = D.mode === "sorting" ? easeOutCubic(phase(t, SORT.fly, 900)) : D.mode === "cloud" || D.mode === "empty" ? 0 : 1;
  let animating = D.mode === "cloud" || D.mode === "sorting" || D.mode === "morphing";

  /* --- static clock furniture --- */
  ctx.save();
  ctx.strokeStyle = C.ink; ctx.globalAlpha = 0.9;
  for (let q = 0; q < 96; q++) {
    const major = q % 4 === 0, quarter = q % 24 === 0;
    const a = clockAngle(q / 4);
    const r0 = (quarter ? 0.965 : major ? 0.975 : 0.985) * D.R, r1 = 1.0 * D.R;
    ctx.globalAlpha = quarter ? 0.95 : major ? 0.55 : 0.22;
    ctx.lineWidth = quarter ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(D.cx + Math.cos(a) * r0, D.cy + Math.sin(a) * r0);
    ctx.lineTo(D.cx + Math.cos(a) * r1, D.cy + Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = C.ink;
  ctx.font = `600 ${Math.max(9, D.R * 0.038)}px ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const names = ["12A", "3A", "6A", "9A", "12P", "3P", "6P", "9P"];
  names.forEach((n, i) => {
    const [x, y] = polar(i * 3, 1.075);
    ctx.fillText(n, x, y);
  });
  ctx.restore();

  if (m && chrome > 0) {
    /* --- night shading and the sun ring --- */
    for (const r of m.readings) {
      const h = hourOf(r.hour.iso);
      if (!r.hour.isDay) sector(ctx, h, h + 1, R_BASE, R_MAX + 0.02, C.ink, 0.035 * chrome);
      arc(ctx, h + 0.02, h + 0.98, R_SUN, Math.max(3, D.R * 0.014), r.hour.isDay ? C.sun : C.ink, (r.hour.isDay ? 0.95 : 0.55) * chrome);
    }
    /* --- score reference rings, same thresholds as the decision curve --- */
    ctx.save();
    ctx.setLineDash([2, 5]); ctx.lineWidth = 1; ctx.strokeStyle = C.ink;
    for (const s of [35, 55]) {
      ctx.globalAlpha = (s === 55 ? 0.38 : 0.22) * chrome;
      ctx.beginPath(); ctx.arc(D.cx, D.cy, scoreRadius(s) * D.R, 0, TAU); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.6 * chrome; ctx.fillStyle = C.ink;
    ctx.font = `600 ${Math.max(8, D.R * 0.03)}px ui-monospace, Consolas, monospace`;
    ctx.textAlign = "left";
    for (const s of [35, 55]) {
      const [x, y] = polar(0.18, scoreRadius(s));
      ctx.fillText(String(s), x + 3, y - 5);
    }
    ctx.restore();
  }

  /* --- particles --- */
  const reduced = reducedMotion();
  const flyT = D.mode === "sorting" ? t - SORT.fly : D.mode === "morphing" ? t : 0;
  const flyDur = D.mode === "sorting" ? SORT.flyDur : 620;
  let moving = false;
  for (let i = 0; i < N; i++) {
    let x, y, col, alpha;
    if (D.mode === "cloud" || D.mode === "empty") {
      [x, y] = reduced ? cloudPos(i, 0) : cloudPos(i, secs);
      col = C.ink; alpha = 0.34;
    } else if (D.mode === "sorting" || D.mode === "morphing") {
      const local = clamp01((flyT - P.delay[i]) / flyDur);
      if (local < 1) moving = true;
      const e = D.mode === "sorting" ? easeOutBack(local) : easeInOutCubic(local);
      if (D.mode === "sorting" && local <= 0) {
        // Still in the cloud, contracting slightly while the model samples.
        const pull = 1 - 0.08 * easeOutCubic(phase(t, SORT.sample, SORT.fly));
        const [cx, cy] = cloudPos(i, secs);
        x = D.cx + (cx - D.cx) * pull; y = D.cy + (cy - D.cy) * pull;
        P.sx[i] = x; P.sy[i] = y;
      } else {
        x = lerp(P.sx[i], P.tx[i], e); y = lerp(P.sy[i], P.ty[i], e);
      }
      col = mixColor(P.colFrom[i] ?? C.ink, P.colTo[i], local);
      alpha = lerp(D.mode === "sorting" ? 0.34 : 0.92, P.live[i] ? 0.92 : 0.18, local);
    } else {
      x = P.tx[i]; y = P.ty[i]; col = P.colTo[i]; alpha = P.live[i] ? 0.92 : 0.18;
    }
    P.x[i] = x; P.y[i] = y;
    const s = Math.max(1.3, D.R * 0.0105) * P.size[i];
    ctx.globalAlpha = alpha * (0.62 + 0.38 * (P.size[i] - 0.8) / 0.45);
    ctx.fillStyle = col;
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
  if (D.mode === "morphing" && !moving) finishMorph();

  if (m && chrome > 0) {
    const draw01 = D.mode === "sorting" ? easeInOutCubic(phase(t, SORT.spread, 700)) : 1;
    /* --- silhouette contour --- */
    ctx.save();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.1; ctx.globalAlpha = 0.55 * chrome;
    ctx.beginPath();
    let open = false;
    const first = m.firstClock;
    for (let k = 0; k <= Math.round(m.readings.length * 10 * draw01); k++) {
      const h = first + k / 10;
      const L = lengthAt(h);
      if (L == null || m.slotByClock[Math.floor(h % 24)] == null) { open = false; continue; }
      const [x, y] = polar(h, L + 0.012);
      if (!open) { ctx.moveTo(x, y); open = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    /* --- per-hour rating ring --- */
    m.readings.forEach((r, i) => {
      const h = hourOf(r.hour.iso);
      const reveal = D.mode === "sorting" ? clamp01(draw01 * m.readings.length - i) : 1;
      if (reveal > 0) arc(ctx, h + 0.06, h + 0.06 + 0.88 * reveal, R_TONES, Math.max(3, D.R * 0.016), C.tones[r.rating.tone] ?? C.ink, 0.95);
    });

    /* --- best window --- */
    if (m.best) {
      const p = D.mode === "sorting" ? easeInOutCubic(phase(t, SORT.search, 520)) : 1;
      if (p > 0) {
        const h0 = m.best.h0, h1 = h0 + (m.best.h1 - h0) * p;
        arc(ctx, h0, h1, R_BEST, Math.max(7, D.R * 0.036), C.ink, 1, "round");
        arc(ctx, h0, h1, R_BEST, Math.max(4.5, D.R * 0.024), C.acid, 1, "round");
      }
    }

    /* --- the workout: start reticle + duration arc --- */
    const selP = D.sel.dur ? clamp01((now - D.sel.t0) / D.sel.dur) : 1;
    if (selP < 1) animating = true;
    const lockP = D.mode === "sorting" ? phase(t, SORT.lock, 420) : 1;
    if (lockP > 0) {
      const startH = lerp(D.sel.from, D.sel.to, easeInOutCubic(selP));
      const span = Math.min(23.9, m.durationHours) * (D.mode === "sorting" ? easeOutCubic(lockP) : 1);
      arc(ctx, startH, startH + span, R_WORK, Math.max(3.5, D.R * 0.02), C.ink, 1, "round");
      const [ex, ey] = polar(startH + span, R_WORK);
      ctx.save(); ctx.fillStyle = C.paper; ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ex, ey, Math.max(3, D.R * 0.016), 0, TAU); ctx.fill(); ctx.stroke(); ctx.restore();
      drawReticle(ctx, startH, R_WORK, C.ink, C.acid, D.mode === "sorting" ? 1 + 0.9 * (1 - easeOutBack(lockP)) : 1, secs);
    }

    /* --- pointer preview --- */
    if (D.preview != null && settledish) {
      const r = m.readings[D.preview];
      if (r) {
        const h = hourOf(r.hour.iso);
        ctx.save();
        ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.arc(D.cx, D.cy, (scoreRadius(r.score) + 0.03) * D.R, clockAngle(h), clockAngle(h + 1));
        ctx.arc(D.cx, D.cy, (R_BASE - 0.01) * D.R, clockAngle(h + 1), clockAngle(h), true);
        ctx.closePath(); ctx.stroke(); ctx.restore();
        drawReticle(ctx, h, R_WORK, C.ink, C.sky, 0.85, secs, true);
      }
    }

    /* --- now needle --- */
    if (m.nowClock != null) {
      const a = clockAngle(m.nowClock);
      ctx.save();
      ctx.globalAlpha = chrome;
      ctx.strokeStyle = C.coral; ctx.fillStyle = C.coral; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(D.cx + Math.cos(a) * (R_TONES - 0.035) * D.R, D.cy + Math.sin(a) * (R_TONES - 0.035) * D.R);
      ctx.lineTo(D.cx + Math.cos(a) * 1.0 * D.R, D.cy + Math.sin(a) * 1.0 * D.R);
      ctx.stroke();
      ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.globalAlpha = 0.6 * chrome;
      ctx.beginPath();
      ctx.moveTo(D.cx + Math.cos(a) * (R_SUN + 0.02) * D.R, D.cy + Math.sin(a) * (R_SUN + 0.02) * D.R);
      ctx.lineTo(D.cx + Math.cos(a) * (R_TONES - 0.035) * D.R, D.cy + Math.sin(a) * (R_TONES - 0.035) * D.R);
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = chrome;
      ctx.beginPath(); ctx.arc(D.cx + Math.cos(a) * R_SUN * D.R, D.cy + Math.sin(a) * R_SUN * D.R, 3.5, 0, TAU); ctx.fill();
      const tip = 1.0 * D.R, w = D.R * 0.03;
      ctx.beginPath();
      ctx.moveTo(D.cx + Math.cos(a) * (tip + w * 1.4), D.cy + Math.sin(a) * (tip + w * 1.4));
      ctx.lineTo(D.cx + Math.cos(a + 0.035) * tip, D.cy + Math.sin(a + 0.035) * tip);
      ctx.lineTo(D.cx + Math.cos(a - 0.035) * tip, D.cy + Math.sin(a - 0.035) * tip);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  /* --- the scan beam that sorts the cloud --- */
  if (D.mode === "sorting" && m) {
    const sweep = phase(t, SORT.fly, SORT.flyDur + 520);
    if (sweep > 0 && sweep < 1) {
      const h = m.sweepFrom + 24 * easeInOutCubic(sweep);
      const a = clockAngle(h);
      const g = ctx.createLinearGradient(D.cx, D.cy, D.cx + Math.cos(a) * D.R, D.cy + Math.sin(a) * D.R);
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, C.acid);
      ctx.save();
      ctx.strokeStyle = g; ctx.lineWidth = 2.5; ctx.globalAlpha = Math.sin(sweep * Math.PI);
      ctx.beginPath();
      ctx.moveTo(D.cx + Math.cos(a) * R_BASE * D.R, D.cy + Math.sin(a) * R_BASE * D.R);
      ctx.lineTo(D.cx + Math.cos(a) * D.R, D.cy + Math.sin(a) * D.R);
      ctx.stroke();
      ctx.restore();
    }
    if (t >= SORT.end && !moving) finishSort();
  }

  // The dashed lock ring spins only while the instrument is doing something.
  return animating || (D.mode === "sorting");
}

function drawReticle(ctx, h, r, ink, accent, scale, secs, ghost = false) {
  const [x, y] = polar(h, r);
  const s = Math.max(10, D.R * 0.05) * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = ghost ? 0.9 : 1;
  ctx.fillStyle = accent; ctx.strokeStyle = ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, s * 0.42, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.save();
  ctx.rotate(ghost || reducedMotion() ? 0 : secs * 0.9);
  ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.arc(0, 0, s, 0, TAU); ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(dx * s * 0.62, dy * s * 0.62); ctx.lineTo(dx * s * 1.35, dy * s * 1.35);
  }
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, TAU); ctx.fill();
  ctx.restore();
}

/* ---------- the animation loop only runs while something is moving ---------- */
function tick(now) {
  D.raf = 0;
  const more = draw(now);
  if (more && D.visible && !reducedMotion()) D.raf = window.requestAnimationFrame(tick);
}
function kick() {
  if (!D.ctx) return;
  if (reducedMotion() || !D.visible) { draw(performance.now()); return; }
  if (!D.raf) D.raf = window.requestAnimationFrame(tick);
}

/* ---------- state transitions ---------- */
function setMode(mode) {
  D.mode = mode;
  const chip = $("dialChip");
  const labels = { empty: "CALCULATING", cloud: "CALCULATING", sorting: "SORTING THE DAY", morphing: "RECALCULATING", settled: "LOCKED" };
  if (chip) {
    chip.dataset.state = mode;
    $("dialChipText").textContent = D.preview != null && mode === "settled" ? "PREVIEWING" : labels[mode];
  }
  const inst = $("dialInstrument");
  if (inst) inst.dataset.mode = mode;
}
function setStep(active) {
  const idx = STEPS.indexOf(active);
  document.querySelectorAll("#dialSteps li").forEach((li, i) => {
    li.classList.toggle("done", i < idx || active === "done");
    li.classList.toggle("active", i === idx && active !== "done");
  });
}

function startSort() {
  D.pendingSort = false;
  const reduced = reducedMotion() || !D.ctx;
  computeTargets();
  const m = D.model;
  // Stagger clockwise from "now" (or the start of the displayed day).
  for (let i = 0; i < N; i++) {
    const clock = Math.floor(i / PER_HOUR);
    const along = (((clock + P.ua[i] - m.sweepFrom) % 24) + 24) % 24;
    P.delay[i] = (along / 24) * 520 + P.ur[i] * 90;
    P.colFrom[i] = D.colors?.ink;
  }
  D.sel = { from: m.startClock, to: m.startClock, t0: 0, dur: 0 };
  D.signature = m.signature;
  if (reduced) { settleNow(); return; }
  D.t0 = performance.now();
  setMode("sorting");
  setStep("sample");
  const inst = $("dialInstrument");
  inst?.classList.remove("revealed");
  window.setTimeout(() => D.mode === "sorting" && setStep("balance"), SORT.fly);
  window.setTimeout(() => D.mode === "sorting" && setStep("search"), SORT.search);
  window.setTimeout(() => D.mode === "sorting" && setStep("lock"), SORT.lock);
  window.setTimeout(() => { if (D.mode === "sorting") inst?.classList.add("revealed"); }, SORT.search);
  kick();
}
function finishSort() {
  for (let i = 0; i < N; i++) P.colFrom[i] = P.colTo[i];
  setMode("settled");
  setStep("done");
  $("dialInstrument")?.classList.add("revealed");
}
function settleNow() {
  if (D.colors && D.model) computeTargets();
  for (let i = 0; i < N; i++) { P.x[i] = P.tx[i]; P.y[i] = P.ty[i]; P.colFrom[i] = P.colTo[i]; }
  setMode("settled");
  setStep("done");
  $("dialInstrument")?.classList.add("revealed");
  if (D.ctx) draw(performance.now());
}
function startMorph() {
  if (reducedMotion() || !D.ctx) { D.signature = D.model.signature; settleNow(); return; }
  for (let i = 0; i < N; i++) { P.sx[i] = P.x[i]; P.sy[i] = P.y[i]; P.colFrom[i] = P.colTo[i]; }
  computeTargets();
  for (let i = 0; i < N; i++) P.delay[i] = P.ur[i] * 80 + (Math.floor(i / PER_HOUR) % 24) * 4;
  D.signature = D.model.signature;
  D.t0 = performance.now();
  setMode("morphing");
  kick();
}
function finishMorph() {
  for (let i = 0; i < N; i++) P.colFrom[i] = P.colTo[i];
  setMode("settled");
}

const introRunning = () => document.body.matches(".orb-calculating, .orb-locking, .orb-revealing");
function canReveal() { return D.visible && !introRunning(); }
function maybeReveal() {
  if (!canReveal()) return;
  if (D.pendingSort && D.model) startSort();
  else kick();
}

/* Called by the network layer: a new forecast is on its way. */
export function dialSignal(mode) {
  if (mode !== "loading") return;
  if (needsWire() && !wire()) return;
  if (D.mode === "settled" || D.mode === "morphing") {
    // Release: the settled day dissolves back into an unsorted cloud.
    setMode("cloud");
    setStep("fetch");
    $("dialInstrument")?.classList.remove("revealed");
    kick();
  }
}

/* ---------- DOM readouts ---------- */
function countTo(id, value, format = (v) => String(Math.round(v))) {
  const el = $(id);
  if (!el) return;
  const prev = D.counters.get(id);
  D.counters.set(id, value);
  if (prev == null || prev === value || reducedMotion() || !D.ctx) { el.textContent = format(value); return; }
  const t0 = performance.now(), dur = 520;
  const step = (now) => {
    const p = clamp01((now - t0) / dur);
    if (D.counters.get(id) !== value) return;
    el.textContent = format(lerp(prev, value, easeOutCubic(p)));
    if (p < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

function hubFor(slot, previewing) {
  const m = D.model;
  const r = m.readings[slot];
  if (!r) return;
  $("dialHub").dataset.tone = r.rating.tone;
  $("dialHub").classList.toggle("previewing", previewing);
  $("dialHubKicker").textContent = previewing ? "PREVIEW · CLICK TO USE" : "YOUR START";
  $("dialHubTime").textContent = (m.dayPrefix(r.hour.iso) + hourLabel(r.hour.iso)).trim();
  $("dialHubScore").textContent = `${r.score}/100 · ${r.rating.rating.toUpperCase()}`;
  $("dialHubDetail").textContent = `${U.temp(r.hour.temp)} AIR · ${U.temp(r.hour.dew)} DEW · ${U.wind(r.hour.wind)} ${U.windUnit()}`;
}

function callout(key, tone, label, value, sub, meter, anchor) {
  return { key, tone, label, value, sub, meter, anchor };
}
function buildCallouts() {
  const m = D.model;
  const out = [];
  if (m.best) {
    const r = m.readings[m.best.slot];
    out.push(callout("best", "acid", "BEST WINDOW", m.best.label, `${r.score}/100 · ${r.rating.rating.toUpperCase()}`,
      1 - r.score / 100, [(m.best.h0 + m.best.h1) / 2, R_BEST + 0.03]));
  }
  const hardest = m.readings.reduce((a, r) => (!a || r.score > a.score ? r : a), null);
  if (hardest && (!m.best || m.readings[m.best.slot] !== hardest)) {
    const h = hourOf(hardest.hour.iso) + 0.5;
    out.push(callout("hard", "coral", "HARDEST HOUR", `${m.dayPrefix(hardest.hour.iso)}${hourLabel(hardest.hour.iso)}`,
      `${hardest.score}/100 · ${U.temp(hardest.hour.temp)} AIR`, hardest.score / 100, [h, R_TONES + 0.03]));
  }
  const muggy = m.readings.reduce((a, r) => (!a || r.hour.dew > a.hour.dew ? r : a), null);
  if (muggy) {
    const h = hourOf(muggy.hour.iso) + 0.5;
    out.push(callout("dew", "sky", "DEW POINT PEAK", `${U.temp(muggy.hour.dew)}`,
      `${m.dayPrefix(muggy.hour.iso)}${hourLabel(muggy.hour.iso)} · SWEAT ESCAPES SLOWEST`, clamp01((muggy.hour.dew - 40) / 40), [h, R_TONES + 0.03]));
  }
  if (m.sunset != null) {
    out.push(callout("sun", "sun", "SUNSET", S.meta.sunset, `SUNRISE ${S.meta.sunrise || "—"} · SHADED BAND = DARK`,
      null, [m.sunset, R_TONES + 0.03]));
  } else {
    const coolest = m.readings.reduce((a, r) => (!a || r.hour.temp < a.hour.temp ? r : a), null);
    if (coolest) out.push(callout("cool", "ink", "COOLEST HOUR", `${U.temp(coolest.hour.temp)}`,
      `${m.dayPrefix(coolest.hour.iso)}${hourLabel(coolest.hour.iso)}`, null, [hourOf(coolest.hour.iso) + 0.5, R_TONES + 0.03]));
  }
  // Split by which side of the dial the anchor sits on, then balance two per side.
  const side = (c) => Math.cos(clockAngle(c.anchor[0]));
  const sorted = out.sort((a, b) => side(a) - side(b));
  const left = sorted.slice(0, Math.floor(sorted.length / 2)), right = sorted.slice(Math.floor(sorted.length / 2));
  const byY = (a, b) => Math.sin(clockAngle(a.anchor[0])) - Math.sin(clockAngle(b.anchor[0]));
  return { left: left.sort(byY), right: right.sort(byY) };
}
function calloutHtml(c) {
  const meter = c.meter == null ? "" : `<span class="dial-meter"><i style="width:${Math.round(clamp01(c.meter) * 100)}%"></i></span>`;
  return `<div class="dial-callout" data-key="${c.key}" data-tone="${c.tone}" data-h="${c.anchor[0].toFixed(3)}" data-r="${c.anchor[1].toFixed(3)}">
    <span class="dial-callout-label">${escHtml(c.label)}</span>
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
  const svg = $("dialLeaders"), stage = $("dialStage"), face = $("dialFace");
  if (!svg || !stage || !face || !D.size) return;
  const s = stage.getBoundingClientRect(), f = face.getBoundingClientRect();
  if (!s.width) return;
  svg.setAttribute("viewBox", `0 0 ${s.width.toFixed(1)} ${s.height.toFixed(1)}`);
  const stacked = window.getComputedStyle(stage).getPropertyValue("--dial-stacked").trim() === "1";
  if (stacked) { svg.innerHTML = ""; return; }
  const scale = f.width / D.size;
  let html = "";
  document.querySelectorAll("#dialStage .dial-callout").forEach((el) => {
    const b = el.getBoundingClientRect();
    const left = el.closest(".left") != null;
    const [ax, ay] = polar(Number(el.dataset.h), Number(el.dataset.r));
    const tx = f.left - s.left + ax * scale, ty = f.top - s.top + ay * scale;
    const sx = (left ? b.right : b.left) - s.left, sy = b.top - s.top + 14;
    const ex = sx + (left ? 18 : -18);
    const d = `M${sx.toFixed(1)},${sy.toFixed(1)} H${ex.toFixed(1)} L${tx.toFixed(1)},${ty.toFixed(1)}`;
    html += `<path class="dial-leader" data-tone="${el.dataset.tone}" d="${d}" pathLength="1"/><circle class="dial-leader-dot" cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="3"/>`;
  });
  svg.innerHTML = html;
}

function renderTape() {
  const m = D.model;
  const hours = S.hours;
  const dur = S.duration;
  const step = dur <= 90 ? 5 : dur <= 180 ? 10 : 15;
  const cells = Math.max(1, Math.round(dur / step));
  const p = m.projection;
  const load = (p.factors.intensity ?? 1) * (p.factors.sport ?? 1) * (p.factors.structure ?? 1);
  const bands = STRAIN_BANDS.map((b) => ({ ...b, minutes: 0 }));
  let peak = 0, html = "";
  for (let c = 0; c < cells; c++) {
    const mid = (c + 0.5) * step;
    const smp = sampleAt(hours, S.startIdx + mid / 60);
    const strain = heatStrain(smp.temp, smp.dew, smp.solar, smp.wind, { metabolicLoad: load });
    peak = Math.max(peak, strain);
    const bi = STRAIN_BANDS.findIndex((b) => strain < b.max);
    bands[bi].minutes += step;
    const hollow = strain >= 3.5;
    html += `<span class="tape-cell band-${STRAIN_BANDS[bi].key}${hollow ? " hollow" : ""}" style="--i:${c}"
      title="${escHtml(`+${Math.round(c * step)}–${Math.round((c + 1) * step)} min · load ${fmt1(Math.round(strain * 10) / 10)} · ${strainLabel(strain)}`)}">
      <small>+${String(Math.round(c * step)).padStart(2, "0")}</small><b>${fmt1(Math.round(strain * 10) / 10)}</b></span>`;
  }
  const tape = $("dialTape");
  if (D.tapeHtml !== html) {
    D.tapeHtml = html;
    tape.innerHTML = html + '<span class="tape-cursor" aria-hidden="true"></span>';
    tape.classList.remove("writing");
    void tape.offsetWidth; // restart the typewriter
    tape.classList.add("writing");
  }
  $("dialTapeTitle").textContent = ` · EVERY ${step} MIN OF YOUR ${dur}-MIN ${S.intensity.toUpperCase()} ${S.sport === "ride" ? "RIDE" : "RUN"}`;
  const hollowCount = tape.querySelectorAll(".hollow").length;
  $("dialTapeState").textContent = hollowCount ? `${hollowCount} EASE-OFF ${hollowCount === 1 ? "CELL" : "CELLS"}` : "ALL CELLS COOLING";
  $("dialTapeState").classList.toggle("warn", hollowCount > 0);

  countTo("dialPeak", Math.round(peak * 10) / 10, (v) => fmt1(Math.round(v * 10) / 10));
  $("dialPeak").classList.toggle("warn", peak >= 3.5);
  $("dialPeakWord").textContent = strainLabel(peak).toUpperCase();
  $("dialLedgerBars").innerHTML = bands.map((b) => `
    <div class="ledger-row band-${b.key}">
      <span>${b.label}</span><em>${b.minutes} MIN</em>
      <i><b style="width:${Math.round((b.minutes / dur) * 100)}%"></b></i>
    </div>`).join("");
}

/* ---------- input ---------- */
function slotAtPointer(ev) {
  const rect = D.canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left - rect.width / 2, y = ev.clientY - rect.top - rect.height / 2;
  const dist = Math.hypot(x, y) / (rect.width / 2 * 0.88);
  if (dist < R_SUN - 0.04 || dist > 1.12) return null;
  const clockH = ((Math.atan2(y, x) + Math.PI / 2 + TAU) % TAU) / TAU * 24;
  const slot = slotForClockHour(clockH);
  return slot < 0 ? null : slot;
}
function setPreview(slot) {
  if (D.preview === slot) return;
  D.preview = slot;
  const m = D.model;
  if (!m) return;
  hubFor(slot ?? m.selectedSlot, slot != null && slot !== m.selectedSlot);
  setMode(D.mode);
  if (D.mode === "settled") draw(performance.now());
}
function commit(slot) {
  const m = D.model;
  if (!m || slot == null) return;
  const idx = m.offset + slot;
  if (idx > m.maxStart || idx === S.startIdx) return;
  S.startIdx = idx;
  requestRender();
}

// Wired once per canvas element, so a replaced document gets fresh listeners.
const needsWire = () => !D.wired || D.canvas !== $("dialCanvas");
function wire() {
  const face = $("dialFace");
  D.canvas = $("dialCanvas");
  if (!face || !D.canvas) return false;
  if (D.raf) window.cancelAnimationFrame?.(D.raf);
  Object.assign(D, { ctx: null, size: 0, model: null, signature: "", mode: "empty", visible: false, pendingSort: false, raf: 0, preview: null, tapeHtml: "" });
  D.counters.clear();
  // No IntersectionObserver means a non-visual environment (tests, very old
  // browsers): keep every DOM readout, skip the canvas picture.
  if ("IntersectionObserver" in window) {
    try { D.ctx = D.canvas.getContext("2d"); } catch { D.ctx = null; }
    new window.IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      D.visible = e.isIntersecting;
      maybeReveal();
    }, { threshold: 0.28 }).observe(face);
    // The opening orb covers the page; intersection can't see that, so also
    // wait for the intro classes to leave <body> before sorting the day.
    new window.MutationObserver(maybeReveal).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  } else {
    D.visible = true;
  }
  if (!D.ctx) $("dialInstrument")?.classList.add("no-canvas");
  readColors();
  if ("ResizeObserver" in window) new window.ResizeObserver(() => resize()).observe(D.canvas);
  else window.addEventListener("resize", resize);
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    rgbCache.clear(); readColors(); if (D.model) computeTargets();
    for (let i = 0; i < N; i++) P.colFrom[i] = P.colTo[i];
    draw(performance.now());
  });

  face.addEventListener("pointermove", (ev) => {
    if (ev.pointerType !== "mouse" || D.mode !== "settled") return;
    const slot = slotAtPointer(ev);
    face.style.cursor = slot == null ? "default" : "pointer";
    setPreview(slot);
  });
  face.addEventListener("pointerleave", () => setPreview(null));
  let down = null;
  face.addEventListener("pointerdown", (ev) => { down = { x: ev.clientX, y: ev.clientY }; });
  face.addEventListener("pointerup", (ev) => {
    if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 10) { down = null; return; }
    down = null;
    if (D.mode === "sorting") return;
    const slot = slotAtPointer(ev);
    if (slot != null) { D.preview = null; commit(slot); }
  });
  face.addEventListener("keydown", (ev) => {
    const m = D.model;
    if (!m) return;
    const last = Math.min(m.readings.length - 1, m.maxStart - m.offset);
    let slot = m.selectedSlot;
    if (ev.key === "ArrowRight" || ev.key === "ArrowUp") slot++;
    else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") slot--;
    else if (ev.key === "Home") slot = 0;
    else if (ev.key === "End") slot = last;
    else if (ev.key === "Enter" && m.best) slot = m.best.slot;
    else return;
    ev.preventDefault();
    commit(Math.max(0, Math.min(last, slot)));
  });
  D.wired = true;
  setMode("cloud");
  setStep("fetch");
  resize();
  kick();
  return true;
}

/* ---------- entry point, called from the main render pass ---------- */
export function renderDial({ readings, win, offset, maxStart, projection, todayIso }) {
  if (needsWire() && !wire()) return;
  if (!readings.length) return;
  const hours = S.hours;
  const scoreByClock = new Array(24).fill(null), slotByClock = new Array(24).fill(null);
  readings.forEach((r, i) => { const h = hourOf(r.hour.iso); scoreByClock[h] = r.score; slotByClock[h] = i; });
  const selectedSlot = Math.max(0, Math.min(readings.length - 1, S.startIdx - offset));
  const dayPrefix = (iso) => (offset ? "" : (iso.slice(0, 10) !== todayIso ? "TMRW " : ""));
  let best = null;
  if (win) {
    const lo = win.rangeLo - offset, hi = win.rangeHi - offset;
    const a = readings[Math.max(0, lo)], b = readings[Math.min(readings.length - 1, hi)];
    if (a && b) {
      const h0 = hourOf(a.hour.iso);
      const h1 = h0 + (hi - lo) + 1;
      const endIso = hours[Math.min(hours.length - 1, win.rangeHi + 1)].iso;
      best = { slot: win.idx - offset, h0, h1, label: `${hourLabel(a.hour.iso)}–${hourLabel(endIso)}`.replace(/ (AM|PM)–(\d+) \1/, "–$2 $1") };
    }
  }
  const first = hours[offset];
  let nowClock = null;
  if (!offset && first?.epoch) {
    const mins = clamp01((Date.now() - first.epoch) / 3600000);
    nowClock = hourOf(first.iso) + mins;
  }
  const sunset = !offset && S.meta?.sunset ? parseClock(S.meta.sunset) : null;
  const model = {
    readings, offset, maxStart, projection, selectedSlot, best, dayPrefix,
    scoreByClock, slotByClock, firstClock: hourOf(readings[0].hour.iso),
    startClock: hourOf(readings[selectedSlot].hour.iso),
    durationHours: S.duration / 60,
    nowClock, sunset,
    sweepFrom: nowClock ?? hourOf(readings[0].hour.iso),
    signature: readings.map((r) => `${r.hour.iso}:${r.score}:${r.rating.tone}`).join("|"),
  };
  const prev = D.model;
  D.model = model;

  /* --- DOM readouts first: the answer never waits for the motion --- */
  const face = $("dialFace");
  face.setAttribute("aria-valuemin", "0");
  face.setAttribute("aria-valuemax", String(readings.length - 1));
  face.setAttribute("aria-valuenow", String(selectedSlot));
  const sel = readings[selectedSlot];
  face.setAttribute("aria-valuetext", `${dayPrefix(sel.hour.iso)}${hourLabel(sel.hour.iso)}, ${sel.rating.rating}, ${sel.score} out of 100`);
  hubFor(D.preview ?? selectedSlot, D.preview != null && D.preview !== selectedSlot);
  $("dialSubtitle").textContent = `${offset ? new Date(first.iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toUpperCase() : "NEXT 24 HOURS"} · ${(S.profile.location?.label || S.meta.label || "").toUpperCase()}`;
  countTo("dialHours", readings.length);
  $("dialBest").textContent = best ? `${best.label.replace(" ", " ")}` : "NONE CLEAR";
  const scores = readings.map((r) => r.score);
  $("dialSpread").textContent = `${Math.min(...scores)}–${Math.max(...scores)}`;
  $("dialFootModel").textContent = `MODEL ${projection.modelVersion.toUpperCase()} · SCORE = 55% EFFORT + 45% RISK`;
  renderCallouts();
  renderTape();

  /* --- then the picture --- */
  if (!D.colors) readColors();
  if (D.mode === "cloud" || D.mode === "empty") {
    if (canReveal() || !D.ctx) startSort(); else { D.pendingSort = true; computeTargets(); }
  } else if (D.mode === "sorting") {
    computeTargets();
  } else if (model.signature !== D.signature) {
    startMorph();
  }
  // Move the workout reticle the short way round the clock.
  if (D.mode === "sorting" || !prev) {
    D.sel = { from: model.startClock, to: model.startClock, t0: 0, dur: 0 };
  } else {
    const cur = D.sel.dur ? lerp(D.sel.from, D.sel.to, easeInOutCubic(clamp01((performance.now() - D.sel.t0) / D.sel.dur))) : D.sel.to;
    let to = model.startClock;
    while (to - cur > 12) to -= 24;
    while (cur - to > 12) to += 24;
    if (Math.abs(to - cur) > 0.01) {
      D.sel = { from: cur, to, t0: performance.now(), dur: reducedMotion() ? 0 : 460 };
      kick();
    } else {
      D.sel = { from: to, to, t0: 0, dur: 0 };
    }
  }
  layoutLeaders();
  if (D.mode === "settled") draw(performance.now());
}
