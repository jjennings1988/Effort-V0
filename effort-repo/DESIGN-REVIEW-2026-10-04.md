# EffortCast design review — October 4, 2026

An evidence-based review of the whole app as it stands after the dial, fitness anchor, pace board and Plan tab work. Every finding below comes from captured screens or a measurement, not impression. Fixes are ranked by **impact on the athlete** against **effort**.

**Method.** Headless Chrome, driven over the DevTools protocol:
- **Devices:** phone 390×844 (touch), tablet 768×1024, desktop 1440×900.
- **Themes:** light and dark.
- **States:** first-run setup, a blocked forecast (error), demo with no data, demo with three logged results and a pinned race, the share dialog, and reduced motion.
- **Measurements:** cold-load timing (with and without a simulated slow-4G phone at 4× slower CPU), render cost per interaction, DOM and heading structure, tab stops, live regions, a text-size census, a color-vision-deficiency simulation (Machado 2009) of the rating palette, and a CSS architecture census.
- **Not covered:** real devices, VoiceOver/TalkBack, and real users. Those should follow before any award submission.

---

## Verdict

**What's working.**
- **A rare, ownable identity.** Paper, ink and lime, the Anton display face, monospace instrument labels, and the dial as a signature image.
- **Correct, distinctive substance.** Heat-balance pacing, weather-corrected fitness, and paces by rep length.
- **A sound structure.** Today answers "what do I run?", Plan tunes one session, Week, Race and You each have a clear job.
- **Accessibility basics are in.** Contrast passes WCAG AA in light and dark, reduced motion is fully honored, every control has an accessible name, and keyboard paths exist for the dial, curve, heatmap and tabs.

**What's holding it back from award level.**
1. **The core rating colors fail color-blind athletes.** That's 1 in 12 men, and the colors carry most of the meaning.
2. **Ceremony costs time.** Every launch waits about 3 seconds for an intro after the data is already on screen, and the "sorting the day" story plays twice per visit.
3. **Today contradicts itself.** Two different "easy pace" numbers sit on the same screen, and Today is about 6.4 phone screens long.
4. **Microtype.** 67% of text on Today is under 12px, much of it uppercase monospace, in an app read outdoors and mid-run.
5. **Desktop wastes its first screen** on the brand poster and doesn't use the extra width.

### Scorecard

| Area | Grade | Headline |
|---|---|---|
| Visual identity | A | Distinctive, coherent, memorable |
| Information architecture | B | Right tabs; Today too long, numbers duplicated |
| Data visualization | B− | Strong forms; palette fails CVD, color-only encodings |
| Motion | B | Beautiful, but ceremonial on repeat visits |
| Typography & legibility | C+ | One system now, but microtype dominates |
| Accessibility | B− | Contrast/motion/names pass; no h1, chatty live regions, color-only meaning |
| States (empty/error/offline) | C | Error shows empty chrome; no last-known forecast |
| Performance | B | Fast on desktop; ~6 s to usable on a slow phone; render cost per interaction |
| Content & copy | B− | Great microcopy voice; jargon-dense for recreational runners |
| Design-system health | C | 31 font sizes, 145 hard-coded colors, layered overrides |

---

## Findings, ranked

### 1. The rating palette is hue-only and collapses for color-blind athletes · Critical · Effort M
**Evidence.**
- All seven rating colors sit at nearly the same lightness, L\* 36–46.
- Simulated deuteranopia (the most common form, about 6% of men): Adjust and Caution differ by **ΔE 0.6**, which is indistinguishable. Caution, High and Avoid differ by ΔE ~7.6.
- Protanopia: Adjust vs. Caution is ΔE 4.3.
- In the simulated heatmap, Ideal, Good, Adjust and Caution become one olive-brown field, and the legend swatches look identical.
- Even with normal vision, Ideal vs. Good is only ΔE 13. That's why the heatmap reads as "mostly green".

**Why it matters.** The dial, heatmap, workout and split tapes, hour cells, curve segments and board chips all encode meaning mainly through these colors. In the heatmap and tapes, color is the only encoding.

**Recommendation.**
- **A lightness-ordered ramp.** Make the scale monotonic in lightness and keep the brand: Ideal = pale lime (L\*≈90), Good = light olive (≈78), Adjust = amber (≈66), Caution = orange (≈55), High = coral-red (≈45), Avoid = deep maroon (≈30). Storm stays as the categorical purple, which already survives CVD. Ordered lightness works for every type of color blindness and in grayscale.
- **Redundant encoding:**
  - The heatmap shows each cell's score on hover/focus (already) and a small rank glyph on cells within 5 points of the day's best.
  - Tape cells keep their numbers, and the hollow ease-off cells already help.
- **Pin it with tests.** Add a test that computes pairwise ΔE under the deuteranopia and protanopia matrices and fails below 15 for neighboring ratings.

### 2. Ceremony delays every launch by about 3 seconds · High · Effort S
**Evidence.**
- Desktop: the board renders at **0.12s**, but the intro releases the page at **3.0s**.
- Slow-4G phone at 4× slower CPU: content at **3.3s**, usable at **6.1s**.
- The mini dial sorts during the intro (1.5s), then the full dial sorts again when Today scrolls to it (2.5s), with the five-step "FETCH → LOCK" strip each time.

**Why it matters.** The habit use case is a 5 a.m. glance. Ceremony delights once and taxes every launch after that.

**Recommendation.**
- **Play the full opening once per day**, or once per forecast refresh. Later launches get a ≤400ms settle: the dial appears sorted and the lime best-window arc sweeps in.
- **One sort story per visit.** The intro docks into Today's dial, the mini dial is removed, and Today's dial appears already sorted.
- **Step strip only when it's working.** Show it on first run and during refresh; afterwards collapse it to a one-line "Locked · 154 starts scored · 2 min ago".

### 3. Today shows two different "easy pace" numbers · High · Effort S
**Evidence.** Phone, same screen:
- The answer card says **9:10–9:15 /mi** (Easy, 60 min, the midpoint pace plus model uncertainty).
- The board's Easy card says **8:50–9:33** (the 45-min easy band).
- On desktop at another hour, the card read **9:04–9:04 /mi**, a collapsed range printed twice. The same happens on Plan's "Weather adjustment".

**Recommendation.**
- **One source of truth.** The answer card mirrors the selected board zone exactly: same band, duration and label ("EASY · 45 MIN · 8:50–9:33 /mi").
- **Collapse equal bounds** everywhere ("9:04 /mi"), as the race finish band already does.
- **Show the alternative inline**, e.g. "At 8 PM: 8:44–9:20 (−8 s)", so the best window becomes a decision rather than a separate fact.

### 4. Microtype dominates · High · Effort M
**Evidence.**
- Phone Today: **160 of 239** visible text elements (67%) are under 12px, and **141 (59%)** are under 11px.
- Plan: 165 of 240 under 12px.
- Long uppercase monospace sentences, such as the tape explainer and the dial footnotes, are set at 9–10px.
- The stylesheet has 31 distinct font sizes.

**Why it matters.** It's read outdoors, in glare, often moving or sweaty. Apple's HIG floor is 11pt, and uppercase monospace sentences read noticeably slower than sentence case.

**Recommendation.**
- **A 7-step type scale:** 11 / 12 / 14 / 16 / 20 / 28 / 44 (+ display). Use 12 as the floor for anything actionable or numeric and 11 only for non-essential captions.
- **Uppercase monospace for labels of four words or fewer.** Sentences and explanations go in sentence-case sans at 13–14px.
- **A larger base on phones** for the board's paces (16→18px), the hub and the callout values.

### 5. Today is 6.4 phone screens; the dial instrument's chrome belongs on Plan · High · Effort M
**Evidence.**
- Phone Today is 5,385px.
- The full dial instrument (step strip, stats bar, dial, callouts, legend, workout tape, cooling ledger, footer) is about 1.5 screens, and it pushes the pace board to the third screen.
- Two dials (mini and full) appear within one screen of each other.

**Recommendation.** Keep the dial on Today, as you asked, but as a hero:
- **On Today:** the dial face, its four callouts as a 2×2 grid, and a one-line legend.
- **Moved to Plan:** the workout tape, cooling ledger and step strip, where you tune one session.
- **One dial:** the intro docks into it.
- **Expected result:** about 3.5 phone screens, with the board starting on screen two.

### 6. Desktop spends its first screen on the brand poster · Medium-high · Effort M
**Evidence.**
- At 1440×900, roughly 40% of the first screen is "PLATE 002 / EFFORTCAST. / WEATHER FOR ATHLETES.". The dial and board sit below the fold.
- Content is a single ~1,024px column with a side dock, and the tablet at 768 uses the phone column (board cards one per row).

**Recommendation.**
- **Desktop "cockpit" (≥1100px):** dial on the left (sticky), today's paces on the right, conditions as a strip above both.
- **Brand poster on first run only**, or as a collapsible header.
- **Tablet ≥700px:** board cards three across, callouts beside the dial.

### 7. Error and offline states show empty chrome · Medium · Effort M
**Evidence.** With the forecast blocked:
- The answer card renders dashes, the six metric tiles show "—°", and the mini dial says "SIGNAL UNAVAILABLE".
- The masthead still says "LOCATING…".
- Only a dashed strip explains the problem.
- Nothing from the last successful forecast is kept.

**Recommendation.**
- **A designed error panel:** the grey unsorted cloud as the illustration, a one-sentence cause, then Retry and Use demo.
- **Hide empty instruments** instead of showing placeholders.
- **Keep the last forecast.** Store the last successful forecast and its timestamp so an offline glance still works, clearly labeled "From 2 h ago".
- **Fix the stale masthead label.**

### 8. Jargon density for a recreational audience · Medium · Effort M
**Evidence.**
- First-screen labels include "SWEAT ESCAPE 3.3 KPA", "THERMAL LOAD 4.3", "SCORE SPREAD 9–35", "VDOT 46.5", "WBGT", "LT1 / LT2".
- The September 10 strategy names recreational half and marathon runners as the first audience.

**Recommendation.**
- **Plain language first, the instrument value second:** "Sweat dries slowly · 3.3 kPa", "Cooling near capacity · load 4.3".
- **A tap-to-define glossary sheet** (one component, reused).
- **Keep the technical layer:** it's part of the brand's credibility, just secondary.

### 9. Interaction cost and load waterfall · Medium · Effort M
**Evidence.**
- Desktop render: **10.3ms** median for a full pass, and **14ms median / 20ms max** for moving the start, which is roughly 56–80ms on a 4× slower phone.
- Each render recomputes ~400 projections (24 hour cells, a 24-hour window search, 168 planner starts, 168 heatmap starts, ~14 board cells), even for hidden tabs.
- Cold load: 39 requests, 576KB, **32 separate JS modules**, and a **306ms** long task on the slow phone.

**Recommendation.**
- **Memoize hour scores** by (forecast, intensity, duration, structure, athlete options).
- **Render only the active tab**, and the others when they're shown.
- **Add `<link rel="modulepreload">`** for the critical module graph. That keeps the no-build-step rule.
- **Target:** under 8ms per interaction on desktop and under 50ms on a mid-range phone.

### 10. Screen-reader structure · Medium · Effort S
**Evidence.**
- The only `<h1>` is the brand poster, which is visible only on desktop Today. Phones and the other tabs have none.
- Today has three live regions, and the dial's status chip announces "PREVIEWING" on mouse hover.
- Several encodings are color-only (see #1).

**Recommendation.**
- **A visually hidden `<h1>` per tab** ("Today — what to run", "Plan", …).
- **One polite live region** that announces a summary when the start or workout changes ("2 PM, Easy, 8:50–9:33 per mile, cooling near capacity").
- **Quiet the chip:** remove `role=status` from the dial chip.

### 11. You tab is 8 phone screens, led by a giant release note · Medium · Effort M
**Evidence.** Phone You is 6,726px. The first screen is a lime block of 7 release-note bullets, and settings 02–08 are long, uniform blocks.

**Recommendation.**
- **Release notes as a one-line "What's new" chip** that opens a sheet. Show it once.
- **Settings as an iOS-style grouped list:** a row per setting showing its current value, opening a detail sheet.
- **Fitness anchor stays first.**

### 12. Week on phone leads with seven tall cards · Low-medium · Effort S
**Evidence.** Phone Week shows the day cards first (about two screens), then the heatmap, the denser and more useful view.

**Recommendation.** On phones, put the heatmap first and turn the day cards into a horizontal strip, or drop them since the heatmap already outlines each day's best start.

### 13. Design-system debt · Medium · Effort L (do alongside #1, #4)
**Evidence.**
- styles.css is **134KB** with 1,435 rules.
- **53 selectors are redefined three or more times** (`.plan-day` ×8, `.answer-card` ×7, `.view-nav` ×7).
- **25 `!important`s**, **145 hard-coded hex colors** outside `:root`, **31 font sizes**, and about a dozen breakpoints.

**Recommendation.**
- **Consolidate tokens:**
  - type scale (#4);
  - spacing scale (4/8/12/16/24/32/48);
  - two elevations (4px and 8px offset shadows);
  - semantic colors (surface, ink, muted, accent/selected, positive, caution, critical, storm);
  - three breakpoints (640 / 980 / 1260).
- **Fold the override layers** into one rule per component. This makes items 1, 4, 5 and 6 cheaper and keeps future work coherent.

### 14. Opportunity: share today's paces · Growth · Effort M
**Evidence.** Laktic has "Share paces". EffortCast shares race briefings but not the daily board, which is its most repeatable content.

**Recommendation.** A "Today's paces" card (feed and story) with the dial, the selected zone and the cost chips, built from the existing card pipeline and embedded Anton. This is a club-chat loop: "here's what to run at 6 tonight".

### 15. Smaller polish
- **Setup card jumps in height between steps.** Give it a fixed minimum height.
- **Masthead truncation on phones** ("DEMO FORECAST / SAM…", "FLETCHER, NC / D…"). Show the status dot only, so the location gets the space.
- **Board taps change duration and structure silently** (e.g., Long Run sets 90 min). Add a brief inline confirmation: "Today's workout: Long run · 90 min · edit in Plan".
- **Deleting a result is immediate.** Offer Undo for 5 seconds.

---

## Roadmap

**Status (build 2026.10.04-2):** Sprints 1 and 2 are done and covered by tests.
Measured on a phone afterwards:
- A repeat launch is usable when the forecast lands (0.28s on a phone with a warm cache), not 3s or more later.
- Text under 11px on Today went from 124 elements to 0.
- Today went from 5,602px to 4,832px, and the pace board now starts on screen two.
- The worst neighbouring rating pair under simulated colour blindness went from ΔE 0.6 to 18.7.
Sprint 3 is next.

| Sprint | Items | Outcome |
|---|---|---|
| **1 · Quick wins** (one session) | #2 intro once/day + single sort, #3 one pace source + range collapse, #10 h1 + one live region, #12 Week order, #11 release-note chip, #15 polish | Faster launch, consistent numbers, cleaner a11y |
| **2 · Legibility & color** | #1 lightness-ordered palette + CVD test, #4 type scale + sentence-case explainers, #5 slimmer Today dial, #7 error/offline states | Readable outdoors, works for color-blind athletes, ~3.5-screen Today |
| **3 · Platform polish** | #6 desktop cockpit + tablet grid, #9 memoization + modulepreload, #13 token consolidation, #8 plain-language layer, #14 share today's paces | Award-grade on every screen size; growth loop |

## Appendix: measurements

| Measure | Desktop | Phone (slow 4G, 4× CPU) |
|---|---|---|
| DOMContentLoaded | 120 ms | 3,332 ms |
| Board rendered | 119 ms | 3,331 ms |
| Intro releases page | 3,030 ms | 6,073 ms |
| Long tasks during load | 57 ms | 306, 82, 56 ms |
| Requests / transfer | 39 / 576 KB (32 JS modules) | same |
| Full render (median) | 10.3 ms | ≈40 ms est. |
| Move start + render (median / max) | 14 / 20 ms | ≈56 / 80 ms est. |

| Page height (px) | Phone | Tablet | Desktop |
|---|---|---|---|
| Today | 5,385 | 4,514 | 4,177 |
| Plan | 4,544 | 3,967 | 3,081 |
| Week | 2,355 | 1,837 | 1,535 |
| Race (pinned) | 2,616 | 2,209 | 1,836 |
| You (3 results) | 6,726 | 5,527 | 4,334 |

| Rating pair | ΔE normal | ΔE deuteranopia | ΔE protanopia |
|---|---|---|---|
| Ideal–Good | 13.3 | 12.2 | 12.1 |
| Good–Adjust | 40.9 | 21.3 | 12.1 |
| Adjust–Caution | 22.3 | **0.6** | **4.3** |
| Caution–High | 18.2 | **7.6** | 15.2 |
| High–Avoid | 11.9 | **7.7** | 12.3 |

ΔE is CIE76 in L\*a\*b\*. Below ~10 is hard to tell apart; below 3 is indistinguishable.
