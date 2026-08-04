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

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
  window.addEventListener("online", () => render());
  window.addEventListener("offline", () => render());
} catch (err) {
  showFatal(err, "startup");
}
