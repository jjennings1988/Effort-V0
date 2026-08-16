# EffortCast science review — August 2026

## Purpose

This review records the evidence used for EffortCast model 0.5. It is a product and engineering brief, not a medical protocol. The papers below were selected to answer four questions:

1. Which weather variables most strongly affect endurance performance?
2. How should EffortCast represent the body's ability to dissipate exercise heat?
3. Which personal factors can be modeled responsibly with the data the app currently has?
4. Which claims should the product avoid?

## What the evidence changes

### 1. Humidity should be modeled as vapor pressure, not relative humidity alone

Recent controlled work found that heat impaired performance and that elevated humidity caused an additional performance loss. Experiments that manipulated ambient vapor pressure also showed a steep fall in maximum evaporative capacity and sweating efficiency as the skin-to-air vapor-pressure gradient narrowed. This supports EffortCast's use of dew point and vapor pressure, and argues against a simple temperature-plus-relative-humidity score.

Product decision:

- Keep dew point and vapor pressure as first-class inputs.
- Expose an evaporation or "sweat escape" signal in the interface instead of presenting humidity as a generic percentage.
- Treat high heat plus high vapor pressure as an interaction, not two independent additive penalties.

Key evidence:

- Jenkins et al. (2023), [Delineating the impacts of air temperature and humidity for endurance exercise](https://pubmed.ncbi.nlm.nih.gov/36537856/)
- Coombs et al. (2025), [Elevated humidity impairs evaporative heat loss and self-paced exercise performance in the heat](https://pubmed.ncbi.nlm.nih.gov/40107869/)
- Maughan et al. (2012), [High humidity reduces exercise capacity in the heat](https://pubmed.ncbi.nlm.nih.gov/22012542/)

### 2. The engine needs metabolic heat inside the heat-balance calculation

Required evaporation is driven by metabolic heat production plus dry and radiant heat exchange. Direct-calorimetry work found required evaporation to be a strong determinant of whole-body sweat rate. Studies matching participants for metabolic heat production show that core temperature and sweating are better explained by heat production, body mass, and surface area than by aerobic fitness alone.

Product decision:

- Move workout intensity into thermal strain rather than applying it only as a downstream pace modifier.
- Estimate exercise heat from sport, intensity, and speed, using conservative defaults when body mass is unknown.
- Retain fitness and duration as performance modifiers, but do not let them substitute for heat production.
- Add body mass only as an optional profile input in a later round, after the estimate and privacy language are designed.

Key evidence:

- Gagnon, Jay, and Kenny (2013), [Exercise heat balance and whole-body sweat rate](https://pmc.ncbi.nlm.nih.gov/articles/PMC3690695/)
- Jay et al. (2011), [Changes in core temperature and sweating with fixed heat production](https://pubmed.ncbi.nlm.nih.gov/21697517/)
- Fletcher et al. (2013), [Running economy and energetic cost](https://pmc.ncbi.nlm.nih.gov/articles/PMC5479897/)
- Margaria et al. (1963/1977 record), [Energy cost of running](https://pubmed.ncbi.nlm.nih.gov/922272/)

### 3. Thermal strain is better framed as required versus available cooling

The ratio of required evaporation to maximum evaporative capacity is commonly interpreted as required skin wettedness. Values approaching the person's effective wettedness limit indicate that the environment and activity are becoming difficult to compensate for. Trained and heat-acclimated people can generally sustain higher wettedness than untrained or unacclimated people, but the boundary is not universal.

Product decision:

- Reframe the internal strain calculation as a thermal-load ratio: cooling required divided by cooling available.
- Use a smooth limiting function for air-side evaporation and sweat capacity rather than the current unnormalized harmonic combination, which artificially drives capacity below both limits.
- Avoid displaying a universal physiological threshold as if it were a diagnosis.
- Continue to calibrate predicted performance against race observations, but label those observations honestly as calibration rather than independent validation.

Key evidence:

- Cramer and Jay (2019), [Biophysical limits of heat tolerance during exercise](https://pmc.ncbi.nlm.nih.gov/articles/PMC6601408/)
- Periard et al. (2026), [Systematic review of core-temperature prediction during exercise](https://pmc.ncbi.nlm.nih.gov/articles/PMC13328076/)

### 4. Air movement must eventually include athlete-generated airflow

Wind increases convective and evaporative heat transfer, while solar radiation can sharply reduce exercise capacity. For runners and especially cyclists, apparent air speed is not the same as forecast wind speed: forward motion creates airflow even on a calm day. WBGT is useful for screening environmental heat but can miss important differences in air movement, workload, clothing, and personal state.

Product decision:

- Improve the solar-load treatment now and make its role visible in the graphics.
- Preserve forecast wind in model 0.5.
- Design relative-airflow support for model 0.6, after calibrating it separately for running and cycling; adding it immediately without recalibration would over-credit cooling.
- Keep WBGT as a comparison signal, not the proprietary core of the model.

Key evidence:

- Otani et al. (2016), [Solar radiation and endurance exercise capacity](https://pubmed.ncbi.nlm.nih.gov/26842928/)
- Periard et al. (2015), [Heat acclimation and strategies for competing in the heat](https://pmc.ncbi.nlm.nih.gov/articles/PMC4473280/)
- Che Muhamed et al. (2016), [Environmental heat stress and exercise performance](https://pmc.ncbi.nlm.nih.gov/articles/PMC5198812/)

### 5. Acclimation should come from completed heat exposures, with decay

A 2025 Bayesian meta-regression spanning 211 papers found that the number and duration of heat exposures, ambient temperature, vapor pressure, and protocol all influenced adaptation. A separate meta-analysis estimated that heart-rate and core-temperature adaptations decay by roughly 2.3–2.6% per day without exposure, while reacclimation is substantially faster than initial acclimation.

Product decision:

- Stop presenting recent ambient weather as if it proves acclimation.
- Keep the ambient estimate only as a low-confidence prior.
- Begin recording the predicted heat dose attached to completed-session feedback.
- Build a session-informed acclimation score with explicit decay once enough completed sessions exist.
- Display the provenance: "weather estimate" or "session informed."

Key evidence:

- Corbett et al. (2025), [Heat acclimation adaptations and protocol moderators: Bayesian meta-regression](https://pubmed.ncbi.nlm.nih.gov/40442924/)
- Daanen et al. (2018), [Decay and re-induction of heat acclimation](https://pubmed.ncbi.nlm.nih.gov/29129022/)
- Tyler et al. (2016), [Heat adaptation for human performance: meta-analysis](https://pubmed.ncbi.nlm.nih.gov/27106556/)

### 6. Ability, duration, and body geometry affect the observed slowdown

Large race datasets consistently show nonlinear degradation as heat stress rises. Slower runners often lose a greater percentage of performance because they remain exposed longer, while faster runners can create more metabolic heat per unit time. Body mass and surface area also influence storage and dissipation. These mechanisms should not be collapsed into a single fitness multiplier.

Product decision:

- Retain a separate duration/exposure term.
- Continue using baseline performance to personalize likely slowdown, while separating it conceptually from thermal load.
- Do not infer body shape, age, or sex from pace.
- Prefer the user's observed responses over demographic coefficients when enough feedback exists.

Key evidence:

- El Helou et al. (2012), [Impact of environmental parameters on marathon running performance](https://pubmed.ncbi.nlm.nih.gov/22649525/)
- Ely et al. (2007), [Impact of weather on marathon-running performance](https://pubmed.ncbi.nlm.nih.gov/17473775/)
- Mantzios et al. (2022), [Effects of weather parameters on endurance-running performance](https://pubmed.ncbi.nlm.nih.gov/34652333/)
- Dennis and Noakes (1999), [Advantages of a smaller body mass in distance running in warm conditions](https://pubmed.ncbi.nlm.nih.gov/10048634/)

### 7. The product must communicate uncertainty and cannot certify safety

Heat illness risk depends on forecast conditions plus hydration, illness, sleep, medication, clothing, acclimation, pacing, access to cooling, and other factors that EffortCast does not measure. A weather forecast can identify hazards; it cannot confirm that an individual will finish safely.

Product decision:

- Remove "safe," "confirmed," and similarly absolute language from result cards.
- Use "no major forecast hazard identified" or "forecast caution" and list the relevant driver.
- Round race projections to honest ranges rather than displaying second-level precision.
- Add a short limitation beside high-risk guidance, with emergency symptoms and local-event rules remaining authoritative.

Key evidence:

- Casa et al. (2015), [National Athletic Trainers' Association position statement: exertional heat illnesses](https://pmc.ncbi.nlm.nih.gov/articles/PMC4639891/)
- Périard et al. (2024), [Exercise-induced hyperthermia and heat illness](https://pmc.ncbi.nlm.nih.gov/articles/PMC11438465/)

## Model 0.5 implementation boundary

This round will implement:

- metabolic intensity inside the thermal-load calculation;
- a physically sensible smooth limit between air-side evaporation and sweat capacity;
- clearer vapor-pressure, solar-load, and uncertainty graphics;
- completed-session heat-dose capture for future session-informed acclimation;
- conservative forecast-hazard language and rounded race estimates;
- explicit separation of calibration, validation, and product limitations.

This round will not yet claim:

- individualized core-temperature prediction;
- medical or event-cancellation authority;
- validated cycling airflow or clothing corrections;
- independent clinical validation;
- reliable demographic corrections without body geometry and observed-response data.

## Validation plan

The existing Davis race table remains a regression/calibration fixture so releases do not drift silently. It is not an independent test set. Model 0.5 should add:

1. unit tests for monotonic heat, vapor-pressure, solar, and intensity responses;
2. tests that smooth limiting capacity never exceeds either physical limit;
3. session-dose and acclimation-decay tests;
4. scenario tests for hot-dry, warm-humid, direct-sun, and low-wind conditions;
5. a versioned holdout dataset when real opted-in workout outcomes become available.

## Product principle

EffortCast's defensible advantage should be the closed loop between a transparent heat-balance model, local forecast geometry, a specific workout, and the athlete's own completed-session response. The proprietary value is not a secret weather index; it is a continuously calibrated decision system whose inputs and uncertainty can be inspected.
