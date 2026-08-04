/* DOM helpers and the app's error boundary. */

export const $ = (id) => document.getElementById(id);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

export function toggleClass(el, name, on) {
  if (el) el.classList.toggle(name, on);
}

/* ---------- error boundary ----------
   Previously an exception anywhere in render() left the UI frozen halfway
   through an update with no indication anything had gone wrong. Now it says so. */

let failures = 0;

export function showFatal(err, label) {
  failures++;
  const strip = $("errorStrip");
  if (!strip) { console.error(label, err); return; }
  strip.hidden = false;
  const detail = $("errorDetail");
  if (detail) detail.textContent = `${label}: ${err?.message || String(err)}`;
  console.error(`[effortcast] ${label}`, err);
}

export function clearFatal() {
  const strip = $("errorStrip");
  if (strip) strip.hidden = true;
}

/* Wrap anything that touches the DOM. Returns undefined on failure rather than
   propagating, so one broken panel cannot take the whole page down. */
export function guard(fn, label = "render") {
  return (...args) => {
    try {
      const out = fn(...args);
      if (label === "render") clearFatal();
      return out;
    } catch (err) {
      showFatal(err, label);
      return undefined;
    }
  };
}

export function failureCount() { return failures; }
