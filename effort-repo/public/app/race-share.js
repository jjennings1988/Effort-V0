/* A self-contained SVG is both the preview and the source of the PNG. No
   screenshot library, remote fonts, external image requests, or AI numbers. */
import { fmtDuration } from "../engine.js";
import { raceClock, raceDate, localISO, finishBand, raceTakeaway, raceDialModel, raceSplitPlan } from "./race-model.js";
import { STRAIN_BANDS, strainBand } from "./strain-bands.js";
import { $ } from "./dom.js";

export const CARD_SIZES = { feed: [1080, 1350], story: [1080, 1920] };
const xml = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
export const cardTemp = (f, units) => `${Math.round(units.temperature === "c" ? (f - 32) * 5 / 9 : f)}°${units.temperature === "c" ? "C" : "F"}`;
const cardWind = (mph, units) => `${Math.round(units.distance === "km" ? mph * 1.609344 : mph)} ${units.distance === "km" ? "km/h" : "mph"}`;

export function createBriefingSnapshot({ race, result, weather, units }) {
  // Snapshot only fields needed to share; coordinates and athlete profile never
  // enter the image, caption, or downloadable file metadata. The dial and split
  // strip carry weather-derived load bands only, never paces.
  const dial = raceDialModel(race, result, weather);
  const plan = raceSplitPlan(result, weather, units.distance === "km" ? "km" : "mi");
  return JSON.parse(JSON.stringify({
    dial: { wedges: dial.wedges.map(({ clock, v, tone, night }) => ({ clock, v, tone, night })), start: dial.start, span: dial.span },
    splitBands: plan ? plan.splits.map((sp) => STRAIN_BANDS[strainBand(sp.strain)].key) : [], name: race.name || result.distance.label, distance: result.distance.label,
    date: race.dateISO, venue: race.location.label, timezone: race.location.timezone,
    goalSeconds: race.goalSeconds, lowSeconds: result.lowSeconds, highSeconds: result.highSeconds,
    points: result.points, takeaway: raceTakeaway(result), fetchedAt: weather.fetchedAt,
    demo: weather.demo, units, modelVersion: result.projection.modelVersion,
    aqiComplete: weather.hours.filter(h => h.epoch >= result.startEpoch - 3600000 && h.epoch <= result.points[2].epoch + 3600000)
      .every(h => h.aqi != null) }));
}

export function briefingCaption(s, personal = false) {
  const [start, , finish] = s.points;
  return `${s.demo ? "SAMPLE FORECAST — DEMO DATA\n" : ""}${s.name} · ${s.distance}\n` +
    `${raceDate(s.date)} · ${s.venue}\n${raceClock(start.epoch, s.timezone)} start · ${s.timezone}\n\n` +
    `${s.takeaway.headline} ${s.takeaway.body}\n` +
    `Start → estimated finish: ${cardTemp(start.temp, s.units)} → ${cardTemp(finish.temp, s.units)}. ` +
    `Dew point ${cardTemp(start.dew, s.units)} → ${cardTemp(finish.dew, s.units)}. ` +
    `Wind ${cardWind(start.wind, s.units)} → ${cardWind(finish.wind, s.units)}.\n` +
    (personal ? `My goal: ${fmtDuration(s.goalSeconds)}. Estimated finish: ${finishBand(s.lowSeconds, s.highSeconds)} (model range, not a guarantee).\n` : "") +
    `Forecast snapshot: ${new Date(s.fetchedAt).toISOString().slice(0, 16).replace("T", " ")} UTC. ` +
    `${s.demo ? "Illustrative conditions, not a live forecast." : "Weather: open-meteo.com (CC BY 4.0). Conditions can change."}\n\n` +
    "EffortCast · Know what the weather means for your effort.";
}

function wrap(text, max, lines = 3) {
  const chunks = String(text).split(/\s+/).flatMap(word => word.match(new RegExp(`.{1,${max}}`, "gu")) || []);
  const out = [];
  for (const word of chunks) {
    if (!out.length || out.at(-1).length + word.length + 1 > max) out.push(word);
    else out[out.length - 1] += " " + word;
  }
  if (out.length > lines) return [...out.slice(0, lines - 1), out[lines - 1].slice(0, max - 1) + "…"];
  return out;
}
/* The race dial as vector shapes: the same picture as the app's canvas dial,
   drawn deterministically for the card. Light palette always; cards are paper. */
const CARD_TONES = { ideal: "#2e7d43", good: "#5d8a3c", adjust: "#b98a12", caution: "#c76b1d", high: "#c14a2a", storm: "#6c4bb8", avoid: "#a41f1f" };
const BAND_TONE = Object.fromEntries(STRAIN_BANDS.map((b) => [b.key, CARD_TONES[b.tone]]));
export function raceDialSVG(dial, { cx, cy, r, ink = "#101310", paper = "#f3f0e7", accent = "#cfff18", startLabel = "" }) {
  const f = (n) => n.toFixed(1);
  const ang = (h) => (h / 24) * Math.PI * 2 - Math.PI / 2;
  const pt = (h, rr) => [cx + Math.cos(ang(h)) * rr * r, cy + Math.sin(ang(h)) * rr * r];
  const arcPath = (h0, h1, rr) => {
    const [x0, y0] = pt(h0, rr), [x1, y1] = pt(h1, rr);
    return `M${f(x0)} ${f(y0)}A${f(rr * r)} ${f(rr * r)} 0 ${h1 - h0 > 12 ? 1 : 0} 1 ${f(x1)} ${f(y1)}`;
  };
  const sector = (h0, h1, r0, r1) => {
    const [a, b] = pt(h0, r1), [c, d] = pt(h1, r1), [e, g] = pt(h1, r0), [k, l] = pt(h0, r0);
    return `M${f(a)} ${f(b)}A${f(r1 * r)} ${f(r1 * r)} 0 0 1 ${f(c)} ${f(d)}L${f(e)} ${f(g)}A${f(r0 * r)} ${f(r0 * r)} 0 0 0 ${f(k)} ${f(l)}Z`;
  };
  const base = 0.335, max = 0.8, len = (v) => base + v * (max - base);
  let out = `<g class="card-dial">`;
  out += `<circle cx="${cx}" cy="${cy}" r="${f(r)}" fill="none" stroke="${ink}" stroke-opacity=".25"/>`;
  for (let q = 0; q < 24; q++) {
    const [x0, y0] = pt(q, q % 6 === 0 ? 0.955 : 0.975), [x1, y1] = pt(q, 1);
    out += `<path d="M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}" stroke="${ink}" stroke-width="${q % 6 === 0 ? 3 : 1.5}" stroke-opacity="${q % 6 === 0 ? 1 : .5}"/>`;
  }
  ["12A", "6A", "12P", "6P"].forEach((n, i) => {
    const [x, y] = pt(i * 6, 1.12);
    out += `<text x="${f(x)}" y="${f(y + 8)}" font-size="22" text-anchor="middle" font-family="Courier New, monospace" font-weight="700" fill="${ink}">${n}</text>`;
  });
  for (const w of dial.wedges) {
    if (w.night) out += `<path d="${sector(w.clock, w.clock + 1, base, max + 0.02)}" fill="${ink}" fill-opacity=".05"/>`;
    const tone = CARD_TONES[w.tone] ?? ink;
    const wedge = sector(w.clock + 0.1, w.clock + 0.9, base + 0.012, len(w.v));
    out += `<path d="${wedge}" fill="${tone}" fill-opacity=".9"/><path d="${wedge}" fill="url(#cardStipple)"/>`;
    out += `<path d="${arcPath(w.clock + 0.06, w.clock + 0.94, 0.91)}" fill="none" stroke="${tone}" stroke-width="7"/>`;
    out += `<path d="${arcPath(w.clock + 0.02, w.clock + 0.98, 0.3)}" fill="none" stroke="${w.night ? ink : "#ffdf77"}" stroke-opacity="${w.night ? .5 : 1}" stroke-width="6"/>`;
  }
  const s0 = dial.start, s1 = dial.start + Math.min(23.9, dial.span);
  out += `<path d="${arcPath(s0, s1, 0.855)}" fill="none" stroke="${ink}" stroke-width="11" stroke-linecap="round"/>`;
  const [ex, ey] = pt(s1, 0.855), [sx, sy] = pt(s0, 0.855);
  out += `<circle cx="${f(ex)}" cy="${f(ey)}" r="8" fill="${paper}" stroke="${ink}" stroke-width="4"/>`;
  out += `<circle cx="${f(sx)}" cy="${f(sy)}" r="20" fill="none" stroke="${ink}" stroke-width="2" stroke-dasharray="4 5"/>`;
  out += `<circle cx="${f(sx)}" cy="${f(sy)}" r="11" fill="${accent}" stroke="${ink}" stroke-width="4"/>`;
  // The hub fits inside the sun ring: clock digits large, meridiem and label small.
  const [clock, meridiem = ""] = String(startLabel).split(" ");
  out += `<text x="${cx}" y="${f(cy + r * 0.07)}" font-size="${f(r * 0.19)}" text-anchor="middle" font-weight="900" letter-spacing="-1" fill="${ink}">${xml(clock)}</text>`;
  out += `<text x="${cx}" y="${f(cy + r * 0.17)}" font-size="${f(r * 0.07)}" text-anchor="middle" font-family="Courier New, monospace" font-weight="700" letter-spacing="1" fill="${ink}" fill-opacity=".65">${xml(`${meridiem} START`.trim())}</text>`;
  return out + `</g>`;
}

function splitStripSVG(bands, { x, y, w, h, ink, label }) {
  if (!bands?.length) return "";
  const gap = bands.length > 30 ? 2 : 4, cw = (w - gap * (bands.length - 1)) / bands.length;
  let out = `<g class="card-splits">`;
  bands.forEach((b, i) => {
    const tone = BAND_TONE[b] ?? ink, hollow = b === "near" || b === "outrun";
    out += `<rect x="${(x + i * (cw + gap)).toFixed(1)}" y="${y}" width="${cw.toFixed(1)}" height="${h}" fill="${hollow ? "none" : tone}" stroke="${tone}" stroke-width="3"${hollow ? ' stroke-dasharray="6 4"' : ""}/>`;
  });
  return out + `<text x="${x}" y="${y + h + 32}" font-size="21" font-family="Courier New, monospace" letter-spacing="1" fill="${ink}" fill-opacity=".7">${xml(label)}</text></g>`;
}

export function briefingSVG(s, { format = "feed", personal = false } = {}) {
  const [w, h] = CARD_SIZES[format] ?? CARD_SIZES.feed;
  const story = h > 1400, offset = story ? 210 : 0, ink = "#101310", muted = "#485046", paper = "#f3f0e7";
  const accent = s.takeaway.caution ? "#ff725e" : "#cfff18";
  const text = (value, x, y, size = 28, extra = "") => `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${xml(value)}</text>`;
  const lines = (value, x, y, size, max, count = 3, extra = "") => wrap(value, max, count).map((line, i) => {
    // A conservative glyph-width bound keeps wide names / non-Latin venue
    // labels inside the export without relying on browser font measurement.
    const bound = [...line].reduce((sum, c) => sum + (/\s/.test(c) ? .3 : /[MW@]/.test(c) ? 1 : /[ilI.,'!]/.test(c) ? .35 : c.codePointAt(0) > 0x2e7f ? 1 : .75), 0) * size;
    const fit = bound > 1008 - x ? ` textLength="${1008 - x}" lengthAdjust="spacingAndGlyphs"` : "";
    return text(line, x, y + i * size * 1.08, size, extra + fit);
  }).join("");
  const date = `${raceDate(s.date).toUpperCase()} / ${s.distance.toUpperCase()}`;
  const y = 810 + offset, xs = [90, 540, 990];
  const ts = s.points.map(p => p.temp), min = Math.min(...ts), span = Math.max(12, Math.max(...ts) - min);
  const ys = ts.map(t => y + 110 - ((t - min) / span) * 100);
  const timeLabels = ["START", "MIDPOINT", "EST. FINISH"];
  const trend = s.points.map((p, i) => {
    const anchor = i === 0 ? "start" : i === 2 ? "end" : "middle";
    return `<g>${text(timeLabels[i], xs[i], y - 58, 23, `text-anchor="${anchor}" letter-spacing="2" fill="${muted}"`)}
      ${text(cardTemp(p.temp, s.units), xs[i], y, 54, `text-anchor="${anchor}" font-weight="800"`)}
      <circle cx="${xs[i]}" cy="${ys[i]}" r="10" fill="${ink}" stroke="${paper}" stroke-width="4"/>
      ${text(raceClock(p.epoch, s.timezone, { date: localISO(p.epoch, s.timezone).slice(0, 10) !== s.date }), xs[i], y + 165, 27, `text-anchor="${anchor}"`)}
      ${text(`${cardTemp(p.dew, s.units)} dew`, xs[i], y + 209, 26, `text-anchor="${anchor}" fill="${muted}"`)}
      ${text(cardWind(p.wind, s.units), xs[i], y + 247, 26, `text-anchor="${anchor}" fill="${muted}"`)}</g>`;
  }).join("");
  const foot = h - 220;
  const stops = s.points.map((p, i) => {
    const ry = (story ? 870 : 770) + i * (story ? 130 : 112);
    return `<g>${text(timeLabels[i], 560, ry, 21, `letter-spacing="2" fill="${muted}"`)}
      ${text(cardTemp(p.temp, s.units), 560, ry + 52, 52, 'font-weight="800"')}
      ${text(raceClock(p.epoch, s.timezone, { date: localISO(p.epoch, s.timezone).slice(0, 10) !== s.date }), 740, ry + 24, 26, "")}
      ${text(`${cardTemp(p.dew, s.units)} dew · ${cardWind(p.wind, s.units)}`, 740, ry + 56, 23, `fill="${muted}"`)}</g>`;
  }).join("");
  const unitLabel = s.units.distance === "km" ? "KM" : "MI";
  const dialBlock = s.dial?.wedges?.length ? `
      ${raceDialSVG(s.dial, { cx: 290, cy: story ? 1065 : 925, r: story ? 195 : 160, ink, paper, accent,
        startLabel: raceClock(s.points[0].epoch, s.timezone) })}
      ${stops}
      ${story ? splitStripSVG(s.splitBands, { x: 72, y: 1328, w: 936, h: 34, ink, label: `${s.splitBands.length} ${unitLabel} SPLITS · HOLLOW = COOLING NEAR CAPACITY` }) : ""}
      ${text(`LOCAL TIMES · ${s.timezone}`, 560, story ? 1262 : 1090, 19, `fill="${muted}"`)}
      ${text("WEDGE = HEAT LOAD AT RACE EFFORT", 560, story ? 1288 : 1114, 19, `fill="${muted}"`)}` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Race weather briefing">
    <title>${xml(s.name)} — race weather briefing</title><desc>${xml(briefingCaption(s, personal))}</desc>
    <defs><pattern id="cardStipple" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="${paper}" fill-opacity=".55"/><circle cx="6.5" cy="6.5" r="1.1" fill="${paper}" fill-opacity=".4"/></pattern></defs>
    <rect width="1080" height="${h}" fill="${paper}"/>
    <g fill="${ink}" font-family="Arial, Helvetica, sans-serif">
      <rect x="0" y="0" width="1080" height="12" fill="${accent}"/>
      ${text("EFFORTCAST.", 72, 78, 37, 'font-weight="900" letter-spacing="-2"')}
      ${text("RACE BRIEFING / 01", 1008, 74, 22, 'text-anchor="end" letter-spacing="2"')}
      <path d="M72 105H1008" stroke="${ink}" stroke-width="2"/>
      <rect x="72" y="132" width="${s.demo ? 366 : 252}" height="38" fill="${accent}"/>
      ${text(s.demo ? "SAMPLE FORECAST / DEMO" : "FORECAST SNAPSHOT", 86, 158, 22, 'font-weight="700" letter-spacing="1"')}
      ${lines(s.name.toUpperCase(), 72, 241, 58, 25, 2, 'font-weight="900" letter-spacing="-2"')}
      ${text(date, 72, 353, 27, 'font-weight="700" letter-spacing="1"')}
      ${lines(s.venue, 72, 398, 28, 57, 2, `fill="${muted}"`)}
      <path d="M72 447H1008" stroke="${ink}" stroke-opacity=".25"/>
      ${lines(s.takeaway.headline, 72, 529 + offset / 2, 67, 26, 2, 'font-weight="900" letter-spacing="-2"')}
      ${lines(s.takeaway.body, 72, 663 + offset / 2, 29, 59, 3, `fill="${muted}"`)}
      ${dialBlock || `<path d="M${xs[0]} ${ys[0]} L${xs[1]} ${ys[1]} L${xs[2]} ${ys[2]} L990 ${y + 124} L90 ${y + 124}Z" fill="${accent}" opacity=".55"/>
      <path d="M${xs[0]} ${ys[0]} L${xs[1]} ${ys[1]} L${xs[2]} ${ys[2]}" fill="none" stroke="${ink}" stroke-width="4"/>
      ${trend}
      ${text(`LOCAL TIMES · ${s.timezone}`, 72, y + 291, 22, `fill="${muted}"`)}`}
      ${story ? `<path d="M72 1410H1008" stroke="${ink}"/><circle cx="132" cy="1505" r="53" fill="${accent}"/>${text("FC", 132, 1519, 35, 'font-weight="900" text-anchor="middle"')}${lines("Know what the weather means for your effort.", 226, 1479, 41, 33, 2, 'font-weight="700"')}` : ""}
      <rect x="72" y="${foot}" width="936" height="86" fill="${ink}"/>
      ${text(personal ? `MY GOAL ${fmtDuration(s.goalSeconds)} / EST. ${finishBand(s.lowSeconds, s.highSeconds)}` : "SAME EFFORT. DIFFERENT WEATHER.", 96, foot + 36, 28, `fill="${paper}" font-weight="700"`)}
      ${text(personal ? "Personal model range · rounded to 30 seconds · not a guarantee" : "Weather window uses the runner’s estimated finish time.", 96, foot + 65, 21, `fill="${accent}"`)}
      ${text(`${s.demo ? "SAMPLE DATA" : "OPEN-METEO.COM / CC BY 4.0"} · SNAPSHOT ${new Date(s.fetchedAt).toISOString().slice(0, 16).replace("T", " ")} UTC`, 72, h - 93, 20, `fill="${muted}"`)}
      ${text(s.demo ? "ILLUSTRATIVE CONDITIONS. NOT A LIVE FORECAST." : "FORECASTS CAN CHANGE. CHECK LOCAL ALERTS & RACE UPDATES.", 72, h - 58, 20, `fill="${muted}"`)}
      ${text(s.aqiComplete ? "Weather context by EffortCast." : "Weather context by EffortCast. Air quality coverage incomplete.", 72, h - 26, 19, `fill="${muted}"`)}
    </g></svg>`;
}

export async function renderBriefingPNG(svg, format) {
  const [width, height] = CARD_SIZES[format] ?? CARD_SIZES.feed;
  const source = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new window.Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error("Image rendering failed")); img.src = source; });
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image export is unavailable in this browser");
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG export failed")), "image/png"));
  } finally { URL.revokeObjectURL(source); }
}

let snapshot = null, previewSVG = "", png = null, generation = 0, opener = null;
function message(text) { $("raceShareStatus").textContent = text; }
async function updatePreview() {
  const token = ++generation;
  const format = $("raceShareFormat").value, personal = $("raceSharePersonal").checked;
  png = null;
  $("raceDownload").disabled = true;
  $("raceNativeShare").disabled = true;
  previewSVG = briefingSVG(snapshot, { format, personal });
  $("raceSharePreview").innerHTML = previewSVG;
  $("raceShareCaption").value = briefingCaption(snapshot, personal);
  $("raceCaptionLabel").textContent = "CAPTION · EDIT BEFORE COPYING";
  message("Preparing your image…");
  try {
    const image = await renderBriefingPNG(previewSVG, format);
    if (token !== generation) return;
    png = image;
    $("raceDownload").disabled = false;
    const file = new window.File([png], "effortcast-race.png", { type: "image/png" });
    const canShare = !!navigator.canShare?.({ files: [file] });
    $("raceNativeShare").hidden = !canShare;
    $("raceNativeShare").disabled = !canShare;
    message(`Ready · ${CARD_SIZES[format].join(" × ")} PNG. Your image keeps this forecast snapshot.`);
  } catch {
    if (token === generation) message("PNG export couldn't finish. You can still copy the caption or save the vector image.");
  }
}
export function openRaceShare(value) {
  snapshot = value;
  opener = document.activeElement;
  const dialog = $("raceShareDialog");
  $("raceSharePersonal").checked = false;
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
  $("raceShareClose").focus();
  updatePreview();
}
function saveFile(blob, extension) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url;
  a.download = `effortcast-${snapshot.date}-${snapshot.demo ? "sample-" : ""}race-briefing.${extension}`;
  document.body.append(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function wireRaceShare() {
  generation++; snapshot = null; png = null;
  const dialog = $("raceShareDialog");
  $("raceShareClose").addEventListener("click", () => {
    if (dialog.close) dialog.close(); else { dialog.removeAttribute("open"); opener?.focus(); }
  });
  dialog.addEventListener("close", () => { generation++; png = null; opener?.focus(); });
  $("raceShareFormat").addEventListener("change", updatePreview);
  $("raceSharePersonal").addEventListener("change", updatePreview);
  $("raceDownload").addEventListener("click", () => { if (png) { saveFile(png, "png"); message("Image download started. Copy the caption to go with it."); } });
  $("raceSaveSVG").addEventListener("click", () => saveFile(new Blob([previewSVG], { type: "image/svg+xml" }), "svg"));
  $("raceCopyCaption").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("raceShareCaption").value); message("Caption copied."); }
    catch { $("raceShareCaption").focus(); $("raceShareCaption").select(); message("Select and copy the caption below; clipboard access is unavailable."); }
  });
  $("raceNativeShare").addEventListener("click", async () => {
    if (!png) return;
    try {
      await navigator.share({ files: [new window.File([png], "effortcast-race.png", { type: "image/png" })],
        title: `${snapshot.name} · EffortCast`, text: $("raceShareCaption").value });
      message("Share sheet completed.");
    } catch (e) { message(e.name === "AbortError" ? "Sharing canceled. Your image is ready." : "Sharing is unavailable here. Save the image and copy the caption instead."); }
  });
}
