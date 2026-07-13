/* Server-side proxy for the AI briefing.
   Keeps the Anthropic API key out of the browser — set ANTHROPIC_API_KEY
   in Netlify: Site settings → Environment variables.
   If the variable is unset, returns 501 and the app quietly stays on
   the local composer. This is also where a paid-tier gate would live. */

const SYSTEM = "You are the voice of Effort, an athlete weather briefing. Write a 2-3 sentence synopsis (max 60 words) for the athlete's planned workout. Direct, coach-like, plain prose — no emojis, no lists, no headers, no hedging. Lead with the day's character, name the single biggest environmental factor, and end with the actionable call: when to go and how to adjust pace or effort. Never invent data not provided.";

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: "not-configured" }, { status: 501 });

  let context;
  try {
    ({ context } = await req.json());
    if (!context || typeof context !== "object") throw new Error("bad body");
  } catch {
    return Response.json({ error: "bad-request" }, { status: 400 });
  }

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 220,
      system: SYSTEM,
      messages: [{ role: "user", content: "Conditions and projection JSON:\n" + JSON.stringify(context).slice(0, 6000) }],
    }),
  });
  if (!upstream.ok) return Response.json({ error: "upstream-" + upstream.status }, { status: 502 });

  const data = await upstream.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join(" ").trim();
  return Response.json({ text });
};

export const config = { path: "/api/briefing" };
