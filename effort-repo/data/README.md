# Race-data workspace

This directory holds the reproducible calibration-data pipeline for EffortCast.

## Quick start

```powershell
python -m pip install -r requirements-data.txt
python tools/fetch-race-data.py
python tools/ingest-race-data.py
python tools/enrich-marathon-weather.py --dry-run
```

`data/sources.json` pins source versions, download URLs, checksums, licenses, and rights-review status. The downloader refuses a mismatched checksum.

## Privacy and Git boundary

`data/raw/` and `data/normalized/` are ignored by Git. The downloaded 2023 marathon file contains runner names, but the ingestion script never copies or hashes those names. Normalized results use source-row identifiers that cannot be used to recover identity.

Small aggregate reports in `data/reports/` are safe to version. They contain cohort counts and summary statistics, not personal records.

## Outputs

- `data/normalized/marathon_races.csv`: one row per 2023 marathon edition.
- `data/normalized/marathon_results.csv`: anonymized, validated individual results.
- `data/normalized/endurance_weather_events.csv`: one row per weather-linked event.
- `data/normalized/endurance_weather_performances.csv`: ranked performances in long form with slowdown versus the standing record.
- `data/reports/ingestion-summary.json`: counts, validation results, checksums, and coverage.
- `data/reports/weather-benchmark-summary.csv`: aggregated environment/performance coverage by distance and sex.
- `data/reports/marathon-weather-join-queue.csv`: the 641 race editions awaiting reviewed coordinates and start times.
- `data/reports/marathon-finisher-mismatches.csv`: source-count discrepancies requiring review.

## Weather enrichment workflow

`marathon-weather-join-queue.csv` is deliberately review-gated. Add verified latitude, longitude, IANA timezone, local start time, and the official source URL; then change `review_status` to `approved`. Re-running ingestion preserves these reviewed fields.

Run `python tools/enrich-marathon-weather.py --dry-run` to validate the queue. Running it without `--dry-run` downloads only approved rows and produces `data/normalized/marathon_weather.csv`. Each race is summarized at the start and across the median finisher's exposure window, which is substantially more useful than a single daily high temperature.

The tool uses consistent ERA5-Seamless hourly reanalysis through Open-Meteo and caches responses under ignored `data/raw/weather-cache/`. Its public endpoint is suitable for evaluation and prototyping but explicitly excludes commercial use; production must use an appropriately licensed endpoint or a direct reanalysis pipeline. Weather data and derived outputs require attribution.

## Modeling boundary

The 429,000 marathon finishers are nested within 641 races. Weather sample size is therefore the number of race editions, not the number of athletes. Models must group by race edition and hold out entire events or years. Because the source provides race names and dates but no coordinates or start times, all editions begin in the reviewed weather-join queue rather than receiving guessed conditions.

The Figshare workbook is a calibration audit, not independent validation: the current model's published heat anchors were derived from the associated Mantzios study. The 2023 marathon cohort can become a genuine later-period holdout after its race locations, start times, and weather joins are reviewed.

The Kaggle compilation is useful for internal R&D, but the source manifest keeps it marked `rights-review-required` because the publisher assembled results from third-party sites. The Figshare weather benchmark is explicitly CC BY 4.0 and should carry its DOI attribution in every derived release.
