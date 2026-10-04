/* You → Fitness anchor.

   Log races, correct them for that day's weather, and see the fitness they
   imply: a personal curve across distances, predictions with honest ranges,
   and training zones. One button lets the workout buttons follow it. */

import { fmtDuration, DEFAULT_PACES } from "../engine.js";
import {
  PERF_DISTANCES, MILE_M, ZONES, fitnessPaceFor, predictRace, vdotFromPerformance, parseDuration,
} from "../fitness.js";
import { S, saveProfile, currentFitness, cleanPerformance, raceGoalForFitness } from "./state.js";
import { $, escHtml } from "./dom.js";
import { requestRender } from "./bus.js";
import { searchPlaces, stateAbbr } from "./data.js";
import { cleanVenue } from "./race-model.js";
import { correctPerformance } from "./history-weather.js";
import { countTo } from "./instrument.js";
import { paceLabel, paceUnit, metricDistance } from "./units.js";

const pending = new Set();
const PREDICT = [["5k", "5K"], ["10k", "10K"], ["half", "HALF"], ["full", "MARATHON"]];
const INTENSITIES = ["Easy", "Steady", "Hard", "Race"];
const shortDate = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).toUpperCase();
const fmtRange = (a, b) => { const x = fmtDuration(Math.round(a / 5) * 5), y = fmtDuration(Math.round(b / 5) * 5); return x === y ? x : `${x}–${y}`; };

/* ---------- adding results (shared with setup and the race tab) ---------- */
export function addPerformance(entry, { followFitness = false } = {}) {
  const perf = cleanPerformance({ id: `p${Date.now().toString(36)}${Math.round(Math.random() * 1e4)}`, ...entry });
  if (!perf) return null;
  const firstEver = !S.profile.performances.length;
  S.profile.performances = [...S.profile.performances, perf]
    .sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1)).slice(-40);
  // A brand-new athlete who never typed paces should get race-based ones at once.
  const untouched = INTENSITIES.every((k) => S.profile.paceSource[k] === "manual") && firstEver
    && INTENSITIES.every((k) => S.profile.paces[k] === DEFAULT_PACES[k]);
  if (followFitness || untouched) followFitnessPaces();
  saveProfile();
  correctLater(perf);
  return perf;
}
function correctLater(perf) {
  if (!perf.venue || !perf.startTime || perf.weather || pending.has(perf.id)) return;
  pending.add(perf.id);
  correctPerformance(perf, { homeElevFt: S.profile.homeElevFt ?? 0, massKg: S.profile.massKg ?? 70 }).then((weather) => {
    pending.delete(perf.id);
    const i = S.profile.performances.findIndex((p) => p.id === perf.id);
    if (i < 0) return;
    const updated = cleanPerformance({ ...S.profile.performances[i], weather });
    if (!updated) return;
    S.profile.performances = S.profile.performances.map((p, j) => (j === i ? updated : p));
    saveProfile();
    requestRender();
  });
}
export function followFitnessPaces() {
  const f = currentFitness();
  for (const k of INTENSITIES) {
    S.profile.paceSource[k] = "fitness";
    const s = f && fitnessPaceFor(f, k, raceGoalForFitness());
    if (Number.isFinite(s)) S.profile.paces[k] = new Date(Math.round(s) * 1000).toISOString().slice(14, 19);
  }
}

/* ---------- the curve ---------- */
function curveSVG(f) {
  const W = 460, H = 230, L = 40, R = 14, T = 14, B = 36;
  const lx0 = Math.log(1500), lx1 = Math.log(42195);
  const x = (d) => L + ((Math.log(d) - lx0) / (lx1 - lx0)) * (W - L - R);
  if (!f) {
    return `<rect class="fc-frame" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>
      <text class="fc-empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">YOUR CURVE APPEARS WITH YOUR FIRST RESULT</text>`;
  }
  const samples = Array.from({ length: 25 }, (_, i) => Math.exp(lx0 + (i / 24) * (lx1 - lx0)));
  const band = samples.map((d) => {
    const p = predictRace(f, d);
    return { d, hi: vdotFromPerformance(d, p.fastSeconds), lo: vdotFromPerformance(d, p.slowSeconds), mid: p.vdot };
  });
  const vals = [...band.flatMap((b) => [b.hi, b.lo]), ...f.scored.flatMap((s) => [s.vdot, s.rawVdot])];
  const vmin = Math.floor(Math.min(...vals) - 1), vmax = Math.ceil(Math.max(...vals) + 1);
  const y = (v) => T + (1 - (v - vmin) / Math.max(1, vmax - vmin)) * (H - T - B);
  const ticks = [[1500, "1500"], [5000, "5K"], [10000, "10K"], [21097.5, "HALF"], [42195, "MARA"]];
  const step = vmax - vmin > 12 ? 4 : 2;
  let out = `<rect class="fc-frame" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>`;
  for (const [d, label] of ticks) {
    out += `<line class="fc-grid" x1="${x(d)}" x2="${x(d)}" y1="${T}" y2="${H - B}"/><text class="fc-axis" x="${x(d)}" y="${H - B + 16}" text-anchor="middle">${label}</text>`;
  }
  for (let v = Math.ceil(vmin / step) * step; v <= vmax; v += step) {
    out += `<line class="fc-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="fc-axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  out += `<path class="fc-band" d="M${band.map((b) => `${x(b.d).toFixed(1)},${y(b.hi).toFixed(1)}`).join(" L")} L${[...band].reverse().map((b) => `${x(b.d).toFixed(1)},${y(b.lo).toFixed(1)}`).join(" L")}Z"/>`;
  out += `<path class="fc-line" d="M${band.map((b) => `${x(b.d).toFixed(1)},${y(b.mid).toFixed(1)}`).join(" L")}"/>`;
  // where the zones are read from
  out += `<line class="fc-zone" x1="${x(15000)}" x2="${x(15000)}" y1="${T}" y2="${H - B}"/><text class="fc-zone-label" x="${x(15000) + 5}" y="${T + 12}">ZONES SET HERE</text>`;
  for (const s of f.scored) {
    const cx = x(s.distanceM), op = Math.max(0.35, Math.min(1, s.weight * 1.4)).toFixed(2);
    if (s.corrected && Math.abs(s.rawVdot - s.vdot) > 0.05) {
      out += `<line class="fc-shift" x1="${cx}" x2="${cx}" y1="${y(s.rawVdot)}" y2="${y(s.vdot)}"/><circle class="fc-raw" cx="${cx}" cy="${y(s.rawVdot)}" r="4"/>`;
    }
    out += `<circle class="fc-point${s.corrected ? " corrected" : ""}" cx="${cx}" cy="${y(s.vdot)}" r="6" opacity="${op}"><title>${escHtml(`${PERF_DISTANCES[s.distanceKey].label} ${fmtDuration(s.seconds)} · ${s.dateISO} · VDOT ${s.vdot.toFixed(1)}`)}</title></circle>`;
  }
  out += `<text class="fc-axis fc-ylabel" x="${L}" y="${T - 3}">VDOT</text>`;
  return out;
}

/* ---------- render ---------- */
export function renderFitnessPanel() {
  const inst = $("fitnessInst");
  if (!inst) return;
  const perfs = S.profile.performances;
  for (const p of perfs) correctLater(p);
  const f = currentFitness();
  inst.dataset.state = f ? "ready" : perfs.length ? "stale" : "empty";

  /* top bar */
  const chip = $("fitChip");
  const pend = perfs.some((p) => pending.has(p.id));
  chip.dataset.state = pend ? "sorting" : f ? "settled" : "cloud";
  $("fitChipText").textContent = pend ? "CORRECTING WEATHER" : f ? "ANCHORED" : perfs.length ? "RESULTS TOO OLD" : "NO EVIDENCE";
  if (f) {
    countTo($("fitVdot"), f.vdot, (v) => v.toFixed(1));
    $("fitCurve").textContent = f.endurance ? f.endurance.label.replace("-LEANING", "") : f.scored.length > 1 ? "NEEDS RANGE" : "STANDARD";
    const ten = predictRace(f, 10000);
    $("fitConf").textContent = ten.confidence.toUpperCase();
    $("fitConf").dataset.level = ten.confidence;
    const a = f.anchor;
    $("fitSource").textContent = `ANCHOR: ${PERF_DISTANCES[a.distanceKey].label} · ${shortDate(a.dateISO)} · ${fmtDuration(a.seconds)}${a.corrected ? ` → ${fmtDuration(a.weather.neutralSeconds)} NEUTRAL` : ""}`;
  } else {
    $("fitVdot").textContent = "—"; $("fitCurve").textContent = "—"; $("fitConf").textContent = "—";
    $("fitSource").textContent = perfs.length ? "YOUR RESULTS ARE OVER A YEAR OLD — ADD A RECENT ONE" : "ADD A RECENT RACE TO BEGIN";
  }

  /* curve + note */
  $("fitCurveSvg").innerHTML = curveSVG(f);
  $("fitCurveNote").textContent = !f ? "Each dot will be a result; the line is your fitness by distance."
    : f.endurance ? `${f.endurance.note}. The line bends to your own results; the band is the prediction range.`
      : f.scored.length > 1 ? "Add a result at a clearly different distance and the line learns your endurance."
        : "One result gives the standard curve. A second at another distance makes it yours.";

  /* predictions */
  $("fitPredict").innerHTML = PREDICT.map(([k, label]) => {
    const p = f && predictRace(f, PERF_DISTANCES[k].m);
    return `<div class="fit-pred" data-level="${p?.confidence ?? "none"}">
      <span>${label}</span>
      <strong>${p ? fmtDuration(Math.round(p.midSeconds)) : "—"}</strong>
      <small>${p ? fmtRange(p.fastSeconds, p.slowSeconds) : "NEUTRAL AIR"}</small>
      <em>${p ? `${p.confidence.toUpperCase()}${p.slowExtra ? " · LEANS SLOW" : ""}` : "NO DATA"}</em>
    </div>`;
  }).join("");

  /* evidence tape */
  const rows = [...perfs].reverse();
  $("fitHistory").innerHTML = rows.length ? rows.map((p, i) => {
    const w = p.weather, corrected = w?.status === "corrected";
    const status = pending.has(p.id) ? "CORRECTING…"
      : corrected ? `${fmtDuration(Math.round(w.neutralSeconds))} NEUTRAL${w.tempF != null ? ` · ${w.tempF}°/${w.dewF}°` : ""}${w.sample ? " · SAMPLE" : ""}`
        : w?.status === "unavailable" ? "NO WEATHER FOR THAT HOUR" : p.kind === "tt" ? "TIME TRIAL" : "AS RUN";
    return `<div class="fit-cell${corrected ? " corrected" : ""}" style="--i:${i}">
      <small>${escHtml(PERF_DISTANCES[p.distanceKey].short)} · ${shortDate(p.dateISO)}</small>
      <b>${fmtDuration(p.seconds)}</b>
      <span>${escHtml(status)}</span>
      <button type="button" class="fit-del" data-id="${escHtml(p.id)}" aria-label="Remove ${escHtml(PERF_DISTANCES[p.distanceKey].label)} on ${p.dateISO}">×</button>
    </div>`;
  }).join("") : `<p class="fit-empty">No results yet. Add your most recent race below.</p>`;
  $("fitTapeState").textContent = rows.length ? `${rows.length} RESULT${rows.length === 1 ? "" : "S"} · ${perfs.filter((p) => p.weather?.status === "corrected").length} CORRECTED` : "EMPTY";

  /* zones */
  $("fitZoneUnit").textContent = paceUnit();
  const drives = { easy: "EASY BUTTON", steady: "STEADY BUTTON", lt2: "HARD BUTTON" };
  $("fitZones").innerHTML = f ? f.zones.map((z) => `
    <div class="zone-row" data-zone="${z.key}">
      <span>${z.label}<small>${escHtml(z.desc)}${drives[z.key] ? ` · ${drives[z.key]}` : ""}</small></span>
      <em>${paceLabel(z.fastSec)}–${paceLabel(z.slowSec)}</em>
    </div>`).join("")
    : ZONES.map((z) => `<div class="zone-row empty"><span>${z.label}<small>${escHtml(z.desc)}</small></span><em>—</em></div>`).join("");

  /* follow fitness */
  const all = INTENSITIES.every((k) => S.profile.paceSource[k] === "fitness");
  const some = INTENSITIES.some((k) => S.profile.paceSource[k] === "fitness");
  const use = $("fitUsePaces");
  use.disabled = !f;
  use.textContent = all ? "BACK TO MANUAL PACES" : "USE RACE-BASED PACES";
  use.classList.toggle("on", all);
  $("fitUseNote").textContent = !f ? "Add a result to unlock."
    : all ? "Workout buttons follow your fitness. Typing a pace in 03 pins just that one."
      : some ? "Some buttons follow your fitness; typed paces are pinned."
        : "Your workout buttons use typed paces. Switch to let races set them.";

  /* mileage */
  const miles = $("fitMiles");
  if (miles && document.activeElement !== miles) {
    const wm = S.profile.weeklyMiles;
    miles.value = wm == null ? "" : String(Math.round(metricDistance() ? wm * 1.609344 : wm));
  }
  $("fitMilesUnit").textContent = metricDistance() ? "KM / WEEK" : "MI / WEEK";
}

/* ---------- wiring ---------- */
export function wireFitnessPanel() {
  const form = $("fitForm");
  if (!form) return;
  let venue = null, searchId = 0;
  $("fitDate").value = new Date().toISOString().slice(0, 10);
  $("fitDate").max = new Date().toISOString().slice(0, 10);
  const err = (msg, el) => { $("fitError").hidden = false; $("fitError").textContent = msg; el?.focus(); };
  const choose = (loc) => {
    venue = cleanVenue(loc);
    $("fitPlace").value = venue?.label ?? "";
    $("fitPlaceResults").replaceChildren();
    $("fitPlaceStatus").textContent = venue ? `${venue.sample ? "Sample location" : "Location set"} · ${venue.timezone}. Add the start time, then the result.` : "Choose where you ran and when you started.";
  };
  $("fitPlace").addEventListener("input", () => { searchId++; venue = null; $("fitPlaceResults").replaceChildren(); });
  const search = async () => {
    const q = $("fitPlace").value.trim();
    if (q.length < 2) { $("fitPlaceStatus").textContent = "Enter at least two characters."; return; }
    const token = ++searchId;
    $("fitPlaceStatus").textContent = "Finding places…";
    try {
      const places = await searchPlaces(q);
      if (token !== searchId) return;
      const locs = places.map((p) => cleanVenue({ lat: p.latitude, lon: p.longitude, timezone: p.timezone,
        label: [p.name, p.admin1 ? stateAbbr(p.admin1) : p.country_code, p.country_code].filter((v, i, a) => v && a.indexOf(v) === i).join(", ") })).filter(Boolean);
      $("fitPlaceResults").replaceChildren(...locs.map((loc) => {
        const li = document.createElement("li"), b = document.createElement("button");
        b.type = "button"; b.textContent = `${loc.label} · ${loc.timezone}`;
        b.addEventListener("click", () => { searchId++; choose(loc); $("fitStart").focus(); });
        li.append(b); return li;
      }));
      $("fitPlaceStatus").textContent = locs.length ? "Choose the closest place." : "No places found. Try a nearby city.";
    } catch { if (token === searchId) $("fitPlaceStatus").textContent = "Place search is unavailable offline."; }
  };
  $("fitPlaceSearch").addEventListener("click", search);
  $("fitPlace").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
  $("fitUseHome").addEventListener("click", () => {
    if (S.meta?.demo) choose({ lat: 35.43, lon: -82.5, label: "Fletcher, NC", timezone: "America/New_York", sample: true });
    else if (S.meta?.timezone && Number.isFinite(S.meta.lat)) choose({ lat: S.meta.lat, lon: S.meta.lon, label: S.meta.label, timezone: S.meta.timezone });
    else $("fitPlaceStatus").textContent = "Load your training forecast first, or search for the city.";
  });
  $("fitTime").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/[^0-9:]/g, "").slice(0, 8); });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    $("fitError").hidden = true;
    const seconds = parseDuration($("fitTime").value);
    const dateISO = $("fitDate").value;
    const key = $("fitDist").value;
    if (!seconds) return err("Enter a time like 41:21 or 1:31:35.", $("fitTime"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || dateISO > new Date().toISOString().slice(0, 10)) return err("Pick the date you ran it.", $("fitDate"));
    const pace = seconds / (PERF_DISTANCES[key].m / MILE_M);
    if (pace < 180 || pace > 1800) return err("That time doesn't fit the distance. Check both.", $("fitTime"));
    const withWeather = $("fitWeather").open && venue;
    const added = addPerformance({ distanceKey: key, seconds, dateISO, kind: $("fitKind").value,
      ...(withWeather ? { venue, startTime: $("fitStart").value || "08:00" } : {}) });
    if (!added) return err("That result couldn't be saved. Check the time and date.", $("fitTime"));
    $("fitTime").value = "";
    requestRender();
    $("fitTime").focus();
  });

  $("fitHistory").addEventListener("click", (e) => {
    const b = e.target.closest(".fit-del");
    if (!b) return;
    S.profile.performances = S.profile.performances.filter((p) => p.id !== b.dataset.id);
    saveProfile();
    requestRender();
  });

  $("fitUsePaces").addEventListener("click", () => {
    const all = INTENSITIES.every((k) => S.profile.paceSource[k] === "fitness");
    if (all) for (const k of INTENSITIES) S.profile.paceSource[k] = "manual";
    else followFitnessPaces();
    saveProfile();
    requestRender();
  });

  $("fitMiles").addEventListener("change", (e) => {
    const v = Number(String(e.target.value).replace(/[^0-9.]/g, ""));
    S.profile.weeklyMiles = Number.isFinite(v) && v > 0 ? Math.min(250, metricDistance() ? v / 1.609344 : v) : null;
    saveProfile();
    requestRender();
  });

}
