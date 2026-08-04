# EFFORTCAST — audit and roadmap

Written August 2026 against v0.3. The engine work described in phase 0 is
**already done and shipped in this repo**; everything after it is proposed.

---

## Part 1 — What you have

A genuinely good product with one structural weakness and one strategic gap.

**The good.** The separation of *effort cost* from *environmental risk* into two
independent scores is the smartest thing in the app, and most competitors don't
do it. The best-training-window search with a training-hours fence is a real
feature — the "3 AM trap" test shows someone thought carefully about it. The
`engine.js` / `index.html` split with a test guarding every calibration number
is unusually disciplined for a project this size. The visual design has a point
of view. Keyless data sources mean zero marginal cost per user.

**The structural weakness.** `index.html` is 1,474 lines of markup, CSS, and
application logic in one file, and it will get worse before it gets better. It
isn't urgent — it still loads instantly and has no build step, which is a real
asset — but it is already the thing that will slow down every feature below.

**The strategic gap, and the important one.** Until now the app modelled *the
weather*. It did not model *the athlete*. Two people standing in the same air
got the same answer, forever. That's the difference between a weather app with
running features and a training tool, and it's where the next order of magnitude
comes from.

### Specific findings from the audit

| Severity | Finding |
|---|---|
| High | `temp + dew` conflates two physically different quantities; heat/humidity bands were step functions with jumps up to 3 % |
| High | Nothing personalised the projection to the athlete's heat state |
| High | Altitude was charged against sea level, so residents of high cities were told they were slow every day forever |
| Medium | `effortScore` double-counted dew point and WBGT on top of an impact that already included both |
| Medium | Winds under 10 mph cost runners exactly zero |
| Medium | Cold penalty ~3× the empirical value |
| Medium | Ride wind is reported as a power reduction; wind doesn't reduce power at a given effort, it reduces speed |
| Low | No error boundary — one thrown exception in `render()` leaves the UI frozen mid-update with no message |
| Low | `sw.js` caches the app shell but there's no "you're offline, this forecast is 4 hours old" state |
| Low | `localStorage` keys are unversioned across four separate entries; no export or device sync |
| Low | Free Open-Meteo tier is non-commercial only — blocks monetisation until migrated |

---

## Part 2 — Phase 0: the engine (done)

Replaced the band lookup with a continuous heat-balance model calibrated against
3,891 marathon performances. Full derivation and sources in
[MODEL.md](./MODEL.md).

- **86 % reduction in mean absolute error** (1.14 % → 0.16 %) against the
  published reference table
- Largest jump from a 1 °F forecast change: **3.00 % → 0.22 %**
- Heat acclimatisation derived automatically from the athlete's own last 14 days
  of weather, at no extra API cost
- Wind modelled as aerodynamic drag at torso height, with a terrain shelter
  setting
- Altitude scored relative to home elevation
- 53 tests, including a jsdom smoke test that boots the real page and asserts
  the new controls actually reach the engine
- `npm run validate` scores v0.3 against v0.4 and fails if v0.4 ever regresses

---

## Part 3 — Where the next 10× comes from

Ranked by (value to the athlete) ÷ (effort to build). The theme is consistent:
**stop being a forecast, start being a coach.**

### Tier 1 — Ship these first

**1. The heat adaptation tracker.** You now compute an acclimatisation index but
only display it as a label. Make it a first-class screen: a 14-day strip of
daily heat dose, the trend line, and the sentence that matters — *"You're 60 %
adapted. Two more sessions above 80 °F this week and you'll be ready for
Saturday's race."* Nothing else on the market does this, it runs entirely on
data you already fetch, and it converts a one-off lookup into a daily habit.
Pair it with a push notification on the first hard heat day after a cool spell,
which is the single most useful alert this app could send.

**2. Race day countdown.** The highest-intent moment in any runner's calendar.
Let them pin a date, distance, and goal time. Then: a projected finish-time band
that updates as the forecast firms up inside 10 days, the pace they should
actually go out at, and — the killer feature — *"conditions look 4 % worse than
your goal assumed; your realistic target is 3:07, not 3:00."* Runners will open
this every single day for two weeks. Extend it with an acclimatisation plan
counting back from race day.

**3. The 7-day planner.** The app answers "when today?" It should answer "which
day this week?" A week grid where each day shows its best window and a quality
score, so the long run lands on Saturday instead of Sunday because Sunday is
dew point 74. This is a small change to `findBestWindow` (Open-Meteo already
returns three days free; the paid tier returns sixteen) and a big change to how
often the app gets opened.

**4. Explain the number.** The "why" panel shows factor bars, which is good but
static. Make it interactive: *"if you moved this run to 6 AM you'd save 2.1 %"*,
*"if you were fully heat-adapted you'd save 1.4 %"*, *"shade cuts this by
0.9 %"*. You have every one of those counterfactuals available — they're just
re-runs of `project()` with one input changed. This is the cheapest credibility
you will ever buy, and it's what turns a number people distrust into a number
they act on.

**5. Post-run reconciliation.** Ask one question after a workout: *did that feel
easier or harder than predicted?* Three taps. Store it. After ~10 workouts,
personalise `acclimationMultiplier` and `abilityFactor` to that specific
athlete. This is the flywheel — every other feature gets better as it fills in,
and it's a moat no competitor can copy without your users.

### Tier 2 — Depth

**6. Strava / Garmin import.** Removes the pace-baseline setup friction entirely
(derive Easy/Steady/Hard/Race from actual recent runs), and gives you real
outcome data to validate the model against — closing the loop that MODEL.md's
limitations section is currently honest about. It also fixes the acclimatisation
blind spot: right now a fortnight indoors reads as heat-adapted, because the
index sees ambient weather rather than training.

**7. Route-aware wind.** You have terrain shelter. The next step is a drawn or
imported route: get the actual bearing distribution and compute directional
wind cost instead of assuming out-and-back. Meaningfully better on windy days
and very visual.

**8. Give cycling its own model.** Rides currently borrow the running thermal
model and misreport wind as a power cost. A real cycling mode needs a power-based
thermal model, aero cost as a *speed* prediction, and descent wind chill — which
is a genuine safety issue no weather app covers.

**9. Shade and surface.** `shade` is already plumbed through `heatStrain` with
no UI. A trail-under-canopy run versus open asphalt at noon is a large real
difference — 0.9 % or more — and it's a one-control feature. Surface radiant
load (track and asphalt run far hotter than grass) is the natural extension.

**10. Group and coach mode.** One coach, twenty athletes, twenty different
acclimatisation states, one shared practice time. Output: a per-athlete pace
adjustment table and a flag on whoever is least adapted. This is the highest-value
version of the product and the one people pay for — high-school and collegiate
programmes have a duty-of-care obligation here that is currently met with a
laminated WBGT chart on a clipboard.

### Tier 3 — Foundations, not features

**11. Split `index.html`.** Not into a framework — into ES modules that the
browser loads natively, preserving the no-build-step advantage: `state.js`,
`render.js`, `radar.js`, `briefing.js`, `data.js`. Do this when it's blocking
you, not before.

**12. Error boundary and data-freshness state.** Wrap `render()` so a thrown
exception shows a message instead of freezing the UI mid-update. Show forecast
age prominently when the app is served from the service worker cache.

**13. Versioned, exportable profile.** Consolidate the four `localStorage` keys
into one versioned object with a migration path, then offer export/import. It's
the precondition for accounts without requiring accounts.

---

## Part 4 — Before charging money

Unchanged from the README and still accurate, with one addition:

- Open-Meteo's free tier is **non-commercial only**. A paid product means their
  Standard plan (~$29/mo) — same API, different domain, key routed through a
  Netlify Function like the briefing proxy already is.
- Keep the Open-Meteo attribution visible (CC BY 4.0).
- Re-check RainViewer's commercial terms.
- **New:** the AI briefing currently supports a "paste your own API key into
  localStorage" path. That's fine for a personal tool and unacceptable in a paid
  product — remove it and go server-only, where the gate belongs.

## Suggested sequencing

| | Focus |
|---|---|
| Now | Phase 0 engine (done) |
| Next | Explain-the-number (#4) and the 7-day planner (#3) — both small, both immediately visible |
| Then | Race day countdown (#2) and the adaptation tracker (#1) — the two retention features |
| Then | Post-run reconciliation (#5), then Strava import (#6) to feed it |
| Later | Coach mode (#10) as the first thing worth charging for |

Refactoring (#11–13) should be pulled forward the moment it starts costing more
than it saves — probably around the race day countdown, which is the first
feature that needs real routing and view state.
