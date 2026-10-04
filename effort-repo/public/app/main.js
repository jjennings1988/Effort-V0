/* Boot. Wires the render bus, restores the profile, and gets a forecast. */

import { initState, S } from "./state.js";
import { onRender } from "./bus.js";
import { render } from "./render.js";
import { wireControls } from "./controls.js";
import { loadForecast, loadDemo, setSignal } from "./data.js";
import { $, showFatal } from "./dom.js";
import { initReveal } from "./instrument.js";
import { wireWeekHeat } from "./week-heat.js";
import { wireBoard } from "./pace-board.js";

try {
  initState();
  const demo = new URLSearchParams(location.search).get("demo") === "1";
  if (demo) S.profile.setupDone = true;
  onRender(render);

  const { useGeolocation, afterForecast } = wireControls();
  wireWeekHeat();
  wireBoard();
  initReveal();

  const loc = S.profile.location;
  if (demo) {
    loadDemo();
    render();
    $("radarUnavail").textContent = "Live radar isn't included in the sample forecast.";
    // No sense giving a blank map most of a screen in the demo.
    $("radarUnavail").closest(".radar-frame")?.classList.add("sample");
  } else if (loc) {
    const mast = $("mastLocation");
    if (mast) mast.textContent = loc.label.toUpperCase();
    loadForecast(loc.lat, loc.lon, loc.label, { onReady: afterForecast });
  } else if (S.profile.setupDone) {
    useGeolocation();
  } else {
    // Resolve the opening instrument animation before setup; once setup is
    // complete, the real forecast fetch runs the calculation sequence again.
    setSignal("ready", "READY FOR SETUP");
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
  window.matchMedia?.("(max-width: 600px)").addEventListener?.("change", () => render());
  // Back online while showing a saved forecast: fetch the live one.
  window.addEventListener("online", () => {
    const l = S.profile.location;
    if (S.meta?.restored && l) loadForecast(l.lat, l.lon, l.label, { onReady: afterForecast });
    else render();
  });
  window.addEventListener("offline", () => render());
} catch (err) {
  showFatal(err, "startup");
}
