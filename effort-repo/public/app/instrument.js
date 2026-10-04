/* The instrument kit: small motion and linking helpers shared by every panel
   drawn in the dial's language. Nothing here computes a model value.

   Rules it enforces: numbers only move between two real values, motion waits
   until a panel is actually on screen, and reduced-motion users get the end
   state immediately. */

export const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* The opening instrument covers the page; nothing underneath should play its
   entrance until it has docked. */
export const introRunning = () => !!document.body?.matches(".orb-calculating, .orb-locking, .orb-revealing");

/* The full opening is a first-glance-of-the-day moment. Later launches the same
   day skip it and arrive already sorted. (index.html reads the same key before
   first paint, so a quick launch never flashes the full-screen intro.) */
const INTRO_KEY = "effort-intro-day";
const today = () => new Date().toDateString();
export function introSeenToday() {
  try { return localStorage.getItem(INTRO_KEY) === today(); } catch { return false; }
}
export function markIntroSeen() {
  try { localStorage.setItem(INTRO_KEY, today()); } catch { /* private mode: replay tomorrow */ }
}

/* The app's one polite live region. Everything that wants to be heard goes
   through it, so a screen reader hears one sentence, not three regions. */
export function announce(text) {
  const live = document.getElementById("liveSummary");
  if (!live) return;
  live.textContent = "";
  window.setTimeout(() => {
    live.textContent = text;
    // Spoken once, then cleared (removals are not read out), so the region
    // never holds a stale sentence.
    window.setTimeout(() => { if (live.textContent === text) live.textContent = ""; }, 7000);
  }, 60);
}

/* A short-lived confirmation above the bottom nav, with an optional action
   (Undo, Edit in Plan). One at a time; hovering or focusing it holds it open.
   `focus` moves keyboard users to the action, since the control they used may
   have just left the page. */
let toastEl = null, toastTimer = null;
export function toast(message, { action, onAction, duration = 4500, announce: say = true, focus = false } = {}) {
  if (!document.body) return;
  if (!toastEl || !toastEl.isConnected || toastEl.ownerDocument !== document) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    toastEl.id = "toast";
    toastEl.innerHTML = '<span class="toast-msg"></span><button type="button" class="toast-action"></button>';
    document.body.appendChild(toastEl);
    const hold = () => window.clearTimeout(toastTimer);
    const resume = () => { if (!toastEl.matches(":hover, :focus-within")) arm(toastEl.dataset.duration); };
    toastEl.addEventListener("pointerenter", hold);
    toastEl.addEventListener("focusin", hold);
    toastEl.addEventListener("pointerleave", resume);
    toastEl.addEventListener("focusout", resume);
  }
  const el = toastEl, btn = el.querySelector(".toast-action");
  el.querySelector(".toast-msg").textContent = message;
  btn.hidden = !action;
  btn.textContent = action || "";
  btn.onclick = () => { hideToast(); onAction?.(); };
  el.dataset.duration = String(duration);
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add("show");
  arm(duration);
  if (say) announce(action ? `${message}. ${action[0]}${action.slice(1).toLowerCase()} is available.` : message);
  if (focus && action) btn.focus({ preventScroll: true });
}
function arm(ms) {
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, Number(ms) || 4500);
}
export function hideToast() {
  window.clearTimeout(toastTimer);
  if (!toastEl) return;
  toastEl.classList.remove("show");
  const el = toastEl;
  window.setTimeout(() => { if (!el.classList.contains("show")) el.hidden = true; }, reducedMotion() ? 0 : 220);
}

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

/* ---------- page-wide entrances ----------
   Headlines wipe up out of a mask, kickers slide in, panels rise with a
   stagger among their siblings. Entrances wait for the opening instrument to
   dock, and a tab's content replays its entrance each time the tab opens
   (elements in a hidden tab panel drop back to their pre-entrance state). */
const REVEAL_PANELS = [
  ".inst", ".readout-panel", ".why-panel", ".explain-panel", ".briefing", ".finish-strip",
  ".feedback-section", ".profile-block", ".race-panel", ".planner-rack > *", ".ribbon-metric-control",
  ".hour-ribbon", ".radar-frame", ".score-legend", ".method-strip", ".adapt-section", "#plannerGrid",
  ".planner-summary", ".release-note",
].join(",");
export function initReveal() {
  if (!("IntersectionObserver" in window) || reducedMotion() || document.documentElement.classList.contains("reveal-ready")) return;
  // The first screen (answer, Today's dial, conditions) arrives with the
  // opening hand-off, not with the scroll reveal.
  const skip = (el) => el.closest(".poster, .answer-card, .dial-section, .masthead, .setup, dialog, .inst .inst");
  const tag = (el, kind, delay) => {
    if (skip(el) || el.dataset.reveal) return;
    el.dataset.reveal = kind;
    if (delay) el.style.setProperty("--rd", `${delay}ms`);
  };
  // Title blocks reveal as a group: a headline clipped for its wipe has no
  // visible area of its own, so the block is what gets observed.
  document.querySelectorAll(".section-title-block").forEach((block) => {
    if (skip(block)) return;
    const kicker = block.querySelector("span"), title = block.querySelector("h1, h2"), lead = block.querySelector(":scope > p");
    if (kicker) tag(kicker, "kicker", 0);
    if (title) tag(title, "title", 60);
    if (lead) tag(lead, "panel", 180);
    block.dataset.revealGroup = "";
  });
  document.querySelectorAll(REVEAL_PANELS).forEach((el) => {
    const siblings = [...el.parentElement.children].filter((c) => c.matches(REVEAL_PANELS));
    tag(el, "panel", Math.min(4, Math.max(0, siblings.indexOf(el))) * 80);
  });
  const seen = new Set();
  const members = (el) => (el.dataset.revealGroup != null ? [...el.querySelectorAll("[data-reveal]")] : [el]);
  const show = () => {
    if (introRunning()) return;
    for (const el of seen) for (const m of members(el)) m.classList.add("is-in");
    seen.clear();
  };
  const io = new window.IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) seen.add(e.target);
      else if (e.target.closest("[data-view-panel]")?.hidden) { for (const m of members(e.target)) m.classList.remove("is-in"); seen.delete(e.target); }
    }
    show();
  }, { threshold: 0.08, rootMargin: "0px 0px -6% 0px" });
  document.querySelectorAll("[data-reveal-group], [data-reveal]").forEach((el) => {
    if (el.dataset.revealGroup == null && el.closest("[data-reveal-group]")) return;
    io.observe(el);
  });
  new window.MutationObserver(show).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  document.documentElement.classList.add("reveal-ready");
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
