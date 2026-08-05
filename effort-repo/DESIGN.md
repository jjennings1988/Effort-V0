# UI, flow and design review

Written August 2026 against the v0.4 build, from a screenshot of the installed
PWA on iPhone. Items marked ✅ are already implemented.

---

## The one-line version

EffortCast looks like an award-winning print object and behaves like a brochure.
The visual identity is genuinely distinctive — which is rare and worth
protecting — but the *layout logic* was inherited from a poster, and a poster's
job is to be admired once. An app's job is to answer a question in three seconds
and be reopened tomorrow.

Everything below is about keeping the identity while changing the job.

---

## 1. The bug in the screenshot ✅ fixed

The masthead was rendering *underneath* the iOS status bar — "EFFORTCAST." and
the 1:22 clock were occupying the same pixels.

Two causes, both fixed:

**Cause A — no safe-area insets.** The page set `viewport-fit=cover`, which tells
iOS to extend content edge to edge behind the notch, Dynamic Island and home
indicator. That is only safe if you then pay the insets back:

```css
--safe-top: env(safe-area-inset-top, 0px);
.app-shell{ padding-top: calc(var(--safe-top) + 6px); }
```

Nothing in the stylesheet referenced `env()` at all, and `.app-shell` had
`padding: 0 … 60px` — literally zero top padding.

**Cause B — the wrong status bar style.** The app declared
`apple-mobile-web-app-status-bar-style: black-translucent`. "Translucent" means
*the page draws under the bar*, and iOS renders the clock and battery in **white**
to sit over a dark app. On a `#f3f0e7` cream background that's white-on-cream —
invisible. Changed to `default`, which reserves the space and keeps the clock
dark. `viewport-fit=cover` stays, because it still matters for landscape notch
insets.

The fixed bottom nav pays `--safe-bottom` so it clears the home indicator, and
`.app-shell` reserves scroll room so the last section is never trapped under it.

There is now a test that fails if `black-translucent` comes back or if
`.app-shell` stops consuming the top inset.

---

## 2. The flow problem: the answer was two screens down ✅ fixed

Measured from the screenshot, on a standard iPhone viewport the athlete had to
scroll past roughly **1,900px** — about two full screens — before reaching the
training window. Above it sat: a status bar, a masthead, a location bar, a
decorative orb, a wordmark, and a tagline.

Six of those seven things are chrome. The app's actual answer — *go at 6 AM, run
8:05–8:09* — was below all of it.

**The order was inverted.** A poster front-loads identity because you see it once
on a wall. An app front-loads the answer because you see it every morning and
already know whose app it is.

### What changed

An **answer card** now sits directly under the masthead on mobile, carrying the
training window, the adjusted pace, and three condition chips. It's the same data
as the panels below, read from the same projection — a test asserts the two can't
drift apart.

Below it, the poster becomes a masthead rather than a hero:

| Element | Before (mobile) | After |
|---|---|---|
| Orb | ~40% of the first screen | hidden — it's decoration, and it's still there on desktop |
| Wordmark | `clamp(70px, 13.5vw, 160px)` | `clamp(46px, 13vw, 72px)` |
| Location bar | permanent strip | collapsed behind the location name in the masthead |
| Window plate | in the poster grid | hidden on mobile (the answer card has it) |

**Desktop is untouched.** The two-column editorial poster, the orb, the full-size
wordmark — all still there above 840px. The identity survives; only the phone
gets the app treatment.

---

## 3. Navigation: the tabs existed but nobody would find them ✅ fixed

The three views (Today / This week / Race day) were an inline strip placed *after*
the poster and *before* the briefing — roughly 2,000px down. Two of the app's
three major features were effectively undiscoverable.

**Now a fixed bottom tab bar on mobile**, reverting to an inline strip on desktop.

Why bottom, specifically:

- **Thumb reach.** On a 6.1" phone held one-handed the top ~30% of the screen is
  a stretch. Navigation you use every session belongs in the bottom third.
- **Persistence.** Fixed nav means the athlete can see there *is* a week view
  without scrolling to discover it.
- **Convention.** Every installed app the user already has — Strava, Garmin,
  Apple Weather — puts primary navigation at the bottom. Matching that is not
  unoriginality; it's not making people learn your filing system.

Each tab carries an icon *and* a label. Icon-only navigation tests badly for
anything that isn't universally understood, and "thermal strain planner" is not
universally understood.

Tapping the already-active tab scrolls to top — a small convention people expect
and notice when it's missing.

---

## 4. Current design trends, and which ones actually apply

Trend-following for its own sake would wreck this app's best quality. Here's the
honest filter.

### Worth adopting

**Answer-first / progressive disclosure.** The dominant pattern in 2025–26 utility
apps: lead with the single decision, put the working underneath for whoever wants
it. EffortCast is unusually well-suited to this because it already computes a
clean headline answer. ✅ done.

**Bottom navigation for installed PWAs.** Now near-universal. ✅ done.

**Bold, opinionated typography.** Already ahead of the curve — the Impact-scale
display type and condensed all-caps labels are exactly where editorial-influenced
product design has been heading. Keep it.

**Explaining the model.** "Show your working" has moved from a nice-to-have to a
trust requirement, especially for anything that looks like AI. The explain panel
and MODEL.md put this app ahead of most. Keep leaning in.

**Real haptics and micro-feedback.** Cheap to add, disproportionately makes a web
app feel native. Not yet done — see below.

### Worth ignoring

**Glassmorphism / heavy blur.** Would destroy the flat print identity, and it's
already fading.

**Dark mode as default.** Genuinely optional here. The paper palette *is* the
brand. A dark mode is worth building for pre-dawn runners — a real use case for
this specific audience — but it should be a considered second theme, not a
default. See below.

**AI chat as an interface.** The app correctly uses an LLM to *write one
paragraph*, not to be a chatbot. Don't add a chat box.

**Rounded, soft, friendly everything.** The hard 2px borders and zero radius are
the identity. Leave them.

---

## 5. Remaining recommendations, ranked

### High value

**1. Add haptics and pull-to-refresh.** `navigator.vibrate(8)` on tab change and
segmented-control taps costs nothing and closes most of the remaining gap between
"website" and "app". Pull-to-refresh on the Today view is the gesture people will
try first.

**2. Build a dark theme.** Not for fashion — for the 5:30 AM user checking the
window in a dark bedroom. The palette already has `--ink` and `--paper`; a
`prefers-color-scheme` block that swaps them plus tone adjustments is maybe 40
lines. The `theme-color` meta is already split light/dark in preparation.

**3. Make the hourly ribbon's scroll obvious.** A horizontally scrolling row with
a hard edge reads as a truncated grid — people don't know to swipe. A fade mask
on the right edge, or a peeking half-cell, fixes it. (Scrollbar styling and an
end-spacer are in; the fade is not.)

**4. Reduce the workout controls from five stacked fieldsets to one row.**
Activity / intent / structure / duration / start time is five separate bordered
boxes on mobile — a lot of chrome for five choices. A single compact bar with
the current selection summarised, expanding on tap, would cut the Today view's
length by roughly a third.

### Medium

**5. Onboarding for first run.** A new user currently lands on a full app with
default paces of 8:00/7:30/7:00/6:30 that aren't theirs, and no explanation of
what "thermal strain 3.6" means. Three screens — location, your easy pace, done —
would fix the two things the model most needs.

**6. Empty and loading states.** Right now everything shows an em dash while
loading. Skeleton blocks that match the final layout read as faster even when
they aren't.

**7. Make the metric bank tappable.** Six numbers with no interaction. Tapping
"67° DEW" could switch the hourly ribbon to dew point — a natural connection
between two panels that currently ignore each other.

**8. Reconsider "PLATE 002 / ATHLETE WEATHER SYSTEM / LIVE".** It's good voice,
but it's the third piece of branding in the first 200px. On mobile it now
competes with the answer card. Consider moving it to the footer.

### Low

**9. A share card.** "6—9 AM, 8:05/mi" as a generated image is the most natural
organic growth loop this app has.

**10. Widget / Live Activity.** Out of reach for a PWA today, but the answer card
is precisely the right shape for one if this ever goes native.

---

## 6. Branding note

The tagline is now **WEATHER FOR ATHLETES.** — a category claim rather than a
description of mechanism. "Weather, translated into athletic effort" explained
*how it works*, which is the kind of thing you write when you're proud of the
engine. "Weather for athletes" says *who it's for*, which is what a tagline is
actually meant to do. The mechanism moved to a supporting line under it on
desktop and to the meta description.

One open question: **the wordmark appears twice on the first screen** — once in
the masthead, once in the poster. That's deliberate on a printed plate and
redundant in an app. Once the answer card is doing the work, the poster wordmark
may be able to shrink further or go entirely on mobile.

---

---

## 7. Postscript: why the first fix appeared not to work ✅ fixed

After shipping sections 1–3, the phone still showed the overlap, an unstyled
answer card, the orb, and a broken nav. The code was correct; the **delivery**
was not.

The service worker had two different strategies:

```js
// navigations — network-first
if (request.mode === "navigate") { fetch(...).catch(() => caches.match(...)) }
// everything else — cache-first
caches.match(request).then((cached) => cached || fetch(request))
```

So every deploy delivered **new HTML to a browser still running the old CSS and
the old JavaScript**. That is strictly worse than either strategy on its own: the
markup referenced `.answer-card` and `.view-nav`, which the cached stylesheet had
never heard of, and the cached `render.js` had no code to populate the new
elements — hence a nav of giant black blobs and a card full of em dashes.

The tell was that the tagline *had* updated. New markup, old everything else.

### Fixed

- **Network-first for HTML, CSS and JS**; cache-first only for images and fonts.
  Deploys now land on the next load with no manual cache-name bump.
- **The worker never caches itself** — a cached bad worker is a permanent one.
- **Precache entries are added individually.** `cache.addAll()` is atomic, so one
  404 silently discarded the entire offline shell.
- **An update strip** appears if a new worker installs while the app is open.
- **A build stamp in the footer**, with a test asserting the page and the worker
  agree on which build they are.

### Two robustness fixes this exposed

**`[hidden]{display:none !important}`.** The HTML `hidden` attribute is only
`display:none` from the UA stylesheet, so *any* author rule beats it —
`.locbar{display:flex}` was silently overriding it. This is a general trap worth
a global rule.

**Intrinsic fallbacks on the nav icons.** An SVG with only a `viewBox` and no
width/height defaults to 300×150 and fills black. The nav now carries
`width`/`height`/`fill` presentation attributes and an inline `display:grid`, so
a late stylesheet degrades instead of exploding. Presentation attributes lose to
CSS, so they cost nothing when the stylesheet does arrive.

---

---

## 8. The profile tab ✅ built

**Split by how often a thing changes, not by what kind of thing it is.** Sport,
intent, structure, duration and start time change every session and stay on
Today. Paces, units, body weight, training hours, route shelter and the
acclimatisation control change almost never, and moved to a fourth tab.

That single axis fixes recommendation #4 (the Today view was five stacked
fieldsets deep) without deleting anything.

**One split worth being careful about.** Acclimatisation is both a setting and a
state. The *control* — auto versus manual — moved to Profile. The *reading* —
your 14-day heat dose, the trend, the guidance — stays in This Week, because it
changes daily and it is the app's most distinctive output. Move the knob, keep
the gauge. A test asserts both halves stay where they belong.

### On age, weight and sex

Weight is in: the drag model already took `massKg` and was hardcoded to 70, so
the app was guessing a number it could simply ask for. Frontal area scales as
mass^0.6466, and a 55 kg runner genuinely differs from a 95 kg one.

Age and sex are deliberately **not** collected. There is real literature on sex
differences in sweat rate and gland density, and on thermal tolerance declining
with age — but once you control for body size, fitness and acclimation state the
residual effect on *performance decrement* is small and contested. No coefficient
could be sourced the way every other constant in MODEL.md is sourced, and
collecting data the model cannot defensibly use is worse than not asking.

Post-run reconciliation already captures individual variation, and it does it
from actual outcomes rather than a demographic prior. An athlete who consistently
reports "harder" gets a ×1.3 multiplier regardless of why. That strictly
dominates guessing from demographics.

**Units** went in instead, because °F and minutes per mile were hardcoded, which
locked out every non-US runner. The engine stays imperial internally — every
calibration constant is anchored there — and `units.js` converts at the last
moment before display. One source of truth for the physics, formatting as a
separate concern.

They are **three independent switches**, not one imperial/metric toggle. The
first version coupled them, which was wrong for a large and obvious group: a
British runner wants °C and kilograms but very often still runs in miles and
min/mile, because British road racing is run in miles. Coupling forced that
athlete into min/km just to get Celsius. Body weight in particular has nothing to
do with pace or the forecast, so tying it to either was arbitrary.

Defaults are read from device locale: US/Liberia/Myanmar get °F, miles and
pounds; the UK and Ireland get °C, **miles** and kilograms; everywhere else is
fully metric. The v6 single-string setting migrates so nobody loses their choice,
and a test asserts the UK combination is reachable.

## 9. First-run setup, not a first-run tour ✅ built

A modal that explains features is the weakest onboarding there is. The actual
problem on first launch was that the app produced a *wrong answer*: default paces
of 8:00/7:30/7:00/6:30 belong to nobody, so the adjusted pace was fiction.

Three questions — units, easy pace, training hours — and the first screen is
correct. The other three paces are derived from the easy pace using conventional
offsets, so the athlete answers one question instead of four. Everything is
skippable, and nothing is asked that the model does not use.

**Updates get no modal.** Interrupting someone who opened the app at 5am to check
whether they should run, in order to announce a feature, is hostile. Release
notes appear inline in Profile and dismiss permanently. The one reserved
exception is a model recalibration — that changes their numbers, so it is
substantive rather than promotional, and `RELEASE_NOTES` carries a
`recalibration` flag for it.

## Test coverage for this work

| Test | Guards |
|---|---|
| `safe-area insets are applied, not just declared` | `.app-shell` consumes `--safe-top`, `.view-nav` consumes `--safe-bottom`, scroll room is reserved |
| `the status bar style suits a light background` | `black-translucent` can't come back |
| `the answer card repeats the window and pace above the fold` | the card exists, is populated, and agrees with the detail panels |
| `the bottom nav is a real nav with three reachable tabs` | correct roles, one active tab, labels present, nav sits outside `.app-shell` so it can be fixed |
| `the location controls hide behind the masthead until asked for` | drawer starts closed, toggles, correct ARIA |
| `branding reads WEATHER FOR ATHLETES` | tagline and meta description stay in sync |
| `the service worker does not serve code cache-first` | the exact strategy mismatch that stranded users on old CSS/JS |
| `the service worker never caches itself` | a cached bad worker can't become permanent |
| `precaching one bad URL cannot wipe the whole offline shell` | `addAll` atomicity |
| `the build stamp is present and matches the worker version` | the page and the worker can't disagree about which build they are |
| `hidden elements stay hidden no matter what display rules exist` | the `[hidden]` override |
| `the bottom nav survives a stylesheet that has not loaded yet` | icon size/fill fallbacks, layout fallback |
| `the profile tab collects the set-once inputs in one place` | the frequency split, including that the heat *gauge* stayed in This Week |
| `the science section is present and substantive` | three paragraphs, and that it cites the model's real anchor numbers |
| `each unit toggle converts its own numbers and nothing else` | the three settings are genuinely independent |
| `the UK combination is reachable: °C with miles and kilograms` | the case that motivated the split |
| `a v6 single-string units setting migrates to the three fields` | nobody loses their existing choice |
| `the current build always has a release note to show` | bumping `data-build` can't silently orphan the note |
| `pace entry is interpreted in whatever unit is on screen` | 5:00/km stores as ~8:03/mi |
| `body mass reaches the drag model` | the input actually reaches `modelOpts()` |
| `first run shows setup, and it collects rather than lectures` | three steps, each asking for a model input |
| `completing setup derives all four paces from one answer` | one question, four baselines, correctly ordered |
| `release notes appear once, inline, and never as an interstitial` | dismissal persists; the note lives in Profile |
