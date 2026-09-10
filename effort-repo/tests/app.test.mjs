/* App smoke tests — boot public/index.html in jsdom against a stubbed
   Open-Meteo response and drive the real UI.

   Now that the app is ES modules, we install a jsdom environment as globals and
   import main.js directly: no source rewriting, no eval, and the modules under
   test are exactly the ones the browser loads. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { PROFILE_VERSION } from "../public/app/state.js";

const HTML = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

/* ---------- a stubbed 22-day Open-Meteo payload (14 past + 8 forecast) ---------- */
export function stubForecast({ hotPast = true } = {}) {
  const n = 22 * 24;
  const start = Date.now() - 14 * 86400e3;
  const k = () => [];
  const h = {
    time: k(), temperature_2m: k(), dew_point_2m: k(), relative_humidity_2m: k(),
    apparent_temperature: k(), precipitation_probability: k(), weather_code: k(),
    wind_speed_10m: k(), wind_gusts_10m: k(), shortwave_radiation: k(),
    uv_index: k(), is_day: k(),
  };
  for (let i = 0; i < n; i++) {
    const d = new Date(start + i * 3600e3);
    h.time.push(d.toISOString().slice(0, 13) + ":00");
    const hh = d.getUTCHours();
    const isDay = hh >= 6 && hh <= 20;
    const past = i < 14 * 24;
    const peak = past ? (hotPast ? 92 : 58) : 86;
    const t = Math.round(peak - 14 + 14 * Math.max(0, Math.sin(((hh - 5) / 24) * 2 * Math.PI)));
    h.temperature_2m.push(t);
    h.dew_point_2m.push(past ? (hotPast ? 74 : 40) : 68);
    h.relative_humidity_2m.push(72);
    h.apparent_temperature.push(t + 4);
    h.precipitation_probability.push(10);
    h.weather_code.push(1);
    h.wind_speed_10m.push(7);
    h.wind_gusts_10m.push(12);
    h.shortwave_radiation.push(isDay ? 700 : 0);
    h.uv_index.push(isDay ? 6 : 0);
    h.is_day.push(isDay ? 1 : 0);
  }
  return {
    utc_offset_seconds: 0, timezone_abbreviation: "UTC", elevation: 640,
    daily: { sunrise: [h.time[6]], sunset: [h.time[20]] },
    minutely_15: { precipitation: [0, 0, 0, 0] },
    hourly: h,
  };
}

let win;

/* Install a jsdom environment as globals so the app modules — which are written
   for a browser and reference bare `document` / `localStorage` — just work.

   Note on module identity: only main.js is cache-busted per boot. Everything it
   imports resolves without a query string, so tests MUST import those the same
   way — `state.js?t=1` would be a different module with a different `S`. */
function installDom(opts = {}) {
  const dom = new JSDOM(HTML, { url: "https://effortcast.test/", pretendToBeVisual: false });
  win = dom.window;

  win.fetch = async (url) => {
    const u = String(url);
    if (u.includes("air-quality")) return { ok: true, json: async () => ({ hourly: { time: [], us_aqi: [] } }) };
    if (u.includes("api.open-meteo.com")) return { ok: true, json: async () => {
      const om = stubForecast(opts);
      om.timezone = "UTC";
      if (u.includes("unixtime")) om.hourly.time = om.hourly.time.map(t => Date.parse(t + "Z") / 1000);
      return om;
    } };
    if (u.includes("nominatim")) return { ok: true, json: async () => ({ address: { city: "Fletcher", state: "North Carolina" } }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  Object.defineProperty(win.navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: (ok) => ok({ coords: { latitude: 35.43, longitude: -82.5 } }) },
  });
  win.scrollTo = () => {};
  Object.defineProperty(win.Element.prototype, "scrollIntoView", { configurable: true, value: () => {} });
  // Keep the Leaflet CDN race from holding the event loop open after the tests.
  const raw = win.setTimeout;
  win.setTimeout = (fn, ms, ...rest) => raw(fn, Math.min(Number(ms) || 0, 30), ...rest);

  // Node 22 defines some of these (notably `navigator`) as getter-only globals,
  // so they have to be redefined rather than assigned.
  const expose = { window: win };
  for (const key of ["document", "navigator", "localStorage", "fetch", "Event", "Blob", "URL", "location", "confirm", "alert", "prompt"]) {
    expose[key] = win[key];
  }
  for (const [key, value] of Object.entries(expose)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  return win;
}

/* Wait for a condition rather than sleeping a fixed interval — with 35 tests a
   flat 500 ms per boot dominated the run time. */
async function until(predicate, { tries = 60, gap = 10 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, gap));
  }
  return false;
}

async function boot(opts = {}) {
  installDom(opts);
  // cache-bust so each boot re-evaluates the module graph against fresh globals
  await import(`../public/app/main.js?t=${Date.now()}${Math.random()}`);
  // Most tests exercise the rendered product rather than first-run setup. The
  // real app now correctly waits until setup finishes before requesting browser
  // location permission, so complete setup here unless a test explicitly keeps it.
  if (!opts.keepSetup && !win.document.getElementById("setupOverlay").hidden) {
    win.document.getElementById("setupSkip").click();
  }
  // the first render lands once the stubbed forecast resolves
  await until(() => win.document.getElementById("effortScore").textContent !== "—");
  await new Promise((r) => setTimeout(r, 20));
  return win;
}

const $ = (id) => win.document.getElementById(id);

async function pinTestRace(days = 3) {
  $("raceInputName").value = "Test Half";
  $("raceInputDate").value = new Date(Date.now() + days * 86400e3).toISOString().slice(0, 10);
  $("raceInputGoal").value = "1:45:00";
  $("raceInputDist").value = "half";
  $("raceInputTime").value = "08:15";
  $("raceUseLocation").click();
  $("raceForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  await until(() => !$("raceShare").disabled || /unavailable|worth watching/.test($("raceHeadline").textContent));
}

after(() => { try { win?.close(); } catch {} });

/* ============================================================ */

test("the page boots and renders a v0.5 projection", async () => {
  await boot();
  assert.equal($("modelVersion").textContent, "0.5-THERMAL-LOAD");
  assert.notEqual($("effortScore").textContent, "—", "effort score never rendered");
  assert.match($("adjustment").textContent, /\d+:\d\d/, "expected an adjusted pace range");
  assert.ok($("hourRibbon").children.length > 10, "hourly ribbon is empty");
  assert.ok($("errorStrip").hidden, "error boundary tripped during a clean boot");
});

test("thermal strain, heat state and personal calibration all render", async () => {
  await boot();
  assert.ok(Number($("strainVal").textContent) > 0, "no thermal strain");
  assert.notEqual($("acclWord").textContent, "—", "no heat state");
  assert.match($("personalWord").textContent, /LEARNING/, "calibration should start in learning mode");
});

test("acclimatisation is derived from the fetched history", async () => {
  await boot({ hotPast: true });
  assert.match($("acclSourceNote").textContent, /WEATHER ESTIMATE/);
  const hot = $("adaptLevel").textContent;

  await boot({ hotPast: false });
  const cool = $("adaptLevel").textContent;
  assert.ok(Number(hot) > Number(cool), `a hot fortnight should read more adapted: ${hot} vs ${cool}`);
});

test("the 7-day planner fills in and each day is selectable", async () => {
  await boot();
  const grid = $("plannerGrid");
  assert.ok(grid.children.length >= 5, `expected ~7 days, got ${grid.children.length}`);
  assert.match($("plannerNote").textContent, /Recommended:/);
  assert.ok(win.document.querySelector(".plan-day.best"), "no best day flagged");
  assert.equal(win.document.querySelectorAll(".plan-day.best").length, 1, "the planner should name exactly one best day");

  const before = $("startOut").textContent;
  const target = [...grid.querySelectorAll("button.plan-day")].find((b) => b.dataset.idx !== undefined && b.dataset.idx !== "0");
  target?.click();
  assert.notEqual($("startOut").textContent, before, "clicking a planner day did not move the start time");
});

test("the heat adaptation tracker draws a dose bar per day", async () => {
  await boot();
  const cells = $("doseStrip").querySelectorAll(".dose-cell");
  assert.ok(cells.length >= 14, `expected at least 14 days of dose, got ${cells.length}`);
  assert.ok($("doseStrip").querySelectorAll(".dose-cell.future").length > 0, "no forecast days projected");
  assert.ok($("adaptGuidance").textContent.length > 40, "no guidance sentence");
  assert.doesNotMatch($("doseStrip").textContent + $("doseStrip").innerHTML, /undefined/);
});

test("explain-the-number offers real, ranked counterfactuals", async () => {
  await boot();
  // Exercise a hot daylight window independently of the time this suite runs.
  const { S } = await import("../public/app/state.js");
  S.startIdx = S.hours.findIndex(h => h.iso.slice(11, 13) === "12");
  (await import("../public/app/render.js")).render();
  const rows = $("explainList").querySelectorAll(".explain-row");
  assert.ok(rows.length >= 2, `expected several options, got ${rows.length}`);
  const values = [...rows].map((r) => parseFloat(r.querySelector("b").textContent.replace("−", "")));
  assert.deepEqual(values, [...values].sort((a, b) => b - a), "counterfactuals should be ranked by saving");
  assert.match($("explainLead").textContent, /lever|conditions are what/i);
});

test("pinning a race produces a conditions-adjusted finish band", async () => {
  await boot();
  const soon = new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10);
  $("raceInputDate").value = soon;
  $("raceInputGoal").value = "3:30:00";
  $("raceInputDist").value = "full";
  $("raceUseLocation").click();
  $("raceInputTime").value = "07:30";
  $("raceForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));

  await until(() => !$("raceShare").disabled);
  assert.ok($("raceDetail").hidden === false, "race detail never shown");
  assert.match($("raceCountdown").textContent, /\d+ DAYS?/);
  assert.match($("raceHeadline").textContent, /\d+:\d\d:\d\d–\d+:\d\d:\d\d/, `got "${$("raceHeadline").textContent}"`);
  assert.ok($("raceBody").textContent.length > 40);
});

test("race edits can be canceled and outside-forecast races cannot be shared", async () => {
  await boot();
  await pinTestRace();
  const { S } = await import("../public/app/state.js");
  const before = JSON.stringify(S.profile.race);
  $("raceEdit").click();
  $("raceInputName").value = "Unsaved change";
  $("raceCancel").click();
  assert.equal(JSON.stringify(S.profile.race), before);
  assert.equal($("raceDetail").hidden, false);
  $("raceEdit").click();
  await pinTestRace(30);
  assert.match($("raceBody").textContent, /outside the forecast/);
  assert.equal($("raceShare").disabled, true);
  assert.equal($("raceTimeline").hidden, true);
});

test("race forecast failures preserve the race and retry recovers without moving home", async () => {
  await boot();
  const { S } = await import("../public/app/state.js");
  const trainingHours = S.hours, home = JSON.stringify(S.profile.location);
  const original = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes("unixtime") ? { ok: false } : original(url);
  try {
    await pinTestRace();
    assert.match($("raceHeadline").textContent, /unavailable/);
    assert.ok(S.profile.race);
    assert.equal($("raceShare").disabled, true);
    globalThis.fetch = original;
    $("raceRefresh").click();
    await until(() => !$("raceShare").disabled);
    assert.equal($("raceShare").disabled, false);
    assert.equal(S.hours, trainingHours);
    assert.equal(JSON.stringify(S.profile.location), home);
  } finally { globalThis.fetch = original; }
});

test("race share preview is opt-in for personal details and offers a copy fallback", async () => {
  await boot();
  await pinTestRace();
  $("raceShare").focus(); $("raceShare").click();
  assert.equal($("raceShareDialog").hasAttribute("open"), true);
  assert.equal($("raceSharePersonal").checked, false);
  assert.doesNotMatch($("raceShareCaption").value, /My goal/);
  assert.equal($("raceSharePreview").querySelector("svg").getAttribute("height"), "1350");
  $("raceSharePersonal").checked = true;
  $("raceSharePersonal").dispatchEvent(new win.Event("change"));
  assert.match($("raceShareCaption").value, /My goal: 1:45:00/);
  $("raceShareFormat").value = "story";
  $("raceShareFormat").dispatchEvent(new win.Event("change"));
  assert.equal($("raceSharePreview").querySelector("svg").getAttribute("height"), "1920");
  $("raceShareCaption").value = "My edited caption";
  $("raceCopyCaption").click();
  await until(() => $("raceShareStatus").textContent.includes("clipboard"));
  assert.equal(win.document.activeElement, $("raceShareCaption"));
  assert.equal($("raceShareCaption").selectionEnd, "My edited caption".length);
  $("raceShareClose").click();
  assert.equal(win.document.activeElement, $("raceShare"));
});

test("a delayed race response cannot repopulate a removed race", async () => {
  await boot();
  const { S } = await import("../public/app/state.js");
  const original = globalThis.fetch;
  let resolveForecast;
  globalThis.fetch = url => String(url).includes("api.open-meteo.com") && String(url).includes("unixtime")
    ? new Promise(resolve => { resolveForecast = resolve; }) : original(url);
  try {
    const pin = pinTestRace();
    await until(() => !!resolveForecast);
    assert.match($("raceHeadline").textContent, /Reading/);
    $("raceClear").click();
    const payload = stubForecast();
    payload.hourly.time = payload.hourly.time.map(t => Date.parse(t + "Z") / 1000);
    resolveForecast({ ok: true, json: async () => payload });
    await pin;
    assert.equal(S.profile.race, null);
    assert.equal(S.raceWeather, null);
    assert.equal($("raceDetail").hidden, true);
  } finally { globalThis.fetch = original; }
});

test("a bad goal time is rejected rather than silently stored", async () => {
  await boot();
  $("raceInputDate").value = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  $("raceInputGoal").value = "banana";
  $("raceForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal($("raceError").hidden, false, "no validation message");
  assert.equal($("raceDetail").hidden, true, "invalid race should not be pinned");
});

test("post-run feedback logs and eventually personalises the model", async () => {
  await boot();
  // Personal calibration deliberately ignores mild-weather check-ins. Select
  // the hottest visible race-effort window so this remains a useful-signal test
  // regardless of the wall-clock hour at which the suite runs.
  $("intentCtl").querySelector('button[data-intent="Race"]').click();
  $("durCtl").querySelector('button[data-dur="120"]').click();
  const hours = [...$("hourRibbon").querySelectorAll(".hour-cell")];
  const hottest = hours.reduce((best, hour) =>
    Number(hour.querySelector("strong").textContent) > Number(best.querySelector("strong").textContent) ? hour : best);
  hottest.click();
  const harder = $("feedbackCtl").querySelector('button[data-delta="1"]');
  assert.ok(harder, "feedback controls never built");

  for (let i = 0; i < 6; i++) harder.click();

  assert.ok($("feedbackLog").querySelectorAll("li").length >= 5, "feedback log not populated");
  assert.match($("feedbackState").textContent, /×1\.[1-9]/, `expected a personalised multiplier, got "${$("feedbackState").textContent}"`);
  assert.match($("personalWord").textContent, /HEAT MORE THAN AVERAGE/i);
});

test("view tabs swap panels", async () => {
  await boot();
  const panel = (name) => win.document.querySelector(`[data-view-panel="${name}"]`);
  assert.equal(panel("today").hidden, false);
  assert.equal(panel("week").hidden, true);

  win.document.querySelector('#viewTabs button[data-view="week"]').click();
  assert.equal(panel("week").hidden, false);
  assert.equal(panel("today").hidden, true);
});

test("the profile survives a round trip through export and import", async () => {
  await boot();
  const { exportProfile, importProfile, S } = await import("../public/app/state.js");
  S.profile.paces.Easy = "9:15";
  S.profile.terrain = "city";
  const json = exportProfile(S.profile);

  S.profile.paces.Easy = "7:00";
  S.profile.terrain = "open";
  const back = importProfile(json);
  assert.equal(back.paces.Easy, "9:15");
  assert.equal(back.terrain, "city");
  assert.equal(back.version, PROFILE_VERSION);
});

test("a corrupt profile does not break the app", async () => {
  installDom();
  win.localStorage.setItem("effortcast-profile", '{"paces":{"Easy":"not-a-pace"},"terrain":"moon","feedback":"nope","setupDone":true}');
  await import(`../public/app/main.js?t=${Date.now()}${Math.random()}`);
  await until(() => $("adjustment").textContent !== "—");
  assert.ok($("errorStrip").hidden, "a corrupt profile tripped the error boundary");
  assert.match($("adjustment").textContent, /\d+:\d\d/, "app did not recover to a working projection");
});

test("legacy v0.3 localStorage keys are migrated", async () => {
  installDom();
  win.localStorage.setItem("effort-runner-pace-profile", JSON.stringify({ Easy: "10:30" }));
  win.localStorage.setItem("effort-settings-v2", JSON.stringify({ hoursFrom: 5, hoursTo: 9 }));
  win.localStorage.setItem("effort-athlete-v4", JSON.stringify({ terrain: "city", homeElevFt: 5280 }));
  await import(`../public/app/main.js?t=${Date.now()}${Math.random()}`);
  await until(() => win.localStorage.getItem("effortcast-profile") != null);

  const saved = JSON.parse(win.localStorage.getItem("effortcast-profile"));
  assert.equal(saved.paces.Easy, "10:30", "paces did not migrate");
  assert.equal(saved.trainingHours.from, 5, "training hours did not migrate");
  assert.equal(saved.terrain, "city", "terrain did not migrate");
  assert.equal(saved.homeElevFt, 5280, "home elevation did not migrate");
  assert.equal(saved.version, PROFILE_VERSION);
  assert.equal(saved.setupDone, true, "an existing v0.3 user should not be shown first-run setup");
});

test("the error boundary catches a broken render instead of freezing", async () => {
  await boot();
  const { render } = await import("../public/app/render.js");
  const ribbon = $("hourRibbon");
  // simulate a DOM node vanishing mid-update
  Object.defineProperty(ribbon, "innerHTML", { set() { throw new Error("boom"); }, configurable: true });
  render();
  assert.equal($("errorStrip").hidden, false, "error boundary did not trip");
  assert.match($("errorDetail").textContent, /boom/);
});

/* ============================================================
   v0.5 LAYOUT AND NAVIGATION
   ============================================================ */

test("the answer card identifies the selected start and its pace", async () => {
  await boot();
  const card = $("answerCard");
  assert.ok(card, "answer card missing");
  assert.notEqual($("answerWindow").textContent, "—", "no training window in the answer card");
  assert.match($("answerPace").textContent, /\d+:\d\d/, "no pace in the answer card");
  assert.match($("answerChipStrain").textContent, /SWEAT ESCAPE \d/);
  // it must agree with the detailed panels rather than drift from them
  assert.equal($("answerWindow").textContent.toUpperCase(), $("startOut").textContent);
  assert.equal($("answerKicker").textContent, "YOUR SELECTED START");
});

test("the 24-hour decision curve renders the selected start and recommended band", async () => {
  await boot();
  assert.ok($("decisionPlot").querySelector("svg"), "decision curve SVG missing");
  assert.ok($("decisionPlot").querySelector(".curve-line"), "decision line missing");
  assert.ok($("decisionPlot").querySelector(".curve-selected-point"), "selected start missing");
  assert.ok($("decisionPlot").querySelector(".curve-best-band"), "recommended band missing");
  assert.match($("decisionCurveReadout").textContent, /YOUR START \d+\/100 · BEST \d+\/100/);
});

test("the opening orb calculates, locks, and respects reduced motion", async () => {
  await boot();
  const orb = win.document.querySelector(".weather-orb-svg");
  assert.ok(orb.querySelector(".orb-ring-outer"), "outer calculation ring missing");
  assert.ok(orb.querySelector(".orb-target"), "condition-lock target missing");
  assert.ok($("orbSkip"), "opening calculation has no escape control");
  assert.match($("orbReadings").textContent, /AIR \/ .* DEW \/ .* W·M⁻²/);
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(!win.document.body.classList.contains("orb-calculating"), "opening calculation never resolved");
  assert.ok(!win.document.body.classList.contains("orb-locking"), "condition lock never released the app");
  assert.ok(!win.document.body.classList.contains("orb-revealing"), "opening graphic never faded out");
  const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /orb-target-scan/);
  assert.match(css, /grid-template-areas:"orb metrics"/, "phone conditions instrument is missing");
  const motion = readFileSync(new URL("../public/app/data.js", import.meta.url), "utf8");
  assert.match(motion, /dockOrbToLayout/, "orb no longer docks into the responsive layout");
  assert.match(motion, /1250[^]*720[^]*680/, "extended motion timing changed unexpectedly");
  assert.match(motion, /ORB_INTRO_MAX_MS\s*=\s*6000/, "opening calculation has no six-second watchdog");
  assert.match(motion, /orb-refreshing/, "later forecasts still replay the full-screen opening");
  assert.match(motion, /AbortController/, "forecast requests have no timeout controller");
});

test("forecast guidance avoids certifying personal safety", async () => {
  await boot();
  const copy = [$("finishFlag"), $("finishHead"), $("finishCopy")].map((e) => e.textContent).join(" ");
  assert.doesNotMatch(copy, /FINISH-SAFE|CONFIRMED|YOU SHOULD FINISH/i);
  assert.match(copy, /FORECAST/);
});

test("the bottom nav is a real nav with four reachable tabs", async () => {
  await boot();
  const nav = win.document.querySelector("nav.view-nav");
  assert.ok(nav, "bottom nav missing");
  assert.equal(nav.getAttribute("role"), "tablist");
  const buttons = nav.querySelectorAll("button[data-view]");
  assert.equal(buttons.length, 4);
  assert.equal([...buttons].filter((b) => b.classList.contains("active")).length, 1,
    "exactly one tab should be active at a time");
  // every tab carries a label as well as an icon
  for (const b of buttons) assert.ok(b.querySelector("span")?.textContent.trim().length > 2);
  // and the nav lives outside the scrolling shell so it can be fixed
  assert.equal(nav.closest(".app-shell"), null, "nav must sit outside .app-shell to stay fixed");
});

test("the location controls hide behind the masthead until asked for", async () => {
  await boot();
  const bar = $("locbar"), toggle = $("mastLocation");
  assert.equal(bar.hidden, true, "location bar should start collapsed");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.getAttribute("aria-controls"), "locbar");

  toggle.click();
  assert.equal(bar.hidden, false, "tapping the location name should open the drawer");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");

  toggle.click();
  assert.equal(bar.hidden, true, "tapping again should close it");
});

test("safe-area insets are applied, not just declared", async () => {
  await boot();
  const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /--safe-top:\s*env\(safe-area-inset-top/, "no top inset variable");
  assert.match(css, /--safe-bottom:\s*env\(safe-area-inset-bottom/, "no bottom inset variable");
  // the shell must actually consume the top inset, or the masthead sits under the clock
  const shell = css.match(/\.app-shell\{[^}]*\}/s)?.[0] ?? "";
  assert.match(shell, /var\(--safe-top\)/, ".app-shell does not pad for the status bar");
  // the fixed nav must clear the home indicator
  const nav = css.match(/\.view-nav\{[^}]*\}/s)?.[0] ?? "";
  assert.match(nav, /var\(--safe-bottom\)/, ".view-nav does not pad for the home indicator");
  // and the shell must reserve room so content is never trapped under the nav
  assert.match(css, /padding-bottom:calc\(var\(--nav-height\)/, "no scroll room reserved for the nav");
});

test("the status bar style suits a light background", async () => {
  await boot();
  const style = win.document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content;
  assert.notEqual(style, "black-translucent",
    "black-translucent renders the iOS clock in white, which is invisible on the paper background");
  assert.equal(style, "default");
  const viewport = win.document.querySelector('meta[name="viewport"]')?.content;
  assert.match(viewport, /viewport-fit=cover/, "still need cover for landscape notch insets");
});

test("branding reads WEATHER FOR ATHLETES", async () => {
  await boot();
  assert.equal(win.document.querySelector(".poster-tagline").textContent.trim(), "WEATHER FOR ATHLETES.");
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /content="Weather for athletes\./, "meta description should match the new positioning");
});

/* ============================================================
   SERVICE WORKER CACHING STRATEGY
   The v0.4 worker served HTML network-first but CSS/JS cache-first, so every
   deploy shipped new markup to browsers running the old stylesheet and modules.
   These tests exist so that combination can never come back.
   ============================================================ */

test("the service worker does not serve code cache-first", async () => {
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.ok(!/caches\.match\([^)]*\)\.then\(\(cached\)\s*=>\s*cached\s*\|\|\s*fetch/.test(sw),
    "cache-first for all same-origin assets is what stranded users on old CSS and JS");
  assert.match(sw, /function networkFirst/, "expected an explicit network-first path");
  assert.match(sw, /STATIC\s*=\s*\/\\\.\(png/, "static assets should still be cache-first");
  // the routing decision must send non-static requests down networkFirst
  assert.match(sw, /STATIC\.test\(url\.pathname\)\s*\?\s*cacheFirst\(request\)\s*:\s*networkFirst\(request\)/);
});

test("the service worker never caches itself", async () => {
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(sw, /url\.pathname === "\/sw\.js"/, "a cached service worker is a permanent one");
});

test("precaching one bad URL cannot wipe the whole offline shell", async () => {
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.ok(!/cache\.addAll\(APP_SHELL\)/.test(sw),
    "addAll is atomic — a single 404 discards every precached file");
  assert.match(sw, /cache\.add\(u\)\.catch/, "add each shell entry independently");
});

test("the build stamp is present and matches the worker version", async () => {
  await boot();
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  const htmlBuild = html.match(/data-build="([^"]+)"/)?.[1];
  const swVersion = sw.match(/const VERSION = "([^"]+)"/)?.[1];
  assert.ok(htmlBuild, "no data-build on <html>");
  assert.equal(htmlBuild, swVersion, "the page and the worker disagree about which build this is");
  assert.equal($("buildStamp").textContent, htmlBuild, "build stamp not rendered to the footer");
});

test("hidden elements stay hidden no matter what display rules exist", async () => {
  const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\[hidden\]\{display:none !important\}/,
    "the UA `hidden` rule loses to any author display rule — .locbar{display:flex} beat it");
  // and the rule must come before the component rules it protects
  assert.ok(css.indexOf("[hidden]{display:none") < css.indexOf(".locbar{display:flex"),
    "the global hidden rule should be declared early");
});

test("the bottom nav survives a stylesheet that has not loaded yet", async () => {
  await boot();
  const nav = win.document.querySelector("nav.view-nav");
  // Without CSS these SVGs default to 300x150 and render as solid black blobs.
  const svg = nav.querySelector("svg");
  assert.equal(svg.getAttribute("width"), "22", "icons need intrinsic size as a fallback");
  assert.equal(svg.getAttribute("fill"), "none", "icons need fill=none as a fallback");
  assert.match(nav.getAttribute("style") ?? "", /display:grid/, "nav needs a layout fallback");
});

/* ============================================================
   PROFILE, UNITS AND FIRST-RUN SETUP
   ============================================================ */

test("the profile tab collects the set-once inputs in one place", async () => {
  await boot();
  const panel = win.document.querySelector('[data-view-panel="profile"]');
  assert.ok(panel, "no profile panel");
  for (const id of ["unitsCtl", "paceProfile", "massInput", "homeElev", "hoursFrom", "terrainCtl", "acclSlider", "profileExport"]) {
    assert.ok(panel.querySelector(`#${id}`), `${id} should live in the profile panel`);
  }
  // ...and the per-session controls must NOT have moved there
  for (const id of ["sportCtl", "intentCtl", "durCtl", "start-time"]) {
    assert.equal(panel.querySelector(`#${id}`), null, `${id} changes every session and belongs on Today`);
  }
  // the acclimatisation *reading* stays in This Week, only the knob moved
  const week = win.document.querySelector('[data-view-panel="week"]');
  assert.ok(week.querySelector("#doseStrip"), "the daily heat reading should stay in This Week");
  assert.ok(week.querySelector("#adaptLevel"), "the adaptation gauge should stay in This Week");
});

test("the science section is present and substantive", async () => {
  await boot();
  const about = win.document.querySelector(".about-block");
  assert.ok(about, "no about section");
  const paras = about.querySelectorAll("p");
  assert.ok(paras.length >= 3, `expected three paragraphs, got ${paras.length}`);
  const text = about.textContent;
  assert.ok(text.length > 1200, `expected a real explanation, got ${text.length} chars`);
  // it should cite the actual numbers the model is built on
  for (const claim of ["5.6", "3,891", "48", "sixteen percent"]) {
    assert.ok(text.includes(claim), `the science copy should mention ${claim}`);
  }
});

const unitBtn = (field, value) =>
  win.document.querySelector(`#unitsCtl button[data-field="${field}"][data-value="${value}"]`);

test("each unit toggle converts its own numbers and nothing else", async () => {
  await boot();
  unitBtn("temperature", "f").click();
  unitBtn("distance", "mi").click();
  unitBtn("weight", "lb").click();

  const imperialTemp = Number($("mTemp").textContent);
  const imperialPace = $("adjPace").textContent;
  assert.ok(imperialTemp > 60, `expected Fahrenheit, got ${imperialTemp}`);

  // temperature alone
  unitBtn("temperature", "c").click();
  const metricTemp = Number($("mTemp").textContent);
  assert.ok(Math.abs(metricTemp - (imperialTemp - 32) * 5 / 9) < 1.5, `bad conversion: ${imperialTemp}F -> ${metricTemp}`);
  assert.equal($("adjPace").textContent, imperialPace, "changing temperature must not touch pace");
  assert.match($("massUnit").textContent, /LB/, "changing temperature must not touch weight");

  // distance alone
  unitBtn("distance", "km").click();
  assert.match($("adjPaceFrom").textContent, /MIN \/ KM/, "pace unit label did not follow distance");
  assert.notEqual($("adjPace").textContent, imperialPace, "pace should be re-expressed per km");
  assert.match($("massUnit").textContent, /LB/, "changing distance must not touch weight");

  // weight alone
  unitBtn("weight", "kg").click();
  assert.match($("massUnit").textContent, /KG/);
  assert.match($("adjPaceFrom").textContent, /MIN \/ KM/, "changing weight must not touch pace");

  // and back, without losing the stored canonical values
  unitBtn("temperature", "f").click();
  unitBtn("distance", "mi").click();
  assert.equal(Number($("mTemp").textContent), imperialTemp, "round trip changed the temperature");
  assert.equal($("adjPace").textContent, imperialPace, "round trip changed the pace");
});

test("the UK combination is reachable: Celsius with miles and kilograms", async () => {
  await boot();
  const { S } = await import("../public/app/state.js");
  unitBtn("temperature", "c").click();
  unitBtn("distance", "mi").click();
  unitBtn("weight", "kg").click();
  assert.deepEqual(S.profile.units, { temperature: "c", distance: "mi", weight: "kg" });
  assert.match($("adjPaceFrom").textContent, /MIN \/ MI/, "should still be running in miles");
  assert.match($("massUnit").textContent, /KG/);
  assert.ok(Number($("mTemp").textContent) < 40, "should be reading Celsius");
});

test("a v6 single-string units setting migrates to the three fields", async () => {
  installDom();
  win.localStorage.setItem("effortcast-profile", JSON.stringify({
    version: 6, units: "metric", setupDone: true,
  }));
  await import(`../public/app/main.js?t=${Date.now()}${Math.random()}`);
  await until(() => win.localStorage.getItem("effortcast-profile").includes("temperature"));
  const saved = JSON.parse(win.localStorage.getItem("effortcast-profile"));
  assert.deepEqual(saved.units, { temperature: "c", distance: "km", weight: "kg" },
    "an existing metric user should keep metric across all three");
  assert.equal(saved.version, PROFILE_VERSION);
});

test("pace entry is interpreted in whatever unit is on screen", async () => {
  await boot();
  const { S } = await import("../public/app/state.js");
  const field = () => win.document.querySelector('.pace-field[data-pace="Easy"] input');

  unitBtn("distance", "km").click();
  const input = field();
  input.value = "5:00";
  input.dispatchEvent(new win.Event("blur", { bubbles: true }));
  // 5:00/km is about 8:03/mi — stored canonically in miles
  const stored = S.profile.paces.Easy;
  const [m, s] = stored.split(":").map(Number);
  assert.ok(Math.abs((m * 60 + s) - 300 * 1.609344) < 3, `5:00/km should store as ~8:03/mi, got ${stored}`);
});

test("body mass reaches the drag model", async () => {
  await boot();
  const { S, modelOpts } = await import("../public/app/state.js");
  assert.equal(modelOpts().massKg, 70, "default mass should be 70 kg");
  const mass = $("massInput");
  mass.value = "220";                       // pounds, imperial by default
  mass.dispatchEvent(new win.Event("change", { bubbles: true }));
  assert.ok(S.profile.massKg > 95 && S.profile.massKg < 102, `220 lb should be ~100 kg, got ${S.profile.massKg}`);
  assert.equal(modelOpts().massKg, S.profile.massKg, "mass must flow into the projection options");
});

test("first run shows setup, and it collects rather than lectures", async () => {
  await boot({ keepSetup: true });
  const overlay = $("setupOverlay");
  assert.equal(overlay.hidden, false, "a brand-new athlete should see setup");
  // three steps, each asking for something the model uses
  assert.ok($("setupUnitsCtl"), "step 1 should ask units");
  assert.ok($("setupPace"), "step 2 should ask easy pace");
  assert.ok($("setupFrom") && $("setupTo"), "step 3 should ask training hours");
  assert.equal($("setupProgress").textContent, "1 / 3");
});

test("completing setup derives all four paces from one answer", async () => {
  await boot({ keepSetup: true });
  const { S } = await import("../public/app/state.js");
  $("setupNext").click();                     // units -> pace
  $("setupPace").value = "9:30";
  $("setupNext").click();                     // pace -> hours
  $("setupFrom").value = "5";
  $("setupTo").value = "9";
  $("setupNext").click();                     // finish

  assert.equal($("setupOverlay").hidden, true, "setup should close");
  assert.equal(S.profile.setupDone, true);
  assert.equal(S.profile.paces.Easy, "9:30");
  const secs = (p) => { const [m, s] = p.split(":").map(Number); return m * 60 + s; };
  assert.ok(secs(S.profile.paces.Steady) < secs(S.profile.paces.Easy), "steady should be faster than easy");
  assert.ok(secs(S.profile.paces.Race) < secs(S.profile.paces.Hard), "race should be faster than hard");
  assert.deepEqual(S.profile.trainingHours, { from: 5, to: 9 });
});

test("setup can be skipped and never nags again", async () => {
  await boot({ keepSetup: true });
  const { S } = await import("../public/app/state.js");
  $("setupSkip").click();
  assert.equal($("setupOverlay").hidden, true);
  assert.equal(S.profile.setupDone, true);
  assert.equal(JSON.parse(win.localStorage.getItem("effortcast-profile")).setupDone, true);
});

test("the current build always has a release note to show", async () => {
  await boot();
  const { RELEASE_NOTES, currentBuild } = await import("../public/app/profile.js");
  const build = currentBuild();
  assert.ok(RELEASE_NOTES.some((n) => n.build === build),
    `RELEASE_NOTES has no entry for build ${build} — bumping data-build without adding a note silently ships nothing`);
});

test("release notes appear once, inline, and never as an interstitial", async () => {
  await boot();
  const { S } = await import("../public/app/state.js");
  S.profile.setupDone = true;
  S.profile.seenBuild = null;
  const { renderProfile, currentBuild } = await import("../public/app/profile.js");
  renderProfile();

  const note = $("releaseNote");
  assert.equal(note.hidden, false, "a new build should surface its note");
  assert.ok(note.closest('[data-view-panel="profile"]'), "release notes belong in Profile, not over the app");
  assert.ok($("releaseList").children.length >= 2);

  $("releaseDismiss").click();
  assert.equal(S.profile.seenBuild, currentBuild());
  renderProfile();
  assert.equal($("releaseNote").hidden, true, "a dismissed note should stay dismissed");
});

/* ============================================================
   TAB IDENTITY AND RADAR ZOOM
   ============================================================ */

test("the forecast hero belongs to Today, not to every tab", async () => {
  await boot();
  const today = win.document.querySelector('[data-view-panel="today"]');
  // the three things that used to sit above every tab
  for (const sel of [".answer-card", ".poster", ".briefing"]) {
    const el = win.document.querySelector(sel);
    assert.ok(el, `${sel} missing`);
    assert.ok(today.contains(el), `${sel} should live inside the Today panel`);
  }
  // nothing forecast-shaped may sit between the masthead and the panels
  const shell = win.document.querySelector(".app-shell");
  const CHROME = "dialog:not([open]), header.masthead, .locbar, .alert-strip, .status-strip, .error-strip, .stale-strip, footer.site-footer";
  const strays = [...shell.children].filter((el) =>
    !el.hasAttribute("data-view-panel") && !el.matches(CHROME));
  assert.deepEqual(strays.map((e) => e.className || e.tagName), [],
    "only chrome may sit outside the view panels — anything else shows on every tab");
  // the method strip explains the current projection, so it is Today's, not global
  assert.ok(today.querySelector(".method-strip"), "the model explanation belongs to Today");
});

test("each tab opens on its own first element", async () => {
  await boot();
  const firstOf = (view) => {
    const panel = win.document.querySelector(`[data-view-panel="${view}"]`);
    return [...panel.children].find((c) => !c.hidden);
  };
  assert.ok(firstOf("today").matches(".answer-card"), "Today should lead with the answer");
  assert.ok(firstOf("week").querySelector("h2")?.textContent.includes("WHICH DAY"),
    "Week should lead with the planner heading");
  assert.ok(firstOf("race").querySelector("h2")?.textContent.includes("THE ONE THAT COUNTS"),
    "Race should lead with its own heading");
  assert.ok(firstOf("profile").querySelector("h2")?.textContent.includes("YOU"),
    "Profile should lead with YOU, not a forecast");
});

test("the week tab shows the planner before the adaptation tracker", async () => {
  await boot();
  const panel = win.document.querySelector('[data-view-panel="week"]');
  const grid = panel.querySelector("#plannerGrid");
  const adapt = panel.querySelector("#adaptSection");
  assert.ok(grid && adapt);
  assert.equal(
    grid.compareDocumentPosition(adapt) & win.Node.DOCUMENT_POSITION_FOLLOWING,
    win.Node.DOCUMENT_POSITION_FOLLOWING,
    "the planner is what you open the Week tab for — it goes first",
  );
});

test("radar never requests a zoom RainViewer cannot serve", async () => {
  const src = readFileSync(new URL("../public/app/radar.js", import.meta.url), "utf8");
  // RainViewer documents a hard maximum of zoom 7
  assert.match(src, /RADAR_MAX_NATIVE_ZOOM\s*=\s*7/, "radar tiles cap at zoom 7");
  assert.match(src, /maxNativeZoom:\s*RADAR_MAX_NATIVE_ZOOM/,
    "the tile layer must declare maxNativeZoom or Leaflet asks for tiles that do not exist");
  // and the map must not be able to outrun what the base layer allows either
  const mapZoom = Number(src.match(/const MAP_ZOOM = (\d+)/)?.[1]);
  const mapMax = Number(src.match(/const MAP_MAX_ZOOM = (\d+)/)?.[1]);
  assert.ok(mapZoom >= 7, "opening below zoom 7 would waste the available detail");
  assert.ok(mapMax >= mapZoom, "max zoom must not be below the opening zoom");
  assert.match(src, /refreshRadarSize/, "the map needs a resize hook for when its panel was hidden");
});


test("later-week selection survives rendering and opens the workout panel", async () => {
  await boot();
  const { S } = await import("../public/app/state.js");
  const { render } = await import("../public/app/render.js");
  const buttons = [...$("plannerGrid").querySelectorAll("button")];
  const target = buttons.find(b => Number(b.dataset.idx) >= 48);
  assert.ok(target);
  const index = Number(target.dataset.idx);
  target.click();
  assert.equal(S.startIdx, index);
  assert.equal(S.lastProjection.start.temp, S.hours[index].temp);
  assert.equal(win.document.querySelector('[data-view-panel="today"]').hidden, false);
  assert.equal(win.document.querySelector('[data-view-panel="week"]').hidden, true);
  assert.match($("startOut").textContent, /[A-Z]{3}/);
  assert.ok($("hourRibbon").querySelector(`[data-idx="${index}"][aria-pressed="true"]`));
  assert.ok(!$("decisionPlot").innerHTML.includes("NaN"));
  S.duration = 120;
  render();
  assert.equal(S.startIdx, index);
  $("recommendedStart").click();
  assert.equal(S.startIdx, S.bestWindow.idx);
  assert.equal(win.document.activeElement, $("start-time"));
  assert.equal(S.hours[S.startIdx].iso.slice(0,10), S.hours[index].iso.slice(0,10));
  $("forecastDay").value = "0";
  $("forecastDay").dispatchEvent(new win.Event("change", {bubbles:true}));
  assert.equal(S.startIdx, 0);
});

test("week comparison handles all-storm data without retaining its recommendation", async () => {
  await boot();
  const { S } = await import("../public/app/state.js");
  const { render } = await import("../public/app/render.js");
  S.hours = S.hours.map(h => ({...h, code:95}));
  render();
  assert.equal($("plannerGrid").querySelectorAll("button").length, 0);
  assert.match($("plannerNote").textContent, /No storm-free start/);
  assert.equal($("recommendedStart").disabled, true);
  assert.ok(!$("plannerGrid").innerHTML.includes("NaN"));
});

test("tab keyboard navigation uses roving focus and connected panels", async () => {
  await boot();
  const tabs = [...$("viewTabs").querySelectorAll("button")];
  tabs[0].dispatchEvent(new win.KeyboardEvent("keydown", {key:"ArrowRight", bubbles:true}));
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  assert.equal(tabs[0].tabIndex, -1);
  assert.equal(win.document.activeElement, tabs[1]);
  assert.equal($(tabs[1].getAttribute("aria-controls")).hidden, false);
});

test("forecast chart previews without committing and supports direct selection", async () => {
  await boot();
  const { S } = await import("../public/app/state.js");
  const host = $("decisionPlot");
  const svg = host.querySelector("svg");
  svg.getBoundingClientRect = () => ({left:0,top:0,width:1000,height:230});
  const before = S.startIdx;
  host.dispatchEvent(new win.MouseEvent("pointermove", {clientX:982,clientY:80}));
  assert.equal(S.startIdx, before, "hover must not change the workout");
  assert.match($("curveInspector").textContent, /PREVIEW/);
  assert.equal(host.querySelector(".curve-preview").style.display, "");
  host.dispatchEvent(new win.MouseEvent("click", {clientX:982,clientY:80}));
  assert.equal(S.startIdx, Number(host.getAttribute("aria-valuemax")));
  assert.match($("curveInspector").textContent, /SELECTED/);
  assert.equal(host.getAttribute("role"), "slider");
  host.focus();
  host.dispatchEvent(new win.KeyboardEvent("keydown", {key:"ArrowLeft",bubbles:true}));
  assert.equal(S.startIdx, Number(host.getAttribute("aria-valuemax")) - 1);
  assert.equal(win.document.activeElement, host, "render must retain chart focus");
  assert.match(host.getAttribute("aria-valuetext"), /air.*dew/);
  host.dispatchEvent(new win.KeyboardEvent("keydown", {key:"Home",bubbles:true}));
  assert.equal(S.startIdx, Number(host.getAttribute("aria-valuemin")));
});

test("chart hit testing ignores letterboxing and touch scrolling", async () => {
  await boot();
  const { S } = await import("../public/app/state.js");
  const host = $("decisionPlot");
  const svg = host.querySelector("svg");
  svg.getBoundingClientRect = () => ({left:0,top:0,width:500,height:230});
  const before = S.startIdx;
  host.dispatchEvent(new win.MouseEvent("click", {clientX:450,clientY:10}));
  assert.equal(S.startIdx, before);
  const touch = new win.MouseEvent("pointermove", {clientX:450,clientY:100});
  Object.defineProperty(touch, "pointerType", {value:"touch"});
  host.dispatchEvent(touch);
  assert.doesNotMatch($("curveInspector").textContent, /PREVIEW/);
  host.dispatchEvent(new win.MouseEvent("click", {clientX:491,clientY:100}));
  assert.equal(S.startIdx, Number(host.getAttribute("aria-valuemax")));
});

test("marker and view motion only run for changes and honor reduced motion", async () => {
  await boot();
  const { S } = await import("../public/app/state.js");
  const { render } = await import("../public/app/render.js");
  S.view = "today";
  render();
  const animations = [];
  win.Element.prototype.animate = function(frames, options) {
    animations.push({element:this,frames,options});
    return {cancel(){}};
  };
  win.matchMedia = () => ({matches:false});
  S.startIdx = Math.min(S.startIdx + 1, 23);
  render();
  assert.equal(animations.filter(a => a.element.classList.contains("curve-selected-point")).length, 1);
  const count = animations.length;
  render();
  assert.equal(animations.length, count, "unchanged renders must not replay motion");
  win.document.querySelector('[data-view="week"]').click();
  assert.ok(animations.some(a => a.element.dataset.viewPanel === "week"));
  win.matchMedia = () => ({matches:true});
  const reducedCount = animations.length;
  S.startIdx = Math.min(S.startIdx + 1, 23);
  render();
  win.document.querySelector('[data-view="today"]').click();
  assert.equal(animations.length, reducedCount);
});
