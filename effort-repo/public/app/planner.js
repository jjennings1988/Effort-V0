/* 7-day planner (#3).

   The app already answered "when today?". This answers the question runners
   actually ask on a Tuesday: "which day this week should the long run go on?" */

import { findDailyWindows, hourLabel, fmt1 } from "../engine.js";
import { S, modelOpts, trainingHours, PLANNER_DAYS } from "./state.js";
import { $, escHtml, scrollBehavior } from "./dom.js";
import { temp } from "./units.js";
import { requestRender } from "./bus.js";

function dayName(dayIso, todayIso) {
  if (dayIso === todayIso) return "TODAY";
  const dt = new Date(dayIso + "T12:00:00");
  const today = new Date(todayIso + "T12:00:00");
  if ((dt - today) / 86400000 < 1.5) return "TOMORROW";
  return dt.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
}

export function renderPlanner() {
  const host = $("plannerGrid");
  if (!host || !S.hours) return;

  const th = trainingHours();
  const days = findDailyWindows(S.hours, S.duration, S.intensity, S.sport, {
    days: PLANNER_DAYS,
    fromH: th.from,
    toH: th.to,
    structure: S.structure,
    ...modelOpts(),
  });

  const todayIso = S.meta?.todayIso ?? S.hours[0].iso.slice(0, 10);
  const scored = days.filter((d) => d.score != null);
  // Pick exactly one winner. Rounded scores can tie; impact breaks the tie,
  // then the earlier day wins so the interface never shouts BEST twice.
  const bestDay = scored.length ? scored.reduce((a, b) => (
    b.score < a.score || (b.score === a.score && b.impactMid < a.impactMid) ? b : a
  )) : null;

  const scale = Math.max(5, Math.ceil(Math.max(0, ...scored.map(d => d.impactMid)) / 5) * 5);
  const summary = $("plannerSummary");
  summary.textContent = `${S.intensity} · ${S.duration} min · ${S.sport === "run" ? "Run" : "Ride"} · Best start per day`;
  $("plannerScale").textContent = `Weather impact · 0–${scale}% shared scale · lower is better`;
  host.innerHTML = days.map((d) => {
    if (d.thunder || d.idx == null) {
      return `<div class="plan-day storm">
        <span class="plan-dayname">${escHtml(dayName(d.day, todayIso))}</span>
        <strong>—</strong>
        <span class="plan-rating">STORMS</span>
        <span class="plan-detail">No clear window</span>
      </div>`;
    }
    const isBest = d === bestDay;
    return `<button type="button" class="plan-day tone-${d.rating.tone}${isBest ? " best" : ""}" data-idx="${d.idx}"
        aria-label="${escHtml(`${dayName(d.day, todayIso)}, best window ${hourLabel(d.iso)}, ${d.rating.rating}, ${d.impactMid}% impact`)}">
      ${isBest ? '<span class="plan-flag">BEST</span>' : ""}
      <span class="plan-dayname">${escHtml(dayName(d.day, todayIso))}</span>
      <strong>${escHtml(hourLabel(d.iso))}</strong>
      <span class="plan-rating">${escHtml(d.rating.rating)}</span>
      <span class="plan-impact"><b>+${fmt1(d.impactMid)}%</b><span class="plan-track" aria-hidden="true"><i style="width:${Math.max(0, d.impactMid / scale * 100)}%"></i></span></span>
      <span class="plan-detail">${temp(d.maxTemp)} peak · ${temp(d.maxDew)} dew${!d.allowed ? " · Outside your hours" : ""}</span>
    </button>`;
  }).join("");

  host.querySelectorAll("button.plan-day").forEach((b) => {
    b.addEventListener("click", () => {
      S.startIdx = Number(b.dataset.idx);
      const day = S.hours[S.startIdx].iso.slice(0, 10);
      S.rangeStart = S.hours.findIndex(h => h.iso.startsWith(day));
      S.view = "today";
      requestRender();
      $("planner-title")?.focus({ preventScroll: true });
      $("planner-title")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    });
  });

  const note = $("plannerNote");
  if (note) {
    if (!bestDay) {
      note.textContent = "No storm-free start found in the available forecast. Check local alerts and consider an indoor session.";
    } else {
      const min = Math.min(...scored.map(d => d.impactMid));
      const max = Math.max(...scored.map(d => d.impactMid));
      const spread = max - min;
      note.textContent = `Recommended: ${dayName(bestDay.day, todayIso).toLowerCase()} at ${hourLabel(bestDay.iso)}. `
        + (spread >= 0.5 ? `Daily best starts range from +${fmt1(min)}% to +${fmt1(max)}% weather impact — a ${fmt1(spread)} percentage-point spread.`
          : "Weather impact varies by less than half a percentage point. Choose the day that fits your schedule.")
        + " Rankings also consider hazards, daylight and your training hours. Later forecasts may change.";
    }
  }
}
