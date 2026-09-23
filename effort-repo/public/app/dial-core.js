/* The dial renderer: one canvas, one clock face, particles that sort a day.

   It knows nothing about scores, races or the DOM around it. Callers hand it a
   model of up to 24 hour wedges (length 0–1, a tone, and whether the hour is
   dimmed), plus optional arcs and markers, and it draws, sorts, morphs and
   releases. The Today dial, the compact opening dial and the race dial are all
   instances of this class. */

import { reducedMotion } from "./instrument.js";

const TAU = Math.PI * 2;
export const RADII = { sun: 0.30, base: 0.335, max: 0.80, work: 0.855, tones: 0.91, best: 0.952 };
const { sun: R_SUN, base: R_BASE, max: R_MAX, work: R_WORK, tones: R_TONES, best: R_BEST } = RADII;
const TONES = ["ideal", "good", "adjust", "caution", "high", "storm", "avoid"];

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => { const c = 1.25; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
export const clockAngle = (h) => (h / 24) * TAU - Math.PI / 2;
const phase = (t, start, dur) => clamp01((t - start) / dur);

function mulberry(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hexToRgb(hex) {
  const h = String(hex).trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [16, 19, 16];
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
/* Colours come from the live CSS tokens, so dark mode needs no second palette. */
export function readDialColors() {
  const css = window.getComputedStyle(document.documentElement);
  const v = (name, fallback) => (css.getPropertyValue(name) || fallback).trim() || fallback;
  const tones = {};
  for (const t of TONES) tones[t] = v(`--tone-${t}`, "#5d8a3c");
  rgbCache.clear();
  return {
    ink: v("--ink", "#101310"), paper: v("--paper-light", "#faf8f1"),
    acid: v("--acid", "#cfff18"), coral: v("--coral", "#ff725e"), sky: v("--sky", "#a8d2ff"), sun: v("--sun", "#ffdf77"),
    tones,
  };
}

// The full intro and a quicker one for the opening instrument.
const TIMELINES = {
  full: { sample: 0, fly: 260, flyDur: 820, spread: 900, search: 1500, lock: 2050, end: 2500 },
  fast: { sample: 0, fly: 120, flyDur: 620, spread: 520, search: 880, lock: 1120, end: 1450 },
};

export class DialRenderer {
  constructor(canvas, { perHour = 90, compact = false, timeline = "full", seed = 20260923, onMode, onStep } = {}) {
    this.canvas = canvas;
    this.ctx = null;
    try { this.ctx = canvas.getContext("2d"); } catch { this.ctx = null; }
    this.compact = compact;
    this.T = TIMELINES[timeline] ?? TIMELINES.full;
    this.onMode = onMode ?? (() => {});
    this.onStep = onStep ?? (() => {});
    this.perHour = perHour;
    const N = (this.N = perHour * 24);
    this.P = {
      x: new Float32Array(N), y: new Float32Array(N), sx: new Float32Array(N), sy: new Float32Array(N),
      tx: new Float32Array(N), ty: new Float32Array(N), delay: new Float32Array(N), size: new Float32Array(N),
      cr: new Float32Array(N), cphi: new Float32Array(N), cw: new Float32Array(N), cwob: new Float32Array(N),
      ua: new Float32Array(N), ur: new Float32Array(N),
      colFrom: new Array(N), colTo: new Array(N), aTo: new Float32Array(N), aFrom: new Float32Array(N),
    };
    const rnd = mulberry(seed), P = this.P;
    const across = Math.round(Math.sqrt(perHour * 0.9)), deep = Math.ceil(perHour / across);
    for (let i = 0; i < N; i++) {
      P.cr[i] = Math.sqrt(rnd()) * 0.72;
      P.cphi[i] = rnd() * TAU;
      P.cw[i] = (0.05 + rnd() * 0.16) * (rnd() < 0.5 ? -1 : 1);
      P.cwob[i] = rnd() * TAU;
      const k = i % perHour;
      P.ua[i] = ((k % across) + rnd()) / across;
      P.ur[i] = (Math.floor(k / across) + rnd()) / deep;
      P.size[i] = 0.8 + rnd() * 0.45;
    }
    this.colors = readDialColors();
    this.model = null; this.byClock = new Array(24).fill(null);
    this.mode = "cloud"; this.signature = "";
    this.visible = true; this.raf = 0; this.t0 = 0; this.size = 0; this.dpr = 1; this.R = 0; this.cx = 0; this.cy = 0;
    this.sel = { from: 0, to: 0, t0: 0, dur: 0 };
    this.preview = null; this.hatch = null;
    this.tick = this.tick.bind(this);
    this.resize();
  }

  /* ---------- geometry ---------- */
  polar(h, r) {
    const a = clockAngle(h);
    return [this.cx + Math.cos(a) * r * this.R, this.cy + Math.sin(a) * r * this.R];
  }
  radius(v) { return R_BASE + clamp01(v) * (R_MAX - R_BASE); }
  lengthAt(h) {
    const x = (((h - 0.5) % 24) + 24) % 24;
    const a = Math.floor(x), b = (a + 1) % 24, t = x - a;
    const wa = this.byClock[a], wb = this.byClock[b];
    if (!wa && !wb) return null;
    const v = !wa ? wb.v : !wb ? wa.v : lerp(wa.v, wb.v, t * t * (3 - 2 * t));
    return this.radius(v);
  }
  /* Which clock hour is under a client point, or null outside the face. */
  clockAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left - rect.width / 2, y = clientY - rect.top - rect.height / 2;
    const dist = Math.hypot(x, y) / ((rect.width / 2) * 0.88);
    if (dist < R_SUN - 0.04 || dist > 1.12) return null;
    return Math.floor(((Math.atan2(y, x) + Math.PI / 2 + TAU) % TAU) / TAU * 24) % 24;
  }
  anchor(h, r) {
    const rect = this.canvas.getBoundingClientRect();
    const [x, y] = this.polar(h, r);
    const scale = this.size ? rect.width / this.size : 1;
    return [rect.left + x * scale, rect.top + y * scale];
  }

  computeTargets() {
    const m = this.model, P = this.P, C = this.colors, pad = 0.11;
    for (let i = 0; i < this.N; i++) {
      const clock = Math.floor(i / this.perHour);
      const w = this.byClock[clock];
      const h = clock + pad + P.ua[i] * (1 - 2 * pad);
      if (!w) {
        const [x, y] = this.polar(h, R_BASE - 0.012 + P.ur[i] * 0.02);
        P.tx[i] = x; P.ty[i] = y; P.colTo[i] = C.ink; P.aTo[i] = 0.14;
        continue;
      }
      const L = this.lengthAt(h) ?? R_BASE;
      // Biased outward so each wedge has a crisp rim and an airy root.
      const r = R_BASE + 0.012 + Math.pow(P.ur[i], 0.42) * (L - R_BASE - 0.012);
      const [x, y] = this.polar(h, r);
      P.tx[i] = x; P.ty[i] = y;
      P.colTo[i] = w.dim ? C.ink : (C.tones[w.tone] ?? w.tone ?? C.ink);
      P.aTo[i] = w.dim ? 0.2 : 0.92;
    }
    void m;
  }
  cloudPos(i, t) {
    const P = this.P, phi = P.cphi[i] + P.cw[i] * t;
    const r = P.cr[i] * (1 + 0.05 * Math.sin(t * 0.9 + P.cwob[i]));
    return [this.cx + Math.cos(phi) * r * this.R, this.cy + Math.sin(phi) * r * this.R * 0.96];
  }

  /* ---------- lifecycle ---------- */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.round(rect.width);
    if (!size || !this.ctx) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    if (size !== this.size) {
      this.size = size;
      this.canvas.width = size * this.dpr;
      this.canvas.height = size * this.dpr;
      this.hatch = null;
    }
    this.R = (size / 2) * 0.88;
    this.cx = size / 2; this.cy = size / 2;
    if (this.model) {
      this.computeTargets();
      if (this.mode === "settled") this.snapToTargets();
    }
    this.draw(performance.now());
  }
  refreshColors() {
    this.colors = readDialColors();
    if (this.model) { this.computeTargets(); if (this.mode === "settled") this.snapToTargets(); }
    this.draw(performance.now());
  }
  snapToTargets() {
    const P = this.P;
    for (let i = 0; i < this.N; i++) { P.x[i] = P.tx[i]; P.y[i] = P.ty[i]; P.colFrom[i] = P.colTo[i]; P.aFrom[i] = P.aTo[i]; }
  }
  setMode(mode) { this.mode = mode; this.onMode(mode); }

  /* Give the renderer a new day. The first model sorts the cloud (when `reveal`
     allows it); later models morph in place; a new start glides the reticle. */
  setModel(model, { reveal = true } = {}) {
    const prev = this.model;
    this.model = model;
    this.byClock = new Array(24).fill(null);
    for (const w of model.wedges) this.byClock[((w.clock % 24) + 24) % 24] = w;
    if (this.mode === "cloud") {
      this.pending = true;
      this.computeTargets();
      this.sel = { from: model.work?.start ?? 0, to: model.work?.start ?? 0, t0: 0, dur: 0 };
      if (reveal) this.startSort();
      return;
    }
    if (this.mode === "sorting") { this.computeTargets(); this.sel = { from: model.work?.start ?? 0, to: model.work?.start ?? 0, t0: 0, dur: 0 }; return; }
    if (model.signature !== this.signature) this.startMorph();
    if (prev && model.work) {
      const cur = this.currentStart(performance.now());
      let to = model.work.start;
      while (to - cur > 12) to -= 24;
      while (cur - to > 12) to += 24;
      this.sel = Math.abs(to - cur) > 0.01
        ? { from: cur, to, t0: performance.now(), dur: reducedMotion() ? 0 : 460 }
        : { from: to, to, t0: 0, dur: 0 };
    }
    this.kick();
  }
  currentStart(now) {
    const s = this.sel;
    return s.dur ? lerp(s.from, s.to, easeInOutCubic(clamp01((now - s.t0) / s.dur))) : s.to;
  }
  reveal() { if (this.pending && this.model && this.mode === "cloud") this.startSort(); else this.kick(); }
  release() {
    if (this.mode === "cloud") return;
    this.setMode("cloud");
    this.onStep("fetch");
    this.kick();
  }
  startSort() {
    this.pending = false;
    const P = this.P, m = this.model;
    this.computeTargets();
    for (let i = 0; i < this.N; i++) {
      const clock = Math.floor(i / this.perHour);
      const along = (((clock + P.ua[i] - (m.sweepFrom ?? 0)) % 24) + 24) % 24;
      P.delay[i] = (along / 24) * (this.T.flyDur * 0.63) + P.ur[i] * 90;
      P.colFrom[i] = this.colors.ink; P.aFrom[i] = 0.34;
    }
    this.signature = m.signature;
    if (reducedMotion() || !this.ctx) { this.settle(); return; }
    this.t0 = performance.now();
    this.setMode("sorting");
    this.onStep("sample");
    const T = this.T, token = this.t0;
    const at = (ms, fn) => window.setTimeout(() => { if (this.mode === "sorting" && this.t0 === token) fn(); }, ms);
    at(T.fly, () => this.onStep("balance"));
    at(T.search, () => this.onStep("search"));
    at(T.lock, () => this.onStep("lock"));
    this.kick();
  }
  settle() {
    if (this.model) this.computeTargets();
    this.snapToTargets();
    this.setMode("settled");
    this.onStep("done");
    this.draw(performance.now());
  }
  startMorph() {
    const P = this.P;
    if (reducedMotion() || !this.ctx) { this.signature = this.model.signature; this.settle(); return; }
    for (let i = 0; i < this.N; i++) { P.sx[i] = P.x[i]; P.sy[i] = P.y[i]; P.colFrom[i] = P.colTo[i]; P.aFrom[i] = P.aTo[i]; }
    this.computeTargets();
    for (let i = 0; i < this.N; i++) P.delay[i] = P.ur[i] * 80 + (Math.floor(i / this.perHour) % 24) * 4;
    this.signature = this.model.signature;
    this.t0 = performance.now();
    this.setMode("morphing");
    this.kick();
  }
  setPreview(clock) {
    if (this.preview === clock) return;
    this.preview = clock;
    if (this.mode === "settled") this.draw(performance.now());
  }
  setVisible(v) { this.visible = v; if (v) this.kick(); }

  tick(now) {
    this.raf = 0;
    const more = this.draw(now);
    if (more && this.visible && !reducedMotion()) this.raf = window.requestAnimationFrame(this.tick);
  }
  kick() {
    if (!this.ctx) return;
    if (reducedMotion() || !this.visible) { this.draw(performance.now()); return; }
    if (!this.raf) this.raf = window.requestAnimationFrame(this.tick);
  }
  destroy() { if (this.raf) window.cancelAnimationFrame?.(this.raf); this.raf = 0; }

  /* ---------- drawing ---------- */
  arc(h0, h1, r, width, color, alpha = 1, cap = "butt", dash = null) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = cap;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r * this.R, clockAngle(h0), clockAngle(h1));
    ctx.stroke();
    ctx.restore();
  }
  sector(h0, h1, r0, r1, fill, alpha) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha; ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, r1 * this.R, clockAngle(h0), clockAngle(h1));
    ctx.arc(this.cx, this.cy, r0 * this.R, clockAngle(h1), clockAngle(h0), true);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  hatchPattern() {
    if (this.hatch) return this.hatch;
    const tile = document.createElement("canvas");
    const s = Math.round(7 * this.dpr);
    tile.width = s; tile.height = s;
    const t = tile.getContext("2d");
    if (!t) return null;
    t.strokeStyle = this.colors.ink; t.lineWidth = Math.max(1, this.dpr * 0.9);
    t.beginPath(); t.moveTo(0, s); t.lineTo(s, 0); t.moveTo(-1, 1); t.lineTo(1, -1); t.moveTo(s - 1, s + 1); t.lineTo(s + 1, s - 1); t.stroke();
    this.hatch = this.ctx.createPattern(tile, "repeat");
    this.hatch?.setTransform?.(new DOMMatrix().scale(1 / this.dpr));
    return this.hatch;
  }

  draw(now) {
    const ctx = this.ctx;
    if (!ctx || !this.size) return false;
    const C = this.colors, P = this.P, T = this.T, m = this.model;
    const t = now - this.t0, secs = now / 1000, R = this.R;
    const reduced = reducedMotion();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);
    const chrome = this.mode === "sorting" ? easeOutCubic(phase(t, T.fly, 900)) : this.mode === "cloud" ? 0 : 1;
    let animating = this.mode !== "settled";
    const dimClock = (h) => this.byClock[((Math.floor(h) % 24) + 24) % 24]?.dim;

    /* --- bezel: 15-minute ticks, hour names; hours outside the athlete's window fade --- */
    ctx.save();
    ctx.strokeStyle = C.ink;
    for (let q = 0; q < 96; q++) {
      const major = q % 4 === 0, quarter = q % 24 === 0;
      if (this.compact && !major) continue;
      const a = clockAngle(q / 4);
      const r0 = (quarter ? 0.965 : major ? 0.975 : 0.985) * R, r1 = R;
      const off = m && chrome > 0 && dimClock(q / 4);
      ctx.globalAlpha = (quarter ? 0.95 : major ? 0.55 : 0.22) * (off ? 0.35 : 1);
      ctx.lineWidth = quarter ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(this.cx + Math.cos(a) * r0, this.cy + Math.sin(a) * r0);
      ctx.lineTo(this.cx + Math.cos(a) * r1, this.cy + Math.sin(a) * r1);
      ctx.stroke();
    }
    if (!this.compact) {
      ctx.fillStyle = C.ink;
      ctx.font = `600 ${Math.max(9, R * 0.038)}px ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ["12A", "3A", "6A", "9A", "12P", "3P", "6P", "9P"].forEach((n, i) => {
        const off = m && chrome > 0 && dimClock(i * 3);
        ctx.globalAlpha = off ? 0.35 : 0.85;
        const [x, y] = this.polar(i * 3, 1.075);
        ctx.fillText(n, x, y);
      });
    }
    ctx.restore();

    if (m && chrome > 0) {
      for (const w of m.wedges) {
        const h = w.clock;
        if (w.night) this.sector(h, h + 1, R_BASE, R_MAX + 0.02, C.ink, 0.035 * chrome);
        // Hours outside the athlete's training window are hatched out.
        if (w.dim) {
          const pat = this.hatchPattern();
          if (pat) this.sector(h, h + 1, R_BASE - 0.01, R_TONES + 0.03, pat, 0.2 * chrome);
        }
        this.arc(h + 0.02, h + 0.98, R_SUN, Math.max(this.compact ? 2 : 3, R * 0.014), w.night ? C.ink : C.sun, (w.night ? 0.55 : 0.95) * chrome);
      }
      if (!this.compact && m.refs?.length) {
        ctx.save();
        ctx.setLineDash([2, 5]); ctx.lineWidth = 1; ctx.strokeStyle = C.ink;
        m.refs.forEach((ref, i) => {
          ctx.globalAlpha = (i === m.refs.length - 1 ? 0.38 : 0.22) * chrome;
          ctx.beginPath(); ctx.arc(this.cx, this.cy, this.radius(ref.v) * R, 0, TAU); ctx.stroke();
        });
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.6 * chrome; ctx.fillStyle = C.ink;
        ctx.font = `600 ${Math.max(8, R * 0.03)}px ui-monospace, Consolas, monospace`;
        ctx.textAlign = "left";
        for (const ref of m.refs) {
          const [x, y] = this.polar(0.18, this.radius(ref.v));
          ctx.fillText(ref.label, x + 3, y - 5);
        }
        ctx.restore();
      }
    }

    /* --- particles --- */
    const flyT = this.mode === "sorting" ? t - T.fly : this.mode === "morphing" ? t : 0;
    const flyDur = this.mode === "sorting" ? T.flyDur : 620;
    let moving = false;
    const dot = Math.max(this.compact ? 1 : 1.3, R * 0.0105);
    for (let i = 0; i < this.N; i++) {
      let x, y, col, alpha;
      if (this.mode === "cloud") {
        [x, y] = this.cloudPos(i, reduced ? 0 : secs);
        col = C.ink; alpha = 0.34;
      } else if (this.mode === "sorting" || this.mode === "morphing") {
        const local = clamp01((flyT - P.delay[i]) / flyDur);
        if (local < 1) moving = true;
        const e = this.mode === "sorting" ? easeOutBack(local) : easeInOutCubic(local);
        if (this.mode === "sorting" && local <= 0) {
          // Still in the cloud, contracting slightly while the model samples.
          const pull = 1 - 0.08 * easeOutCubic(phase(t, T.sample, T.fly));
          const [cx, cy] = this.cloudPos(i, secs);
          x = this.cx + (cx - this.cx) * pull; y = this.cy + (cy - this.cy) * pull;
          P.sx[i] = x; P.sy[i] = y;
        } else {
          x = lerp(P.sx[i], P.tx[i], e); y = lerp(P.sy[i], P.ty[i], e);
        }
        col = mixColor(P.colFrom[i] ?? C.ink, P.colTo[i], local);
        alpha = lerp(P.aFrom[i] || 0.34, P.aTo[i], local);
      } else {
        x = P.tx[i]; y = P.ty[i]; col = P.colTo[i]; alpha = P.aTo[i];
      }
      P.x[i] = x; P.y[i] = y;
      const s = dot * P.size[i];
      ctx.globalAlpha = alpha * (0.62 + 0.38 * (P.size[i] - 0.8) / 0.45);
      ctx.fillStyle = col;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    if (this.mode === "morphing" && !moving) {
      for (let i = 0; i < this.N; i++) { P.colFrom[i] = P.colTo[i]; P.aFrom[i] = P.aTo[i]; }
      this.setMode("settled");
    }

    if (m && chrome > 0) {
      const draw01 = this.mode === "sorting" ? easeInOutCubic(phase(t, T.spread, 700)) : 1;
      /* --- silhouette contour --- */
      ctx.save();
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.1;
      const first = m.wedges[0]?.clock ?? 0;
      let open = false, lastDim = null;
      const steps = Math.round(m.wedges.length * 10 * draw01);
      ctx.beginPath();
      for (let k = 0; k <= steps; k++) {
        const h = first + k / 10;
        const w = this.byClock[Math.floor(h % 24)];
        const L = this.lengthAt(h);
        if (L == null || !w) { open = false; continue; }
        if (lastDim !== null && lastDim !== !!w.dim) { ctx.stroke(); ctx.beginPath(); open = false; }
        ctx.globalAlpha = (w.dim ? 0.2 : 0.55) * chrome; lastDim = !!w.dim;
        const [x, y] = this.polar(h, L + 0.012);
        if (!open) { ctx.moveTo(x, y); open = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();

      /* --- per-hour tone ring --- */
      m.wedges.forEach((w, i) => {
        const reveal = this.mode === "sorting" ? clamp01(draw01 * m.wedges.length - i) : 1;
        if (reveal <= 0) return;
        if (w.dim) this.arc(w.clock + 0.06, w.clock + 0.06 + 0.88 * reveal, R_TONES, 1.5, C.ink, 0.35, "butt", [2, 3]);
        else this.arc(w.clock + 0.06, w.clock + 0.06 + 0.88 * reveal, R_TONES, Math.max(this.compact ? 2.5 : 3, R * 0.016), C.tones[w.tone] ?? w.tone ?? C.ink, 0.95);
      });

      /* --- training window bracket --- */
      if (m.window && !this.compact) {
        const { from, to } = m.window;
        const end = to >= from ? to + 1 : to + 25;
        const br = 1.035;
        this.arc(from, end, br, 1.5, C.ink, 0.75 * chrome);
        for (const h of [from, end]) {
          const a = clockAngle(h);
          ctx.save(); ctx.globalAlpha = 0.75 * chrome; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(this.cx + Math.cos(a) * (br - 0.03) * R, this.cy + Math.sin(a) * (br - 0.03) * R);
          ctx.lineTo(this.cx + Math.cos(a) * (br + 0.03) * R, this.cy + Math.sin(a) * (br + 0.03) * R);
          ctx.stroke(); ctx.restore();
        }
      }

      /* --- best window --- */
      if (m.best) {
        const p = this.mode === "sorting" ? easeInOutCubic(phase(t, T.search, 520)) : 1;
        if (p > 0) {
          const h0 = m.best.h0, h1 = h0 + (m.best.h1 - h0) * p;
          this.arc(h0, h1, R_BEST, Math.max(this.compact ? 5 : 7, R * 0.036), C.ink, 1, "round");
          this.arc(h0, h1, R_BEST, Math.max(this.compact ? 3 : 4.5, R * 0.024), C.acid, 1, "round");
        }
      }

      /* --- markers (race start / midpoint / finish) --- */
      if (m.markers?.length) {
        ctx.save();
        ctx.font = `700 ${Math.max(8, R * 0.032)}px ui-monospace, Consolas, monospace`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        for (const mk of m.markers) {
          const a = clockAngle(mk.h);
          ctx.globalAlpha = chrome; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(this.cx + Math.cos(a) * (R_WORK - 0.05) * R, this.cy + Math.sin(a) * (R_WORK - 0.05) * R);
          ctx.lineTo(this.cx + Math.cos(a) * (R_TONES + 0.04) * R, this.cy + Math.sin(a) * (R_TONES + 0.04) * R);
          ctx.stroke();
          if (!this.compact && mk.label) {
            const [x, y] = this.polar(mk.h, 1.12);
            const wv = ctx.measureText(mk.label).width + 8;
            ctx.fillStyle = C.ink; ctx.fillRect(x - wv / 2, y - 8, wv, 16);
            ctx.fillStyle = C.paper; ctx.fillText(mk.label, x, y + 0.5);
          }
        }
        ctx.restore();
      }

      /* --- the workout: start reticle + duration arc --- */
      const selP = this.sel.dur ? clamp01((now - this.sel.t0) / this.sel.dur) : 1;
      if (selP < 1) animating = true;
      const lockP = this.mode === "sorting" ? phase(t, T.lock, 420) : 1;
      if (m.work && lockP > 0) {
        const startH = this.currentStart(now);
        const span = Math.min(23.9, m.work.span) * (this.mode === "sorting" ? easeOutCubic(lockP) : 1);
        this.arc(startH, startH + span, R_WORK, Math.max(this.compact ? 2.5 : 3.5, R * 0.02), C.ink, 1, "round");
        const [ex, ey] = this.polar(startH + span, R_WORK);
        ctx.save(); ctx.fillStyle = C.paper; ctx.strokeStyle = C.ink; ctx.lineWidth = this.compact ? 1.5 : 2;
        ctx.beginPath(); ctx.arc(ex, ey, Math.max(2.5, R * 0.016), 0, TAU); ctx.fill(); ctx.stroke(); ctx.restore();
        this.reticle(startH, R_WORK, C.ink, m.work.accent ? (C[m.work.accent] ?? C.acid) : C.acid,
          this.mode === "sorting" ? 1 + 0.9 * (1 - easeOutBack(lockP)) : 1, secs);
      }

      /* --- pointer preview --- */
      if (this.preview != null && this.mode === "settled") {
        const w = this.byClock[this.preview];
        if (w) {
          const h = w.clock;
          ctx.save();
          ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(this.cx, this.cy, (this.radius(w.v) + 0.03) * R, clockAngle(h), clockAngle(h + 1));
          ctx.arc(this.cx, this.cy, (R_BASE - 0.01) * R, clockAngle(h + 1), clockAngle(h), true);
          ctx.closePath(); ctx.stroke(); ctx.restore();
          this.reticle(h, R_WORK, C.ink, C.sky, 0.85, secs, true);
        }
      }

      /* --- now needle --- */
      if (m.now != null) {
        const a = clockAngle(m.now);
        const at = (r) => [this.cx + Math.cos(a) * r * R, this.cy + Math.sin(a) * r * R];
        ctx.save();
        ctx.globalAlpha = chrome;
        ctx.strokeStyle = C.coral; ctx.fillStyle = C.coral; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(...at(R_TONES - 0.035)); ctx.lineTo(...at(1.0)); ctx.stroke();
        ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.globalAlpha = 0.6 * chrome;
        ctx.beginPath(); ctx.moveTo(...at(R_SUN + 0.02)); ctx.lineTo(...at(R_TONES - 0.035)); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = chrome;
        ctx.beginPath(); ctx.arc(...at(R_SUN), this.compact ? 2.5 : 3.5, 0, TAU); ctx.fill();
        const tip = R, w = R * 0.03;
        ctx.beginPath();
        ctx.moveTo(this.cx + Math.cos(a) * (tip + w * 1.4), this.cy + Math.sin(a) * (tip + w * 1.4));
        ctx.lineTo(this.cx + Math.cos(a + 0.035) * tip, this.cy + Math.sin(a + 0.035) * tip);
        ctx.lineTo(this.cx + Math.cos(a - 0.035) * tip, this.cy + Math.sin(a - 0.035) * tip);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    /* --- the scan beam that sorts the cloud --- */
    if (this.mode === "sorting" && m) {
      const sweep = phase(t, T.fly, T.flyDur + 520);
      if (sweep > 0 && sweep < 1) {
        const h = (m.sweepFrom ?? 0) + 24 * easeInOutCubic(sweep);
        const a = clockAngle(h);
        const g = ctx.createLinearGradient(this.cx, this.cy, this.cx + Math.cos(a) * R, this.cy + Math.sin(a) * R);
        g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, C.acid);
        ctx.save();
        ctx.strokeStyle = g; ctx.lineWidth = 2.5; ctx.globalAlpha = Math.sin(sweep * Math.PI);
        ctx.beginPath();
        ctx.moveTo(this.cx + Math.cos(a) * R_BASE * R, this.cy + Math.sin(a) * R_BASE * R);
        ctx.lineTo(this.cx + Math.cos(a) * R, this.cy + Math.sin(a) * R);
        ctx.stroke();
        ctx.restore();
      }
      if (t >= T.end && !moving) {
        for (let i = 0; i < this.N; i++) { P.colFrom[i] = P.colTo[i]; P.aFrom[i] = P.aTo[i]; }
        this.setMode("settled");
        this.onStep("done");
      }
    }
    return animating;
  }

  reticle(h, r, ink, accent, scale, secs, ghost = false) {
    const ctx = this.ctx;
    const [x, y] = this.polar(h, r);
    const s = Math.max(this.compact ? 7 : 10, this.R * 0.05) * scale;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = ghost ? 0.9 : 1;
    ctx.fillStyle = accent; ctx.strokeStyle = ink; ctx.lineWidth = this.compact ? 1.5 : 2;
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
}
