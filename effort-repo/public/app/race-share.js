/* A self-contained SVG is both the preview and the source of the PNG. No
   screenshot library, remote fonts, external image requests, or AI numbers. */
import { fmtDuration } from "../engine.js";
import { raceClock, raceDate, localISO, finishBand, raceTakeaway } from "./race-model.js";
import { $ } from "./dom.js";

export const CARD_SIZES = { feed: [1080, 1350], story: [1080, 1920] };
const xml = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
export const cardTemp = (f, units) => `${Math.round(units.temperature === "c" ? (f - 32) * 5 / 9 : f)}°${units.temperature === "c" ? "C" : "F"}`;
const cardWind = (mph, units) => `${Math.round(units.distance === "km" ? mph * 1.609344 : mph)} ${units.distance === "km" ? "km/h" : "mph"}`;

export function createBriefingSnapshot({ race, result, weather, units }) {
  // Snapshot only fields needed to share; coordinates and athlete profile never
  // enter the image, caption, or downloadable file metadata.
  return JSON.parse(JSON.stringify({ name: race.name || result.distance.label, distance: result.distance.label,
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Race weather briefing">
    <title>${xml(s.name)} — race weather briefing</title><desc>${xml(briefingCaption(s, personal))}</desc>
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
      <path d="M${xs[0]} ${ys[0]} L${xs[1]} ${ys[1]} L${xs[2]} ${ys[2]} L990 ${y + 124} L90 ${y + 124}Z" fill="${accent}" opacity=".55"/>
      <path d="M${xs[0]} ${ys[0]} L${xs[1]} ${ys[1]} L${xs[2]} ${ys[2]}" fill="none" stroke="${ink}" stroke-width="4"/>
      ${trend}
      ${text(`LOCAL TIMES · ${s.timezone}`, 72, y + 291, 22, `fill="${muted}"`)}
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
