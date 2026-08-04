/* App smoke tests — boot public/index.html in jsdom against a stubbed
   Open-Meteo response and drive the real UI.

   Now that the app is ES modules, we install a jsdom environment as globals and
   import main.js directly: no source rewriting, no eval, and the modules under
   test are exactly the ones the browser loads. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

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
   for a browser and reference bare `document` / `localStorage` — just work. */
function installDom(opts = {}) {
  const dom = new JSDOM(HTML, { url: "https://effortcast.test/", pretendToBeVisual: false });
  win = dom.window;

  win.fetch = async (url) => {
    const u = String(url);
    if (u.includes("air-quality")) return { ok: true, json: async () => ({ hourly: { time: [], us_aqi: [] } }) };
    if (u.includes("api.open-meteo.com")) return { ok: true, json: async () => stubForecast(opts) };
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

async function boot(opts) {
  installDom(opts);
  // cache-bust so each boot re-evaluates the module graph against fresh globals
  await import(`../public/app/main.js?t=${Date.now()}${Math.random()}`);
  for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 20));
  return win;
}

const $ = (id) => win.document.getElementById(id);

after(() => { try { win?.close(); } catch {} });

/* ============================================================ */

test("the page boots and renders a v0.4 projection", async () => {
  await boot();
  assert.equal($("modelVersion").textContent, "0.4-STRAIN");
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
  assert.match($("acclSourceNote").textContent, /LAST 14 DAYS READ/);
  const hot = $("adaptLevel").textContent;

  await boot({ hotPast: false });
  const cool = $("adaptLevel").textContent;
  assert.ok(Number(hot) > Number(cool), `a hot fortnight should read more adapted: ${hot} vs ${cool}`);
});

test("the 7-day planner fills in and each day is selectable", async () => {
  await boot();
  const grid = $("plannerGrid");
  assert.ok(grid.children.length >= 5, `expected ~7 days, got ${grid.children.length}`);
  assert.match($("plannerNote").textContent, /Best \d+-minute/);
  assert.ok(win.document.querySelector(".plan-day.best"), "no best day flagged");

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
});

test("explain-the-number offers real, ranked counterfactuals", async () => {
  await boot();
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
  $("raceForm").dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));

  assert.ok($("raceDetail").hidden === false, "race detail never shown");
  assert.match($("raceCountdown").textContent, /\d+ DAYS?/);
  assert.match($("raceHeadline").textContent, /\d+:\d\d:\d\d–\d+:\d\d:\d\d/, `got "${$("raceHeadline").textContent}"`);
  assert.ok($("raceBody").textContent.length > 40);
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
  const { exportProfile, importProfile, S } = await import(`../public/app/state.js?t=${Date.now()}`);
  S.profile.paces.Easy = "9:15";
  S.profile.terrain = "city";
  const json = exportProfile(S.profile);

  S.profile.paces.Easy = "7:00";
  S.profile.terrain = "open";
  const back = importProfile(json);
  assert.equal(back.paces.Easy, "9:15");
  assert.equal(back.terrain, "city");
  assert.equal(back.version, 5);
});

test("a corrupt profile does not break the app", async () => {
  installDom();
  win.localStorage.setItem("effortcast-profile", '{"paces":{"Easy":"not-a-pace"},"terrain":"moon","feedback":"nope"}');
  await import(`../public/app/main.js?t=${Date.now()}${Math.random()}`);
  for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok($("errorStrip").hidden, "a corrupt profile tripped the error boundary");
  assert.match($("adjustment").textContent, /\d+:\d\d/, "app did not recover to a working projection");
});

test("legacy v0.3 localStorage keys are migrated", async () => {
  installDom();
  win.localStorage.setItem("effort-runner-pace-profile", JSON.stringify({ Easy: "10:30" }));
  win.localStorage.setItem("effort-settings-v2", JSON.stringify({ hoursFrom: 5, hoursTo: 9 }));
  win.localStorage.setItem("effort-athlete-v4", JSON.stringify({ terrain: "city", homeElevFt: 5280 }));
  await import(`../public/app/main.js?t=${Date.now()}${Math.random()}`);
  for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 20));

  const saved = JSON.parse(win.localStorage.getItem("effortcast-profile"));
  assert.equal(saved.paces.Easy, "10:30", "paces did not migrate");
  assert.equal(saved.trainingHours.from, 5, "training hours did not migrate");
  assert.equal(saved.terrain, "city", "terrain did not migrate");
  assert.equal(saved.homeElevFt, 5280, "home elevation did not migrate");
  assert.equal(saved.version, 5);
});

test("the error boundary catches a broken render instead of freezing", async () => {
  await boot();
  const { render } = await import(`../public/app/render.js?t=${Date.now()}`);
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

test("the answer card repeats the window and pace above the fold", async () => {
  await boot();
  const card = $("answerCard");
  assert.ok(card, "answer card missing");
  assert.notEqual($("answerWindow").textContent, "—", "no training window in the answer card");
  assert.match($("answerPace").textContent, /\d+:\d\d/, "no pace in the answer card");
  assert.match($("answerChipStrain").textContent, /STRAIN \d/);
  // it must agree with the detailed panels rather than drift from them
  assert.equal($("answerWindow").textContent, $("windowTime").textContent);
  assert.equal($("answerKicker").textContent, $("windowLabel").textContent);
});

test("the bottom nav is a real nav with three reachable tabs", async () => {
  await boot();
  const nav = win.document.querySelector("nav.view-nav");
  assert.ok(nav, "bottom nav missing");
  assert.equal(nav.getAttribute("role"), "tablist");
  const buttons = nav.querySelectorAll("button[data-view]");
  assert.equal(buttons.length, 3);
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
