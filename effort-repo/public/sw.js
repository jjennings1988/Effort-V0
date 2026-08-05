/* EFFORTCAST service worker.

   The previous version served same-origin CSS and JS cache-first, but HTML
   network-first. That combination is worse than either strategy alone: every
   deploy shipped new markup to browsers still running the old stylesheet and
   the old modules, so the page rendered with elements the CSS had never heard
   of. It also meant a deploy was invisible until someone remembered to bump a
   version string by hand.

   Now: code and markup are network-first (fresh whenever the network answers,
   cached copy when it doesn't), and only genuinely static assets are
   cache-first. Deploys land on the next load with no manual version bump. */

const VERSION = "2026.08.05-2";
const CACHE_NAME = `effortcast-${VERSION}`;

/* Precached so the app opens offline on first launch. */
const APP_SHELL = [
  "/", "/styles.css", "/engine.js",
  "/app/main.js", "/app/state.js", "/app/data.js", "/app/render.js", "/app/controls.js",
  "/app/dom.js", "/app/bus.js", "/app/radar.js", "/app/briefing.js",
  "/app/adaptation.js", "/app/planner.js", "/app/race.js", "/app/explain.js", "/app/feedback.js",
  "/app/profile.js", "/app/setup.js", "/app/units.js",
  "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png",
];

/* Live data — never cached, always straight to the network. */
const NEVER_CACHE = [
  "api.anthropic.com", "api.open-meteo.com", "geocoding-api.open-meteo.com",
  "api.weather.gov", "nominatim.openstreetmap.org", "air-quality-api.open-meteo.com",
  "api.rainviewer.com", "tilecache.rainviewer.com", "tile.openstreetmap.org",
];

/* Immutable enough to serve from cache without checking. */
const STATIC = /\.(png|jpg|jpeg|svg|webp|ico|woff2?)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // addAll is atomic: one 404 discards the whole precache. Add individually
      // so a single missing icon can't leave the app with no offline shell.
      .then((cache) => Promise.all(APP_SHELL.map((u) => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await caches.match("/");
      if (shell) return shell;
    }
    throw new Error("offline and uncached");
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.includes(url.hostname)) return;

  // Never let the worker cache itself — that is how a bad SW becomes permanent.
  if (url.pathname === "/sw.js") return;

  event.respondWith(STATIC.test(url.pathname) ? cacheFirst(request) : networkFirst(request));
});

/* Lets the page ask what it is running, and force an update if it is stale. */
self.addEventListener("message", (event) => {
  if (event.data === "version") event.source?.postMessage({ version: VERSION });
  if (event.data === "skipWaiting") self.skipWaiting();
});
