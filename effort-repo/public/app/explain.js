/* Explain the number (#4).

   The "why" bars show what the weather is charging you. This shows what you
   could do about it. Every row is a real re-run of the projection with exactly
   one input changed, so the numbers are the model's own, not a rule of thumb. */

import { counterfactuals, fmt1 } from "../engine.js";
import { S, currentProjectionArgs, trainingHours, baselinePaceSeconds, SEARCH_HOURS } from "./state.js";
import { $, escHtml } from "./dom.js";
import { paceLabel, paceUnitShort } from "./units.js";
import { requestRender } from "./bus.js";

export function renderExplain(p) {
  const host = $("explainList");
  if (!host || !S.hours) return;

  const th = trainingHours();
  const options = counterfactuals(currentProjectionArgs(), {
    fromH: th.from,
    toH: th.to,
    maxStartIdx: Math.min(SEARCH_HOURS - 1, S.hours.length - 4),
  });

  if (!options.length) {
    host.innerHTML = `<p class="explain-none">Nothing meaningful left to trade — these conditions are already about as good as your options get.</p>`;
    return;
  }

  const base = baselinePaceSeconds();
  const asPace = (saved) => (S.sport === "run" && base
    ? ` · ${paceLabel(base * (1 + (p.impactMid - saved) / 100))}${paceUnitShort()}`
    : "");
  const max = Math.max(...options.map((o) => o.savedPct));

  host.innerHTML = options.map((o) => `
    <${o.key === "time" ? "button type=\"button\"" : "div"} class="explain-row${o.key === "time" ? " actionable" : ""}"${o.startIdx != null ? ` data-idx="${o.startIdx}"` : ""}>
      <span class="explain-label">${escHtml(o.label)}</span>
      <span class="explain-bar"><i style="width:${Math.round((o.savedPct / max) * 100)}%"></i></span>
      <b>−${fmt1(o.savedPct)}%${escHtml(asPace(o.savedPct))}</b>
    </${o.key === "time" ? "button" : "div"}>`).join("");

  host.querySelectorAll("button.explain-row[data-idx]").forEach((b) => {
    b.addEventListener("click", () => {
      S.startIdx = Number(b.dataset.idx);
      requestRender();
    });
  });

  const lead = $("explainLead");
  if (lead) {
    const top = options[0];
    lead.textContent = top.savedPct >= 0.5
      ? `The biggest single lever right now: ${top.label.toLowerCase()} — worth ${fmt1(top.savedPct)}% of pace.`
      : `No single change moves this much. The conditions are what they are.`;
  }
}
