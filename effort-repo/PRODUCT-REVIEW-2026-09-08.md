# EffortCast product review — 2026-09-08

## Product understanding

EffortCast helps runners and cyclists decide when to train and how to adjust effort for weather. Its most frequent task is choosing a start time for a specific duration and intensity; secondary tasks are arranging the week, planning a race, and learning from completed sessions. The most valuable information is the selected workout's adjusted pace, its environmental-risk context, and practical alternatives.

The app is a static, native ES-module application with plain CSS and no build step. A pure calculation engine consumes forecast data; a versioned localStorage profile holds athlete preferences, race settings and feedback. Open-Meteo supplies weather and air quality, NWS supplies alerts, and RainViewer/Leaflet supply radar. The synopsis has a local composer and optional server-side AI enhancement. There is no application database. Tests cover the engine, calibration fixtures, DOM workflows and research-data provenance.

The athletic poster typography, paper palette, weather instrument, separate effort/risk scores, unit flexibility and transparent model explanations are worth preserving.

## Priority findings and implementation

| Priority | Finding | Change |
| --- | --- | --- |
| Critical | Selecting a later-week window was clamped into the next 24 hours; programmatic view changes were not synchronized with visible panels. | Preserve the full forecast index, show the relevant day's hourly controls, and synchronize panel visibility and tab state on render. |
| High | The headline juxtaposed a recommended window with pace calculated for a different selected start. | Make the selected start explicit beside its pace on phone and desktop. Keep recommendations separately labeled. |
| High | Weekly cards required mental comparison and could describe a small pace difference as a substantial gap. | Add shared-scale weather-impact bars, precise values, current workout context, and a summary of the actual range. |
| High | Desktop intrinsic grid widths caused horizontal overflow; the oversized wordmark competed with useful information. | Constrain grid tracks, reduce desktop branding/instrument size and promote the selected-workout summary. |
| Medium | A composite planning-score line was labeled as environmental caution. | Label its score reference accurately, add numerical axis values and remove an unrelated time-based stroke gradient. |
| Medium | A desktop SVG shrank labels to unreadable sizes on phones. | Use a compact SVG coordinate system with fewer time labels, responsive at the chart breakpoint. |
| Medium | Later starts lacked clear dates and changing days defaulted to midnight. | Show dated starts, scope comparisons and alternatives to the displayed range, and use the athlete's training start hour when choosing a later day. |
| Medium | Keyboard navigation and update feedback lacked continuity. | Connect tabs to panels, add arrow/Home/End navigation with roving focus, retain hourly-button focus, and provide a recommended-start action beside the slider. |
| Medium | Rebuilding the curve replayed its entrance animation for every input. | Show changed data immediately, retain restrained hover feedback, and respect reduced motion for programmatic scrolling. |
| Medium | Storm-only and no-improvement states could retain old explanatory text. | Explicitly replace those summaries and disable the recommended-start action when no start exists. |

## Analytics boundaries

Weekly bar lengths use the existing model's impact midpoint, with a shared zero-based scale rounded upward to a multiple of five percentage points. Text reports the numeric values even when differences are too small to make prominent bars. The weekly spread is max minus min across available daily recommendations, expressed in percentage points. Rankings still incorporate daylight, training-hour preferences and hazards; the interface explicitly says so. No model coefficient, research calibration or underlying weather observation was changed.

## Validation

- 119 tests passed across engine, strain, DOM and data-artifact suites.
- The model validator passed all 875 temperature/dew-point combinations; calibration metrics remained unchanged.
- The final UI follow-up was retested against all 48 DOM tests.
- Browser inspection covered first-run setup, denied-location fallback, demo forecast, weekly selection, a later-day workout, keyboard slider interaction, the empty and populated race form, and profile settings.
- Visual review covered desktop, laptop, tablet (768px) and phone (390px). Browser measurements showed no horizontal page overflow at the inspected phone and tablet sizes.
- The phone chart was visually verified with its 420-unit viewBox and readable axis labels.
- No browser console errors were reported in the inspected demo session.
- Reduced-motion handling was covered by the existing motion test and source review; a full assistive-technology or real-device accessibility audit was not performed.
- Git whitespace validation passed. The repository has no separate lint or TypeScript configuration.

The `?demo=1` entry point provides a labeled sample forecast without requesting location access. Live radar is explicitly unavailable in this sample mode. Live weather-provider reliability and production AI-proxy behavior were not validated end to end; model/DOM tests use fixture data, and browser checks primarily used the demo.

## Deliberately deferred

1. Make the weekly workout definition editable directly in Week. Shared sport/intensity/duration controls need a deliberate navigation and ownership decision; the current context line makes the active assumptions visible.
2. Forecast confidence bands and change alerts require stored forecast snapshots or ensemble inputs. Do not infer statistical confidence from the existing model's pace range.
3. Completed-session reconciliation needs a dated session record distinct from the currently selected future forecast; this would make personalized calibration and adaptation evidence more reliable.
4. Explicit race start time, race timezone and timezone-aware calendar exports deserve a separate model/schema change and migration.
5. Saved weekly schedules and multi-workout planning need a persisted workout model and edit/undo semantics.
6. Targeted memoization or rendering only visible panels could reduce repeated calculations. Measure interaction latency before changing render scheduling.
7. Audit low-contrast legacy secondary text and onboarding focus containment across the entire app with screen readers and real mobile devices.
8. A small uncertainty range can round to identical race finish bounds (for example 50:30–50:30); a later content pass should collapse equal rounded endpoints and clarify precision consistently across pace displays.

## Motion and direct interaction follow-up — build 2026.09.08-2

The forecast curve is now an input surface: pointer movement previews the existing hourly calculation in a fixed inspector, while click/tap or arrow keys commit a start. The preview crosshair leaves the selected workout untouched; a persistent inspector avoids obscuring the curve with a floating tooltip. Touch movement preserves vertical page scrolling. Hit testing accounts for SVG letterboxing, and the chart exposes slider semantics, date/condition value text, Home/End and arrow-key controls.

A 220ms marker transition links old and new selections within the same forecast range. Data values update immediately. A 180ms directional panel transition provides continuity between Today, Week, Race and You. Both animations are disabled under reduced-motion preferences, and unchanged renders do not replay them. These features use native browser animation APIs and add no dependencies.

Validation: all 51 DOM tests passed, including preview/commit separation, letterboxed hit tests, touch handling, keyboard focus retention, motion change detection and reduced-motion suppression. Browser review confirmed direct selection, keyboard operation, mobile chart/inspector layout and view changes; the inspected browser console reported no errors. The new module is included in the offline app shell.
