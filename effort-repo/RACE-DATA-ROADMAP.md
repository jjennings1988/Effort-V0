# EffortCast race-data roadmap — August 2026

## The opportunity

EffortCast can build a defensible empirical layer from large race-result cohorts joined to conditions over each event. The target should not be a lookup table saying that a hot race was slow. The useful target is the **weather-attributable residual**: how much a performance moved away from its expected course-, cohort-, ability-, and era-adjusted result as heat, vapor pressure, solar load, wind, air quality, and exposure time changed.

That residual can calibrate the physical heat-balance engine without replacing it. The physical model gives sensible behavior in combinations the race archive has rarely observed; the empirical layer corrects its magnitude and interaction shapes; the athlete's completed sessions personalize the final estimate.

## What is already proprietary in model 0.5

- Vapor pressure and dew point drive evaporative restriction instead of relative humidity acting as a generic penalty.
- Metabolic heat from sport and workout intensity sits inside the thermal balance.
- Cooling demand is compared with a smooth estimate of available evaporative capacity.
- Solar load, wind exposure, duration, terrain, altitude, air quality, and athlete size are modeled as distinct mechanisms.
- Heat adaptation can become session-informed and decays between exposures.
- The engine exposes counterfactuals, allowing the product to say which controllable change would matter most.
- Personal response bias only activates after enough useful completed-session evidence exists.

The next moat is a versioned calibration asset and evaluation system, not a more mysterious index.

## Candidate result sources

### 1. Start here: Mantzios–Ioannou–Flouris research dataset

The [Figshare dataset](https://figshare.com/articles/dataset/Effects_of_weather_parameters_on_endurance_running_performance/14753565/1) behind the 1,258-race endurance-weather study includes temperature, humidity, wind, solar-load methodology, and multiple running distances. It is only about 697 KB and is explicitly licensed CC BY 4.0.

Use: immediate calibration audit for population-level response surfaces. It is strongest for peak performance and race-level comparisons, not individual recreational-runner prediction. It is not independent validation because model 0.5's published heat anchors were derived from the associated Mantzios study.

### 2. Large marathon cohort for R&D

[Marathon Data 2000–2019 on Zenodo](https://zenodo.org/records/6959864) contains a 353.7 MB result file spanning ten marathons. The visible Zenodo record does not currently state a license, so it should not enter a commercial training asset until reuse rights are clarified with the authors.

Use: schema, cleaning, normalization, and sensitivity-analysis prototype after rights review.

### 3. Licensed production pipeline

[RunSignup's official API](https://runsignup.com/API/race/%3Arace_id/results/get-results) provides paginated event results and supports registered API callers, OAuth, and public result sets.

Use: negotiate a partner/data agreement, ingest permitted public result sets, and retain source-level provenance. This is a much safer production path than scraping race websites.

### 4. Anonymized weather-aware development set

The [National Running Club Database](https://github.com/National-Running-Club-Database/national_running_club_database_public_dataset) contains 128,963 anonymized results, 1,336 meets, athlete linkage, course information, and partial weather/elevation coverage through May 2026. Its maintainers label it for research and analysis, so commercial use should be confirmed first.

Use: repeated-athlete methods, course normalization, cross-country robustness, and pipeline tests.

### 5. Official race archives

The B.A.A., NYRR, Berlin, Chicago, London, and other organizers have deep official archives. Availability is not the same as permission: for example, B.A.A. historical-result materials warn against publishing or reposting without permission.

Use: pursue direct organizer licenses or research collaborations. Do not build the product moat on unapproved scraping.

## Weather sources

- [NOAA Integrated Surface Database](https://www.ncei.noaa.gov/products/land-based-station/integrated-surface-database): quality-controlled hourly observations from more than 20,000 stations. Prefer this for observed race-day conditions when a representative station is available.
- [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api): consistent ERA5/ERA5-Land reanalysis from 1940/1950 onward for global gap filling and multi-decade work.
- [Open-Meteo Historical Forecast API](https://open-meteo.com/en/docs/historical-forecast-api): operational-model history for recent years. This is especially useful for measuring what the athlete could actually have known before a race, rather than only the eventual observed weather.

Store source, station/grid distance, elevation difference, temporal resolution, and uncertainty with every joined condition.

## Correct modeling design

### Unit of analysis

Create one race-edition record plus anonymized athlete-result records. Preserve course, start wave, gun/chip time, splits when licensed, age band, performance band, sex category where supplied, DNF/DNS counts, and result provenance. Do not retain names or other unnecessary personal data.

### Exposure features

Integrate conditions across the likely time each performance group was on course instead of attaching one noon temperature to everyone:

- air temperature and dew point/vapor pressure;
- estimated wet-bulb and globe/radiant load;
- solar elevation, cloud cover, shade proxy, and shortwave radiation;
- apparent head/cross/tailwind using course bearings where available;
- precipitation, air quality, altitude, elevation gain, and exposure duration;
- rate of change, maximum stress, and cumulative stress dose.

### Outcome

Estimate an expected performance before weather using course, era, field composition, athlete ability/repeated history, and pacing information. Train on the residual from that expectation. For fields without athlete history, use within-race performance quantiles and robust course-year baselines.

### Model family

Use a hierarchical generalized additive or Bayesian model first. It can express nonlinear heat curves and interactions while retaining race/course random effects and useful uncertainty. A monotonic gradient-boosted challenger can test lift, but it should not be allowed to learn implausible shapes from confounded archives.

### Validation

- Hold out entire races and entire years, not random finishers from the same race.
- Keep the CC BY 1,258-race dataset as a versioned calibration audit, and reserve later race years and unrelated sources for external validation.
- Report calibration error by distance, ability band, sex category, duration, climate, and extreme-condition scarcity.
- Compare against air temperature, dew point, and WBGT-only baselines.
- Never call the same race archive both calibration and independent validation.

## Recommended sequence

1. Build a small reproducible benchmark from the CC BY 1,258-race dataset and NOAA observations.
2. Define the normalized result and weather-exposure schemas, provenance rules, and license ledger.
3. Run model 0.5 blind against that benchmark before fitting anything.
4. Fit an empirical residual correction with race/year holdouts and publish its lift over simpler baselines.
5. Negotiate a RunSignup or organizer feed before scaling individual-result ingestion.
6. Add opt-in EffortCast workout outcomes as the highest-value calibration stream: forecast, prescribed pace, observed effort, actual pace, and completed-session heat dose.

The long-term proprietary system is therefore:

**physical heat balance + licensed race residuals + course/weather geometry + personal completed-session response + versioned holdout evaluation.**

That combination is substantially harder to copy—and easier to defend scientifically—than a single secret weather coefficient.
