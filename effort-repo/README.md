# EFFORTCAST.

**Weather, translated into athletic effort.** A performance-focused weather app for runners and cyclists: live conditions become a personalized training window, an effort score, and an adjusted pace range.

Live data: [Open-Meteo](https://open-meteo.com) (forecast, history, air quality, elevation) · [RainViewer](https://www.rainviewer.com) (radar) · NWS (alerts). All keyless on the free tier.

## The model

`engine.js` runs **model 0.4-strain**: a continuous heat-balance model calibrated
against 3,891 marathon performances, replacing the v0.3 `temp + dew` lookup grid.
It cuts mean absolute error against the published reference table by **86 %** and
eliminates the band discontinuities that let a 1 °F forecast change move the pace
prediction by 3 %.

It also models the athlete, not just the air — heat acclimatisation is derived
automatically from your own last 14 days of weather, wind is computed as
aerodynamic drag at torso height, and altitude is scored against your home
elevation rather than sea level.

Full derivation, calibration data, and sources: **[MODEL.md](./MODEL.md)**.
Where the product goes next: **[ROADMAP.md](./ROADMAP.md)**.

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
  engine.test.mjs     ← v0.3 legacy bands + shared helpers
  strain.test.mjs     ← guards every v0.4 calibration constant
  app.test.mjs        ← boots index.html in jsdom, checks the UI reaches the engine
tools/
  validate-model.mjs  ← scores v0.3 vs v0.4 against published marathon data
MODEL.md              ← the science, the constants, and where each number came from
ROADMAP.md            ← audit findings and the prioritised feature plan
netlify.toml          ← tells Netlify what to publish and where functions live
```

**The rule that keeps this maintainable:** anything that computes (strain, WBGT, projections, window search) lives in `engine.js` and gets a test. Anything that displays or fetches lives in `index.html`.

## First-time setup (GitHub Desktop)

1. Install [GitHub Desktop](https://desktop.github.com) and sign in.
2. **File → Add local repository** → choose this folder. Desktop will offer to
   "create a repository" here — accept the defaults.
3. Write a first commit message ("initial commit"), click **Commit to main**,
   then **Publish repository** (uncheck "keep private" only if you want it public).
4. In [Netlify](https://app.netlify.com): **Add new site → Import an existing
   project → GitHub** → pick this repo. Build settings are read from
   `netlify.toml` automatically. Deploy.

## Redeploying

Edit → commit → push. Netlify builds automatically: it runs `npm test`, and
publishes `public/` only if the tests pass.

**The one thing that catches people out:** `public/sw.js` is a service worker
with a cache-first strategy, so a returning visitor keeps serving the old
`engine.js` from their browser cache no matter what you deploy. Whenever you
change `engine.js` or `index.html`, **bump `CACHE_NAME` in `sw.js`** in the same
commit. The old cache is deleted on activate, and everyone picks up the new
build on their next visit.

To confirm a deploy actually landed, open the site and check that the MODEL line
at the bottom reads the version you expect. If it doesn't, you have a stale
service worker — DevTools → Application → Service Workers → Unregister, then
hard-reload.

## Running tests

```
npm test          # 50 engine tests, no dependencies, runs in under a second
npm run validate  # re-scores v0.3 vs v0.4 against the published marathon data
npm run test:dom  # boots index.html in jsdom (needs npm install first)
npm run check     # all three
```

Requires Node 20+. The engine tests and the validator have **no dependencies** —
they use Node's built-in test runner, so the common path stays instant. Only the
DOM smoke test needs `npm install` (jsdom).

`npm run validate` evaluates 875 temperature/dew-point combinations and **fails
if v0.4 ever regresses** against the reference data or reintroduces a band
discontinuity.

**Run this before every push that touches `engine.js`.** If a change shifts a
pace number, a strain constant, or a WBGT estimate unexpectedly, a test fails and
tells you exactly which behavior moved.

If you change a calibration constant, update the paragraph in `MODEL.md` that
justifies it in the same commit.

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
