/* Race day countdown (#2).

   The highest-intent moment in a runner's calendar. Pin a date, distance and
   goal; get a conditions-adjusted finish band the moment the race enters
   forecast range, plus an honest read on whether the goal still stands. */

import {
  projectRace, RACE_DISTANCES, fmtDuration, fmtPace,
  acclimationOutlook, acclimationLabel, hourLabel, fmt1,
} from "../engine.js";
import { S, modelOpts, trainingHours, saveProfile, effectiveAcclimation } from "./state.js";
import { $ } from "./dom.js";
import { requestRender } from "./bus.js";

export function parseGoal(text) {
  const m = String(text).trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1] ?? 0), min = Number(m[2]), s = Number(m[3]);
  if (min > 59 || s > 59) return null;
  const total = h * 3600 + min * 60 + s;
  return total >= 480 && total <= 12 * 3600 ? total : null;
}

export function daysUntil(dateISO, todayIso) {
  const a = Date.parse(dateISO + "T00:00:00Z");
  const b = Date.parse(todayIso + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86400000);
}

/* Find the forecast index for the race morning, if it's in range. */
function raceStartIdx(hours, dateISO, hour = 7) {
  const exact = hours.findIndex((h) => h.iso.slice(0, 10) === dateISO && Number(h.iso.slice(11, 13)) === hour);
  if (exact >= 0) return exact;
  const anyThatDay = hours.findIndex((h) => h.iso.slice(0, 10) === dateISO);
  return anyThatDay >= 0 ? anyThatDay : null;
}

export function renderRace() {
  const host = $("raceSection");
  if (!host) return;
  const race = S.profile.race;
  const empty = $("raceEmpty"), detail = $("raceDetail");

  if (!race) {
    empty.hidden = false;
    detail.hidden = true;
    return;
  }
  empty.hidden = true;
  detail.hidden = false;

  const todayIso = S.meta?.todayIso ?? new Date().toISOString().slice(0, 10);
  const days = daysUntil(race.dateISO, todayIso);
  const dist = RACE_DISTANCES[race.distanceKey];

  $("raceName").textContent = (race.name || dist.label).toUpperCase();
  $("raceMeta").textContent =
    `${dist.label} · ${new Date(race.dateISO + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase()} · GOAL ${fmtDuration(race.goalSeconds)}`;

  if (days == null || days < 0) {
    $("raceCountdown").textContent = "PAST";
    $("raceHeadline").textContent = "That race has been and gone.";
    $("raceBody").textContent = "Pin the next one.";
    $("racePlan").textContent = "";
    return;
  }
  $("raceCountdown").textContent = days === 0 ? "TODAY" : `${days} DAY${days === 1 ? "" : "S"}`;

  const startIdx = S.hours ? raceStartIdx(S.hours, race.dateISO) : null;

  if (startIdx == null) {
    // Beyond forecast range — still useful: talk about preparation, not weather
    const th = trainingHours();
    const outlook = acclimationOutlook(S.pastHours ?? [], S.hours ?? [], { fromH: th.from, toH: th.to });
    $("raceHeadline").textContent = `Goal pace ${fmtPace(race.goalSeconds / dist.miles)}/mi`;
    $("raceBody").textContent =
      `The forecast doesn't reach race day yet — it opens up about a week out. Until then the useful work is adaptation, not weather-watching.`;
    $("racePlan").textContent =
      `You're currently ${acclimationLabel(effectiveAcclimation()).toLowerCase()}. Heat adaptation takes 10–14 days and most of it lands in the first week, so the window that matters starts around day ${Math.max(0, days - 14)} from now. ${outlook.usefulDaysAhead > 0 ? `There are ${outlook.usefulDaysAhead} useful heat days in the next week to start banking.` : `Nothing hot enough this week to build it.`}`;
    return;
  }

  const r = projectRace({
    hours: S.hours,
    startIdx,
    distanceKey: race.distanceKey,
    goalSeconds: race.goalSeconds,
    ...modelOpts(),
  });
  if (!r) return;

  const p = r.projection;
  $("raceHeadline").textContent = `${r.lowLabel}–${r.highLabel}`;
  const costMin = Math.round(Math.abs(r.costSeconds) / 60);
  const cond = `${p.extremes.maxTemp}° / ${p.extremes.maxDew}° dew at the finish, thermal strain ${fmt1(p.strain.mean)}`;

  if (r.costSeconds <= 45) {
    $("raceBody").textContent = `Conditions are close to neutral — ${cond}. Your ${r.goalLabel} goal stands. Go out at ${r.goalPaceLabel}/mi.`;
  } else {
    $("raceBody").textContent =
      `Conditions look like they'll cost you about ${costMin} minute${costMin === 1 ? "" : "s"} — ${cond}. A realistic target is ${r.midLabel}, not ${r.goalLabel}. Go out at ${r.realisticPaceLabel}/mi, not ${r.goalPaceLabel}, and you'll finish faster than if you chase the original number and blow up.`;
  }

  const level = effectiveAcclimation();
  // What an unadapted version of this athlete would have paid on the same day
  const naive = projectRace({
    hours: S.hours, startIdx, distanceKey: race.distanceKey,
    goalSeconds: race.goalSeconds, ...modelOpts(), acclimation: 0,
  });
  const adaptationWorth = Math.max(0, Math.round((naive.midSeconds - r.midSeconds) / 60));

  $("racePlan").textContent = days === 0
    ? `Race day. Start conditions ${Math.round(p.start.temp)}° / ${Math.round(p.start.dew)}° dew. Drink to thirst and pace by effort, not by the watch.`
    : level >= 0.7
      ? `You're ${acclimationLabel(level).toLowerCase()}, and on this forecast that's worth about ${adaptationWorth} minute${adaptationWorth === 1 ? "" : "s"} against an unadapted runner. Hold it with a couple of warm sessions a week, and don't add heat stress in the last five days.`
      : `You're ${acclimationLabel(level).toLowerCase()} with ${days} day${days === 1 ? "" : "s"} to go — full adaptation would be worth roughly ${adaptationWorth} minute${adaptationWorth === 1 ? "" : "s"} here. ${days >= 10 ? "There's still time: 10–14 days of outdoor heat exposure would take most of that back." : days >= 5 ? "Most of the gain lands in the first 4–7 days, so starting now still helps." : "Too late to adapt much — plan to race conservatively instead."}`;

  $("raceStartNote").textContent = `PROJECTED FROM ${hourLabel(S.hours[startIdx].iso)} START`;
}

export function wireRace() {
  const form = $("raceForm");
  if (!form) return;

  const fill = () => {
    const race = S.profile.race;
    $("raceInputName").value = race?.name ?? "";
    $("raceInputDate").value = race?.dateISO ?? "";
    $("raceInputGoal").value = race ? fmtDuration(race.goalSeconds) : "";
    if (race) $("raceInputDist").value = race.distanceKey;
  };
  fill();

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const goal = parseGoal($("raceInputGoal").value);
    const dateISO = $("raceInputDate").value;
    const err = $("raceError");
    if (!dateISO || !goal) {
      err.hidden = false;
      err.textContent = !dateISO ? "Pick a race date." : "Goal time should look like 3:30:00 or 24:30.";
      return;
    }
    err.hidden = true;
    S.profile.race = {
      name: $("raceInputName").value.trim().slice(0, 60),
      dateISO,
      distanceKey: $("raceInputDist").value,
      goalSeconds: goal,
    };
    saveProfile();
    requestRender();
  });

  $("raceClear")?.addEventListener("click", () => {
    S.profile.race = null;
    saveProfile();
    fill();
    requestRender();
  });
  $("raceEdit")?.addEventListener("click", () => {
    $("raceEmpty").hidden = false;
    $("raceDetail").hidden = true;
    fill();
  });
}
