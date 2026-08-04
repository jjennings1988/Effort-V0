/* App smoke test — boots public/index.html in jsdom against a stubbed
   Open-Meteo response and asserts the page actually renders v0.4 output.
   Catches the class of bug unit tests miss: a control that was never wired,
   an element id that drifted, an option that never reaches the engine. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import * as engine from "../public/engine.js";

const HTML = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

/* ---------- a stubbed 17-day Open-Meteo payload (14 past + 3 forecast) ---------- */
function stubForecast() {
  const n = 17 * 24;
  const start = Date.now() - 14 * 86400e3;
  const time = [], temp = [], dew = [], rh = [], app = [], pp = [], code = [],
    ws = [], wg = [], sw = [], uv = [], day = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(start + i * 3600e3);
    time.push(d.toISOString().slice(0, 13) + ":00");
    const h = d.getUTCHours();
    const isDay = h >= 6 && h <= 20;
    const t = 74 + 12 * Math.sin(((h - 8) / 24) * 2 * Math.PI);
    temp.push(Math.round(t)); dew.push(66); rh.push(72); app.push(Math.round(t) + 4);
    pp.push(10); code.push(1); ws.push(7); wg.push(12);
    sw.push(isDay ? 700 : 0); uv.push(isDay ? 6 : 0); day.push(isDay ? 1 : 0);
  }
  return {
    utc_offset_seconds: 0, timezone_abbreviation: "UTC", elevation: 640,
    daily: { sunrise: [time[6]], sunset: [time[20]] },
    minutely_15: { precipitation: [0, 0, 0, 0] },
    hourly: {
      time, temperature_2m: temp, dew_point_2m: dew, relative_humidity_2m: rh,
      apparent_temperature: app, precipitation_probability: pp, weather_code: code,
      wind_speed_10m: ws, wind_gusts_10m: wg, shortwave_radiation: sw,
      uv_index: uv, is_day: day,
    },
  };
}

/* jsdom does not execute <script type="module">, so rewrite the app's single
   import into a destructure off a global and run it as a classic script.
   The app code itself is untouched — only its module preamble is swapped. */
function asClassicScript(html) {
  const body = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(body, "could not find the app's module script");
  const rewritten = body[1].replace(
    /import\s*\{([\s\S]*?)\}\s*from\s*["']\.\/engine\.js["'];/,
    "const {$1} = window.__ENGINE__;",
  );
  assert.ok(rewritten.includes("window.__ENGINE__"), "engine import was not rewritten");
  return rewritten;
}
const APP_SRC = asClassicScript(HTML);

async function boot() {
  const dom = new JSDOM(HTML, { url: "https://effortcast.test/", runScripts: "outside-only" });
  const win = dom.window;
  win.__ENGINE__ = engine;
  win.fetch = async (url) => {
    const u = String(url);
    if (u.includes("air-quality")) return { ok: true, json: async () => ({ hourly: { time: [], us_aqi: [] } }) };
    if (u.includes("api.open-meteo.com")) return { ok: true, json: async () => stubForecast() };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  Object.defineProperty(win.navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: (ok) => ok({ coords: { latitude: 35.43, longitude: -82.5 } }) },
  });
  win.scrollTo = () => {};
  Object.defineProperty(win.Element.prototype, "scrollIntoView", { configurable: true, value: () => {} });
  // The app races a 15 s timeout when loading Leaflet from a CDN that isn't
  // reachable here. Cap every timer so that race settles immediately instead of
  // holding the event loop open long after the assertions have finished.
  const rawSetTimeout = win.setTimeout;
  win.setTimeout = (fn, ms, ...rest) => rawSetTimeout(fn, Math.min(Number(ms) || 0, 30), ...rest);

  win.eval(APP_SRC);
  // let the stubbed fetch and the render it triggers settle
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 20));
  return win;
}

test("the page boots and renders a v0.4 projection", async (t) => {
  const win = await boot();
  t.after(() => win.close());
  const $ = (id) => win.document.getElementById(id);

  assert.equal($("modelVersion").textContent, "0.4-STRAIN");
  assert.notEqual($("effortScore").textContent, "—", "effort score never rendered");
  assert.notEqual($("adjustment").textContent, "—", "pace adjustment never rendered");
  assert.match($("adjustment").textContent, /\d+:\d\d/, "expected an adjusted pace range");
  assert.ok($("hourRibbon").children.length > 10, "hourly ribbon is empty");
});

test("the v0.4 controls exist and are wired to the model", async (t) => {
  const win = await boot();
  t.after(() => win.close());
  const $ = (id) => win.document.getElementById(id);

  const strainBefore = $("strainVal").textContent;
  assert.notEqual(strainBefore, "—", "thermal strain never rendered");
  assert.ok(Number(strainBefore) > 0, `expected positive strain, got ${strainBefore}`);
  assert.notEqual($("acclWord").textContent, "—", "heat state never rendered");

  // acclimatisation slider must actually move the projection
  const before = $("effortScore").textContent;
  const slider = $("acclSlider");
  slider.value = "0";
  slider.dispatchEvent(new win.Event("input", { bubbles: true }));
  const after = $("effortScore").textContent;
  assert.notEqual(before, after, "moving acclimatisation did not change the effort score");
  assert.ok(Number(after) > Number(before), "unacclimatised should read harder");

  // terrain must actually move the wind contribution
  const windBefore = $("valWind").textContent;
  win.document.querySelector('#terrainCtl button[data-terrain="open"]').click();
  assert.notEqual(windBefore, $("valWind").textContent, "terrain did not change the wind term");
});

test("acclimatisation is read from the fetched history, not defaulted", async (t) => {
  const win = await boot();
  t.after(() => win.close());
  const note = win.document.getElementById("acclSourceNote").textContent;
  assert.match(note, /LAST 14 DAYS READ/, `expected history-derived state, got "${note}"`);
});
