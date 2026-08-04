/* The main render pass. Reads state, runs the projection, paints everything. */

import {
  clamp, fmt1, r1, project, hourScore, hourAllowed, findBestWindow,
  ratingFor, metricSeverity, hourLabel, dayTag, windowLabelText, THUNDER_CODES,
} from "../engine.js";
import {
  S, modelOpts, trainingHours, currentProjectionArgs,
  TERRAIN_LABELS, SLIDER_HOURS, SEARCH_HOURS, bias,
} from "./state.js";
import { $, escHtml, guard } from "./dom.js";
import { forecastAgeMinutes } from "./data.js";
import { renderNowcast } from "./radar.js";
import { updateBriefing } from "./briefing.js";
import { renderAdaptation } from "./adaptation.js";
import { renderPlanner } from "./planner.js";
import { renderRace } from "./race.js";
import { renderExplain } from "./explain.js";
import { renderFeedback } from "./feedback.js";
import { syncControls } from "./bus.js";

const RIBBON_LABELS = { temp: "temp", dew: "dew point", wind: "wind", wbgt: "est. WBGT", aqi: "AQI" };

function ribbonMetricValue(h, metric) {
  if (metric === "dew") return { value: Math.round(h.dew), unitType: "deg" };
  if (metric === "wind") return { value: Math.round(h.wind), unitType: "mph" };
  if (metric === "wbgt") return { value: Math.round(h.wbgt), unitType: "deg" };
  if (metric === "aqi") return { value: h.aqi != null ? Math.round(h.aqi) : "—", unitType: "none" };
  return { value: Math.round(h.temp), unitType: "deg" };
}

function setMetricFlag(valueId, flagId, level, text) {
  const cell = $(valueId)?.closest(".poster-metric");
  const flag = $(flagId);
  if (!cell || !flag) return;
  cell.classList.toggle("driver", level === 2);
  cell.classList.toggle("watch", level === 1);
  flag.textContent = level > 0 ? text : ".";
}

function riskCopyFor(p) {
  if (p.thunder) return "Thunderstorm signal inside this window. Lightning risk overrides pace planning — move the workout.";
  if (!p.finishSafe) return "Heat or precipitation rises before your expected finish. Move or modify the workout.";
  if (p.avgTemp < 32) return "Cold is the main variable. Cover extremities and warm up indoors; footing may be a factor.";
  if (p.start.uv >= 8) return "No major hazard signal during this window. UV is the main variable — cover up.";
  return "No major hazard signal during this window. Solar exposure is the main variable.";
}

function renderCore() {
  if (!S.hours || !S.meta) return;
  const hours = S.hours;
  const th = trainingHours();
  const maxStart = Math.min(SLIDER_HOURS - 1, hours.length - 4);
  S.startIdx = clamp(S.startIdx, 0, maxStart);

  const slider = $("start-time");
  if (slider) { slider.max = String(maxStart); slider.value = String(S.startIdx); }

  const p = project(currentProjectionArgs());
  S.lastProjection = p;

  const startHour = hours[S.startIdx];
  const todayIso = S.meta.todayIso || hours[0].iso.slice(0, 10);
  const startLabel = dayTag(startHour.iso, todayIso) + hourLabel(startHour.iso);

  /* ---- metric bank ---- */
  $("mTemp").textContent = Math.round(startHour.temp);
  $("mDew").textContent = Math.round(startHour.dew);
  $("mWind").textContent = Math.round(startHour.wind);
  $("mWbgt").textContent = startHour.wbgt;
  $("mAqi").textContent = startHour.aqi != null ? Math.round(startHour.aqi) : "—";
  $("mPrecip").textContent = Math.round(startHour.precipProb);
  $("mPrecipLabel").textContent = THUNDER_CODES.has(startHour.code) ? "T-STORM" : "PRECIP";

  const x = p.extremes;
  const sev = metricSeverity(x, S.sport);
  const coldDriven = x.minTemp <= 32 && x.maxTemp < 80;
  setMetricFlag("mTemp", "fTemp", sev.temp, coldDriven ? `▼ LOW ${x.minTemp}°` : `▲ PEAKS ${x.maxTemp}°`);
  setMetricFlag("mDew", "fDew", sev.dew, `▲ PEAKS ${x.maxDew}°`);
  setMetricFlag("mWind", "fWind", sev.wind, `▲ GUSTS ${x.maxGust}`);
  setMetricFlag("mWbgt", "fWbgt", sev.wbgt, `▲ PEAKS ${x.maxWbgt}°`);
  setMetricFlag("mPrecip", "fPrecip", sev.precip, x.thunder ? "⚡ T-STORM RISK" : `▲ ${x.maxPrecip}% BY FINISH`);
  setMetricFlag("mAqi", "fAqi", sev.aqi, `▲ PEAKS ${x.maxAqi} AQI`);

  renderNowcast();

  /* ---- planner controls ---- */
  $("startOut").textContent = startLabel.toUpperCase();
  $("scaleLeft").textContent = hourLabel(hours[0].iso);
  $("scaleRight").textContent = "+" + maxStart + "H";
  $("adjustment").textContent = p.adjustment.toUpperCase();
  $("finishFlag").textContent = p.finishSafe ? "FINISH-SAFE / CONFIRMED" : "EARLIER START / ADVISED";

  /* ---- pace profile ---- */
  const paceProfile = $("paceProfile");
  paceProfile.classList.toggle("inactive", S.sport === "ride");
  $("paceHint").textContent = S.sport === "run"
    ? `${S.intensity.toUpperCase()} pace drives this projection.`
    : "Select RUN to apply these pace baselines.";
  document.querySelectorAll(".pace-field").forEach((f) => {
    const active = f.dataset.pace === S.intensity && S.sport === "run";
    f.classList.toggle("active", active);
    f.querySelector("em").textContent = active ? "ACTIVE BASELINE" : "PROFILE PACE";
  });
  $("adjPaceLabel").textContent = `ADJUSTED ${S.intensity.toUpperCase()} PACE`;
  if (S.sport === "run" && p.adjustedPace) {
    $("adjPace").textContent = `${p.adjustedPace.lowLabel}–${p.adjustedPace.highLabel}`;
    $("adjPaceFrom").textContent = `FROM ${p.adjustedPace.baselineLabel} MIN/MI`;
  } else {
    $("adjPace").textContent = "RUN ONLY";
    $("adjPaceFrom").textContent = "POWER PROFILE COMING NEXT";
  }

  /* ---- hourly ribbon ---- */
  const ribbonCount = Math.min(SLIDER_HOURS, maxStart + 1);
  let html = "";
  for (let i = 0; i < ribbonCount; i++) {
    const h = hours[i];
    const hs = hourScore(hours, i, S.duration, S.intensity, S.sport, S.structure, S.meta.elevFt || 0, modelOpts());
    const rt = ratingFor(hs.score, hs.thunder);
    const off = !hourAllowed(h.iso, th.from, th.to);
    const rv = ribbonMetricValue(h, S.profile.ribbonMetric);
    const aria = rv.unitType === "deg" ? `${rv.value} degrees` : rv.unitType === "mph" ? `${rv.value} mph` : `${rv.value}`;
    const val = rv.unitType === "deg" ? `${rv.value}°` : rv.unitType === "mph" ? `${rv.value}<small> MPH</small>` : `${rv.value}`;
    html += `<button type="button" class="hour-cell tone-${rt.tone}${i === S.startIdx ? " selected" : ""}${off ? " offhours" : ""}" data-idx="${i}"
      aria-pressed="${i === S.startIdx}" aria-label="${escHtml(`${dayTag(h.iso, todayIso)}${hourLabel(h.iso)}, ${rt.rating}, ${RIBBON_LABELS[S.profile.ribbonMetric]} ${aria}`)}">
      ${h.isDay ? "" : '<span class="night-dot" title="Dark"></span>'}
      <span class="hour-index">${String(i + 1).padStart(2, "0")}</span>
      <span class="hour-time">${dayTag(h.iso, todayIso)}${hourLabel(h.iso)}</span>
      <strong>${val}</strong>
      <span class="hour-rating">${rt.rating}</span>
    </button>`;
  }
  const ribbon = $("hourRibbon");
  ribbon.innerHTML = html;
  ribbon.querySelectorAll(".hour-cell").forEach((b) =>
    b.addEventListener("click", () => { S.startIdx = Number(b.dataset.idx); render(); }));

  /* ---- best window ---- */
  const searchMax = Math.min(SEARCH_HOURS, hours.length - 4);
  const win = findBestWindow(hours, S.duration, S.intensity, S.sport, searchMax,
    { fromH: th.from, toH: th.to, structure: S.structure, ...modelOpts() });
  S.bestWindow = win;
  const plate = $("windowPlate");
  if (win) {
    const a = hours[win.rangeLo], b = hours[Math.min(win.rangeHi + 1, hours.length - 1)];
    const wl = windowLabelText(a.iso, b.iso, todayIso);
    $("windowLabel").textContent = wl.prefix ? `GOOD TRAINING WINDOW / ${wl.prefix}` : "GOOD TRAINING WINDOW";
    $("windowTime").textContent = wl.time;
    $("windowLoc").textContent = (S.profile.location?.label || S.meta.label).toUpperCase();
    $("windowMeta").textContent = S.meta.sunrise ? `/ SUNRISE ${S.meta.sunrise} · SUNSET ${S.meta.sunset}` : "/ NEXT 24H SCAN";
    plate.classList.remove("none");
  } else {
    $("windowLabel").textContent = "NO CLEAR WINDOW";
    $("windowTime").textContent = "TRAIN INDOORS";
    $("windowLoc").textContent = (S.profile.location?.label || S.meta.label).toUpperCase();
    $("windowMeta").textContent = "/ STORM SIGNAL ACROSS NEXT 24H";
    plate.classList.add("none");
  }

  updateBriefing(p, win ? ($("windowLabel").textContent.includes("TOMORROW") ? "tomorrow " : "") + $("windowTime").textContent : null);

  /* ---- readout ---- */
  $("atTime").textContent = "AT " + startLabel.toUpperCase();
  $("effortScore").textContent = p.effortScore;
  $("effortHead").textContent = S.sport === "run" && p.adjustedPace
    ? `${p.adjustedPace.lowLabel}–${p.adjustedPace.highLabel} /MI`
    : `+${fmt1(p.performanceImpact.low)}–${fmt1(p.performanceImpact.high)}% LOAD`;
  $("effortCopy").textContent = S.sport === "run" && p.adjustedPace
    ? `Adjusted from your ${S.intensity.toLowerCase()} baseline of ${p.adjustedPace.baselineLabel}/mi. About +${fmt1(p.rpeDelta.low)}–${fmt1(p.rpeDelta.high)} RPE. Averaged across your full ${S.duration} minutes.`
    : `About +${fmt1(p.rpeDelta.low)}–${fmt1(p.rpeDelta.high)} RPE. Hold effort, not normal power.`;
  $("impactRange").textContent = `${fmt1(p.performanceImpact.low)}–${fmt1(p.performanceImpact.high)}% SLOWER`;
  $("strainVal").textContent = fmt1(p.strain.mean);
  $("strainWord").textContent = p.strain.label.toUpperCase();
  $("acclWord").textContent = `${p.acclimation.label.toUpperCase()} / ×${fmt1(p.acclimation.multiplier)}`;
  const b = bias();
  $("personalWord").textContent = b.ready ? `${b.label.toUpperCase()} / ×${fmt1(b.multiplier)}` : `LEARNING · ${b.samples}/6`;

  $("riskScore").textContent = p.riskScore;
  $("riskHead").textContent = p.riskLabel.toUpperCase();
  $("riskCopy").textContent = riskCopyFor(p);

  const age = forecastAgeMinutes();
  $("fcMeta").textContent = S.meta.demo ? "DEMO DATA" : `OPEN-METEO / ${age} MIN AGO`;
  const stale = $("staleStrip");
  if (stale) {
    const isStale = !S.meta.demo && age != null && age >= 90;
    stale.hidden = !isStale;
    if (isStale) $("staleText").textContent =
      `THIS FORECAST IS ${age >= 120 ? `${Math.round(age / 60)} HOURS` : `${age} MINUTES`} OLD${navigator.onLine === false ? " AND YOU'RE OFFLINE" : ""} — REFRESH FOR CURRENT CONDITIONS`;
  }

  /* ---- why bars ---- */
  const c = p.components;
  const mids = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, (v.low + v.high) / 2]));
  const total = Math.max(0.001, Object.values(mids).reduce((a, v) => a + v, 0));
  for (const key of ["heat", "wind", "cold", "rain", "air", "alt"]) {
    const bar = $("bar" + key[0].toUpperCase() + key.slice(1));
    const val = $("val" + key[0].toUpperCase() + key.slice(1));
    if (bar) bar.style.width = clamp((mids[key] / total) * 100, 0, 100) + "%";
    if (val) val.textContent = mids[key] < 0.05 ? "—" : `+${fmt1(r1(c[key].low))}–${fmt1(r1(c[key].high))}%`;
  }

  /* ---- finish strip ---- */
  $("finishStrip").className = "finish-strip " + (p.finishSafe ? "safe" : "warning");
  $("finishIcon").textContent = p.finishSafe ? "OK" : "!";
  $("finishHead").textContent = p.finishSafe
    ? "YOU SHOULD FINISH AHEAD OF THE CHANGE."
    : "CONDITIONS MAY TURN BEFORE YOU FINISH.";
  $("finishCopy").textContent = p.finishSafe
    ? `Starting at ${startLabel}, the ${S.duration}-minute ${S.sport} stays ahead of the changing conditions.`
    : `At finish: ${Math.round(p.finish.wbgt)}°F est. WBGT and ${Math.round(p.finish.precipProb)}% precip probability${p.thunder ? " with thunderstorm signal" : ""}. Start earlier or shorten.`;
  $("finTemp").textContent = Math.round(p.finish.temp);
  $("finPrecip").textContent = Math.round(p.finish.precipProb);

  /* ---- method strip ---- */
  $("methodLoad").textContent = `STRAIN ${fmt1(p.strain.mean)} / PEAK ${fmt1(p.strain.peak)}${(S.meta.elevFt || 0) >= 3000 ? ` / ELEV ${S.meta.elevFt.toLocaleString()} FT` : ""}`;
  const altNote = p.components.alt.high > 0
    ? ` Altitude is scored against your home elevation of ${(S.profile.homeElevFt ?? 0).toLocaleString()} ft.`
    : "";
  const personalNote = b.ready ? ` Personalised ×${fmt1(b.multiplier)} from ${b.samples} logged workouts.` : "";
  $("methodCopy").textContent =
    `Thermal strain ${fmt1(p.strain.mean)} — ${p.strain.label.toLowerCase()} — integrated across your ${S.duration}-minute window rather than read off its average. Dew point sets how much heat you can shed; temperature and sun set how much you must. Scaled for ${S.intensity.toLowerCase()} effort (×${fmt1(p.factors.intensity)}), duration (×${fmt1(p.factors.duration)}) and your heat state (×${fmt1(p.acclimation.multiplier)}).${personalNote} Wind is modelled as drag at torso height over a ${TERRAIN_LABELS[S.profile.terrain].toLowerCase()} route.${altNote} Est. WBGT and storms drive safety, not pace.`;

  /* ---- feature panels ---- */
  renderAdaptation();
  renderPlanner();
  renderRace();
  renderExplain(p);
  renderFeedback();
  syncControls();
}

export const render = guard(renderCore, "render");
