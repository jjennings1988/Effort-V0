/* The main render pass. Reads state, runs the projection, paints everything. */

import {
  clamp, fmt1, r1, project, hourScore, hourAllowed, findBestWindow,
  ratingFor, metricSeverity, hourLabel, dayTag, windowLabelText, THUNDER_CODES,
} from "../engine.js";
import {
  S, modelOpts, trainingHours, currentProjectionArgs,
  TERRAIN_LABELS, SLIDER_HOURS, SEARCH_HOURS, bias, hintSeen,
} from "./state.js";
import { $, $$, escHtml, guard } from "./dom.js";
import { forecastAgeMinutes } from "./data.js";
import { renderNowcast } from "./radar.js";
import { updateBriefing } from "./briefing.js";
import { renderAdaptation } from "./adaptation.js";
import { renderPlanner } from "./planner.js";
import { renderRace } from "./race.js";
import { renderExplain } from "./explain.js";
import { renderFeedback } from "./feedback.js";
import { renderProfile } from "./profile.js";
import * as U from "./units.js";
import { syncControls } from "./bus.js";

const RIBBON_LABELS = { temp: "temp", dew: "dew point", wind: "wind", wbgt: "est. WBGT", aqi: "AQI" };

function ribbonMetricValue(h, metric) {
  const deg = (f) => U.temp(f).replace("°", "");
  if (metric === "dew") return { value: deg(h.dew), unitType: "deg" };
  if (metric === "wind") return { value: U.wind(h.wind), unitType: "wind" };
  if (metric === "wbgt") return { value: deg(h.wbgt), unitType: "deg" };
  if (metric === "aqi") return { value: h.aqi != null ? Math.round(h.aqi) : "—", unitType: "none" };
  return { value: deg(h.temp), unitType: "deg" };
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
  if (!p.forecastClear) return "Forecast heat or precipitation rises before your expected finish. Move, shorten, or modify the workout.";
  if (p.avgTemp < 32) return "Cold is the main variable. Cover extremities and warm up indoors; footing may be a factor.";
  if (p.start.uv >= 8) return "No major hazard signal during this window. UV is the main variable — cover up.";
  return "No major forecast hazard identified in this window. Personal factors and local alerts still take precedence.";
}

function renderDecisionCurve(readings, win, todayIso) {
  const host = $("decisionPlot");
  if (!host || !readings.length) return;
  const W = 1000, H = 230, L = 26, R = 18, T = 22, B = 34;
  const plotW = W - L - R, plotH = H - T - B;
  const x = (i) => L + (i / Math.max(1, readings.length - 1)) * plotW;
  const y = (score) => T + (1 - clamp(score, 0, 100) / 100) * plotH;
  const path = readings.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r.score).toFixed(1)}`).join(" ");
  const area = `${path} L${x(readings.length - 1).toFixed(1)},${(H - B).toFixed(1)} L${x(0).toFixed(1)},${(H - B).toFixed(1)} Z`;
  const selected = readings[Math.min(S.startIdx, readings.length - 1)];
  const best = win ? readings[Math.min(win.idx, readings.length - 1)] : null;
  const bestLo = win ? x(Math.max(0, win.rangeLo)) : 0;
  const bestHi = win ? x(Math.min(readings.length - 1, win.rangeHi)) : 0;
  const timeLabels = [0, Math.round((readings.length - 1) / 3), Math.round((readings.length - 1) * 2 / 3), readings.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i);
  const night = readings.map((r, i) => !r.hour.isDay
    ? `<rect class="curve-night" x="${Math.max(L, x(i) - plotW / readings.length / 2).toFixed(1)}" y="${T}" width="${(plotW / readings.length + 1).toFixed(1)}" height="${plotH}"/>`
    : "").join("");

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="curveStroke" x1="0" x2="1"><stop offset="0" stop-color="#a8d2ff"/><stop offset=".48" stop-color="#cfff18"/><stop offset="1" stop-color="#ff725e"/></linearGradient>
      <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff725e" stop-opacity=".42"/><stop offset="1" stop-color="#cfff18" stop-opacity=".02"/></linearGradient>
    </defs>
    ${night}
    <line class="curve-grid caution" x1="${L}" x2="${W - R}" y1="${y(55)}" y2="${y(55)}"/>
    <line class="curve-grid" x1="${L}" x2="${W - R}" y1="${y(35)}" y2="${y(35)}"/>
    ${win ? `<rect class="curve-best-band" x="${bestLo.toFixed(1)}" y="${T}" width="${Math.max(8, bestHi - bestLo).toFixed(1)}" height="${plotH}"/>` : ""}
    <path class="curve-area" d="${area}"/>
    <path class="curve-line" d="${path}"/>
    ${best ? `<circle class="curve-best-point" cx="${x(win.idx)}" cy="${y(best.score)}" r="7"/>` : ""}
    <line class="curve-selected-line" x1="${x(S.startIdx)}" x2="${x(S.startIdx)}" y1="${T}" y2="${H - B}"/>
    <circle class="curve-selected-point" cx="${x(S.startIdx)}" cy="${y(selected.score)}" r="8"/>
    ${timeLabels.map((i) => `<text class="curve-time" x="${x(i)}" y="${H - 10}" text-anchor="${i === 0 ? "start" : i === readings.length - 1 ? "end" : "middle"}">${escHtml(dayTag(readings[i].hour.iso, todayIso) + hourLabel(readings[i].hour.iso))}</text>`).join("")}
  </svg>`;

  const bestText = best ? `BEST ${best.score}/100` : "NO CLEAR WINDOW";
  $("decisionCurveReadout").textContent = `YOUR START ${selected.score}/100 · ${bestText} · LOWER IS BETTER`;
  host.setAttribute("aria-label", `Workout decision curve. Your selected start scores ${selected.score} out of 100. ${best ? `The recommended start scores ${best.score}.` : "No clear window was found."} Lower is better.`);
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
  const orbReadings = $("orbReadings");
  if (orbReadings) orbReadings.textContent =
    `${U.temp(startHour.temp)} AIR / ${U.temp(startHour.dew)} DEW / ${U.wind(startHour.wind)} ${U.windUnit()} / ${Math.round(startHour.solar || 0)} W·M⁻²`;

  /* ---- metric bank ---- */
  $("mTemp").textContent = U.temp(startHour.temp).replace("°", "");
  $("mDew").textContent = U.temp(startHour.dew).replace("°", "");
  $("mWind").textContent = U.wind(startHour.wind);
  $("mWbgt").textContent = U.temp(startHour.wbgt).replace("°", "");
  // the wind cell carries its unit inline, so it has to follow the setting too
  $$(".poster-metric strong small").forEach((el) => {
    if (/MPH|KM\/H/i.test(el.textContent)) el.textContent = " " + U.windUnit();
  });
  $("mAqi").textContent = startHour.aqi != null ? Math.round(startHour.aqi) : "—";
  $("mPrecip").textContent = Math.round(startHour.precipProb);
  $("mPrecipLabel").textContent = THUNDER_CODES.has(startHour.code) ? "T-STORM" : "PRECIP";

  const x = p.extremes;
  const sev = metricSeverity(x, S.sport);
  const coldDriven = x.minTemp <= 32 && x.maxTemp < 80;
  setMetricFlag("mTemp", "fTemp", sev.temp, coldDriven ? `▼ LOW ${U.temp(x.minTemp)}` : `▲ PEAKS ${U.temp(x.maxTemp)}`);
  setMetricFlag("mDew", "fDew", sev.dew, `▲ PEAKS ${U.temp(x.maxDew)}`);
  setMetricFlag("mWind", "fWind", sev.wind, `▲ GUSTS ${U.wind(x.maxGust)}`);
  setMetricFlag("mWbgt", "fWbgt", sev.wbgt, `▲ PEAKS ${U.temp(x.maxWbgt)}`);
  setMetricFlag("mPrecip", "fPrecip", sev.precip, x.thunder ? "⚡ T-STORM RISK" : `▲ ${x.maxPrecip}% BY FINISH`);
  setMetricFlag("mAqi", "fAqi", sev.aqi, `▲ PEAKS ${x.maxAqi} AQI`);

  renderNowcast();

  /* ---- planner controls ---- */
  $("startOut").textContent = startLabel.toUpperCase();
  $("scaleLeft").textContent = hourLabel(hours[0].iso);
  $("scaleRight").textContent = "+" + maxStart + "H";
  $("adjustment").textContent = S.sport === "run" && p.adjustedPace
    ? `${U.paceLabel(p.adjustedPace.lowSeconds)}–${U.paceLabel(p.adjustedPace.highSeconds)} ${U.paceUnit()} AT THE SAME EFFORT`
    : p.adjustment.toUpperCase();
  $("finishFlag").textContent = p.forecastClear ? "NO MAJOR FORECAST HAZARD" : "MODIFY OR MOVE";
  $("modelVersion").textContent = p.modelVersion.toUpperCase();

  /* ---- adjusted pace (the pace fields themselves live in Profile) ---- */
  $("adjPaceLabel").textContent = `ADJUSTED ${S.intensity.toUpperCase()} PACE`;
  if (S.sport === "run" && p.adjustedPace) {
    $("adjPace").textContent = `${U.paceLabel(p.adjustedPace.lowSeconds)}–${U.paceLabel(p.adjustedPace.highSeconds)}`;
    $("adjPaceFrom").textContent = `FROM ${U.paceLabel(p.adjustedPace.baselineSeconds)} ${U.paceUnit()}`;
  } else {
    $("adjPace").textContent = "RUN ONLY";
    $("adjPaceFrom").textContent = "POWER PROFILE COMING NEXT";
  }

  /* ---- hourly ribbon ---- */
  const ribbonCount = Math.min(SLIDER_HOURS, maxStart + 1);
  let html = "";
  const readings = [];
  for (let i = 0; i < ribbonCount; i++) {
    const h = hours[i];
    const hs = hourScore(hours, i, S.duration, S.intensity, S.sport, S.structure, S.meta.elevFt || 0, modelOpts());
    const rt = ratingFor(hs.score, hs.thunder);
    readings.push({ ...hs, rating: rt, hour: h });
    const off = !hourAllowed(h.iso, th.from, th.to);
    const rv = ribbonMetricValue(h, S.profile.ribbonMetric);
    const aria = rv.unitType === "deg" ? `${rv.value} degrees` : rv.unitType === "wind" ? `${rv.value} ${U.windUnit()}` : `${rv.value}`;
    const val = rv.unitType === "deg" ? `${rv.value}°` : rv.unitType === "wind" ? `${rv.value}<small> ${U.windUnit()}</small>` : `${rv.value}`;
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
  renderDecisionCurve(readings, win, todayIso);
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

  /* ---- answer card (mobile-first summary) ----
     Repeats the two things the athlete opened the app for, above the fold. */
  const card = $("answerCard");
  if (card) {
    card.classList.toggle("none", !win);
    $("answerKicker").textContent = $("windowLabel").textContent;
    $("answerWindow").textContent = $("windowTime").textContent;
    $("answerPace").textContent = S.sport === "run" && p.adjustedPace
      ? `${U.paceLabel(p.adjustedPace.lowSeconds)}–${U.paceLabel(p.adjustedPace.highSeconds)} ${U.paceUnitShort()}`
      : `${fmt1(p.performanceImpact.low)}–${fmt1(p.performanceImpact.high)}% easier`;
    $("answerWhy").textContent = p.impactMid < 0.6
      ? `${S.intensity} ${S.duration} min · no adjustment needed`
      : `${S.intensity} ${S.duration} min · ${p.strain.label.toLowerCase()}`;

    const chip = (id, text, warn) => {
      const el = $(id);
      el.textContent = text;
      el.classList.toggle("warn", !!warn);
    };
    chip("answerChipTemp", `${U.temp(startHour.temp)} TEMP`, x.maxTemp >= 88 || x.minTemp <= 32);
    chip("answerChipDew", `${U.temp(startHour.dew)} DEW`, x.maxDew >= 70);
    chip("answerChipStrain", `SWEAT ESCAPE ${fmt1(p.cooling.vaporGradientKPa)} KPA`, p.cooling.vaporGradientKPa <= 2.7);
  }

  /* ---- readout ---- */
  $("atTime").textContent = "AT " + startLabel.toUpperCase();
  $("effortScore").textContent = p.effortScore;
  $("effortHead").textContent = S.sport === "run" && p.adjustedPace
    ? `${U.paceLabel(p.adjustedPace.lowSeconds)}–${U.paceLabel(p.adjustedPace.highSeconds)} ${U.paceUnitShort()}`
    : `+${fmt1(p.performanceImpact.low)}–${fmt1(p.performanceImpact.high)}% LOAD`;
  $("effortCopy").textContent = S.sport === "run" && p.adjustedPace
    ? `Adjusted from your ${S.intensity.toLowerCase()} baseline of ${U.paceLabel(p.adjustedPace.baselineSeconds)}${U.paceUnitShort()}. About +${fmt1(p.rpeDelta.low)}–${fmt1(p.rpeDelta.high)} RPE. Averaged across your full ${S.duration} minutes.`
    : `About +${fmt1(p.rpeDelta.low)}–${fmt1(p.rpeDelta.high)} RPE. Hold effort, not normal power.`;
  $("impactRange").textContent = `${fmt1(p.performanceImpact.low)}–${fmt1(p.performanceImpact.high)}% SLOWER`;
  $("strainVal").textContent = fmt1(p.strain.mean);
  $("strainWord").textContent = p.strain.label.toUpperCase();
  $("acclWord").textContent = `${p.acclimation.label.toUpperCase()} / ×${fmt1(p.acclimation.multiplier)}`;
  // Explain the strain scale once, the first time it is actually doing work.
  const strainHint = $("strainHint");
  if (strainHint) strainHint.hidden = hintSeen("strain") || p.strain.mean < 1.5;
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
  $("finishStrip").className = "finish-strip " + (p.forecastClear ? "safe" : "warning");
  $("finishIcon").textContent = p.forecastClear ? "FC" : "!";
  $("finishHead").textContent = p.forecastClear
    ? "NO MAJOR FORECAST HAZARD IDENTIFIED."
    : "THE FORECAST FAVORS A CHANGE OF PLAN.";
  $("finishCopy").textContent = p.forecastClear
    ? `The forecast window from ${startLabel} through the expected finish remains below EffortCast's caution triggers. This is weather guidance, not a guarantee of individual safety.`
    : `At finish: ${U.temp(p.finish.wbgt, { unit: true })} est. WBGT and ${Math.round(p.finish.precipProb)}% precip probability${p.thunder ? " with thunderstorm signal" : ""}. Start earlier or shorten.`;
  $("finTemp").textContent = U.temp(p.finish.temp).replace("°", "");
  $("finPrecip").textContent = Math.round(p.finish.precipProb);

  /* ---- method strip ---- */
  $("methodLoad").textContent = `LOAD ${fmt1(p.strain.mean)} / PEAK ${fmt1(p.strain.peak)}${(S.meta.elevFt || 0) >= 3000 ? ` / ELEV ${U.elevation(S.meta.elevFt)}` : ""}`;
  const altNote = p.components.alt.high > 0
    ? ` Altitude is scored against your home elevation of ${U.elevation(S.profile.homeElevFt ?? 0)}.`
    : "";
  const personalNote = b.ready ? ` Personalised ×${fmt1(b.multiplier)} from ${b.samples} logged workouts.` : "";
  $("methodCopy").textContent =
    `Thermal load ${fmt1(p.strain.mean)} — ${p.strain.label.toLowerCase()} — integrated across your ${S.duration}-minute window rather than read off its average. Workout intensity now sets required cooling inside the heat balance (×${fmt1(p.factors.thermalLoad)}); dew-point vapor pressure limits sweat escape, while air temperature and sun set dry and radiant load. Duration (×${fmt1(p.factors.duration)}) and heat adaptation (×${fmt1(p.acclimation.multiplier)}) shape the likely performance cost.${personalNote} Wind drag is modelled at torso height over a ${TERRAIN_LABELS[S.profile.terrain].toLowerCase()} route.${altNote} Est. WBGT, storms, AQI, and forecast change inform caution guidance; they cannot certify personal safety.`;

  /* ---- feature panels ---- */
  renderAdaptation();
  renderPlanner();
  renderRace();
  renderExplain(p);
  renderFeedback();
  renderProfile();
  syncControls();
}

export const render = guard(renderCore, "render");
