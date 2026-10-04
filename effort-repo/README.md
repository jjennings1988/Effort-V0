# EFFORTCAST.

**Weather for athletes.** Live conditions become a training window, an effort score, and the pace you should actually run — for runners and cyclists.

Live data: [Open-Meteo](https://open-meteo.com) (forecast, history, air quality, elevation) · [RainViewer](https://www.rainviewer.com) (radar) · NWS (alerts). All keyless on the free tier.

## The model

`engine.js` runs **model 0.5-thermal-load**: a continuous heat-balance model calibrated
against 3,891 marathon performances, replacing the v0.3 `temp + dew` lookup grid.
It cuts mean absolute error against the calibration reference table by **77 %** and
eliminates the band discontinuities that let a 1 °F forecast change move the pace
prediction by 3 %.

It also models the workout and the athlete, not just the air: intended effort
changes required cooling inside the heat balance; completed hot sessions build
a decaying, session-informed adaptation estimate; wind is computed as
aerodynamic drag at torso height; and altitude is scored against home elevation.

Full derivation and calibration: **[MODEL.md](./MODEL.md)**.
2026 evidence review and implementation boundary: **[SCIENCE-REVIEW-2026.md](./SCIENCE-REVIEW-2026.md)**.
UI and flow review: **[DESIGN.md](./DESIGN.md)**.
Where the product goes next: **[ROADMAP.md](./ROADMAP.md)**.
Race-data and empirical-engine plan: **[RACE-DATA-ROADMAP.md](./RACE-DATA-ROADMAP.md)**.
Reproducible data workspace: **[data/README.md](./data/README.md)**.

## What the app does

**Today** — what to run, right now. The answer (start, pace, and a better start
when there is one), the 24-hour dial, the conditions, then the pace board: every
training zone (LT1, LT2 and VO2 by rep length; easy, long, steady, marathon and
recovery runs) with the neutral pace struck through, today's pace beside it,
and the cost as a chip. Time chips (now, best, tonight, tomorrow morning) move
it; tapping a zone makes it today's workout everywhere else in the app. The
summary card at the top, the synopsis and the screen-reader announcement all
quote the selected zone's numbers from the same function
(`workoutSummary()` in `app/pace-board.js`), so they cannot disagree, and the
card offers the best window as one tap when it saves at least 3 s per mile.

**Plan** — tune one session. Build-your-effort controls, the
decision curve and hourly tape, the readouts and "what would help". Below Plan,
the original Today description still applies:

Live conditions, an effort score and an environmental risk score kept
deliberately separate, an adjusted pace range, the best training window in the
next 24 hours, radar, and a plain-English synopsis.

**The 24-hour dial** — the day as one clock. Each hour is a wedge of particles
sized by what a start then would cost, coloured by its rating; the ink arc is
your workout and the lime arc the best window. It sorts itself from a grey cloud
when the forecast lands, and you can point, tap or use arrow keys to pick a
start. On Plan ("Where it builds"), a workout tape and cooling ledger show where
load builds inside the session, beside the five steps that score every start. Every number on the canvas is also in the DOM. Hours outside your
training window are hatched out and can't be picked from the dial. The same dial
opens the app: the loading cloud sorts itself, locks, and flies into Today's dial,
handing over to it (one dial, not two). That opening plays once per day; later launches the same day start docked and
the dials arrive already sorted (only the best-window arc sweeps in). Today's
dial never re-tells the sort; it sorts again only when a refresh lands while it
is on screen.

**Fitness anchor** — log races (1500 m to marathon, race or solo time trial) in
You. Each result becomes a VDOT with the published Daniels–Gilbert equations;
add the place and start time and it is first corrected to neutral air with the
same weather model, using archived modeled conditions for that hour. Several
results fit a personal endurance curve (VDOT against log distance, shrunk
toward standard until evidence accrues), recent results outweigh old ones, and
every prediction carries an explicit range and confidence. Seven zones
(recovery → intervals) drive the workout buttons, appear in today's weather on
Today, and feed race-goal suggestions. Design notes:
[PACE-ANCHOR-RESEARCH-2026-10-04.md](./PACE-ANCHOR-RESEARCH-2026-10-04.md).

**What would actually help** — every suggestion is a real re-run of the
projection with one input changed, so "start at 6 AM saves 2.1%" is the model's
own number, not a rule of thumb. Tap one to apply it.

**This week** — the best window for each of the next seven days, so the long run
lands on Thursday instead of Saturday when Saturday is dew point 74.

**Heat adaptation** — a 14-day record of the heat you've actually trained in,
projected forward through the forecast. It knows the difference between the
first hot day of spring and the tenth, and warns you about the first one.

**Race day** — pin a city, date, local wave time, distance and goal. The venue has
its own forecast and timezone, independent of your training location. See a
personal estimated finish range and conditions from the start through the finish.
Older saved races retain their details and ask you to confirm location and time.

**Race dial and split tape** — race day as a dial in venue-local time with the
race window drawn on it, a target pace for every mile or kilometre (the model's
weather cost is spread by when you reach each stretch, so splits add back up to
the projected finish), and a split ledger. The share card carries a vector copy
of the dial; its split strip shows load bands only, never paces.

**Race briefings** — preview and save a 1080 × 1350 feed image or 1080 × 1920
story image, use the native share sheet where supported, and copy an editable
caption. Goal numbers are opt-in. Exports keep the forecast timestamp, data
source and explicit sample labels. SVG export is available for further editing.
Sharing is enabled only when the complete projected race window is available.
These are local exports; public race links and Strava integration are not included.

**After the run** — three taps to say whether it felt harder or easier than
predicted. After six workouts the heat model starts calibrating to you.

**You** — everything that changes rarely, in one place: pace baselines, units,
body weight, training hours, route shelter and the acclimatisation control. Plus
a written account of the science the model is built on. The per-session controls
stay on Today; the daily heat reading stays in This Week.

## Repo layout

```
public/                 ← the deployed site (what Netlify publishes)
  index.html            ← markup only
  styles.css            ← all styling, plain CSS
  engine.js             ← THE MODEL. Pure functions only — no DOM, no fetch.
  fitness.js            ← fitness anchor: VDOT, zones, weather correction, predictions (pure)
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
    profile.js          ← the You tab, release notes, pace fields
    setup.js            ← first-run setup (three questions, not a tour)
    units.js            ← imperial/metric display conversion
    dial-core.js        ← the dial renderer (canvas, particles, sorting, morphing)
    dial.js             ← the Today dials: opening dial + 24-hour instrument
    race-dial.js        ← the race dial, split tape and ledger
    instrument.js       ← shared motion kit: counters, visibility, hover link
    fitness-panel.js    ← You → fitness anchor (results, curve, zones, predictions)
    history-weather.js  ← archived conditions for weather-correcting past results
    pace-board.js       ← Today → today's paces: every zone adjusted, by rep length
    week-heat.js        ← Week → 7 × 24 heatmap of every start
    strain-bands.js     ← thermal-load bands shared by tapes, ledgers, dials
    radar.js, briefing.js
  sw.js                 ← service worker (PWA/offline)
  fonts/                ← Anton display face (SIL OFL 1.1, see fonts/OFL.txt), self-hosted
  manifest.webmanifest, icons/, favicon.svg, _redirects
netlify/functions/
  ai-briefing.mjs       ← server-side Claude proxy for the AI briefing
tests/
  engine.test.mjs       ← v0.3 legacy bands + shared helpers
  strain.test.mjs       ← guards every v0.5 calibration constant
  fitness.test.mjs      ← VDOT table values, zone scaling, correction, uncertainty
  app.test.mjs          ← boots the real page in jsdom and drives the UI
  data-artifacts.test.mjs ← guards privacy, provenance and report integrity
tools/
  validate-model.mjs    ← scores v0.3 vs v0.5 against published marathon data
  fetch-race-data.py    ← downloads and checksum-verifies pinned research data
  ingest-race-data.py   ← privacy-safe normalization and aggregate QA
  enrich-marathon-weather.py ← review-gated historical-weather join
data/
  sources.json          ← version, checksum, license and rights ledger
  reports/              ← small versioned QA outputs; no personal records
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

Edit → commit → push. Netlify builds automatically: it runs `npm run check`, and
publishes `public/` only if the engine, model, DOM and data-integrity checks pass.

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
npm test          # engine tests plus design-system checks, no dependencies
npm run validate  # re-scores v0.3 vs v0.5 against the published marathon data
npm run test:dom  # 45 UI tests — boots the real page in jsdom (needs npm install)
npm run test:data # 4 privacy, provenance and committed-report integrity tests
npm run check     # all four checks above
```

Requires Node 20+. The engine tests and the validator have **no dependencies** —
they use Node's built-in test runner, so the common path stays instant. Only the
DOM smoke test needs `npm install` (jsdom).

`tests/design.test.mjs` guards the design system: the rating fills stay ordered
by lightness and at least ΔE 15 apart for every neighbouring pair under simulated
deuteranopia and protanopia, text on a fill clears 4.5:1, nothing is set below
11px, tappable and numeric text is at least 12px, and explanations stay sentence
case.

**Offline.** Every live forecast is saved on the device. If a later fetch fails,
the last one for the same place (up to three days old) comes back, re-cut to the
current hour and always labelled with its age; with nothing saved, Today shows
one status panel (retry or demo) over the dial's grey cloud instead of empty
instruments.

`npm run validate` evaluates 875 temperature/dew-point combinations and **fails
if v0.5 ever regresses** against the reference data or reintroduces a band
discontinuity.

**Run this before every push that touches `engine.js`.** If a change shifts a
pace number, a strain constant, or a WBGT estimate unexpectedly, a test fails and
tells you exactly which behavior moved.

If you change a calibration constant, update the paragraph in `MODEL.md` that
justifies it in the same commit.

## Research data pipeline

The research workspace currently normalizes 429,266 anonymized 2023 marathon
results across 641 race editions plus 1,258 weather-linked endurance events.
Downloaded inputs and row-level normalized outputs are ignored by Git. Runner
names are never exported or hashed.

The marathon compilation remains **R&D-only pending underlying rights review**.
The Figshare weather workbook is CC BY 4.0, but it is a calibration audit rather
than independent validation because model 0.5's published anchors came from the
associated research. No new engine coefficient should be fitted or advertised
until reviewed race locations, start times and weather joins create a genuinely
later-period holdout. See [data/README.md](./data/README.md) for the reproducible
workflow and attribution requirements.

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

Serves `public/` at localhost. Add `?demo=1` to explore the clearly labeled sample forecast without granting location access. (The AI briefing's server path only works on a
Netlify deploy or via `netlify dev`; everything else runs locally.)
