# Race briefings — build 2026.09.10-1

Implemented the first release from the September 10 product strategy: accurate race inputs and a shareable weather briefing. Public event pages, accounts, alerts and activity-platform integrations remain separate releases.

## Experience

- Search for the race city/town or explicitly use the training location. The selected venue carries its own IANA timezone. Enter the local wave start to the minute, event date, distance and goal.
- Race conditions load independently of the training forecast. Venue elevation feeds the race calculation; athlete settings still personalize the estimate.
- Read temperature, dew point and wind at the start, midpoint and estimated finish. The finish band is clearly a personal model range, with equal rounded endpoints collapsed.
- Open **Share race briefing** to preview a feed (1080 × 1350) or story (1080 × 1920) image. Save PNG, use native file sharing when supported, copy an editable caption, or save SVG for editing.
- Personal goal and estimated finish numbers are off by default. The preview explains that the weather timeline still depends on estimated duration. No coordinates or full athlete profile enter the export.
- Every card preserves its forecast timestamp, attribution, and sample-data status. Weather-driven copy gives storms, poor air quality and rain precedence over playful headlines. Missing air-quality coverage is disclosed.
- Brief modal/preview entrances honor reduced motion. The native modal contains keyboard focus, supports Escape, and restores focus to the opener. Mobile controls remain reachable by scrolling.

## Engineering

The profile schema moves from version 8 to 9. Existing races retain their name, date, distance and goal; missing venue/start fields require confirmation before projection or export. Invalid dates, coordinates and timezones are rejected.

`race-model.js` holds pure date/time, coverage and presentation rules. Venue-local wall times resolve to UTC independently of the device timezone, including fractional UTC offsets. Repeated/nonexistent DST start times are rejected with an explanation rather than silently shifted.

`race-weather.js` fetches a separate Open-Meteo forecast using Unix timestamps, as documented in the [forecast API](https://open-meteo.com/en/docs). Geocoding supplies the location timezone through the [geocoding API](https://open-meteo.com/en/docs/geocoding-api). Missing required weather values stay missing; incomplete hourly coverage or a projected finish beyond the available data prevents sharing. Responses from obsolete requests cannot overwrite a removed or changed race. Forecasts refresh after 15 minutes on the next render/share attempt and support explicit retry.

`race-share.js` produces one self-contained SVG for both the preview and PNG source. Canvas rasterizes it locally. No new dependency, remote font, image service, AI call or publishing endpoint was added. User-entered text is escaped. Snapshot content remains independent of later profile changes.

New modules are included in the service-worker shell. Build stamps, in-app release notes and the README are updated. The physiological engine and calibration coefficients are unchanged.

## Validation

- Full suite: **137 tests passed**, including 11 new race/model/export tests and four new UI lifecycle tests. After the final copy/export refinements, the 66 race and DOM tests were rerun successfully.
- Existing model validation passed all **875** temperature/dew-point combinations, with unchanged calibration results.
- Browser checks covered a sample race at 07:30, live Boston geocoding and venue forecast, personal-detail toggles, feed/story previews, image export, modal focus containment and Escape/focus restoration.
- Downloaded PNGs verified as **1080 × 1350** and **1080 × 1920**; the feed file and both previews were inspected visually. Both export sizes also have SVG structure tests. Caption copying was verified through the browser clipboard.
- Responsive browser review at **390 × 844**, **768 × 1024**, and **1280 × 900** found no horizontal overflow in the inspected race/sharing flows. Mobile modal sizing and background scrolling were refined after review.
- Browser console had no errors in the inspected release flow. Git whitespace validation passed. The repository has no separate TypeScript/lint configuration.

Native share-sheet delivery to an external app was not exercised. Dark-mode contrast and reduced-motion rules were reviewed in code; this was not a full real-device or screen-reader audit. Weather availability remains dependent on the provider. Location search selects a city/town forecast, not street-level course exposure. Public links, automatic notifications, historical workout receipts, and Strava writeback are not part of this build.
