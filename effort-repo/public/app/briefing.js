/* The synopsis panel: a deterministic local composer, optionally upgraded by
   Claude via the Netlify function (or a personal key on your own device). */

import { S, effectiveAcclimation } from "./state.js";
import { $ } from "./dom.js";

const BRIEF = { token: 0, timer: null, lastSig: "", lastCtx: null, serverDown: false };

function briefingContext(p, winText) {
  const h = S.hours[S.startIdx];
  return {
    location: S.profile.location?.label || S.meta.label,
    startLabel: $("startOut")?.textContent ?? "",
    workout: `${S.sport} / ${S.intensity} / ${S.structure} / ${S.duration} min`,
    start: {
      temp: Math.round(h.temp), dew: Math.round(h.dew), windMph: Math.round(h.wind),
      estWbgt: h.wbgt, aqi: h.aqi != null ? Math.round(h.aqi) : null,
      precipPct: Math.round(h.precipProb), isDay: h.isDay,
    },
    peaksDuringWorkout: p.extremes,
    adjustment: $("adjustment")?.textContent ?? "",
    effortScore: p.effortScore, riskScore: p.riskScore, riskLabel: p.riskLabel,
    bestWindow: winText, finishSafe: p.finishSafe, thunder: p.thunder,
    nowcast: S.meta.nowcast ? $("nowcastChip")?.textContent : null,
    elevFt: S.meta.elevFt || 0,
    thermalStrain: { value: p.strain.mean, peak: p.strain.peak, meaning: p.strain.label },
    heatState: { label: p.acclimation.label, costMultiplier: p.acclimation.multiplier },
  };
}

/* Deterministic 2–3 sentence synopsis from the engine's own numbers. */
export function composeLocalBriefing(ctx, p) {
  const st = ctx.start, x = ctx.peaksDuringWorkout;
  let s1;
  if (ctx.thunder) s1 = `Storm energy is in this window — lightning risk is the story today, not pace.`;
  else if (st.aqi != null && x.maxAqi >= 151) s1 = `Air is the problem today: AQI peaks near ${x.maxAqi}, which taxes breathing more than the ${st.temp}° heat.`;
  else if (ctx.heatState.costMultiplier >= 1.3 && p.strain.mean >= 3.5) s1 = `You have not seen air like this in two weeks — ${st.temp}° with a ${st.dew}° dew point will cost an unadapted body more than the numbers suggest.`;
  else if (st.dew >= 70) s1 = `Thick air today — ${st.temp}° with a ${st.dew}° dew point means sweat stops working long before you feel tired.`;
  else if (st.dew >= 65 && x.maxTemp >= 80) s1 = x.maxTemp > st.temp + 2
    ? `A muggy one: ${st.temp}° now, ${st.dew}° dew point, climbing to ${x.maxTemp}° before you finish.`
    : `A muggy one: ${st.temp}° with a ${st.dew}° dew point — the humidity, not the heat, sets today's cost.`;
  else if (x.minTemp <= 32) s1 = `Cold work today — down to ${x.minTemp}° with wind chill doing the talking; the warm-up matters more than the pace.`;
  else if (x.maxWind >= (S.sport === "ride" ? 18 : 20)) s1 = `Wind is the day's tax: sustained ${Math.round(p.avgWind)} with gusts to ${x.maxGust}.`;
  else if (x.maxTemp >= 88) s1 = `Plain hot: ${st.temp}° rising to ${x.maxTemp}°, though the ${st.dew}° dew point keeps it honest rather than brutal.`;
  else s1 = `Fair conditions — ${st.temp}°, dew point ${st.dew}°, and nothing in the forecast that outranks your legs.`;

  let s2 = ctx.bestWindow
    ? `Best window: ${ctx.bestWindow}.`
    : `No clean window in the next 24 hours — treat today as optional or take it inside.`;
  if (!ctx.finishSafe && ctx.bestWindow) s2 += ` Start on time — conditions turn before a late finish.`;

  let s3;
  if (S.sport === "run" && p.adjustedPace) s3 = `Run ${p.adjustedPace.lowLabel}–${p.adjustedPace.highLabel} and call it even effort, not lost fitness.`;
  else if (S.sport === "ride") s3 = `Trim target power ${p.performanceImpact.low}–${p.performanceImpact.high}% and ride the feel.`;
  else s3 = `Expect ${p.performanceImpact.low}–${p.performanceImpact.high}% slower at the same effort.`;
  if (p.effortScore < 15 && !ctx.thunder) s3 = `No adjustment needed — run it straight up.`;

  return `${s1} ${s2} ${s3}`;
}

function getAiKey() { try { return localStorage.getItem("effort-anthropic-key") || ""; } catch { return ""; } }

async function llmBriefing(ctx, token) {
  const key = getAiKey();
  const el = $("briefingText");
  const src = $("briefingSource");
  if (!el) return;
  el.classList.add("pending");
  try {
    const res = key
      ? await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json", "x-api-key": key,
          "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5", max_tokens: 220,
          system: "You are the voice of Effort, an athlete weather briefing. Write a 2-3 sentence synopsis (max 60 words). Direct, coach-like, plain prose — no emojis, no lists, no hedging. Lead with the day's character, name the single biggest environmental factor, end with the actionable call. thermalStrain 1.0 is where cooling starts falling behind; 5+ is near capacity. If heatState.costMultiplier is above 1.25 on a hot day, say plainly they are not adapted to it. Never invent data.",
          messages: [{ role: "user", content: "Conditions and projection JSON:\n" + JSON.stringify(ctx) }],
        }),
      })
      : await fetch("/api/briefing", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: ctx }),
      });

    if (token !== BRIEF.token) return;
    if (!key && (res.status === 501 || res.status === 404)) { BRIEF.serverDown = true; if (src) src.textContent = "LOCAL MODEL"; return; }
    if (res.status === 401 || res.status === 403) throw new Error("auth");
    if (!res.ok) throw new Error("http " + res.status);

    const data = await res.json();
    const text = key
      ? (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim()
      : data.text;
    if (text && token === BRIEF.token) {
      el.textContent = text;
      if (src) src.textContent = key ? "CLAUDE HAIKU / LIVE" : "CLAUDE HAIKU / SERVER";
    }
  } catch (e) {
    if (token !== BRIEF.token) return;
    if (src) src.textContent = e.message === "auth" ? "LOCAL MODEL / KEY REJECTED" : "LOCAL MODEL";
  } finally {
    if (token === BRIEF.token) el.classList.remove("pending");
  }
}

export function updateBriefing(p, winText) {
  const el = $("briefingText");
  if (!el) return;
  const ctx = briefingContext(p, winText);
  BRIEF.lastCtx = ctx;
  const sig = JSON.stringify([ctx.location, ctx.startLabel, ctx.workout, ctx.bestWindow, S.meta.fetchedAt, effectiveAcclimation()]);
  if (sig === BRIEF.lastSig) return;
  BRIEF.lastSig = sig;
  BRIEF.token++;
  el.textContent = composeLocalBriefing(ctx, p);
  const willAsk = getAiKey() || !BRIEF.serverDown;
  const src = $("briefingSource");
  if (src) src.textContent = willAsk ? "LOCAL MODEL / ASKING CLAUDE…" : "LOCAL MODEL";
  if (willAsk) {
    clearTimeout(BRIEF.timer);
    const token = BRIEF.token;
    BRIEF.timer = setTimeout(() => llmBriefing(BRIEF.lastCtx, token), 1200);
  }
}

export function wireBriefing(onChange) {
  const keyBtn = $("briefingKeyBtn"), refreshBtn = $("briefingRefresh");
  if (!keyBtn) return;
  const sync = () => {
    const has = !!getAiKey();
    keyBtn.textContent = has ? "AI: ON / REMOVE KEY" : "ENABLE AI BRIEFING";
    if (refreshBtn) refreshBtn.hidden = !has;
  };
  keyBtn.addEventListener("click", () => {
    if (getAiKey()) {
      if (window.confirm("Remove the stored Anthropic API key from this device?")) {
        try { localStorage.removeItem("effort-anthropic-key"); } catch {}
      }
    } else {
      const k = window.prompt("Paste your Anthropic API key (sk-ant-…).\nStored only in this browser — personal devices only.");
      if (k && k.trim().startsWith("sk-ant-")) {
        try { localStorage.setItem("effort-anthropic-key", k.trim()); } catch {}
        BRIEF.lastSig = "";
        onChange?.();
      } else if (k) window.alert("That didn't look like an Anthropic key (sk-ant-…). Not saved.");
    }
    sync();
  });
  refreshBtn?.addEventListener("click", () => {
    if (!BRIEF.lastCtx) return;
    BRIEF.token++;
    const src = $("briefingSource");
    if (src) src.textContent = "LOCAL MODEL / ASKING CLAUDE…";
    llmBriefing(BRIEF.lastCtx, BRIEF.token);
  });
  sync();
}
