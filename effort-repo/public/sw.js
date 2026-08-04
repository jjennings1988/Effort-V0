/* Bump CACHE_NAME on every deploy that changes engine.js or index.html.
   The fetch handler below is cache-first for same-origin assets, so returning
   visitors keep the old engine.js forever until this string changes. */
const CACHE_NAME = "effort-pwa-v6-mobile";
const APP_SHELL = [
  "/", "/styles.css", "/engine.js",
  "/app/main.js", "/app/state.js", "/app/data.js", "/app/render.js", "/app/controls.js",
  "/app/dom.js", "/app/bus.js", "/app/radar.js", "/app/briefing.js",
  "/app/adaptation.js", "/app/planner.js", "/app/race.js", "/app/explain.js", "/app/feedback.js",
  "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png",
];
const NEVER_CACHE = ["api.anthropic.com", "api.open-meteo.com", "geocoding-api.open-meteo.com", "api.weather.gov", "nominatim.openstreetmap.org", "air-quality-api.open-meteo.com", "api.rainviewer.com", "tilecache.rainviewer.com", "tile.openstreetmap.org"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (NEVER_CACHE.includes(url.hostname)) return; // live data: always network
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match(event.request).then((c) => c || caches.match("/")))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
