# EFFORTCAST.

**Weather for athletes.** Live conditions become a training window, an effort score, and the pace you should actually run — for runners and cyclists.

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
UI and flow review: **[DESIGN.md](./DESIGN.md)**.
Where the product goes next: **[ROADMAP.md](./ROADMAP.md)**.

## What the app does

**Today** — live conditions, an effort score and an environmental risk score kept
deliberately separate, an adjusted pace range, the best training window in the
next 24 hours, radar, and a plain-English synopsis.

**What would actually help** — every suggestion is a real re-run of the
projection with one input changed, so "start at 6 AM saves 2.1%" is the model's
own number, not a rule of thumb. Tap one to apply it.

**This week** — the best window for each of the next seven days, so the long run
lands on Thursday instead of Saturday when Saturday is dew point 74.

**Heat adaptation** — a 14-day record of the heat you've actually trained in,
projected forward through the forecast. It knows the difference between the
first hot day of spring and the tenth, and warns you about the first one.

**Race day** — pin a date, distance and goal; get a conditions-adjusted finish
band the moment the race enters forecast range, a realistic target, and an
honest read on whether adaptation can still change the outcome.

**After the run** — three taps to say whether it felt harder or easier than
predicted. After six workouts the heat model starts calibrating to you.

## Repo layout

```
public/                 ← the deployed site (what Netlify publishes)
  index.html            ← markup only, ~490 lines
  styles.css            ← all styling, plain CSS
  engine.js             ← THE MODEL. Pure functions only — no DOM, no fetch.
  app/                  ← native ES modules, no build step
    main.js             ← boot
    state.js            ← session state + the versioned athlete profile
    data.js             ← Open-Meteo / AQI / NWS / geocoding + demo data
    render.js           ← the main render pass
    controls.js         ← every input in the app
    dom.js              ← DOM helpers + the error boundary
    bus.js              ← render bus (keeps render and controls acyclic)
    adaptation.js       ← heat adaptation tracker
    planner.js          ← 7-day planner
    race.js             ← race day countdown
    explain.js          ← "what would actually help" counterfactuals
    feedback.js         ← post-run reconciliation
    radar.js, briefing.js
  sw.js                 ← service worker (PWA/offline)
  manifest.webmanifest, icons/, favicon.svg, _redirects
netlify/functions/
  ai-briefing.mjs       ← server-side Claude proxy for the AI briefing
tests/
  engine.test.mjs       ← v0.3 legacy bands + shared helpers
  strain.test.mjs       ← guards every v0.4 calibration constant
  app.test.mjs          ← boots the real page in jsdom and drives the UI
tools/
  validate-model.mjs    ← scores v0.3 vs v0.4 against published marathon data
MODEL.md                ← the science, the constants, and where each number came from
DESIGN.md               ← UI/flow review, mobile redesign rationale, remaining ideas
ROADMAP.md              ← audit findings and the prioritised feature plan
netlify.toml            ← publish config, test gate, cache headers
```

**Two rules that keep this maintainable:**

1. Anything that computes (strain, WBGT, projections, window search, race
   fixed-point, counterfactuals) lives in `engine.js` as a pure function and
   gets a test. Anything that displays or fetches lives in `app/`.
2. No build step. The browser loads `app/main.js` as a module and resolves the
   rest natively. There is nothing to compile, bundle, or keep up to date.

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

### Confirming a deploy landed

The footer shows a **BUILD** stamp. It comes from `data-build` on `<html>`, and a
test fails if that ever drifts from `VERSION` in `sw.js`. If the stamp doesn't
match what you deployed, you're looking at a cached build — not a broken one.

The service worker is **network-first for HTML, CSS and JS**, cache-first only
for images and fonts. Deploys therefore land on the next load with no manual
version bump. If a new worker installs while the app is open, a strip appears
offering to update.

This used to be the single biggest source of "I deployed but nothing changed":
the old worker served HTML network-first but code cache-first, so a deploy
delivered new markup to browsers still running the old stylesheet and modules —
which renders as an unstyled, half-broken page. Three tests now guard against
that combination returning.

**If a phone is still stuck on an old build** (usually because the old worker is
still in control): Settings → Safari → Advanced → Website Data → remove the site,
or on desktop DevTools → Application → Service Workers → Unregister, then reload.
For an installed PWA, deleting and re-adding it to the home screen also picks up
changed `<meta>` tags, which iOS caches at install time.

## Running tests

```
npm test          # 63 engine tests, no dependencies, runs in under a second
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
