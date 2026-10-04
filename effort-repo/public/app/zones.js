/* Today → Your zones, today.

   Every training zone from the fitness anchor, in neutral air and at the
   selected start. Each "today" range is a real projection at that zone's
   pace and intensity over the selected duration — not a flat percentage. */

import { project, hourLabel, dayTag } from "../engine.js";
import { ZONE_HEAT_INTENSITY, PERF_DISTANCES } from "../fitness.js";
import { S, currentFitness, currentProjectionArgs } from "./state.js";
import { $, escHtml } from "./dom.js";
import { paceLabel, paceUnitShort, temp } from "./units.js";

export function renderZones() {
  const table = $("zonesTable");
  if (!table || !S.hours) return;
  const f = currentFitness();
  $("zonesEmpty").hidden = !!f;
  table.hidden = !f;
  $("zonesInst").classList.toggle("empty", !f);
  if (!f) {
    $("zonesSource").textContent = "NO RESULTS LOGGED YET";
    for (const id of ["zonesStart", "zonesAir", "zonesCost"]) $(id).textContent = "—";
    return;
  }
  const h = S.hours[S.startIdx];
  const todayIso = S.meta?.todayIso || S.hours[0].iso.slice(0, 10);
  $("zonesStart").textContent = (dayTag(h.iso, todayIso) + hourLabel(h.iso)).trim();
  $("zonesAir").textContent = `${temp(h.temp)} / ${temp(h.dew)}`;
  const a = f.anchor;
  $("zonesSource").textContent = `VDOT ${f.vdot.toFixed(1)} · FROM ${PERF_DISTANCES[a.distanceKey].label} ${a.dateISO.slice(5).replace("-", "/")}${a.corrected ? " · WEATHER-CORRECTED" : ""} · ${S.duration} MIN`;

  const sport = S.sport;
  let thresholdCost = null;
  const rows = f.zones.map((z) => {
    const intensity = ZONE_HEAT_INTENSITY[z.key];
    const p = project(currentProjectionArgs({ intensity, sport: "run", baselinePaceSeconds: z.midSec }));
    const lo = p.performanceImpact.low, hi = p.performanceImpact.high;
    const fast = z.fastSec * (1 + lo / 100), slow = z.slowSec * (1 + hi / 100);
    const delta = Math.round(z.midSec * ((lo + hi) / 2) / 100);
    if (z.key === "lt2") thresholdCost = delta;
    const bar = Math.min(100, ((lo + hi) / 2) * 10);
    return `<div class="zt-row" role="row" data-zone="${z.key}">
      <span class="zt-name" role="cell">${escHtml(z.label)}<small>${escHtml(z.desc)}</small></span>
      <span class="zt-neutral" role="cell">${paceLabel(z.fastSec)}–${paceLabel(z.slowSec)}</span>
      <span class="zt-today" role="cell"><b>${paceLabel(fast)}–${paceLabel(slow)}</b><small>${p.strain.label.toUpperCase()}</small></span>
      <span class="zt-cost" role="cell"><i style="width:${bar.toFixed(0)}%"></i><em>${delta > 0 ? `+${delta}s` : "±0"}</em></span>
    </div>`;
  }).join("");
  table.innerHTML = `<div class="zt-row zt-head" role="row">
      <span role="columnheader">ZONE</span><span role="columnheader">NEUTRAL AIR ${paceUnitShort().toUpperCase()}</span>
      <span role="columnheader">AT YOUR START</span><span role="columnheader">COST</span>
    </div>${rows}`;
  $("zonesCost").textContent = thresholdCost == null ? "—" : `+${thresholdCost}s${paceUnitShort()}`;
  $("zonesLead").textContent = sport === "ride"
    ? "Running zones from your races. Switch Today to Run to apply them to your workout."
    : "Race-based paces in neutral air, and what holds the same effort at your start.";
}
