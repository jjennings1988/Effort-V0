/* A pinned race owns its venue forecast. Athlete assumptions remain shared. */
import { RACE_DISTANCES, fmtDuration } from "../engine.js";
import { S, modelOpts, saveProfile } from "./state.js";
import { $ } from "./dom.js";
import { paceLabel, paceUnitShort, temp, wind, windUnit, unit } from "./units.js";
import { requestRender } from "./bus.js";
import { searchPlaces, stateAbbr, FORECAST_DAYS } from "./data.js";
import { cleanVenue, validDate, validTime, raceEpoch, localISO, daysUntil, raceProjection, raceTakeaway, finishBand, raceClock, raceDate } from "./race-model.js";
import { fetchRaceWeather } from "./race-weather.js";
import { createBriefingSnapshot, openRaceShare, wireRaceShare } from "./race-share.js";
import { renderRaceInstrument, hideRaceInstrument } from "./race-dial.js";
import { MILE_M, predictRace, goalCheck, parseDuration } from "../fitness.js";
import { currentFitness } from "./state.js";
import { addPerformance } from "./fitness-panel.js";

const PERF_KEY = { "5k": "5k", "10k": "10k", half: "half", full: "full" };
const round5 = (s) => Math.round(s / 5) * 5;
let suggestedGoal = null;

/* What demonstrated fitness says about this race. With a forecast, the
   suggestion is also run through the race model for that venue and start. */
function renderRaceFitness(race, weatherData) {
  const box = $("raceFitness");
  suggestedGoal = null;
  const f = currentFitness();
  const dist = RACE_DISTANCES[race.distanceKey];
  if (!box || !f || !dist) { if (box) box.hidden = true; return; }
  const pred = predictRace(f, dist.miles * MILE_M);
  suggestedGoal = round5(pred.midSeconds);
  box.hidden = false;
  box.dataset.level = pred.confidence;
  $("raceFitTime").textContent = fmtDuration(suggestedGoal);
  let forecast = "";
  if (weatherData) {
    const withWeather = raceProjection({ ...race, goalSeconds: suggestedGoal }, weatherData, modelOpts());
    if (withWeather) forecast = ` With this forecast, about ${finishBand(withWeather.lowSeconds, withWeather.highSeconds)}.`;
  }
  const check = goalCheck(f, dist.miles * MILE_M, race.goalSeconds);
  const verdict = !check ? "" : {
    stretch: ` Your ${fmtDuration(race.goalSeconds)} goal needs fitness well beyond your recent results (VDOT ${check.needed.toFixed(1)} vs ${check.have.toFixed(1)}).`,
    ambitious: ` Your ${fmtDuration(race.goalSeconds)} goal is ambitious but within reach of a good day.`,
    matched: ` Your ${fmtDuration(race.goalSeconds)} goal matches your fitness.`,
    conservative: ` Your ${fmtDuration(race.goalSeconds)} goal is conservative for your recent results.`,
  }[check.verdict];
  $("raceFitBody").textContent = `In neutral air: ${finishBand(pred.fastSeconds, pred.slowSeconds)} · ${pred.confidence} confidence${pred.slowExtra ? ", leaning slow without long-race evidence" : ""}.${forecast}${verdict}`;
  $("raceFitUse").hidden = Math.abs(suggestedGoal - race.goalSeconds) < 30;
}
export { daysUntil } from "./race-model.js";

export function parseGoal(text) {
  const m = String(text).trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1] ?? 0), min = Number(m[2]), s = Number(m[3]);
  if (min > 59 || s > 59) return null;
  const total = h * 3600 + min * 60 + s;
  return total >= 480 && total <= 12 * 3600 ? total : null;
}
let requestId = 0, editing = false, currentResult = null;
const weatherKey = race => JSON.stringify([race.dateISO, race.location]);

function ensureWeather(race, force = false) {
  const key = weatherKey(race), existing = S.raceWeather;
  if (!force && existing?.key === key && (existing.status !== "ready" || Date.now() - existing.data.fetchedAt < 15 * 60000)) return;
  const token = ++requestId;
  S.raceWeather = { key, status: "loading", data: null };
  fetchRaceWeather(race.location).then(data => {
    if (token !== requestId || !S.profile.race || weatherKey(S.profile.race) !== key) return;
    S.raceWeather = { key, status: "ready", data };
    requestRender();
  }).catch(() => {
    if (token !== requestId || !S.profile.race || weatherKey(S.profile.race) !== key) return;
    S.raceWeather = { key, status: "error", data: null };
    requestRender();
  });
}

export function renderRace() {
  if (!$("raceSection")) return;
  const race = S.profile.race;
  $("raceEmpty").hidden = !!race && !editing;
  $("raceDetail").hidden = !race || editing;
  $("raceCancel").hidden = !race;
  $("raceUseLocation").textContent = S.meta?.demo ? "Use sample venue" : "Use training location";
  currentResult = null;
  hideRaceInstrument();
  if ($("raceFitness")) $("raceFitness").hidden = true;
  if ($("raceLog")) $("raceLog").hidden = true;
  if (!race) return;
  const dist = RACE_DISTANCES[race.distanceKey];
  $("raceName").textContent = race.name || dist.label;
  $("raceMeta").textContent = `${dist.label} · ${raceDate(race.dateISO)} · Goal ${fmtDuration(race.goalSeconds)}`;
  $("raceVenue").textContent = race.location ? `${race.location.label} · ${race.startTime || "Confirm start"} · ${race.location.timezone}` : "Confirm the race venue and your wave time";
  $("raceStartNote").textContent = "YOUR RACE BRIEFING";
  $("raceTimeline").hidden = true;
  $("raceShare").disabled = true;
  $("raceRefresh").hidden = true;
  $("raceForecastStatus").textContent = "";
  $("racePlan").textContent = "";
  const timezone = race.location?.timezone;
  const today = timezone ? localISO(Date.now(), timezone).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const days = daysUntil(race.dateISO, today);
  $("raceCountdown").textContent = days < 0 ? "PAST" : days === 0 ? "TODAY" : `${days} DAY${days === 1 ? "" : "S"}`;
  $("raceCountdownLabel").textContent = days > 0 ? "TO GO" : "RACE DAY";
  if (!cleanVenue(race.location) || !validTime(race.startTime)) {
    $("raceHeadline").textContent = "Make it race-specific.";
    $("raceBody").textContent = "Your saved race is here. Confirm its venue and your wave time to get the correct forecast and create a briefing.";
    return;
  }
  const start = raceEpoch(race.dateISO, race.startTime, timezone);
  if (start == null) {
    $("raceHeadline").textContent = "Confirm your wave time.";
    $("raceBody").textContent = "This local time is repeated or skipped by a daylight-saving change. Edit the start to an unambiguous race time.";
    return;
  }
  if (start < Date.now()) {
    const logged = S.profile.performances.some((p) => p.dateISO === race.dateISO && p.distanceKey === PERF_KEY[race.distanceKey]);
    $("raceHeadline").textContent = logged ? "Result logged." : "The start is behind us.";
    $("raceBody").textContent = logged
      ? "Your result is in your fitness anchor, corrected for that morning's weather. Pin your next race when you're ready."
      : "Log your finish below and every training pace updates from it. Then edit the date or pin your next race.";
    $("raceLog").hidden = logged;
    return;
  }
  if (days >= FORECAST_DAYS) renderRaceFitness(race, null);
  if (days >= FORECAST_DAYS) {
    $("raceHeadline").textContent = "A goal worth watching.";
    $("raceBody").textContent = `Goal pace ${paceLabel(race.goalSeconds / dist.miles)}${paceUnitShort()}. Race-day weather is outside the forecast window. Check back within a week of the start.`;
    $("racePlan").textContent = "Your venue and wave time are saved. The shareable weather briefing opens when the forecast covers your full race.";
    return;
  }
  ensureWeather(race);
  const state = S.raceWeather;
  if (state?.status === "loading") {
    $("raceHeadline").textContent = "Reading the race forecast…";
    $("raceBody").textContent = `Fetching conditions for ${race.location.label}. Your training location stays the same.`;
    $("raceForecastStatus").textContent = "Loading venue forecast";
    return;
  }
  $("raceRefresh").hidden = false;
  if (state?.status !== "ready") {
    $("raceHeadline").textContent = "Forecast temporarily unavailable.";
    $("raceBody").textContent = "Your race is saved. Retry the venue forecast when you're connected; a briefing needs current, complete conditions.";
    return;
  }
  const r = raceProjection(race, state.data, modelOpts());
  if (!r) {
    $("raceHeadline").textContent = "Waiting for the full race window.";
    $("raceBody").textContent = "The available forecast does not cover the entire projected race, or some weather hours are missing. Check back or refresh before sharing.";
    return;
  }
  currentResult = r;
  const takeaway = raceTakeaway(r);
  $("raceStartNote").textContent = "ESTIMATED FINISH / PERSONAL MODEL RANGE";
  $("raceHeadline").textContent = finishBand(r.lowSeconds, r.highSeconds);
  $("raceBody").textContent = `${takeaway.headline} ${takeaway.body}`;
  $("racePlan").textContent = `Goal ${r.goalLabel} · modeled pace ${paceLabel(r.midSeconds / dist.miles)}${paceUnitShort()}. Rounded finish range reflects model assumptions, not a statistical confidence interval or a guarantee.`;
  $("raceTimeline").hidden = false;
  $("raceTimeline").innerHTML = r.points.map((p, i) => `<div class="race-stop"><span>${["START", "MIDPOINT", "EST. FINISH"][i]}</span><strong>${temp(p.temp, { unit: true })}</strong><time>${raceClock(p.epoch, timezone, { date: localISO(p.epoch, timezone).slice(0, 10) !== race.dateISO })}</time><small>${temp(p.dew)} dew · ${wind(p.wind)} ${windUnit()}</small></div>`).join("");
  const aqComplete = state.data.hours.filter(h => h.epoch >= r.startEpoch - 3600000 && h.epoch <= r.points[2].epoch + 3600000).every(h => h.aqi != null);
  $("raceForecastStatus").textContent = `${state.data.demo ? "SAMPLE FORECAST · DEMO DATA" : "Open-Meteo forecast"} · Fetched ${raceClock(state.data.fetchedAt, timezone, { date: true })} · ${timezone}${aqComplete ? "" : " · Air quality coverage incomplete"}`;
  $("raceShare").disabled = false;
  renderRaceFitness(race, state.data);
  renderRaceInstrument(race, r, state.data);
}

export function wireRace() {
  requestId++; editing = false; currentResult = null;
  const form = $("raceForm");
  if (!form) return;
  wireRaceShare();
  let venue = null, searchId = 0;
  const error = (message, field) => { $("raceError").hidden = false; $("raceError").textContent = message; field?.focus(); };
  const chooseVenue = loc => {
    venue = cleanVenue(loc);
    $("raceInputPlace").value = venue?.label ?? "";
    $("raceInputTimezone").value = venue?.timezone ?? "";
    $("racePlaceStatus").textContent = venue ? `${venue.sample ? "Sample venue" : "Venue selected"} · ${venue.timezone}` : "Search, then select the race city or town.";
    $("racePlaceResults").replaceChildren();
  };
  const fill = () => {
    const r = S.profile.race;
    $("raceInputName").value = r?.name ?? "";
    $("raceInputDate").value = r?.dateISO ?? "";
    $("raceInputGoal").value = r ? fmtDuration(r.goalSeconds) : "";
    $("raceInputDist").value = r?.distanceKey ?? "full";
    $("raceInputTime").value = r?.startTime ?? "07:00";
    chooseVenue(r?.location);
    $("raceError").hidden = true;
    $("raceSave").textContent = r ? "Save race" : "Pin race";
  };
  fill();
  $("raceInputPlace").addEventListener("input", () => {
    searchId++; venue = null; $("raceInputTimezone").value = "";
    $("racePlaceResults").replaceChildren();
    $("racePlaceStatus").textContent = "Search, then select the race city or town.";
  });
  const search = async () => {
    const query = $("raceInputPlace").value.trim();
    if (query.length < 2) { $("racePlaceStatus").textContent = "Enter at least two characters to search."; return; }
    const token = ++searchId;
    $("racePlaceStatus").textContent = "Finding race venues…";
    try {
      const places = await searchPlaces(query);
      if (token !== searchId) return;
      const locations = places.map(p => cleanVenue({ lat: p.latitude, lon: p.longitude,
        label: [p.name, p.admin1 ? stateAbbr(p.admin1) : p.country_code, p.country_code].filter((v, i, a) => v && a.indexOf(v) === i).join(", "), timezone: p.timezone })).filter(Boolean);
      $("racePlaceResults").replaceChildren();
      for (const loc of locations) {
        const li = document.createElement("li"), b = document.createElement("button");
        b.type = "button"; b.textContent = `${loc.label} · ${loc.timezone}`;
        b.addEventListener("click", () => { searchId++; chooseVenue(loc); $("raceInputTime").focus(); });
        li.append(b); $("racePlaceResults").append(li);
      }
      $("racePlaceStatus").textContent = locations.length ? "Choose the location closest to the race start." : "No places found. Try a nearby city or include the country.";
    } catch { if (token === searchId) $("racePlaceStatus").textContent = "Place search is unavailable. Try again when connected, or use your training location."; }
  };
  $("racePlaceSearch").addEventListener("click", search);
  $("raceInputPlace").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); search(); } });
  $("raceUseLocation").addEventListener("click", () => {
    searchId++;
    if (S.meta?.demo) chooseVenue({ lat: 35.43, lon: -82.5, label: "Fletcher, NC", timezone: "America/New_York", sample: true });
    else if (S.meta?.timezone && Number.isFinite(S.meta.lat)) chooseVenue({ lat: S.meta.lat, lon: S.meta.lon, label: S.meta.label, timezone: S.meta.timezone });
    else { $("racePlaceStatus").textContent = "Load your training forecast first, or search for the race city."; return; }
    $("raceInputTime").focus();
  });
  form.addEventListener("submit", e => {
    e.preventDefault();
    const goal = parseGoal($("raceInputGoal").value), dateISO = $("raceInputDate").value, startTime = $("raceInputTime").value;
    if (!goal) return error("Goal time should look like 3:30:00 or 24:30.", $("raceInputGoal"));
    if (!validDate(dateISO)) return error("Pick a valid race date.", $("raceInputDate"));
    if (!venue) return error("Select the race city or use the training location.", $("raceInputPlace"));
    if (!validTime(startTime)) return error("Enter your local wave start time.", $("raceInputTime"));
    const start = raceEpoch(dateISO, startTime, venue.timezone);
    if (start == null) return error("That local time is repeated or skipped by daylight saving. Choose an unambiguous start time.", $("raceInputTime"));
    if (start <= Date.now()) return error("Choose a race start in the future.", $("raceInputDate"));
    S.profile.race = { name: $("raceInputName").value.trim().slice(0, 60), dateISO,
      distanceKey: $("raceInputDist").value, goalSeconds: goal, startTime, location: { ...venue } };
    editing = false; $("raceError").hidden = true;
    saveProfile(); requestRender(); $("raceName").focus({ preventScroll: true });
  });
  $("raceEdit").addEventListener("click", () => { editing = true; fill(); renderRace(); $("raceInputName").focus(); });
  $("raceCancel").addEventListener("click", () => { editing = false; searchId++; renderRace(); $("raceEdit").focus(); });
  $("raceClear").addEventListener("click", () => { requestId++; searchId++; S.profile.race = null; S.raceWeather = null; editing = false; saveProfile(); fill(); requestRender(); $("raceInputName").focus(); });
  $("raceRefresh").addEventListener("click", () => { ensureWeather(S.profile.race, true); renderRace(); });
  $("raceFitUse")?.addEventListener("click", () => {
    if (!suggestedGoal || !S.profile.race) return;
    S.profile.race = { ...S.profile.race, goalSeconds: suggestedGoal };
    saveProfile(); requestRender();
  });
  $("raceLogTime")?.addEventListener("input", (e) => { e.target.value = e.target.value.replace(/[^0-9:]/g, "").slice(0, 8); });
  $("raceLog")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const race = S.profile.race, seconds = parseDuration($("raceLogTime").value);
    if (!race || !seconds) { $("raceLogStatus").textContent = "Enter your finish like 1:44:10."; return; }
    const added = addPerformance({ distanceKey: PERF_KEY[race.distanceKey], seconds, dateISO: race.dateISO, kind: "race",
      label: race.name, venue: race.location, startTime: race.startTime });
    $("raceLogStatus").textContent = added ? "Logged. Correcting for race-day weather…" : "That time doesn't fit the distance. Check it.";
    if (added) { $("raceLogTime").value = ""; requestRender(); }
  });
  const goalHint = () => {
    const f = currentFitness(), dist = RACE_DISTANCES[$("raceInputDist").value];
    $("raceInputGoal").placeholder = f && dist ? `Fitness says ${fmtDuration(round5(predictRace(f, dist.miles * MILE_M).midSeconds))}` : "3:30:00 or 24:30";
  };
  $("raceInputDist").addEventListener("change", goalHint);
  goalHint();
  $("raceShare").addEventListener("click", () => {
    renderRace();
    if (!currentResult) return;
    openRaceShare(createBriefingSnapshot({ race: S.profile.race, result: currentResult, weather: S.raceWeather.data,
      units: { temperature: unit("temperature"), distance: unit("distance") } }));
  });
  renderRace();
}
