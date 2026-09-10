# EffortCast: product value and organic growth strategy

September 10, 2026. Based on the current repository, the preceding browser/product audit, and primary-source platform and competitor research. Priorities below are product judgments to test; the repository currently has no adoption, retention, or sharing instrumentation that establishes demand. This brief proposes work; it does not implement the features or initiate integrations.

## The opportunity

EffortCast can own the question: **What does this weather mean for my effort?** That connects a useful decision before exercise with a meaningful story afterward.

The existing product has promising ingredients: a transparent calculation engine, workout-specific projections, separate effort and environmental-risk information, useful timing comparisons, and a distinctive athletic visual identity. Its next advance should connect these ingredients into a repeatable habit.

My initial audience hypothesis is recreational half-marathon and marathon runners with an upcoming event, especially members of clubs. Their race supplies urgency, their training supplies recurring use, and their club supplies a natural audience for sharing. Keep existing cycling functionality, but concentrate initial onboarding and growth experiments on this audience.

A good card can acquire a visitor. A useful plan that adapts to changing conditions earns the next visit. Both are necessary; an attractive export alone is easy to copy and may create downloads without sustained product use.

## The competitive implication

Personalized running-weather recommendations and event forecasts already exist in [RunnerCast](https://runnercast.app/). [Klimat](https://klimat.app/) already offers automatic weather information in training logs. These public feature descriptions establish overlap, not comparative effectiveness or market share.

EffortCast's opportunity is a coherent experience across planning, race preparation, and reflection: explain the expected impact, offer a feasible action, and make the result easy to understand and share. A funny AI caption is a distribution experiment, not a durable advantage by itself.

## Foundations that should precede public sharing

1. **Give every race its own location and start.** `public/app/race.js` currently stores name, date, distance, and goal; it projects from the selected location's `S.hours` and normally starts at 7 a.m. A traveling runner or later wave can receive an inappropriate projection. Persist venue coordinates, local start time, and IANA timezone; fetch race conditions independently of home conditions. Keep the public event distinct from each athlete's wave, duration, and goal.
2. **Make completed workouts actual records.** `public/app/feedback.js` logs `S.lastProjection` with the current timestamp. Create a dated workout record with its own location, duration, forecast snapshot, and user feedback. Fetch historical conditions for that interval when available. Label historical modeled conditions accurately; do not imply a sensor measured them on the runner's route.
3. **Separate evidence types.** Forecast weather, historical weather, athlete-reported effort, and modeled impact should remain distinguishable. A pace-adjustment range is not automatically a statistical confidence interval. The current model does not justify a claim such as “you would have run a personal best in perfect weather.”
4. **Make freshness visible.** A shared image is an immutable forecast snapshot with a creation time. Its linked event page can show the latest forecast and explain changes. Outside the forecast horizon, show when tracking begins. Seasonal context, if added later, must be clearly separated from a forecast.

## The first sharing product: a race briefing people want to forward

Start with one excellent design in feed and story formats. Build exact text and charts with SVG/canvas or HTML rendering so numbers remain deterministic and legible.

**The card hierarchy:**

- Event, date, venue, and local wave time.
- One useful headline: the dominant implication for this race window.
- A start-to-finish weather timeline, emphasizing the conditions that matter for that event.
- One practical takeaway supported by the model.
- Optional personal target and estimated adjustment, clearly identified as personal.
- Forecast timestamp, data attribution, and a restrained EffortCast signature.

Use the existing paper, lime, and coral language. Let large typography and the weather timeline carry the design. A public event card should remain useful without exposing the creator's goal or personal calibration. A recipient should apply their own start time and athlete settings before seeing a personal pace recommendation.

**The sharing flow:** Race → Share briefing → Preview → choose public/personal details → Share image or Save image → Copy event link. Use the native share sheet where file sharing is supported and keep download/copy fallbacks. An image-only export can ship locally; persistent public links and social link previews require hosted event/snapshot infrastructure.

The destination matters: a recipient should land on that exact race, see useful information without registering, and have a clear “Get my race plan” action. A generic homepage loses the context that motivated the visit. A small QR code can help when an image travels without its caption; a real link should accompany the image wherever possible.

**Motion:** a short transition from the race panel into the card preview and a start-to-finish timeline reveal can make the export feel crafted. Allow saving immediately and honor reduced motion. Test static cards first; video export adds considerable complexity before we know whether people share.

## The second sharing product: the Weather Receipt

After a completed workout, summarize the conditions the athlete experienced and the model's estimated impact. Give the user an editable, concise caption with optional attribution.

Illustrative tone, not a real workout or forecast:

> Pace: patient. Humidity: ambitious.
>
> Weather context by EffortCast.

The actual caption should include a compact factual line when verified historical conditions are available. Offer straight and playful tones. Humor can make an ordinary training day memorable, but the facts should determine which jokes fit. Avoid heat-risk trophies and fabricated “minutes earned” or equivalent-PR claims.

Start with a copyable caption and image generated from independently supplied workout details and licensed weather data. Generation can be templated; AI is optional wording assistance after the underlying facts and permissions are settled. Editing and sharing should remain the athlete's choice.

## Strava: technically possible, strategically conditional

The [Update Activity endpoint](https://developers.strava.com/docs/reference/#api-Activities-updateActivityById) supports an activity description with `activity:write` authorization. Technical capability does not establish permission for the proposed processing.

Strava's June 2026 policy restricts AI use of API data and derivatives, and separately restricts analytics. Treat automated enrichment as requiring explicit platform review; replacing AI with templates does not settle that issue. [API Policy, sections 5.3–5.4](https://www.strava.com/legal/api_policy).

Keep sharing independently useful while evaluating the exact integration. If approved, implement server-side OAuth/token handling, event processing, user preview, optional attribution, preservation of existing text, duplicate prevention, and disconnect/deletion support. Define scope, permitted processing, storage, and writeback before committing the roadmap. Do not assume importing data through an intermediary changes its permissions.

## The most valuable missing experiences

### Race Watch: a reason to return

Tell the runner when a forecast change affects the plan. This requires timestamped snapshots; the current forecast alone cannot tell us what changed. Compare the same venue, wave time, and workout assumptions between snapshots.

Show the changed conditions, the changed recommendation, and a clear explanation. Avoid turning every weather fluctuation into an alert. Give users control of thresholds, quiet hours, and delivery. Deduplicate and stabilize recommendations so small oscillations do not generate contradictory instructions.

Notifications require a backend scheduler and delivery channel. The first version can show “since your last visit” changes within the app. Do not label a stable forecast as certain without evidence about forecast reliability.

### A weekly plan that respects real life

Extend the existing daily rankings with availability and distinct workout types. A runner might have only Tuesday evening for intervals and Saturday morning for a long run. Ranking midnight as better has no value if they cannot run then.

Start with manual planned sessions, available windows, and save/edit/undo. Explain suggested moves within those constraints. This gives EffortCast a weekly job even after race day passes.

### Club briefings: sharing that coordinates an action

A captain creates a public session with location, time, and duration. Members receive one clear briefing and can personalize their own plan. Shared event information should use public weather and organizer-supplied details, without disclosing individual athlete profiles.

This has a stronger collaborative reason to spread than a watermark alone. Initially, create and test briefings with a few clubs. A social feed, follower system, and chat are unnecessary to validate it.

### Explain the counterfactual

Use the existing model to answer “What changes if I start earlier?” Present the original and alternative workout under the same assumptions, with their estimated impact and any safety constraints. Show a near tie honestly.

Later, compare practical route options for wind or shade only after adding route geometry and appropriate environmental data. Current point forecasts cannot support confident street-level exposure claims.

### Learn the athlete carefully

Properly linked workout outcomes can reveal whether recommendations systematically feel too easy or too hard. Begin with transparent summaries and minimum-sample rules. Distinguish correlation from attribution: fatigue, terrain, training load, and pacing also affect performance. Current feedback provides a starting point, not a proven individual physiological model.

## Suggested implementation order

These are relative estimates, not delivery promises.

| Order | Release | Main value | Effort / risk |
| --- | --- | --- | --- |
| 1 | Race location, wave time, timezone, and honest labels | Trust prerequisite | Medium / medium |
| 2 | Race briefing image export and editable caption | Fastest sharing experiment | Medium / low |
| 3 | Public event links, saved snapshots, social previews | Converts sharing into activation | Medium–high / medium |
| 4 | Race Watch changes and optional alerts | Repeat use during race preparation | High / medium |
| 5 | Dated completed workouts and Weather Receipts | Post-run value and recurring sharing | Medium–high / medium |
| 6 | Weekly availability and club session briefings | Habit beyond one event; group distribution | High / medium |
| Separate feasibility track | Approved activity-platform enrichment | Lower friction after workouts | High / high external dependency |

Avoid building every release before testing. Ship the race card once the race inputs are sound, and let observed behavior determine whether the next investment is public links, alerts, or post-run recaps.

## Validate the growth mechanism

Recruit a small initial group across a few running clubs and upcoming races. Watch people create a plan, preview a card, decide whether to share, and react to receiving one. Suggested sample sizes and success thresholds should be experiment choices, not asserted industry benchmarks.

Instrument a minimal first-party funnel: eligible race briefing viewed → export/share invoked → attributed event-link opened → recipient creates a plan → recipient returns. An opened native share sheet or saved image is not proof of publication. Use opaque attribution IDs; avoid embedding goals, precise private locations, or health-profile fields in analytics and share URLs.

Measure both sides:

- **Value:** time to a useful recommendation, saved plans, reported decisions influenced, and repeat use across training weeks.
- **Distribution:** unique recipients who create their own plan per sharing athlete, followed by those recipients' return rate.
- **Trust:** wrong-location reports, misunderstood estimates, stale-card confusion, unwanted edits, and notification disable rates.

If exports rise but recipients do not activate, improve the destination and relevance before adding card styles. If recipients activate but do not return, improve planning and Race Watch. If people use the product repeatedly but do not share, test club coordination and the story on the card rather than adding more prompts.

## Business model and deliberate exclusions

Keep useful public briefings and basic sharing free during validation. Test willingness to pay for ongoing service: multiple watched races, useful change alerts, richer planning, and personal history. Compare a race-season purchase with a subscription through actual customer conversations and behavior; no evidence currently supports a particular price.

Weather-provider licensing, snapshot storage, notification delivery, integration requirements, and rendering costs belong in the unit economics before promising unlimited features.

Defer a full coaching platform, fitness social network, generic chatbot, elaborate animated exports, and outcome claims beyond the model's evidence. A defensible product will come from repeated usefulness, trustworthy personal history, and trusted club/event distribution. More charts and more AI do not establish those advantages on their own.

**Recommended next release:** accurate race inputs plus a beautiful, useful race briefing export. That makes the user's sharing idea concrete while building on the app's strongest existing capabilities.
