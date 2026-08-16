/* Heat adaptation tracker (#1).

   Turns the acclimatisation index from a hidden multiplier into the thing the
   athlete actually looks at: how much heat you've banked, where it's heading,
   and what it would take to be ready. */

import { dailyHeatDose, acclimationOutlook, acclimationLabel, acclimationMultiplier, r1, fmt1 } from "../engine.js";
import { S, trainingHours, effectiveAcclimation, acclimationEstimate } from "./state.js";
import { $, escHtml } from "./dom.js";

const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

function dayCell(d, opts = {}) {
  const pct = Math.round(d.dose * 100);
  const dt = new Date(d.day + "T12:00:00");
  const initial = DAY_INITIALS[dt.getDay()];
  const cls = ["dose-cell", opts.future ? "future" : "", d.dose >= 0.6 ? "hot" : d.dose >= 0.25 ? "warm" : "cool"]
    .filter(Boolean).join(" ");
  const detail = Number.isFinite(d.peakStrain)
    ? `peak load ${d.peakStrain}`
    : "forecast exposure estimate";
  const title = `${d.day} · ${detail} · ${pct}% of a full heat day`;
  return `<div class="${cls}" title="${escHtml(title)}" role="listitem" aria-label="${escHtml(title)}">
    <i style="height:${Math.max(4, pct)}%"></i><span>${initial}</span>
  </div>`;
}

export function renderAdaptation() {
  const host = $("adaptSection");
  if (!host) return;
  if (!S.pastHours?.length) { host.hidden = true; return; }
  host.hidden = false;

  const th = trainingHours();
  const opts = { fromH: th.from, toH: th.to };
  const past = dailyHeatDose(S.pastHours, opts).slice(-14);
  const outlook = acclimationOutlook(S.pastHours, S.hours ?? [], opts);
  const estimate = acclimationEstimate();
  const level = effectiveAcclimation();
  const mult = acclimationMultiplier(level);

  $("adaptLevel").textContent = String(Math.round(level * 100));
  $("adaptLabel").textContent = acclimationLabel(level).toUpperCase();
  const sourceLabel = estimate.source === "sessions" ? `SESSION-INFORMED / ${estimate.sessions} LOGGED`
    : estimate.source === "manual" ? "MANUAL"
      : "WEATHER ESTIMATE";
  $("adaptMult").textContent = `HEAT COST ×${fmt1(r1(mult))} / ${sourceLabel}`;

  const ahead = outlook.projected.slice(0, 7);
  $("doseStrip").innerHTML =
    past.map((d) => dayCell(d)).join("") +
    (ahead.length ? `<div class="dose-divider" aria-hidden="true"></div>` : "") +
    ahead.map((d) => dayCell(d, { future: true })).join("");

  // The sentence that actually helps
  const manual = S.profile.acclimation.mode === "manual";
  let guidance;
  if (manual) {
    guidance = `You've set this manually. Switch to automatic to use completed hot-session evidence when available, with recent local weather as the fallback estimate.`;
  } else if (estimate.source === "sessions" && level >= 0.8) {
    guidance = `This is based on ${estimate.sessions} completed heat sessions, with evidence-based daily decay between exposures. You're carrying strong adaptation; maintain it with a couple of useful warm sessions each week.`;
  } else if (estimate.source === "sessions") {
    guidance = `This is based on ${estimate.sessions} completed heat sessions, not merely hot weather nearby. Useful exposures build the score; time without exposure gradually decays it.${outlook.usefulDaysAhead ? ` The forecast contains ${outlook.usefulDaysAhead} potentially useful heat ${outlook.usefulDaysAhead === 1 ? "day" : "days"}.` : " No useful heat day appears in the next week."}`;
  } else if (level >= 0.8) {
    guidance = `Recent local weather suggests substantial exposure, but this is still a low-confidence weather estimate. Log three completed hot sessions and EffortCast will switch to session-informed adaptation.`;
  } else if (outlook.readyOn) {
    const when = new Date(outlook.readyOn + "T12:00:00")
      .toLocaleDateString("en-US", { weekday: "long" });
    guidance = `The weather-only outlook could cross well-adapted by ${when} if you actually complete useful outdoor heat sessions. There ${outlook.usefulDaysAhead === 1 ? "is" : "are"} ${outlook.usefulDaysAhead} potentially useful heat ${outlook.usefulDaysAhead === 1 ? "day" : "days"} in the next week.`;
  } else if (outlook.usefulDaysAhead > 0) {
    guidance = `${outlook.usefulDaysAhead} potentially useful heat ${outlook.usefulDaysAhead === 1 ? "day" : "days"} appear in the coming week. The score remains a weather estimate until you log completed sessions; adaptation generally develops across repeated 60–120 minute exposures.`;
  } else {
    guidance = `Nothing hot enough in the next week to build adaptation. That's fine — but treat the first genuinely hot day as a hard day, because your body will.`;
  }
  $("adaptGuidance").textContent = guidance;

  // Warn on the specific day that hurts people: the first hot day after a cool spell
  const spike = ahead.find((d) => d.dose >= 0.5);
  const warn = $("adaptWarning");
  if (spike && level < 0.45) {
    const when = new Date(spike.day + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
    warn.hidden = false;
    warn.textContent = `⚠ ${when.toUpperCase()} IS A STEP UP — YOU HAVEN'T TRAINED IN AIR LIKE THAT RECENTLY. TREAT IT AS A HARD DAY.`;
  } else {
    warn.hidden = true;
  }
}
