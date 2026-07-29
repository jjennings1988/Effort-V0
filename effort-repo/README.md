# EFFORTCAST.

**Weather, translated into athletic effort.** A performance-focused weather app for runners and cyclists: live conditions become a personalized training window, an effort score, and an adjusted pace range.

Live data: [Open-Meteo](https://open-meteo.com) (forecast, air quality, elevation) · [RainViewer](https://www.rainviewer.com) (radar) · NWS (alerts). All keyless on the free tier.

## Repo layout

```
public/               ← the deployed site (what Netlify publishes)
  index.html          ← app shell, UI, data fetching, rendering
  engine.js           ← THE MODEL. Pure functions only — no DOM, no fetch.
  sw.js               ← service worker (PWA/offline)
  manifest.webmanifest, icons/, favicon.svg, _redirects
netlify/functions/
  ai-briefing.mjs     ← server-side Claude proxy for the AI briefing
tests/
  engine.test.mjs     ← guards every calibration number in engine.js
netlify.toml          ← tells Netlify what to publish and where functions live
```

**The rule that keeps this maintainable:** anything that computes (bands, WBGT, projections, window search) lives in `engine.js` and gets a test. Anything that displays or fetches lives in `index.html`.

## First-time setup (GitHub Desktop)

1. Install [GitHub Desktop](https://desktop.github.com) and sign in.
2. **File → Add local repository** → choose this folder. Desktop will offer to
   "create a repository" here — accept the defaults.
3. Write a first commit message ("initial commit"), click **Commit to main**,
   then **Publish repository** (uncheck "keep private" only if you want it public).
4. In [Netlify](https://app.netlify.com): **Add new site → Import an existing
   project → GitHub** → pick this repo. Build settings are read from
   `netlify.toml` automatically (no build command needed). Deploy.

From now on: edit → commit → push → Netlify deploys automatically. No more drag-and-drop.

## Running tests

```
npm test
```

Requires Node 20+. No dependencies to install — the suite uses Node's built-in
test runner. **Run this before every push that touches `engine.js`.** If a
change shifts a pace number or a WBGT estimate unexpectedly, a test fails and
tells you exactly which behavior moved.

## AI briefing (optional)

The synopsis panel works out of the box using a built-in rule-based composer.
To upgrade it with Claude, either:

- **Server (recommended, required for other users):** in Netlify →
  Site settings → Environment variables, add `ANTHROPIC_API_KEY`. The app
  auto-detects the `/api/briefing` function and uses it.
- **Personal device only:** tap ENABLE AI BRIEFING in the app and paste a key
  (stored in that browser's localStorage).

If neither is configured the app silently stays on the local composer.

## Before charging money

- Free Open-Meteo tier is **non-commercial only**. Paid app ⇒ switch to their
  Standard plan ($29/mo) — same API, different domain + key. Change the URLs in
  `index.html` (`OM_URL`, `AQ_URL`, `GEO_URL`) to `customer-api.open-meteo.com`
  and route the key through a Netlify Function like the briefing proxy.
- Keep the Open-Meteo attribution link visible (CC BY 4.0 requirement).
- Re-check RainViewer's terms for commercial use.

## Local development

```
npm run dev
```

Serves `public/` at localhost. (The AI briefing's server path only works on a
Netlify deploy or via `netlify dev`; everything else runs locally.)
