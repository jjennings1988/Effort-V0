/* The instrument kit: small motion and linking helpers shared by every panel
   drawn in the dial's language. Nothing here computes a model value.

   Rules it enforces: numbers only move between two real values, motion waits
   until a panel is actually on screen, and reduced-motion users get the end
   state immediately. */

export const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* The opening instrument covers the page; nothing underneath should play its
   entrance until it has docked. */
export const introRunning = () => !!document.body?.matches(".orb-calculating, .orb-locking, .orb-revealing");

/* Count a number from its previous real value to its new one. The first
   value is simply shown: there is no honest "from" for it. */
const counts = new WeakMap();
export function countTo(el, value, format = (v) => String(Math.round(v))) {
  if (!el) return;
  const prev = counts.get(el);
  counts.set(el, value);
  if (!Number.isFinite(value)) { el.textContent = format(value); return; }
  if (prev == null || !Number.isFinite(prev) || prev === value || reducedMotion() || !window.requestAnimationFrame) {
    el.textContent = format(value);
    return;
  }
  const t0 = performance.now(), dur = 520;
  const step = (now) => {
    if (counts.get(el) !== value) return;
    const p = Math.min(1, (now - t0) / dur);
    el.textContent = format(prev + (value - prev) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) window.requestAnimationFrame(step);
    else el.textContent = format(value);
  };
  window.requestAnimationFrame(step);
}

/* Restart a CSS entrance (typewriter, tape fill) on an element. */
export function replay(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/* Run `onShow` whenever the element is at least `threshold` visible and the
   opening instrument is out of the way. Without IntersectionObserver (tests,
   very old browsers) the element counts as always visible. */
export function watchVisibility(el, onChange, threshold = 0.28) {
  if (!el) return () => false;
  if (!("IntersectionObserver" in window)) { onChange(true); return () => true; }
  let seen = false;
  const report = () => onChange(seen && !introRunning());
  new window.IntersectionObserver((entries) => { seen = entries[entries.length - 1].isIntersecting; report(); }, { threshold }).observe(el);
  new window.MutationObserver(report).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  return () => seen && !introRunning();
}

/* One shared "which hour is being looked at" signal, so hovering the dial
   previews the curve and vice versa. Each consumer registers under a key, so
   re-rendering replaces a listener instead of stacking them. */
const hoverListeners = new Map();
let hovered = null;
export function onHover(key, fn) { hoverListeners.set(key, fn); }
export function setHover(index, source) {
  if (hovered === index) return;
  hovered = index;
  for (const [key, fn] of hoverListeners) if (key !== source) fn(index);
}
