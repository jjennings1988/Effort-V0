import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { validDate, cleanVenue, raceEpoch, localISO, raceProjection, finishBand, raceTakeaway, raceDialModel, raceSplitPlan } from "../public/app/race-model.js";
import { parseRaceWeather, raceWeatherURL } from "../public/app/race-weather.js";
import { createBriefingSnapshot, briefingSVG, briefingCaption } from "../public/app/race-share.js";
import { importProfile, exportProfile } from "../public/app/state.js";

const venue = { lat: 40.71, lon: -74.01, label: "New York, NY", timezone: "America/New_York" };
const race = { name: "City Half", dateISO: "2026-09-13", startTime: "07:30", distanceKey: "half", goalSeconds: 6300, location: venue };
function weather() {
  const start = Date.parse("2026-09-13T00:00:00Z");
  return { fetchedAt: start, elevFt: 0, demo: false, hours: Array.from({ length: 48 }, (_, i) => ({
    epoch: start + i * 3600000, iso: localISO(start + i * 3600000, venue.timezone),
    temp: 58 + i / 3, dew: 48, rh: 60, wind: 4, gust: 8, solar: 200, precipProb: 5,
    code: 1, uv: 2, isDay: true, aqi: null, wbgt: 60,
  })) };
}
function snapshot() {
  const w = weather(), result = raceProjection(race, w, { homeElevFt: 0 });
  assert.ok(result);
  return createBriefingSnapshot({ race, result, weather: w, units: { temperature: "f", distance: "mi" } });
}

test("race wall time resolves in the venue timezone, including fractional offsets", () => {
  assert.equal(new Date(raceEpoch("2026-09-13", "07:30", "America/New_York")).toISOString(), "2026-09-13T11:30:00.000Z");
  assert.equal(new Date(raceEpoch("2026-09-13", "07:30", "Asia/Kathmandu")).toISOString(), "2026-09-13T01:45:00.000Z");
  assert.equal(new Date(raceEpoch("2026-01-13", "07:30", "America/New_York")).toISOString(), "2026-01-13T12:30:00.000Z");
  assert.equal(localISO(Date.parse("2026-09-13T00:30:00Z"), "America/Los_Angeles"), "2026-09-12T17:30");
});
test("invalid dates, DST gaps and repeated start times are rejected", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(raceEpoch("2026-03-08", "02:30", venue.timezone), null);
  assert.equal(raceEpoch("2026-11-01", "01:30", venue.timezone), null);
  assert.equal(raceEpoch("2026-09-13", "24:30", venue.timezone), null);
  assert.equal(cleanVenue({ ...venue, lat: 140 }), null);
  assert.equal(cleanVenue({ ...venue, timezone: "Mars/Here" }), null);
});
test("legacy races keep their goals and require venue/start confirmation", () => {
  const { startTime, location, ...old } = race;
  const profile = importProfile(JSON.stringify({ version: 8, race: old }));
  assert.equal(profile.race.name, old.name);
  assert.equal(profile.race.goalSeconds, old.goalSeconds);
  assert.equal(profile.race.startTime, null);
  assert.equal(profile.race.location, null);
  const saved = importProfile(JSON.stringify({ race }));
  assert.deepEqual(JSON.parse(exportProfile(saved)).race, race);
  assert.equal(importProfile(JSON.stringify({ race: { ...race, dateISO: "2026-02-31" } })).race, null);
});
test("race projection interpolates the precise minute and uses race elevation", () => {
  const w = weather();
  const result = raceProjection(race, w, { elevFt: 15000, homeElevFt: 0 });
  assert.ok(result);
  assert.equal(result.startEpoch, Date.parse("2026-09-13T11:30Z"));
  assert.equal(result.points[0].temp, (w.hours[11].temp + w.hours[12].temp) / 2);
  assert.equal(result.projection.components.alt.high, 0);
  assert.ok(result.points[2].epoch > result.points[1].epoch);
});
test("incomplete race weather cannot extrapolate into a shareable result", () => {
  const w = weather();
  assert.equal(raceProjection(race, { ...w, hours: w.hours.slice(0, 13) }), null);
  assert.equal(raceProjection(race, { ...w, hours: w.hours.filter((_, i) => i !== 12) }), null);
  assert.equal(raceProjection({ ...race, dateISO: "2026-09-20" }, w), null);
  assert.equal(finishBand(3028, 3032), "50:30");
});
test("race request asks for UTC epochs and the dedicated venue timezone", () => {
  const url = new URL(raceWeatherURL(venue));
  assert.equal(url.searchParams.get("latitude"), String(venue.lat));
  assert.equal(url.searchParams.get("timezone"), venue.timezone);
  assert.equal(url.searchParams.get("timeformat"), "unixtime");
  assert.equal(url.searchParams.has("past_days"), false);
});
test("null forecast values remain missing and cannot become zero-degree observations", () => {
  const time = [0, 1, 2].map(i => Date.parse("2026-09-13T10:00Z") / 1000 + i * 3600);
  const hourly = { time };
  for (const key of ["temperature_2m", "dew_point_2m", "relative_humidity_2m", "wind_speed_10m", "wind_gusts_10m", "shortwave_radiation", "precipitation_probability", "weather_code", "uv_index", "is_day"]) hourly[key] = [1, 1, 1];
  hourly.temperature_2m = [65, null, 70];
  const parsed = parseRaceWeather({ hourly }, venue.timezone);
  assert.equal(parsed.hours.length, 2);
  assert.equal(parsed.hours[1].epoch - parsed.hours[0].epoch, 7200000);
  assert.equal(parsed.hours[0].iso, "2026-09-13T06:00");
});
test("briefing hides personal goal numbers and coordinates unless explicitly included", () => {
  const s = snapshot();
  assert.equal("lat" in s, false);
  assert.equal("location" in s, false);
  assert.doesNotMatch(briefingSVG(s), /MY GOAL|1:45:00|40\.71/);
  assert.doesNotMatch(briefingCaption(s), /My goal|1:45:00/);
  assert.match(briefingSVG(s, { personal: true }), /MY GOAL 1:45:00/);
  assert.match(briefingCaption(s, true), /My goal: 1:45:00/);
  assert.equal(s.aqiComplete, false);
});
test("briefing exports are valid self-contained SVG with safe text and both sizes", () => {
  const s = snapshot();
  s.name = '<script>alert("x")</script> & a race';
  for (const [format, height] of [["feed", "1350"], ["story", "1920"]]) {
    const svg = briefingSVG(s, { format });
    const dom = new JSDOM(svg, { contentType: "image/svg+xml" });
    assert.equal(dom.window.document.documentElement.getAttribute("height"), height);
    assert.equal(dom.window.document.documentElement.getAttribute("width"), "1080");
    assert.equal(dom.window.document.querySelectorAll("script,image,foreignObject").length, 0);
    assert.match(svg, /Open-Meteo|OPEN-METEO/);
    assert.ok(dom.window.document.querySelector("desc").textContent.includes(s.name));
    dom.window.close();
  }
});
test("demo, unit settings and forecast provenance survive export", () => {
  const s = snapshot(); s.demo = true; s.units = { temperature: "c", distance: "km" };
  assert.match(briefingSVG(s), /SAMPLE FORECAST/);
  assert.match(briefingCaption(s), /DEMO DATA/);
  assert.match(briefingCaption(s), /°C/);
  assert.match(briefingCaption(s), /km\/h/);
  const before = briefingSVG(s);
  assert.equal(briefingSVG(s), before, "export has no ambient time or profile dependencies");
});
test("hazards override playful weather headlines", () => {
  const r = raceProjection(race, weather());
  r.projection.thunder = true;
  assert.equal(raceTakeaway(r).caution, true);
  assert.match(raceTakeaway(r).headline, /Storms/);
  r.projection.thunder = false;
  r.projection.extremes.maxPrecip = 75;
  assert.match(raceTakeaway(r).body, /75%/);
});

test("split targets add back up to the projected finish, and warmer miles run slower", () => {
  const w = weather(), r = raceProjection(race, w, { homeElevFt: 0 });
  const plan = raceSplitPlan(r, w, "mi");
  assert.equal(plan.splits.length, Math.ceil(r.distance.miles));
  assert.ok(Math.abs(plan.totalSeconds - r.midSeconds) < 1, `${plan.totalSeconds} vs ${r.midSeconds}`);
  assert.ok(plan.splits.at(-2).paceSeconds >= plan.splits[0].paceSeconds, "the fixture warms through the morning");
  for (const s of plan.splits) assert.ok(s.paceSeconds >= r.goalSeconds / r.distance.miles, "weather never makes a split faster than goal pace");
  const km = raceSplitPlan(r, w, "km");
  assert.equal(km.splits.length, Math.ceil(r.distance.miles / 0.621371 - 1e-9));
  assert.ok(Math.abs(km.totalSeconds - r.midSeconds) < 1);
});

test("the race dial covers race day in venue-local time", () => {
  const w = weather(), r = raceProjection(race, w, { homeElevFt: 0 });
  const d = raceDialModel(race, r, w);
  assert.equal(d.wedges.length, 24);
  assert.equal(d.start, 7.5, "a 7:30 wave starts at 7.5 on the venue clock");
  assert.ok(d.span > r.goalSeconds / 3600 - 0.01);
  for (const wd of d.wedges) assert.ok(wd.v > 0 && wd.v <= 1);
});

test("the share card draws the dial as vector shapes and never carries paces", () => {
  const s = snapshot();
  assert.equal(s.dial.wedges.length, 24);
  assert.ok(s.splitBands.every((b) => ["free", "mild", "working", "near", "outrun"].includes(b)));
  assert.doesNotMatch(JSON.stringify(s), /paceSeconds|lowSeconds":\s*null/);
  const feed = briefingSVG(s), story = briefingSVG(s, { format: "story" });
  assert.match(feed, /class="card-dial"/);
  assert.match(story, /class="card-splits"/);
  for (const svg of [feed, story]) {
    const dom = new JSDOM(svg, { contentType: "image/svg+xml" });
    assert.equal(dom.window.document.querySelectorAll("script,image,foreignObject").length, 0);
  }
});
