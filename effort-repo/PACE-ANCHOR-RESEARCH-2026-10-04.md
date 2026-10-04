# Race-anchored paces: what to take from Laktic, and how to do it better

October 4, 2026. Research into Laktic (laktic.com), compared with EffortCast's current pace model, plus an implementation plan. Laktic's pace-zone and event-pace logic runs in its public web client and was read from the shipped JavaScript on this date. Its plans, race predictions and race "gameplans" are generated on its server and were not inspected; descriptions of those come from its UI copy.

## What Laktic is

An AI coaching app for runners (GPT-4o plans and chat, Strava sync, coach marketplace, high-school/college recruiting pages). The pace calculator is one panel inside it: **Pace Zones**, labelled with where the numbers came from ("from 5K PR (17:30)").

## How Laktic sets thresholds

1. **One anchor performance.** It takes your 3000 m, 3200 m, 5K and 10K PRs, converts each to a 5K equivalent and keeps the fastest. The conversion factors (3000 m ×1.719, 3200 m ×1.605, 10K ×0.48) are exactly Riegel's formula with exponent 1.06.
2. **Zones as fixed multiples of 5K pace.**

   | Zone | Label | × 5K pace | ≈ % VO2max (Daniels) |
   |---|---|---|---|
   | LT2 | Threshold, "race-effort threshold" | 1.044–1.092 | 86–91 % |
   | LT1 | Tempo, "comfortably hard" | 1.118–1.155 | 80–83 % |
   | Steady | Aerobic development | 1.222–1.296 | 70–74 % |
   | Easy / Recovery | Lookup table by 5K time | — | — |
3. **Event paces** come from mile/1500/800 PRs: mile pace, 1500 m and 800 m pace per 400 m.
4. **No aerobic PR?** The panel says "Add a 3000m, 3200m, 5K, or 10K PR to unlock your personalized pace zones."
5. **Predictions** (server side): "Right now", "Race week" and "Potential PR", each with a confidence level (high / medium / low, "add a PR to improve accuracy") and a "based on" line.
6. **Weather:** only temperature, wind and a text description shown with an emoji. The "weather-adjusted strategy" is written by their AI. There is no dew point, heat-balance or acclimatisation model. This matches your read: our weather is much stronger.

### What they get right
- **Paces start from something you actually ran**, not from a guess about your easy pace.
- **Named physiological zones (LT1, LT2) with ranges**, not single numbers.
- **Provenance on screen:** "from 5K PR (17:30)" builds trust and tells you what to update.
- **An honest empty state and confidence labels** when data is thin.

### Where their method breaks (checked numerically)
- **Easy and Recovery stop scaling at an 18:00 5K.** Every runner slower than 18:00 gets Easy 7:20–8:45/mi and Recovery 8:00–9:30/mi.

  | 5K | 5K race pace | Laktic LT2 | Laktic "Easy" |
  |---|---|---|---|
  | 20:00 | 6:26/mi | 6:43–7:02 | 7:20–8:45 |
  | 25:00 | 8:03/mi | 8:24–8:47 | **7:20–8:45** (fast end quicker than race pace) |
  | 30:00 | 9:39/mi | 10:05–10:33 | **7:20–8:45** (entirely faster than race pace) |

  Our target audience (recreational half and marathon runners, per the September 10 strategy) is exactly the group it gets wrong.
- **Half-marathon and marathon PRs are collected at signup but never used for zones.** Only 3000 m–10K results count.
- **"PR" rather than "recent".** A five-year-old PR anchors today's zones.
- **The anchor ignores conditions.** A 5K run in 86 °F at a 72 °F dew point counts at face value, so the zones come out too slow.
- **Fixed ratios** are fine for threshold but don't adapt to how far someone's endurance extends (5K-strong vs marathon-strong runners).

## Where EffortCast is today

- Four manual paces in You: Easy / Steady / Hard / Race (defaults 8:00 / 7:30 / 7:00 / 6:30).
- Setup asks only for **easy pace** and derives the rest as ×0.94 / ×0.88 / ×0.82. That's the weakest possible anchor: easy pace says the least about fitness, and the ratios belong to nobody.
- The heat model's intensity is fixed per label (`HEAT_INTENSITY` Easy 0.72 … Race 1.0), so "Hard" means the same metabolic load for a 17-minute and a 30-minute 5K runner.
- The race goal is typed in by hand. Nothing suggests a realistic goal or checks one.

## Recommendation: a "fitness anchor" that beats both

Keep Laktic's ideas (anchor on real performances, LT1/LT2 zones, provenance, confidence) and fix the four weaknesses using things only EffortCast can do.

### 1. Performance history, not a single PR
A small list in You → Fitness. Each entry has:
- distance: any of 1 mi, 5K, 10K, 15K, 10 mi, half, marathon, or custom;
- time and date;
- type: race / time trial / hard workout;
- optional location and start time, which unlocks the weather correction.

The "Add a race" flow also offers to save the race pinned in the Race tab once it's done.

### 2. Weather-corrected performances (our unique edge)
For entries with a place and start time, fetch the **historical hourly weather** for that window. Open-Meteo's archive/historical-forecast endpoints use the same variables we already parse. Run the existing engine at race effort over that window and remove the modeled weather cost:

```
neutral time = actual time ÷ (1 + impactMid/100)
```

The app then shows, for example: "17:52 in 86 °F / 72 °F dew ≈ **17:21 in neutral air**." Laktic can't do this. It turns hot-summer races into usable fitness evidence instead of discarding them, and it uses only model 0.5. Label it as modeled ("historical modeled conditions"), never as measured on the route, per the strategy doc's evidence rules.

### 3. A continuous fitness model (Daniels–Gilbert VDOT)
Replace fixed ratios and lookup tables with the published VDOT equations, which work from 1500 m to the marathon at any ability:
- **Oxygen cost** VO2 = −4.60 + 0.182258·v + 0.000104·v² (v in m/min).
- **Sustainable fraction** %VO2max = 0.8 + 0.1894393·e^(−0.012778·t) + 0.2989558·e^(−0.1932605·t) (t in minutes).
- **VDOT** = cost ÷ fraction.
- Every zone is then a %VO2max band solved back to pace. Every race prediction comes from a bisection on time.

**Current fitness = recency-weighted best**, not all-time best. Each entry's VDOT is weighted with a half-life of about 90 days (older results fade), and races outrank time trials, which outrank workouts.

**Confidence:**
- **High:** a race within 8 weeks at a similar distance to the target.
- **Medium:** a race within 16 weeks, or a different distance.
- **Low:** anything older, or workouts only.

**Marathon realism:** Vickers & Vertosick (2016, 2,303 recreational runners) found Riegel-style projections give marathon times 10+ minutes too fast for about half of runners. Accuracy improves when weekly mileage is included. Add an optional weekly-mileage field, and apply a documented low-mileage marathon penalty rather than trusting VDOT alone above the half.

### 4. Zones, calibrated to Laktic's useful bands
Same names as Laktic where they work, extended to the full ability range:

| Zone | % VO2max | 20:00 5K | 25:00 5K |
|---|---|---|---|
| Recovery | 58–64 | 8:52–9:36 | 10:55–11:47 |
| Easy | 64–70 | 8:16–8:52 | 10:11–10:55 |
| Steady | 70–75 | 7:49–8:16 | 9:38–10:11 |
| LT1 / Tempo | 80–83 | 7:12–7:25 | 8:53–9:09 |
| LT2 / Threshold | 86–90 | 6:45–7:00 | 8:20–8:39 |

The LT2 and LT1 ranges land within a few seconds of Laktic's for fast runners, and stay sensible for slow ones. The app's four intensity buttons map onto zones:
- **Easy** → Easy zone
- **Steady** → Steady
- **Hard** → LT2
- **Race** → the pinned race's goal pace, or the predicted 10K pace

Each zone can still be **pinned manually**, which overrides the model and shows a "MANUAL" source tag, matching how acclimatisation already works.

### 5. Then the merger: zones *in today's weather*
This is the feature neither app has. The **Today** view shows a zone table with both columns, for example:

| Zone | Neutral air | Your 3 PM start |
|---|---|---|
| LT2 / Threshold | 6:45–7:00 | 7:03–7:21 |

Each "today" column is a real projection at that zone's intensity. The dial hub, split tape and race plan all use the anchored paces. The provenance line reads like Laktic's, but better: "from 10K race, Sep 14 (41:30 → 40:58 weather-corrected) · confidence high".

### 6. Race tab: suggested goal and a reality check
Once fitness exists:
- **Suggested goal:** "Predicted 1:31:50 in neutral air (VDOT 49.8, high confidence). With this forecast: 1:33:40–1:35:20."
- **Typed goal vs. fitness:** if the goal implies a VDOT more than 3 points above current fitness, say so gently, e.g. "your goal needs fitness you last showed in March."
- The split tape and share card use the anchored goal pace by default.

### 7. Make the heat model use real intensity (model 0.6, separate release)
Today `HEAT_INTENSITY` is fixed per label. With zones, each workout's relative intensity is known: it's the zone's %VO2max relative to typical marathon effort (~80 %). Feeding that into the heat balance as `metabolicLoad` makes a threshold run genuinely hotter than an easy one for every athlete. This changes model outputs, so it must ship as **0.6** with:
- `npm run validate`;
- new calibration tests;
- a MODEL.md section;
- `recalibration: true` in the release notes.

Steps 1–6 don't change the model at all.

## Implementation plan

| Step | Files | Notes |
|---|---|---|
| A. Fitness math | new `public/fitness.js` (pure) + `tests/fitness.test.mjs` | `vdotFromPerformance`, `paceAtFraction`, `predictSeconds`, `trainingZones`, `fitnessFromHistory` (recency + confidence). Test against published Daniels table values (e.g. 20:00 5K ≈ VDOT 49.8, threshold ≈ 6:52–7:12/mi). |
| B. Weather correction | `fitness.js` (`neutralizePerformance`, uses `projectV4`), new `app/history-weather.js` | Open-Meteo historical endpoint by date and venue timezone. Reuse `parseRaceWeather` and `raceEpoch` for local-time handling. Missing hours → no correction, clearly labelled. |
| C. Profile schema v10 | `state.js` | `performances: [{distanceM, seconds, dateISO, kind, venue?, startTime?, neutralSeconds?}]`, `weeklyMiles?`, `zonePins`. Migrate existing manual paces into pins so nobody's numbers change on upgrade. |
| D. You → Fitness UI | `profile.js`, `index.html`, `styles.css` | Instrument-style panel: history tape (one cell per performance, hollow = weather-corrected), zone ledger with provenance and confidence chip. |
| E. Setup | `setup.js` | Replace "What is your easy pace?" with "Your most recent race or hard effort". Keep easy pace as the fallback ("I haven't raced"). |
| F. Today | `render.js`, `dial.js` | Zone table with neutral vs. today columns; intensity buttons pull anchored paces. |
| G. Race | `race.js`, `race-dial.js` | Suggested goal, goal-vs-fitness check, confidence on the race instrument. |
| H. Model 0.6 | `engine.js`, `MODEL.md`, `tools/validate-model.mjs` | Separate branch and release, per section 7. |

Steps A–D are about one focused session each; E–G are smaller. Nothing in A–G changes model 0.5 numbers for an athlete who adds no performances.

## Deliberately not copying

- **AI-written plans and chat.** The strategy doc already defers a coaching platform and a generic chatbot. Laktic's weather strategy is AI prose over three weather fields; ours should stay model-derived.
- **Strava ingestion** for automatic best efforts. Useful later, but it carries the API policy constraints noted in the September 10 strategy (AI and analytics restrictions). Manual entry first.
- **Track event paces** (800/1500/mile per 400 m). Laktic serves high-school and college runners. Add them later only if track athletes show up.

## Sources

- Laktic web client, read 2026-10-04: [laktic.com](https://www.laktic.com/) (pace-zone constants, zone labels, prediction-card fields, gameplan weather fields).
- Daniels–Gilbert VDOT equations: [Rundida VDOT methodology](https://rundida.com/tools/vdot-calculator/), [Rundida methodology notes](https://rundida.com/about/methodology/).
- Riegel underestimates recreational marathon times; mileage-aware models do better: [Vickers & Vertosick 2016, BMC Sports Sci Med Rehabil](https://pmc.ncbi.nlm.nih.gov/articles/PMC5000509/).
- Critical speed vs. maximal lactate steady state (why "threshold" is a band, not a point): [PMC6533178](https://pmc.ncbi.nlm.nih.gov/articles/6533178/), [Springer s00421-021-04780-8](https://link.springer.com/10.1007/s00421-021-04780-8).
- Weather effects on marathon times (context for weather-corrected anchors): [UChicago EPIC](https://epic.uchicago.edu/insights/your-race-against-time-how-climate-affects-the-marathon/), [Scientific Reports 2022](https://nature.com/articles/s41598-022-25901-z.pdf).
- Threshold-calculator landscape: [Coach Saltmarsh LT1/LT2 calculator](https://coachsaltmarsh.com/lactate-threshold-calculator/), [Running Explained calculators](https://www.runningexplained.com/calculators).
