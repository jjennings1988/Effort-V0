# EFFORTCAST — briefing document for external review

This document is written to be handed to a reviewer (human or AI) who has no
access to the repository. It describes what the app is, how the model works,
what the architecture looks like, and where the author already believes it is
weak. Everything here is stated as fact about the current build
(`2026.08.16-3`); where something is uncertain or contested, that is called out.

**What is wanted from a review is disagreement, not endorsement.** Specific
questions are listed at the end, but a reviewer should feel free to attack any
premise, including the central one.

---

## 1. What the product is

EffortCast is a weather app for endurance athletes — runners primarily, cyclists
secondarily. It is a progressive web app, installed to the home screen, opened
in the morning before a workout.

It does not report weather. It converts weather into three decisions:

1. **What pace should I run today?** An adjusted pace range derived from the
   athlete's own baseline paces.
2. **When should I go?** The best training window in the next 24 hours, and the
   best day in the next seven.
3. **Is this safe?** An environmental risk score kept deliberately separate from
   the performance score, because "this will be slow" and "this is dangerous"
   are different questions with different answers.

Positioning line: *"Weather for athletes."*

**Business status:** hobby project, no users other than the author, no revenue,
no accounts, no server-side storage. Data lives in the browser's localStorage.
Hosted on Netlify. All data sources are free and keyless.

---

## 2. The model — this is the heart of it

### The core claim

Running is a heat engine with poor efficiency: roughly three-quarters of
metabolic energy leaves as heat rather than forward motion. At marathon effort
that is on the order of a kilowatt of thermal load that must be shed
continuously. Almost all of it goes through sweat evaporation.

Therefore: **the limit on holding a pace in warm conditions is not how hot the
air is, but how much of your heat that air will accept.**

### How strain is computed

A dimensionless **Thermal Strain Index**, normalised so 1.0 is where pace begins
to cost:

```
strain = STRAIN_SCALE × max(0, Ereq) / Emax

Ereq = 1 + C_DRY·(Tair − 35 °C)/10
         + C_SOLAR·(solar/1000)·(1 − shade)/(1 + 0.4·windMs)

Emax = 1 / (1/Emax_air + 1/SWEAT_CAP)          ← harmonic (smooth) minimum
Emax_air = (Psk − Pa)/KPA_REF_GRADIENT × √((1 + 0.10·v)/(1 + 0.10·v_ref))
Pa  = saturation vapour pressure at the DEW POINT (Magnus-Tetens)
Psk = 5.6158 kPa (saturated skin at 35 °C)
```

Then:

```
slowdown% = HEAT_A0 × max(0, strain − 1.0) ^ HEAT_P
```

at a reference of race effort, 180 minutes, an 8:00/mi runner, population-average
acclimatisation.

Fitted constants: `C_DRY = 0.44`, `C_SOLAR = 0.424`, `SWEAT_CAP = 0.590`,
`STRAIN_SCALE = 2.082`, `HEAT_A0 = 0.965`, `HEAT_P = 0.958`.

**Three consequences the author considers the model's main intellectual content:**

- Dew point enters as *vapour pressure*, not as a number added to temperature.
  This is why heat and humidity compound multiplicatively (heat inflates the
  numerator while humidity shrinks the denominator) rather than additively.
- Humidity becomes nearly irrelevant in cool air for free — at low `Tair` the
  numerator is small enough that even a poor gradient covers it.
- The **sweat-rate ceiling** (`SWEAT_CAP`) is the second, independent limit. In
  very dry heat the air can accept unlimited moisture but you cannot produce it
  fast enough. This is what makes 95 °F desert air still cost a marathoner ~4.9%.
  A pure vapour-gradient model gets that case badly wrong.

### Calibration and validation

Fitted by grid search plus coordinate descent against the marathon slowdown
table in Davis (2025), a re-analysis of Mantzios et al. (2022) covering **3,891
marathon performances across 754 races**. Evaluated on 875 temperature/dew-point
combinations.

| | MAE | RMSE | Bias | Worst | Max jump per 1 °F |
|---|---|---|---|---|---|
| Previous model (`temp + dew` band lookup) | 1.14 % | 1.66 % | +0.69 % | 6.62 % | **3.00 %** |
| Current strain model | **0.27 %** | **0.36 %** | +0.17 % | 2.26 % | **0.30 %** |

`npm run validate` reruns this and **fails the build** if the model ever
regresses or reintroduces a discontinuity.

### The other terms

- **Acclimatisation** — the largest single moderator, and the app's main
  differentiator. Racinais et al. measured cycling power decrement in heat at
  −16% unacclimatised, −8% after one week, −3% after two: a fivefold swing from
  identical weather. Multiplier `1.45 − 0.90·a`, centred so `a = 0.5` (population
  average) gives ×1.0, giving a ×1.45…×0.55 range. **The index is derived
  automatically** from the athlete's own last 14 days of weather at their own
  location, restricted to their training hours, exponentially weighted with a
  6-day half-life. Open-Meteo returns that history free via `&past_days=14`.
- **Wind** — modelled as aerodynamic drag, not a lookup. Forecast wind is
  measured at 10 m and scaled to torso height (~1.5 m) via the wind profile
  power law with a user-set terrain exponent (open 0.11 → city 0.40). Drag
  equation with Cd = 0.80, frontal area from Livingston & Lee BSA × Pugh's 0.266
  frontal fraction, converted to metabolic cost via da Silva et al. (2022):
  1% bodyweight of horizontal force = 6.13% metabolic cost.
  *Derived result:* on an out-and-back the runner's speed cancels exactly and the
  net tax is proportional to **wind²**, independent of pace. Also: heavier
  runners pay relatively *less*, because frontal area grows as mass^0.65 while
  bodyweight grows as mass^1.0 and cost tracks force relative to bodyweight.
- **Cold** — driven by NWS wind chill, not air temperature. Deliberately small:
  `0.44 × deficit^0.85` below 40 °F felt, so a −7 °F wind chill costs ~1.6% of
  pace. The danger in real cold is frostbite and footing, which is the risk
  score's job.
- **Altitude** — two-regime VO₂max curve (~1%/1000 m below 1500 m, ~6.3%/1000 m
  above), × 0.85 because thinner air also cuts drag. Scored **relative to home
  elevation**, not sea level, since the athlete's pace baselines were set where
  they live.
- **Air quality** — continuous, capped at 3%. Deliberately conservative; the
  published PM2.5 marathon regressions are heavily confounded with heat and
  urban effects.
- **Duration** — `(minutes/180)^0.55`, normalised at the marathon reference.
  Heat is accumulated fatigue, not a fixed tax.
- **Ability** — slower runners lose more in percentage terms (Ely 2007), damped
  to `(pace/480)^1.2` because much of the raw effect is longer time on course,
  which duration already covers.
- **Personal calibration** — after six logged workouts, a recency-weighted
  multiplier (0.72–1.40) learned from the athlete's own "harder / about right /
  easier" feedback.

Strain is integrated at 9 points across the workout rather than computed from
averaged inputs, because strain is convex in temperature — so a rising afternoon
correctly reads hotter than its own mean.

---

## 3. Features and information architecture

Four tabs in a fixed bottom nav (inline strip on desktop). The organising
principle is **frequency of change**: things you set every session live on
Today, things you set once live on You.

**TODAY** — answer card (window + adjusted pace + condition chips), poster hero
with the six-metric bank, AI/rule-based synopsis, workout controls (sport,
intent, structure, duration, start time), hourly ribbon, radar, effort score and
risk score side by side, factor-contribution bars, a "what would actually help"
panel, finish-safety strip, post-run feedback, and the method explanation.

**WEEK** — best window for each of the next 7 days with a flagged best day, plus
the heat adaptation tracker: a 14-day record of heat dose behind you and 7 days
projected forward, with guidance and a warning on the first genuinely hot day
after a cool spell.

**RACE** — pin a date, distance and goal; get a conditions-adjusted finish band
once the race enters forecast range. Duration and impact are mutually dependent
(a slower finish means more heat exposure means slower still), so it solves the
fixed point rather than estimating once — converges in 2–3 iterations. Also
reports what full acclimatisation would be worth in minutes on that specific day.

**YOU** — pace baselines, units, body weight, home elevation, training hours,
route shelter, the acclimatisation control, personal calibration summary, a
three-paragraph written account of the science, and profile export/import/reset.

**"What would actually help"** deserves specific attention: every row is a real
re-run of the projection with exactly one input changed, ranked by saving. So
"start at 6 AM — saves 2.1%" is the model's own number, not a heuristic. Rows are
tappable to apply.

**Units** are three independent switches (temperature, distance/pace, weight)
with locale-derived defaults, because °C with miles and kg is the normal British
combination and coupling them would have been wrong.

**First-run setup** is three questions — units, easy pace, training hours — not a
feature tour. The other three paces are derived from the easy pace. Rationale:
the real first-run problem is that default paces produce a *wrong* answer, not
that features are unexplained.

---

## 4. Architecture

No build step. No framework. No bundler. The browser loads ES modules natively.

```
public/
  index.html      ~725 lines, markup only
  styles.css      ~1000 lines, plain CSS
  engine.js      ~1135 lines — THE MODEL, pure functions, no DOM, no fetch
  app/           ~2740 lines across 17 modules
    main.js state.js data.js render.js controls.js dom.js bus.js
    units.js profile.js setup.js adaptation.js planner.js race.js
    explain.js feedback.js radar.js briefing.js
  sw.js          service worker
netlify/functions/ai-briefing.mjs   server-side Claude proxy (52 lines)
```

**Two rules:** anything that computes lives in `engine.js` as a pure function and
gets a test; anything that displays or fetches lives in `app/`. `render.js` and
`controls.js` would be a dependency cycle, so both talk to a 14-line `bus.js`.

**Data:** Open-Meteo (forecast, 14-day history, air quality, elevation),
RainViewer (radar), NWS (alerts), Nominatim (reverse geocoding), OpenStreetMap
(base tiles). All free, all keyless. Optional Claude Haiku call for the synopsis,
proxied server-side.

The separate research pipeline pins and normalizes 429,266 anonymized 2023
marathon results across 641 races plus 1,258 weather-linked endurance events.
Raw and row-level files are ignored by Git; small aggregate QA reports and the
license ledger are versioned. The 2023 cohort has not yet received reviewed
locations, start times or weather, so it has not changed the public model.

**Persistence:** one versioned `localStorage` object (schema v7) with migration
from earlier versions and full input validation on load, so a corrupt or
hand-edited profile degrades to defaults rather than breaking the app.

**Service worker:** network-first for HTML/CSS/JS, cache-first only for images.
An earlier version served HTML network-first but code cache-first, which shipped
new markup to browsers running old CSS and old modules — a genuinely bad failure
mode that produced an unstyled half-broken page.

**Testing:** 66 engine tests (no dependencies, sub-second), 45 DOM tests that
boot the real page in jsdom and drive the actual UI, four committed-data
integrity tests, plus the model validator. Netlify runs the complete
`npm run check` suite as its build gate.

---

## 5. Known weaknesses — the author's own list

Offered so the review does not spend effort rediscovering these.

**Model**
- The reference dataset is elite and sub-elite marathoners. Recreational runners
  in genuinely extreme heat are extrapolation.
- Wind has no direction. The out-and-back assumption is defensible as a default
  but a point-to-point route in a steady wind is a different problem.
- Cycling reuses the running thermal model with a 0.88 airflow factor, and
  reports wind as a speed cost rather than a power cost. It has not been
  separately calibrated and is the weakest part of the model.
- Acclimatisation becomes session-informed after enough completed hot workouts,
  but new users still begin with a low-confidence ambient-weather fallback.
- Personal calibration has never been validated against real outcomes — only
  against self-reported perceived difficulty.
- `shade` is plumbed through the strain function but no UI exposes it.
- Age and sex are deliberately not collected. The reasoning: once you control for
  body size, fitness and acclimation state, the residual effect on *performance
  decrement* is small and contested, and no coefficient could be sourced the way
  every other constant is. **This is a judgement call and a reviewer may
  reasonably disagree.**

**Product**
- No accounts, no sync, no multi-device.
- No training-log integration (Strava/Garmin), which would remove setup friction
  and replace subjective workout check-ins with stronger exposure evidence.
- No haptics, no pull-to-refresh — still reads as a website in places.
- Free Open-Meteo tier is **non-commercial only**, so any monetisation requires
  migrating to their paid plan first.
- Single-athlete only. A coach with twenty athletes at different acclimatisation
  states is the highest-value version of this product and does not exist.

**Design**
- The wordmark appears twice on the first screen (masthead and poster) —
  deliberate on a printed plate, arguably redundant in an app.
- The compact 320 px layout necessarily reduces type and chart scale; it remains
  the least luxurious version of the design.
- The cinematic opening is intentionally prominent. It is skippable and has a
  six-second fail-safe, but repeat-launch frequency still deserves user testing.

---

## 6. What a review should probe

Ordered roughly by how much the answer would change the product.

1. **Is the central model claim right?** Specifically: is framing the limit as
   *evaporative capacity* rather than *heat index* defensible, and is the
   harmonic-mean combination of air capacity and sweat ceiling a reasonable way
   to express two independent limits?

2. **Is the calibration honest?** Six free parameters fitted to a table of ~17
   anchor points, evaluated on 875 interpolated combinations of those same
   anchors. Is that overfitting dressed up as validation? What would a genuinely
   independent test look like?

3. **Is the acclimatisation inference sound?** Completed-session heat dose is
   stronger than ambient weather, but still depends on subjective workout logs.
   Is that evidence strong enough to justify a multiplier with a 2.6× range?

4. **Is refusing to collect age and sex the right call**, or is it letting a
   sourcing standard override useful signal?

5. **Does the personal calibration flywheel actually work?** It learns from
   perceived difficulty, which is confounded with sleep, fuelling, fitness and
   the placebo of having been told a number in advance.

6. **Is "one model, many outputs" the right product**, or should this be two
   things — a safety tool and a pacing tool — with different audiences?

7. **What is the strongest argument that this app should not exist?** The honest
   competing position is that experienced runners already run by feel, and that
   telling someone their pace should be 8:05–8:09 is false precision dressed as
   science.

8. **Where is the code most likely to break?** Especially: the render pass is a
   single 260-line function; state is a mutable module-level singleton; there is
   no type checking of any kind.

---

## 7. Reference documents in the repository

- `MODEL.md` — full derivation, every constant with its source, calibration
  tables, and an explicit limitations section.
- `DESIGN.md` — UI and flow review, the mobile redesign rationale, and the
  post-mortems on two real bugs (a service-worker caching mismatch and the iOS
  safe-area collision).
- `ROADMAP.md` — the original audit and the prioritised feature plan, with
  completed items marked.
- `RACE-DATA-ROADMAP.md` and `data/README.md` — empirical-engine design,
  provenance rules, licensing boundaries and the reproducible data workflow.
- `tools/validate-model.mjs` — the v0.3-vs-v0.5 scoring harness.

---

## 8. Primary sources the model rests on

- Davis (2025), re-analysis of Mantzios et al. (2022) — 3,891 marathon
  performances, 754 races. The heat calibration anchors.
- Racinais et al. — cycling power decrement across a two-week heat
  acclimatisation block (−16% / −8% / −3%). The acclimatisation multiplier.
- da Silva et al. (2022) — horizontal impeding force to metabolic cost
  (1% BW = 6.13%). The wind model's conversion step.
- Pugh (1970, 1971), Davies (1980) — runner drag coefficient and frontal area
  fraction; Pugh's wind-tunnel data is the drag model's validation set.
- Ely et al. (2007) — marathon pace versus WBGT by ability level.
- Livingston & Lee — body surface area from mass.
- Stull (2011) — wet-bulb approximation, used for the WBGT estimate.
- NWS — wind chill formula, WBGT guidance thresholds.
