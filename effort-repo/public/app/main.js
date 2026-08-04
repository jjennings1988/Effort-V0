/* Boot. Wires the render bus, restores the profile, and gets a forecast. */

import { initState, S } from "./state.js";
import { onRender } from "./bus.js";
import { render } from "./render.js";
import { wireControls } from "./controls.js";
import { loadForecast } from "./data.js";
import { $, showFatal } from "./dom.js";

try {
  initState();
  onRender(render);

  const { useGeolocation, afterForecast } = wireControls();

  const loc = S.profile.location;
  if (loc) {
    const mast = $("mastLocation");
    if (mast) mast.textContent = loc.label.toUpperCase();
    loadForecast(loc.lat, loc.lon, loc.label, { onReady: afterForecast });
  } else {
    useGeolocation();
  }

  // A build stamp you can read on the device. If this doesn't match what you
  // just deployed, you are looking at a cached build — not a broken one.
  const build = document.documentElement.dataset.build || "dev";
  const stamp = $("buildStamp");
  if (stamp) stamp.textContent = build;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        // Check for a new worker on every launch, not just on the first one.
        reg.update?.().catch(() => {});
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          next?.addEventListener("statechange", () => {
            // A new worker took over while the page was open: the code on screen
            // is now older than the code on the server. Say so rather than
            // leaving a half-updated page.
            if (next.state === "installed" && navigator.serviceWorker.controller) {
              const strip = $("staleStrip");
              if (strip) {
                strip.hidden = false;
                const text = $("staleText");
                if (text) text.textContent = "A NEW VERSION OF EFFORTCAST IS READY";
                const btn = $("staleRefresh");
                if (btn) {
                  btn.textContent = "UPDATE";
                  btn.onclick = () => { next.postMessage("skipWaiting"); location.reload(); };
                }
              }
            }
          });
        });
      } catch { /* service worker is a progressive enhancement */ }
    });
  }
  window.addEventListener("online", () => render());
  window.addEventListener("offline", () => render());
} catch (err) {
  showFatal(err, "startup");
}
