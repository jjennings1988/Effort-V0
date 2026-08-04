/* Post-run reconciliation (#5).

   One question, three taps: was that harder or easier than we said? After a
   handful of answers the model starts bending toward this specific athlete.
   This is the flywheel — it's the only signal a competitor can't copy. */

import { FEEDBACK_MIN_SAMPLES, fmt1 } from "../engine.js";
import { S, saveProfile, bias } from "./state.js";
import { $, escHtml } from "./dom.js";
import { requestRender } from "./bus.js";

const CHOICES = [
  { delta: -1, label: "EASIER", note: "Felt easier than predicted" },
  { delta: 0, label: "ABOUT RIGHT", note: "Matched the prediction" },
  { delta: 1, label: "HARDER", note: "Felt harder than predicted" },
];

export function logFeedback(feltDelta) {
  const p = S.lastProjection;
  S.profile.feedback = [
    ...(S.profile.feedback ?? []),
    {
      ts: Date.now(),
      feltDelta,
      predictedMid: p?.impactMid ?? 0,
      tempF: p ? Math.round(p.avgTemp) : null,
      dewF: p ? Math.round(p.avgDew) : null,
      intensity: S.intensity,
      durationMinutes: S.duration,
    },
  ].slice(-60);
  saveProfile();
  requestRender();
}

export function renderFeedback() {
  const host = $("feedbackSection");
  if (!host) return;
  const b = bias();
  const entries = S.profile.feedback ?? [];

  $("feedbackState").textContent = b.ready
    ? `${b.label.toUpperCase()} · ×${fmt1(b.multiplier)}`
    : `LEARNING · ${entries.length}/${FEEDBACK_MIN_SAMPLES} WORKOUTS`;

  $("feedbackCopy").textContent = b.ready
    ? `Across your last ${b.samples} logged workouts you've run ${b.mean > 0.1 ? "consistently harder" : b.mean < -0.1 ? "consistently easier" : "very close to"} than the model predicted, so every heat projection above is now scaled by ×${fmt1(b.multiplier)} for you.`
    : `Log how a few workouts actually felt and the heat model starts calibrating to you specifically. ${FEEDBACK_MIN_SAMPLES - entries.length} more to go.`;

  const recent = entries.slice(-10).reverse();
  const log = $("feedbackLog");
  if (log) {
    log.innerHTML = recent.length
      ? recent.map((e) => {
        const c = CHOICES.find((x) => x.delta === e.feltDelta);
        const when = new Date(e.ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return `<li class="fb-${e.feltDelta > 0 ? "hard" : e.feltDelta < 0 ? "easy" : "even"}">
            <span>${escHtml(when)}</span>
            <span>${escHtml(e.tempF != null ? `${e.tempF}°/${e.dewF}° dew` : "—")}</span>
            <span>predicted +${fmt1(e.predictedMid)}%</span>
            <b>${escHtml(c?.label ?? "")}</b>
          </li>`;
      }).join("")
      : `<li class="fb-empty">No workouts logged yet.</li>`;
  }
}

export function wireFeedback() {
  const ctl = $("feedbackCtl");
  if (!ctl) return;
  ctl.innerHTML = CHOICES.map((c) =>
    `<button type="button" data-delta="${c.delta}" title="${escHtml(c.note)}">${c.label}</button>`).join("");
  ctl.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    logFeedback(Number(b.dataset.delta));
    const ack = $("feedbackAck");
    if (ack) {
      ack.textContent = "LOGGED — THANKS";
      ack.hidden = false;
      setTimeout(() => { ack.hidden = true; }, 2600);
    }
  });

  $("feedbackReset")?.addEventListener("click", () => {
    if (!window.confirm("Clear your workout feedback history? The heat model will go back to the population average.")) return;
    S.profile.feedback = [];
    saveProfile();
    requestRender();
  });
}
