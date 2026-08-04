# The Effort Engine — model 0.4-strain

Every number in `public/engine.js` traces back to something in this file. If you
change a constant, change the paragraph that justifies it and run `npm run check`.

---

## Why v0.3 needed replacing

The v0.3 engine used a lookup grid keyed on `temp + dew point`, a heuristic that
circulates widely in running forums. Six problems, in rough order of severity:

**1. `temp + dew` is not a physical quantity.** It treats 90 °F / 50 °F dew and
70 °F / 70 °F dew as identical loads (both sum to 140). They are not remotely
alike: the first is a hot, dry afternoon where sweat evaporates freely; the
second is a mild, saturated morning. Dew point doesn't add to temperature — it
sets a *ceiling on how fast you can shed heat*. Those are different roles in the
equation, and adding them together destroys the information.

**2. The bands were step functions.** Rounding the load to a 5 ° grid meant a
1 °F change in the forecast could move the pace prediction by up to **3.0
percentage points** — from "run 3–4.5 % slower" to "run 4.5–6 % slower" on the
strength of a rounding boundary. The hourly ribbon inherited that jitter.

**3. Cold was overstated by roughly 3×.** v0.3 charged 0.8–2 % at 25 °F. The
marathon data says a marathoner at that temperature loses well under 1 %. Cold
is mostly a *risk* story, not a pace story.

**4. Moderate wind was free.** `windBand` subtracted a 10 mph deadband before
charging anything, so a 10 mph wind cost a runner exactly zero. Air resistance
does not have a deadband.

**5. Double counting.** `effortScore` added a dew-point term *and* a WBGT term
on top of an impact figure that already contained both.

**6. No athlete in the model.** Two people standing in the same air got the same
answer. In reality the largest single moderator of heat cost is how much heat
you've recently trained in — and it is worth more than everything else on this
list combined.

---

## v0.4: a heat-balance model

### The core idea

You produce metabolic heat. You must shed it. Strain is the ratio:

```
                required heat loss
strain  =  ─────────────────────────────
            available evaporative capacity
```

**The numerator** is metabolic heat (normalised to 1), plus dry heat exchange
with the air, plus radiant load from the sun:

```
Ereq = 1 + C_DRY · (Tair − 35 °C)/10 + C_SOLAR · (solar/1000) · (1 − shade) / (1 + 0.4·v)
```

Below 35 °C skin temperature the dry term is *negative* — the air is helping
you. Above it, the air is heating you. Wind dilutes the radiant term.

**The denominator** has two independent ceilings, and the lower one binds:

- *What the air can accept* — proportional to the vapour-pressure gradient
  between saturated skin (5.62 kPa at 35 °C) and the ambient air. Ambient vapour
  pressure is, by definition, the saturation pressure at the dew point. This is
  the correct physical role for dew point.
- *What you can physically sweat* — a hard constant (`SWEAT_CAP`). No amount of
  dry air helps if you can't produce sweat fast enough to use it.

They're combined as a harmonic mean rather than a hard `min()` so the surface
stays differentiable:

```
Emax = 1 / (1/Emax_air + 1/SWEAT_CAP)
```

**This single change earns most of the model's accuracy.** The sweat ceiling is
why 95 °F desert air still costs a marathoner ~4.9 % despite near-infinite
evaporative capacity in the air — a case v0.3 got right only by accident and
that a pure vapour-gradient model gets badly wrong.

It also produces the multiplicative heat × humidity interaction for free.
Hot-and-humid is much worse than either alone, because heat inflates the
numerator while humidity shrinks the denominator.

### From strain to pace

```
slowdown% = HEAT_A0 · max(0, strain − 1.0) ^ HEAT_P
```

at the calibration reference of **race effort, 180 minutes, an 8:00/mi runner,
population-average acclimatisation**. The index is scaled so `strain = 1.0` is
exactly where pace begins to cost you.

| Strain | Reads as |
|---|---|
| < 1.0 | Free cooling |
| 1.0–2.0 | Mild load |
| 2.0–3.5 | Working to stay cool |
| 3.5–5.0 | Cooling near capacity |
| 5.0–7.0 | Cooling outrun |
| 7.0+ | Cooling overwhelmed |

### Calibration

Six parameters (`C_DRY`, `C_SOLAR`, `SWEAT_CAP`, `HEAT_A0`, `HEAT_S0`,
`HEAT_P`) were fit by grid search plus coordinate descent against the marathon
slowdown table in [Davis (2025)](https://runningwritings.com/2025/04/heat-humidity-marathon-times.html),
a re-analysis of [Mantzios et al. (2022)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8677617/)
covering **3,891 marathon performances across 754 races**, with the raw data
published openly. 875 temperature/dew-point combinations were evaluated.

| | MAE | RMSE | Bias | Worst | Max jump per 1 °F |
|---|---|---|---|---|---|
| v0.3 bands | 1.14 % | 1.66 % | +0.69 % | 6.62 % | **3.00 %** |
| v0.4 strain | **0.16 %** | **0.24 %** | +0.04 % | 1.75 % | **0.22 %** |

An 86 % reduction in mean absolute error, and the discontinuities are gone.
Reproduce with `npm run validate`.

Where the two models diverge most:

| Condition | Temp / dew | Published | v0.3 | v0.4 |
|---|---|---|---|---|
| Cool humid dawn | 58 / 56 | 0.38 % | 2.25 % | 0.24 % |
| Warm and dry | 88 / 45 | 3.72 % | 3.75 % | 3.95 % |
| Warm and sticky | 88 / 75 | 5.77 % | 10.50 % | 5.24 % |
| Hot and dry | 95 / 50 | 4.90 % | 5.63 % | 4.89 % |
| Mild but saturated | 70 / 68 | 1.74 % | 3.75 % | 2.13 % |

v0.3's worst failure was the muggy summer afternoon, where it nearly doubled the
real penalty — precisely the condition the app exists to advise on.

---

## Heat acclimatisation

The differentiator. [Racinais et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC4342312/)
measured cycling time-trial power decrement in the heat across a two-week
acclimatisation block:

| Exposure | Power decrement |
|---|---|
| Day 0, unacclimatised | −16 % ± 5 |
| After 1 week | −8 % ± 4 |
| After 2 weeks | −3 % ± 4 |

A **5× swing** from the same weather. No consumer weather app models this.

Because the marathon anchors are a population average already smeared across
acclimatisation states, the multiplier is centred on 1.0 at "typical":

```
acclimationMultiplier(a) = 1.45 − 0.90·a        a ∈ [0,1]
```

giving ×1.45 unacclimatised, ×1.00 typical, ×0.55 fully adapted — a 2.6× spread,
deliberately narrower than the raw 5× because that figure came from maximal time
trials in extreme heat, not pace-at-effort in ordinary conditions.

### Deriving it from the athlete's own weather

`acclimationIndex()` scores the last 14 days of hourly conditions at the
athlete's location, restricted to their training hours, exponentially weighted
with a 6-day half-life. Open-Meteo returns that history free on the same keyless
endpoint via `&past_days=14` — **no extra API cost, no user input, no wearable**.

The practical payoff: on the first 88 °F day after a cool spring, EffortCast
tells you the day will cost you 45 % more than the raw numbers suggest, and
raises the risk score accordingly. That is the day people get hurt.
[75–80 % of the adaptation](https://pmc.ncbi.nlm.nih.gov/articles/PMC11583594/)
arrives in the first 4–7 days, which the half-life reflects.

---

## Wind is drag, not a penalty table

Forecast wind is measured at 10 m. Your torso is at ~1.5 m. The
[wind profile power law](https://en.wikipedia.org/wiki/Wind_profile_power_law)
scales between them, and the exponent depends on shelter:

| Terrain | α | 10 mph becomes |
|---|---|---|
| Open water / beach | 0.11 | 7.8 mph |
| Rural, open field | 0.16 | 7.0 mph |
| Park | 0.20 | 6.5 mph |
| Suburb (default) | 0.30 | 5.7 mph |
| Dense city | 0.40 | 5.0 mph |

Then the drag equation with `Cd = 0.80` (mean of Pugh 1970, Davies 1980,
Walpert 1989, Schickenhofer 2021, Marro 2023) and frontal area from
Livingston & Lee body surface area × Pugh's 0.266 frontal fraction. Drag force
converts to metabolic cost via [da Silva et al. (2022)](https://pubmed.ncbi.nlm.nih.gov/35834628/):
**1 % bodyweight of horizontal impeding force = 6.13 % metabolic cost**.

### A pleasing result

On an out-and-back, average the two legs. With cost ∝ (relative velocity)²:

```
½·[(v_run + v_wind)² + (v_run − v_wind)²] − v_run²  =  v_wind²
```

The runner's speed cancels exactly. **The net wind tax on an out-and-back is
proportional to wind speed squared and independent of how fast you run.** It is
also always positive — which is the formal statement of why a headwind costs
more than the matching tailwind gives back. (When the tailwind exceeds running
speed the algebra changes and the engine handles that branch separately.)

One counterintuitive consequence, confirmed by test: **heavier runners pay
relatively less** for wind. Frontal area grows as mass^0.65 but bodyweight grows
as mass^1.0, and metabolic cost tracks force *relative to bodyweight*.

---

## The rest

**Cold** is driven by wind chill (NWS formula), not air temperature, and grows
as `0.44 · deficit^0.85` below 40 °F felt. Anchored on the 25–30 °F rows of the
Davis table. It stays small on purpose: a −7 °F wind chill costs about 1.6 % of
pace. The danger in real cold is frostbite and footing, which is the risk
score's job, not the pace model's.

**Altitude** follows the two-regime VO₂max curve — ~1 % per 1000 m below 1500 m,
[~6.3 % per 1000 m above](https://www.mysportscience.com/post/2015/03/05/altitude-effects-on-endurance-performance) —
scaled by 0.85 because thinner air also cuts aerodynamic drag.

Critically, it is scored **relative to your home elevation**, not sea level.
Your pace baselines were set where you live. v0.3 told a Denver resident they
were 3–5 % slow every day of their life, forever, which is both wrong and
useless. v0.4 charges them nothing at home and the full penalty when they travel
up.

**Air quality** is continuous rather than stepped, capped at 3 %. Deliberately
conservative: the [Brown University marathon study](https://link.springer.com/article/10.1007/s40279-024-02160-8)
(2.5 M finish times) found ~32 s per µg/m³ of PM2.5, but that coefficient is
heavily confounded with heat and urban effects — taken literally it would imply
a 13 % penalty at AQI 150, which is not credible.

**Duration** — heat is accumulated fatigue, not a fixed tax, so cost scales as
`(minutes/180)^0.55`, normalised at the marathon reference. A 30-minute run gets
0.37× the marathon penalty, not 0.17×.

**Ability** — slower runners lose more in percentage terms
([Ely 2007](https://pubmed.ncbi.nlm.nih.gov/17473775/): 1 s/mi/°C for sub-5:45
runners vs 4–4.5 s/mi/°C at 7:25–10:00). Damped to `(pace/480)^1.2` because much
of the raw effect is simply longer time on course, which duration already covers.

**Integration** — strain is computed at 9 points across the workout and
averaged, rather than averaging the inputs and computing once. Because strain is
convex in temperature, a rising afternoon correctly reads hotter than its own
mean condition.

---

## Known limitations

- The reference dataset is elite and sub-elite marathoners. Recreational runners
  in genuinely extreme heat are extrapolation.
- Wind has no direction. The out-and-back assumption is a reasonable default but
  a point-to-point route in a steady wind is a different problem.
- `shade` is plumbed through `heatStrain` but no UI exposes it yet.
- Cycling reuses the running thermal model with a 0.88 airflow factor, and
  wind is reported as a speed cost rather than a power cost. Rides deserve their
  own calibration — see the roadmap.
- Acclimatisation is inferred from *ambient weather at your location*, not from
  whether you actually trained. A fortnight indoors reads as adapted.
