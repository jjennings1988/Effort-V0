/* 7-day planner (#3).

   The app already answered "when today?". This answers the question runners
   actually ask on a Tuesday: "which day this week should the long run go on?" */

import { findDailyWindows, hourLabel, fmt1 } from "../engine.js";
import { S, modelOpts, trainingHours, PLANNER_DAYS } from "./state.js";
import { $, escHtml } from "./dom.js";
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
  const best = scored.length ? Math.min(...scored.map((d) => d.score)) : null;

  host.innerHTML = days.map((d) => {
    if (d.thunder || d.idx == null) {
      return `<div class="plan-day storm">
        <span class="plan-dayname">${escHtml(dayName(d.day, todayIso))}</span>
        <strong>—</strong>
        <span class="plan-rating">STORMS</span>
        <span class="plan-detail">No clear window</span>
      </div>`;
    }
    const isBest = d.score === best;
    return `<button type="button" class="plan-day tone-${d.rating.tone}${isBest ? " best" : ""}" data-idx="${d.idx}"
        aria-label="${escHtml(`${dayName(d.day, todayIso)}, best window ${hourLabel(d.iso)}, ${d.rating.rating}, ${d.impactMid}% impact`)}">
      ${isBest ? '<span class="plan-flag">BEST</span>' : ""}
      <span class="plan-dayname">${escHtml(dayName(d.day, todayIso))}</span>
      <strong>${escHtml(hourLabel(d.iso))}</strong>
      <span class="plan-rating">${escHtml(d.rating.rating)}</span>
      <span class="plan-detail">+${fmt1(d.impactMid)}% · ${temp(d.maxTemp)}/${temp(d.maxDew)} dew</span>
    </button>`;
  }).join("");

  host.querySelectorAll("button.plan-day").forEach((b) => {
    b.addEventListener("click", () => {
      S.startIdx = Number(b.dataset.idx);
      S.view = "today";
      requestRender();
      $("readout")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // Headline: name the best day and say why
  const bestDay = scored.find((d) => d.score === best);
  const worst = scored.length ? scored.reduce((a, b) => (a.score > b.score ? a : b)) : null;
  const note = $("plannerNote");
  if (note && bestDay) {
    const gap = worst && worst.score - bestDay.score > 8
      ? ` That's a real gap — ${dayName(worst.day, todayIso).toLowerCase()} would cost you about ${fmt1(worst.impactMid - bestDay.impactMid)}% more.`
      : " The week is fairly even — pick on convenience.";
    note.textContent = `Best ${S.duration}-minute ${S.sport} this week: ${dayName(bestDay.day, todayIso).toLowerCase()} at ${hourLabel(bestDay.iso)}.${gap}`;
  }
}
