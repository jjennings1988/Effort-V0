/* Heat adaptation tracker (#1).

   Turns the acclimatisation index from a hidden multiplier into the thing the
   athlete actually looks at: how much heat you've banked, where it's heading,
   and what it would take to be ready. */

import { dailyHeatDose, acclimationOutlook, acclimationLabel, acclimationMultiplier, r1, fmt1 } from "../engine.js";
import { S, trainingHours, effectiveAcclimation } from "./state.js";
import { $, escHtml } from "./dom.js";

const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

function dayCell(d, opts = {}) {
  const pct = Math.round(d.dose * 100);
  const dt = new Date(d.day + "T12:00:00");
  const initial = DAY_INITIALS[dt.getDay()];
  const cls = ["dose-cell", opts.future ? "future" : "", d.dose >= 0.6 ? "hot" : d.dose >= 0.25 ? "warm" : "cool"]
    .filter(Boolean).join(" ");
  const title = `${d.day} · peak strain ${d.peakStrain} · ${pct}% of a full heat day`;
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
  const level = effectiveAcclimation();
  const mult = acclimationMultiplier(level);

  $("adaptLevel").textContent = String(Math.round(level * 100));
  $("adaptLabel").textContent = acclimationLabel(level).toUpperCase();
  $("adaptMult").textContent = `HEAT COSTS YOU ×${fmt1(r1(mult))}`;

  const ahead = outlook.projected.slice(0, 7);
  $("doseStrip").innerHTML =
    past.map((d) => dayCell(d)).join("") +
    (ahead.length ? `<div class="dose-divider" aria-hidden="true"></div>` : "") +
    ahead.map((d) => dayCell(d, { future: true })).join("");

  // The sentence that actually helps
  const manual = S.profile.acclimation.mode === "manual";
  let guidance;
  if (manual) {
    guidance = `You've set this manually. Switch to automatic and it will read the weather you've actually been training in.`;
  } else if (level >= 0.8) {
    guidance = `You're carrying real heat adaptation. Hot days will cost you roughly ${Math.round((1 - mult / acclimationMultiplier(0)) * 100)}% less than they would an unadapted runner — bank it by keeping at least a couple of warm sessions a week.`;
  } else if (outlook.readyOn) {
    const when = new Date(outlook.readyOn + "T12:00:00")
      .toLocaleDateString("en-US", { weekday: "long" });
    guidance = `Keep training outdoors and you'll cross well-adapted by ${when}. There ${outlook.usefulDaysAhead === 1 ? "is" : "are"} ${outlook.usefulDaysAhead} genuinely useful heat ${outlook.usefulDaysAhead === 1 ? "day" : "days"} in the next week.`;
  } else if (outlook.usefulDaysAhead > 0) {
    guidance = `${outlook.usefulDaysAhead} heat ${outlook.usefulDaysAhead === 1 ? "day" : "days"} in the coming week. Training through ${outlook.usefulDaysAhead === 1 ? "it" : "them"} builds adaptation, but you won't be fully adapted inside seven days — most of the gain lands in the first week, the rest by two.`;
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
