# Frontend — per-component detail

> Reference detail, loaded on demand. Rules that PREVENT a mistake live in `CLAUDE.md`;
> this file DESCRIBES how the system works. Reachable from CLAUDE.md's routing table.

## Header (App.tsx)
Single compact row inside one sticky `<header>` (`.hra-header` → `.hra-header-inner` →
`.hra-header-row`): brand + status dot + nav pills. `.hra-header-inner` shares `<main>`'s own
maxWidth/padding (860px, 24px) so the nav pills land in the same columns as the content below — the
header bar itself stays full-bleed (background/blur/border), only its content is column-aligned.

`DateRangeBar` is **not** in the header — it renders in `<main>`, left-aligned above the tab content,
only for tabs in `TABS_WITH_DATERANGE` (Overview/Activities/Body); Manage/Settings show no date-range
row at all. `DateRangeBar` has exactly one call site. (This reverses the two-row-header/right-aligned
layout an earlier pass tried and then undid — don't reintroduce a second header row for it.)

**`DateRangeBar`'s optional `compare` prop** (`CompareRangeState`, `hooks/useCompareRange.ts`) switches
it into the Overview & Trends layout — only ever passed on that tab (`App.tsx` renders `DateRangeBar`
itself only for Activities/Body now; Overview renders its own copy, see the Overview tab section
below); Activities/Body's bar has no `compare` and keeps the original single-row pill layout.

**Stacked rows, not a two-column split** (corrected from an earlier two-column `Current`/`Compare to`
layout — the two-groups-pinned-to-the-edges shape that replaced an even earlier rigid grid is now
retired too, superseded by this stacked design):
1. A heading row: **"Current"** on the left, a **`Switch`** (`ui/Switch.tsx`, a plain `role="switch"`
   button — no `@radix-ui/react-switch` dependency added) labeled "Enable comparison" pinned to the
   row's right end (`justify-content: space-between` — the switch is NOT beside the "Current" text;
   an earlier version put them adjacent on the left, corrected per explicit feedback), `checked={compare.enabled}`.
   Off means no second row and NO comparison data anywhere on the tab (rings, each sport's second trend
   chart, the linked-race row all key off `compareRange.enabled` — see the Overview tab section).
2. The "Current" picker row, one line: a `Select` of the preset windows (was individual pills —
   `PRESETS.map` — converted to a dropdown specifically to free up enough width for the named-range
   picker to sit on the same line; value is the active preset's `days` if one matches `isActive()`,
   else empty so the `Select`'s placeholder ("Custom range") shows), `or`, the two `DatePicker`s, `or`,
   the current-side named-range `Select` (unchanged derivation/eligibility — see below).
3. A second heading, **"Compared to"** (mirrors "Current"'s own heading treatment — same style, its
   own line, not squeezed onto the switch row), then a second picker row: the two compare
   `DatePicker`s, `or`, the compare-side named-range `Select` — same single-line shape as row 2, just
   without a preset dropdown (Compare never had presets). **Always mounted, never conditionally
   rendered** — wrapped in one `<div style={{opacity, pointerEvents}}>` that dims to `0.4` and disables
   interaction (`pointerEvents: "none"`) while `compare.enabled` is false, rather than being
   added/removed from the DOM. An earlier version only rendered this block at all while enabled; changed
   per explicit feedback against a "moving UI" — toggling the switch used to shift every section below
   it up/down as the block un/mounted, which this fixed layout avoids. `DatePicker`/`Select` have no
   `disabled` prop of their own, so `pointerEvents: "none"` on the wrapper is what actually blocks
   interaction (the opacity alone is cosmetic).

Both named-range dropdowns keep their pre-existing rules unchanged: a side's value is **derived**, not
separately stored (whichever saved range's `(from_date, to_date)` matches that side's live `from`/`to`,
same pattern the preset `isActive()` check uses), picking one calls the same `setFrom`/`setTo` every
other control here uses (so "the named range takes precedence" falls out for free — last write wins),
and the compare-side list is filtered to `r.to_date < from` (ranges that ended before Current's own
start).

`useCompareRange(from, to)` mirrors `useDateRange`'s shape (`{ from, to, setFrom, setTo }`) plus
`enabled`/`setEnabled` (default `true`, so existing always-on comparison behavior is unchanged until a
user explicitly flips the switch) and resets `from`/`to` to `defaultCompareRange(from, to)` — same
length as the current range, ending the day before it starts — every time `from`/`to` change; a manual
edit to the compare pickers persists only until the current range next changes, deliberately (re-picking
a preset should give a clean, predictable comparison window again, not silently carry over a stale
manual pick of a different length). `enabled` is untouched by that reset — toggling Current's range
doesn't silently re-enable a comparison the user turned off. `shiftIsoDate`/`daysBetween` (plain
UTC-midnight date math on `"YYYY-MM-DD"` strings) moved from `OverviewTab.tsx` to `utils/date.ts` so
both `useCompareRange` and `OverviewTab` share one implementation.

All header/nav visuals (background, border, backdrop-blur, the online-status dot's color, the active
nav pill) are `index.css` classes/data-attributes — see the "styles live in index.css" rule in
CLAUDE.md. The per-pill `padding`/`fontSize`/`fontWeight` inline in `App.tsx` are structural, not
theme, so they stay inline per that same rule.

## Date pickers (ui/DatePicker.tsx, ui/Calendar.tsx, utils/locale.ts) + display dates (utils/fmt.ts's fmtDate/fmtDateChart, utils/dateFormat.ts)
Every date picker in the app (`DateRangeBar`'s 4, plus any future one) and every displayed date renders
in ONE explicit, user-chosen format — the Settings tab's "Date format" section (`SettingsTab.tsx`'s
`DateFormatPicker`, `types/api.ts`'s `DateFormat`/`DATE_FORMAT_OPTIONS`) — not an implicit OS/browser
locale guess:
- **Four options, style × region**: `numeric_uk` (`23/03/2026`), `numeric_us` (`03/23/2026`),
  `literal_uk` (`23 Mar 2026`), `literal_us` (`Mar 23, 2026`, default `literal_uk`). Each is a pinned
  `Intl.DateTimeFormat` locale (`en-GB`/`en-US` per region — NOT `undefined`/runtime-locale) so the four
  options render EXACTLY as their own `DATE_FORMAT_OPTIONS.example` string regardless of the browser's
  actual language — an earlier version used `Intl.DateTimeFormat(undefined, {...})` (the runtime's own
  locale), which meant the same setting could render differently on two different browsers/OSes; this
  correction traded "matches the OS" for "matches what the user explicitly picked," on the reasoning that
  numeric dd/mm vs mm/dd is genuinely ambiguous to a reader and deserves an explicit choice, not an
  inherited one.
- **`utils/dateFormat.ts`** holds the resolved `DateFormat` in module scope — the same "global
  side-channel every component reads at render time" pattern `utils/units.ts` already uses for unit
  system (see that file's own header comment for why a module variable, not React context, is
  sufficient here). `useAppearance.ts`'s `applyToDocument()` calls `setDateFormatSystem()` whenever the
  settings row loads/changes, alongside theme/units; `setDateFormat` is exposed through `AppearanceApi`
  the same way `setAccentColor` is (both optional, so the pre-existing hand-written `AppearanceApi` stub
  in `SettingsTab.pickers.test.tsx` keeps compiling unmodified).
- **`utils/fmt.ts`'s `fmtDate()`** is the ONE formatter every date shown to the user goes through
  app-wide, not just inside a picker — reads `getDateFormatSystem()` and picks the matching pinned
  formatter. Added after an inconsistency bug report: several places (`ActivityRow`/`ActivityDetailBody`'s
  date, `BodyTab`'s table + "Latest measurement" line + chart X-axis/tooltip, `ClassifySection`/
  `DeleteSection`/`TrashSection`'s activity/measurement rows, `RangeEmpty`'s "available from X to Y",
  `DateRangeBar`/`DateRangesSection`'s named-range and race labels) were printing the raw backend
  `"YYYY-MM-DD"` string directly instead of going through the picker's own formatting. `fmtDate` parses
  the `"YYYY-MM-DD"` prefix as a **local** calendar date (no `new Date("...")` UTC-parse timezone-shift
  trap) and is the single place `DatePicker.tsx`'s trigger text calls too — one implementation, not two
  copies that could drift. Internal ISO-string logic (sorting, grouping, range-filter comparisons, ISO
  week keys in `domain/body-metrics.ts`) is untouched — `fmtDate` is display-only, never used for a
  value that's compared/stored/sent back to the API. `value`/`onChange`/`min`/`max` on `DatePicker`
  itself are also untouched — still plain `"YYYY-MM-DD"`, matching the native `<input type="date">`
  contract this component replaces (HRA-98).
- **`utils/fmt.ts`'s `fmtDateChart()`** — Overview & Trends' per-point chart labels (`domain/trends.ts`'s
  `buildTrendPoints`, "single"/"week" grouping modes) always stay numeric with no year (e.g. `"13/08"`,
  a compact axis tick has no room for a spelled-out month or the "literal" style choice), but still
  follow the chosen REGION (`utils/dateFormat.ts`'s `dateFormatRegion()`, derived from the same
  `DateFormat` setting — `_us` suffix → `"us"`/mm-first, else `"uk"`/dd-first). Replaced a hardcoded
  `sortDate.slice(5)` (always `"MM-DD"`) that ignored the setting entirely. "Month" mode's label (a
  plain `"YYYY-MM"` key) has no day component, so it's untouched — no ordering ambiguity to fix there.
- **The calendar popup's month/weekday names and week-start day** (`Calendar.tsx`'s `locale` prop,
  passed to `react-day-picker`'s `<DayPicker>`) — omitted, `react-day-picker` defaults to English
  (`enUS`) regardless of the OS's actual language, including defaulting every week to start on Sunday
  (the US convention) even for locales where Monday is standard. `utils/locale.ts` resolves
  `navigator.language` (e.g. `"it-IT"`) to a `date-fns` locale object: exact tag first (`"it-IT"` →
  key `"itIT"`), then the base language (`"it"`) if date-fns has no dedicated region variant (it
  doesn't ship every language×region combination — there's no `"itIT"`, only the base `"it"`), then
  `undefined` (react-day-picker's own `enUS` default) if neither exists. No `weekStartsOn` override on
  `<DayPicker>` — omitting it lets the resolved locale's own convention decide, same as every other
  calendar app on the machine.
- **Lazy-loaded, not bundled whole** — `utils/locale.ts` uses `import.meta.glob` (Vite, code-split per
  file) against `date-fns`'s one-file-per-locale layout, rather than `import * as locales from
  "react-day-picker/locale"` (tried first): that barrel re-exports `date-fns/locale` in full, and a
  plain namespace import of it bundles **every** supported locale unconditionally into the main chunk
  — measured +670KB raw / +118KB gzip for a feature that only ever needs the ONE locale the browser
  actually resolves to. The glob also explicitly excludes `cdn*.js` (`!**/cdn*.js`) — `date-fns` ships
  `locale/cdn.js`/`locale/cdn.min.js`, a ~630KB UMD bundle of every locale combined for `<script>`-tag
  consumption, which an unqualified `*.js` glob matches too even though nothing ever requests a key
  named `"cdn"`; left in, the build still had to emit two dead ~630KB output chunks. The result: the
  main bundle grew only ~13KB (from `enUS` — date-fns's own internal default, already pulled in by
  `date-fns/_lib/defaultLocale.js` regardless of anything here), and every other locale is its own
  small (~2-13KB) chunk, fetched only if a browser actually resolves to it. The resolved locale is
  cached at module scope (`loadBrowserCalendarLocale()`) — one fetch total, shared by every `Calendar`
  instance on the page (there can be several at once, e.g. `DateRangeBar`'s 4 pickers), not one fetch
  per mount. No `date-fns` entry was added to `package.json` — nothing here imports from the `date-fns`
  package directly; `react-day-picker` already depends on it (for the `Locale`/`DayPickerLocale`
  types and the actual per-locale modules the glob targets), so it stays a transitive dependency.

## Activity detail chart (ActivityModal.tsx)
**Reference activity for manual verification**: `2026-08-04-10-28-43.fit` (Garmin, `activities.id` 200 as of this writing) — 50:35 duration, 35:59 moving time, ascent 31m / descent 24m, 5 real pauses (~14.6min total), a km-3.80 stretch that's a genuine ~20-sample deceleration into the 360s pause (not noise). Chart-related fixes in this app have repeatedly needed real numbers to verify against (see the git history of this file); this activity is the one already dissected in detail, so re-check against it first before pulling a fresh one.

**Two exports**: `ActivityDetailBody` (all the actual content — header info, delete button, stats grid, charts) and `ActivityModal` (a thin wrapper adding the fixed backdrop overlay + × close button around it). `onClose` is optional on `ActivityDetailBody`; its absence is what suppresses the × button and lets `ActivitiesTab.tsx` render the exact same content inline in its accordion row (see Activities tab below) instead of only ever as a popup.

Multi-metric overlay chart (Speed/Pace mandatory, plus optional HR/altitude/cadence/power — each active metric gets its own mean-centered Y-axis; **Heart rate starts active by default**, the rest are opt-in), with a global Distance/Time X-axis toggle and pause detection:
- **Speed/Pace's axis has no on/off toggle and is never hidden** (fixed 2026-08-06 — it used to have the same "Axis" checkbox as the optional metrics, tied to `axisVisible.speed`; the checkbox is gone and the axis's `hide`/`width` are now hardcoded `false`/`42`, with no state path that can ever zero its width). **What looked like a second, still-unresolved rendering bug after that fix turned out to be a false alarm**: an early follow-up attempt (reordering it first among the `YAxis` elements) was chasing a bug that didn't exist — the axis was rendering correctly the whole time, just on a side the user didn't expect. A **second, real regression then followed**: fixing Speed to `orientation="right"` in isolation (nothing else on that side) genuinely worked, but the very next change — moving Speed back to `orientation="left"` to sit opposite HR, per an explicit "put Speed left, HR right" request — only isolated Speed from *HR specifically*, leaving `altitude_m`/`cadence`/`power` still mapped to `"left"` too. Toggling any of those back on put Speed back in a multi-axis-same-side stack, reintroducing the disappearing-axis symptom. **Fixed 2026-08-07**: `AXIS_SIDE` now puts Speed alone on the left unconditionally and *every* optional metric (not just HR) on the right — Speed never shares a side with anything, under any toggle combination, while still keeping Speed/HR on opposite sides as asked. Lesson: "isolate Speed from the one axis I'm comparing it to right now" isn't the same guarantee as "isolate Speed from everything, always" — the latter is what's actually load-bearing here, and the former quietly regresses the moment a *different* optional metric gets toggled on.
- **Separately, `axisVisible`'s initial state defaulted every optional metric's axis to `false`, including `heart_rate`** (fixed 2026-08-07), even though `activeMetrics`/`showCard` both correctly default `heart_rate` to on — so HR's line rendered by default with no axis of its own (`hide={!axisVisible.heart_rate}`). Fixed by defaulting `axisVisible.heart_rate` to `true` too, so all three pieces of per-metric default state (`activeMetrics`, `showCard`, `axisVisible`) agree. A genuine bug, but a red herring for the report below — it doesn't explain a *totally missing* axis, only a missing-when-not-yet-toggled-on one for HR specifically.
- **The actual reported bug (fixed 2026-08-07): Speed's own axis — the one with no toggle, always `hide={false}` — was rendering completely off-screen**, confirmed from the raw chart DOM the user pasted: the axis's `<line>` had `x1="-13" x2="-13"` while the plot area's own left edge was `x="47"` — the axis was drawn 60px further left than it should've been, past the SVG's own boundary, so it never appeared even though it was correctly present in the DOM the whole time. Root cause: the hidden pause-flag axis (`<YAxis yAxisId="pauseFlag" domain={[0,1]} hide />`) had no explicit `orientation`/`width`, so it fell back to Recharts' defaults — `orientation="left"`, `width=60` — and even though `hide` suppresses its visual rendering, Recharts still reserves that 60px in the left-side axis stack, which is exactly the offset error measured in the DOM (`60` = the default YAxis width). This silently pushed the one real left-side axis (Speed) out from under the container. Fixed by adding `width={0}` to the pauseFlag axis so it can never contribute stacking width regardless of its (irrelevant, since hidden) orientation. Lesson: a `hide`d Recharts axis is not free — it still participates in the same-side axis-width stacking calculation unless its `width` is also explicitly zeroed, and this kind of failure is invisible in code review (nothing about the JSX looks wrong) — it only showed up once the actual rendered SVG coordinates were inspected.
- **Pause flags and HR-recovery flags used to get clipped at the very top of their chart.** Both are 14px-tall custom shapes (`PauseFlagShape`/`HrRecoveryFlagShape`) centered on a data point that sits at the very top of its axis by construction (pause flags: `y=1` on a dedicated `[0,1]` axis; HR-recovery flags: `domain[1]`, the axis's own padded max) — so half the shape's height rendered above pixel row 0 of the chart's own SVG, silently clipped by the browser's default SVG overflow. Fixed by giving both `ComposedChart`s an explicit `margin={{ top: 16, ... }}` (Recharts' default is ~5px) — the data-space domain padding (`axisDomainMinMax`'s 10%) doesn't help here, since it only affects where in *value* space the axis's max sits, not how many *pixels* of the chart's own margin exist above it.
- **Pause detection is two independent methods, picked per-activity** by whether every `track_points` row has `timestamp_unix`: `detectPausesFromTimestamps` (primary, real Garmin data) is a plain gap ≥ threshold between consecutive points' `timestamp_unix` — this device stops recording entirely during an auto-pause, so no speed/clock heuristics are needed, and `elapsed_sec` isn't used at all (see "FIT parser notes" for why it's unreliable). `detectPausesHeuristic` (fallback, Strava or not-yet-backfilled Garmin) uses a debounced near-zero-speed run — a single noisy speed blip inside an otherwise-slow stretch does not end the run, or one real long stop fragments into several short ones.
- **Time-mode X-axis** (`buildChartData`'s `rawX`) uses `timestamp_unix − first timestamp_unix` (real wall-clock elapsed seconds), not `elapsed_sec` — using the latter was the root cause of a bug where the axis's last tick read a small fraction of the real duration (e.g. "10:44" on a 50:35 activity) and tooltip hover didn't match the cursor position. Falls back to `elapsed_sec` only when `timestamp_unix` is unavailable.
- Pauses render as small **fixed-size flags** (never proportional-width gaps), colored on a pale→deep **yellow** gradient purely by magnitude (`magnitudeColor()`, capped per use-site — 300s for pauses) — yellow specifically so the flag's black text stays legible across the whole gradient (unlike the red end of a pink→red scheme tried first). Rendered via a Recharts `Scatter` using a `dataKey` **accessor function** reading straight off the shared chart-level `data` (not a separate `data` array on the `Scatter` itself — a mismatched-length local array there was a plausible cause of unreliable tooltip/hover behavior, since it put the Scatter out of index-sync with the Line series). A `ReferenceLine`'s custom `label` render prop was tried even earlier and silently failed to render.
- **Pause flags only render on the main overlay chart**, not on every standalone per-metric card (removed as visual noise) — with one exception: the **Heart rate card** shows its own **HR recovery flags** instead (`computeHrRecovery`/`HrRecoveryFlagShape`) — the bpm drop (or rise) from just before stopping to right after resuming at each pause, a distinct signal from pause duration. Uses the *same* `magnitudeColor()` yellow gradient as pause flags (cap 60bpm) rather than a separate fixed color, so both flag types share one "how much" visual language — the biggest HR drop renders darkest, same as the longest pause.
- **Pause flags sit on their own dedicated, hidden, fixed `[0,1]`-domain axis** (`yAxisId="pauseFlag"`, plotted at a constant `y=1`), not on Speed's own axis. Two earlier versions tried deriving the flag's Y position from Speed's mean-centered/sometimes-reversed domain (`speedDomain[1]`, or `speedDomain[0]` in pace mode since that axis is `reversed`) — both still rendered the flags mid-chart in practice rather than at the top. A fixed, never-reversed `[0,1]` axis with the flag always at `y=1` has zero dependency on Speed's scale or reversal state, so it's guaranteed correct regardless of Speed/Pace mode.
- **Zero/near-zero speed samples are NOT hidden from the Speed line.** An earlier version nulled out `speed_ms <= 0` to avoid the line touching the axis floor at every stop — but decelerating to a stop is real, informative data, not noise, and hiding it created a misleading gap (verified on the reference activity's km 3.80: heart rate stayed plotted through a genuine ~20-sample taper to a full stop, while the matching speed vanished, looking exactly like a data outage). Genuine sensor glitches are what the outlier filter (below) is for — unlike a blanket "drop all zeros" rule, it correctly leaves a real gradual deceleration alone (it isn't an isolated spike) while still catching an isolated bad sample. Pace mode still excludes `speed_ms <= 0.05` — that exclusion is mathematically unavoidable (pace is 1/speed, undefined near 0), not a data-hiding choice.
- **Pace axis**: reversed (`YAxis reversed={speedMode === "pace"}`) so faster (lower) pace reads toward the top — matches Speed's own "up = faster" feel, which a normal ascending axis would invert for Pace's lower-is-better units. Domain floor is also clamped to `Math.max(0, ...)` as a guaranteed backstop against negative pace ticks.
- **Axis domains are percentile-based, not raw min/max/deviation** (`axisDomainCentered`/`axisDomainMinMax` both use a `percentile()` helper — 95th-percentile deviation for the centered/overlay case, 2nd–98th percentile range for the standalone-card case). A handful of samples right before a real stop are genuine but can still be extreme (pace shooting toward infinity as speed→0) — using the raw max as the domain bound let a few real-but-extreme points squash the other ~95% of normal values into a sliver of the chart height (verified: the reference activity's pace domain went from a raw-max `[-43.98, 55.74]` to a 95th-percentile `[4.73, 7.03]`). Points beyond the domain are simply clipped by Recharts, which is preferable to compressing everything else.
- **Outlier removal** ("Remove outliers" checkbox, default checked) is two independent rules, both scoped to Speed and Cadence:
  - **Isolated-spike delta filter** (`computeOutlierMask()`): a point is flagged only when it differs from *both* its previous and next valid neighbor faster than a per-second rate (thresholds live in the `settings` table, edited via the Settings tab) — symmetric by construction (`Math.abs` both directions), so an increase and a decrease are treated identically; doesn't flag a genuine sustained change (e.g. a real sprint, or a real deceleration into a stop), only a value that jumps away and immediately back.
  - **Absolute min-speed floor**, Speed/Pace only (`computeMinSpeedMask()`, `settings.outlier_min_speed_kmh`, default 6 km/h ≈ 10:00 min/km): any sample slower than this is dropped outright as "not really running," regardless of whether it looks like a spike — a deliberate, *configurable* re-introduction of hiding slow/decelerating stretches (the opposite instinct from the zero-speed note above), for people who want a clean running-only view. Default-on, so it does hide the reference activity's km 3.80 taper by default — turn the checkbox off, or set this threshold to 0, to see the raw deceleration again.
  
  Both masks feed `displayTrack` (nulls `speed_ms`/`cadence` before chart building or axis-domain math) and `speedOutlierMask` (passed into `buildChartData`, see below) — pause detection and HR recovery still read the raw `track`, unaffected. Rate is normalized by real elapsed seconds between samples (`timestamp_unix`, falling back to `elapsed_sec`), not raw array-index deltas, so it stays meaningful across sampling gaps.
- **Outlier removal is consistent on the X-axis, not just the Y-axis**: `buildChartData` takes an `outlierMask` and gives a flagged step **zero** width instead of its real distance/time span — deliberately NOT the same "collapse to a small notch" treatment pauses get. A pause's real span is always huge relative to the notch, so shrinking it down reads as "compressed"; an outlier stretch (e.g. decelerating to a stop) is usually already a *small* real span, so giving it a pause-sized notch was tried first and actually **inflated** its width past reality (verified: the reference activity's km-3.80 outlier stretch went from 15.8m of real width to 91.68m — worse, not "cut" — with the notch approach, then to the correct ~9m with zero-width steps).
- If a new field is added to `fit-parser.ts` that needs backfilling onto already-imported Garmin activities (like `moving_time_sec`/`timestamp_unix`/the `avg_cadence` fix were), run `npm run reprocess:fit` — it re-parses every file in `fit-archive/` and rewrites *every* activity-level column plus `track_points` in place (not a delete+resync), so it stays a complete backfill as `fit-parser.ts` continues to change, not just the two fields it was first written for.
- **Modal does not close on backdrop click** — only the explicit × button (or the browser back/away action) closes it; an earlier version closed on any click outside the modal content, which was easy to trigger by accident.
- **Delete button reads "Delete activity (locally)"**, not a separate "local database only" label + bare "Delete" button — the fuller explanation (what it does, what it doesn't touch, that it's restorable) moved into the button's `title` tooltip instead of sitting permanently in the UI as its own line. Delete is soft (see "Soft delete & trash"); the confirm step now says "Move to trash?" rather than implying permanence.
- **StatGrid conditionals use `!= null`, never bare truthy checks** (`{activity.descent_m != null && <Stat .../>}`, not `{activity.descent_m && ...}`) — a bare truthy check on a legitimately-zero numeric field (e.g. `descent_m: 0` on a flat run) renders the literal text "0" in the DOM instead of nothing, since `0 && <X/>` evaluates to `0`, not `false`. Card order: Distance, Moving time, Duration, Calories, **Avg speed/pace** (combined into one `SpeedPaceStat` card — same measurement shown two ways, so one card with two value+unit pairs side by side in one row, not two separate cards), Cadence, Avg HR, Max HR, Ascent, Descent — in a 4-column grid that's Cadence at row 2 col 2.
- **`ui.tsx`'s `Stat` value font is 18px, not the original 22px** — reduced app-wide (every tab using `Stat` inherits it) specifically so `SpeedPaceStat`'s two side-by-side values could match Stat's size exactly rather than needing their own smaller, inconsistent size to fit the card width.

## Settings tab (SettingsTab.tsx)
**Every section is an `AccordionCard` now** (`ui/AccordionCard.tsx`) — a clickable "card" header (title
+ ▲/▼ chevron) with its content in an attached panel below when expanded, the same visual language
ActivitiesTab.tsx's row accordion and the Overview tab's linked-race row already use
(`components/activity/ActivityRow.tsx`). Single-expand (one `expanded: SectionKey | null` state, all
collapsed by default), same pattern as ActivitiesTab's accordion. `AccordionCard` is purely
presentational — `SettingsTab` owns the expand/collapse state and passes `expanded`/`onToggle` per
section; two different UX patterns fill each section's content, deliberately not unified into one form:
- **Outlier detection** and **Overview & Trends** (explicit save, sharing one `draft`/`saved`/`dirty` state and Save button — see `SaveBar()`, rendered in both cards so either one's button persists everything in one `PUT /api/settings`): `outlier_speed_delta_per_sec`, `outlier_cadence_delta_per_sec` (isolated-spike thresholds), `outlier_min_speed_kmh` (absolute walking-pace floor, shown with a live min/km equivalent via `fmtPace(60 / kmh)`) — backs `ActivityModal.tsx`'s outlier filter. `min_trend_group_size` — backs `OverviewTab.tsx`'s trend gating (see below). Tracks `saved` (last-persisted, shown as "current: X" next to each input) separately from `draft` (the editable form) via `api.settings.get()`/`api.settings.update()` — Save is disabled unless `draft` differs from `saved`, so an unchanged form can't be re-submitted.
- **Appearance**, **Date format**, **Units**, and **Activity details** (immediate-apply): theme + accent color via the useAppearance() hook (below) — the background-picture picker is gone, see Appearance section; `date_format` (`DateFormatPicker`, `types/api.ts`'s `DATE_FORMAT_OPTIONS` — one pill per style×region combo, each pill's own example date doubles as its label) via the same hook's `setDateFormat`, see the Date pickers section above for what it drives; measurement units, same hook; `activity_detail_view` (accordion vs modal — see Activities tab below) handled locally in `SettingsTab` itself (not through `useAppearance()`, since it's a behavior choice, not a document/CSS-level concern) — `setDetailView()` calls `api.settings.setDetailView()` then updates both `saved`+`draft` so it never shows as a dangling unsaved change in the explicit-save cards. Clicking a swatch/button applies it right away, no draft/Save step, since that's the expected feel for this kind of preference.

All persist in the SQLite `settings` table rather than `localStorage` (see Stack & constraints above) — the pattern to follow for any future global setting.

## Appearance (theming + automatic ambient glow)
- **2 predefined themes** (`dark`, `light`, `types/api.ts`'s `THEME_NAMES` — narrowed from 4 by dropping `dark-blue`/`light-warm`), each a full `[data-theme="…"] { --bg, --bg-surface, --bg-card, --border, --border-strong, --text-primary/secondary/muted, --accent-green/blue/red/orange, color-scheme }` block in `index.css`. `:root` itself duplicates the `dark` theme's values directly (not just a fallback) so the very first paint — before `useAppearance()`'s `GET /api/settings` resolves — still looks right; there's no earlier client-side value to flash from since this app has no localStorage. A settings row persisted under a since-retired theme name falls back to resolving as if `'auto'` were selected — see `resolveTheme()`.
- **`--text-muted` and `--accent-green` were contrast-corrected** in both themes after real-world use surfaced them as too low-contrast (measured ~2.9-3.1:1 against their own theme's `--bg`, well under a readable ~4.5:1) — the dark theme's versions were lightened, the light theme's darkened. See the CSS design tokens section below for the actual values and the reasoning.
- **`'auto'` is no longer a user-selectable value** — `ThemePicker` only offers Dark/Light, and `setTheme`'s type narrowed to `Theme` (no `StoredTheme`) so the client literally cannot write it again. It survives purely as the DB column's internal default/sentinel: a settings row that was never explicitly set (a fresh install's default row, or an existing install that predates this change) still reads back as `'auto'` on `GET`, and `useAppearance.ts`'s `resolveTheme()` treats that — and any other non-`'dark'`/`'light'` value, e.g. a retired theme name — identically: resolve from the OS's `prefers-color-scheme` at render time (the one appearance signal a web page can read directly, unlike measurement system below), live, via a `matchMedia("(prefers-color-scheme: dark)")` change listener, no reload needed. Once a user clicks either swatch, that install's row holds a real `'dark'`/`'light'` value from then on and OS-following stops. `ThemePicker` still highlights whichever swatch matches `resolvedTheme` while no explicit choice is stored, so the picker shows what's currently in effect even with nothing "selected" by name.
- **Only general UI chrome is themed.** Chart-specific colors defined in TS (`ActivityModal.tsx`'s `METRIC_DEFS`, `SPORT_COLOR`, `BodyTab.tsx`'s per-metric hexes) were validated specifically against the dark `--bg-card` surface (see the Body metrics chart section below) and are **not** re-validated per theme — they still render on light themes, just without a fresh contrast pass. A real follow-up task if the light themes see much use.
- **`useAppearance()`** (`hooks/useAppearance.ts`) fetches the full `settings` row once, applies `theme` (resolved) as a `data-theme` attribute on `<html>` and `unit_system` (resolved) to `utils/units.ts`'s module state, then exposes `setTheme`/`setUnits`/`setAccentColor` — each updates the backend *and* immediately re-applies, so `SettingsTab` and the actual document never drift out of sync. Also exposes `resolvedTheme`/`resolvedUnitSystem` (the concrete values after resolving `'auto'`) for `SettingsTab`'s live previews. Lifted to `App.tsx` (not fetched again per-tab) so appearance applies regardless of which tab is open, and passed down to `SettingsTab` as a prop.
- ** Automatic ambient glow, not a background picture (corrected 2026-08-16, then again 2026-08-17 — supersedes the earlier per-user picker). The old SettingsTab.tsx "Background picture" gallery (BackgroundPicker, bundled presets + custom upload, --bg-image) is gone: useAppearance.ts no longer computes or sets --bg-image, and index.css's body::before paints ONE page-sized single-hue radial ramp — radial-gradient(135% 135% at 0% 0%, color-mix(accent 8%, --bg) 0%, --bg 46%, color-mix(black 30%, --bg) 100%) — lighter at the top-left, darker toward the bottom-right, per the approved soft-ambient render. The brief 2026-08-16 two-glow version (accent + fixed cyan --accent-glow) was replaced the next day: two independent hues read as "two colors", the user asked for one accent-derived ramp. --accent-glow itself was removed from :root on 2026-08-17 when .hra-pill-active went monochromatic (--accent → --accent-light), leaving nothing that references it. CSS-only, no JS, no per-user setting; follows theme + accent automatically via var(), nothing to persist. types/api.ts's background_kind/background_value fields and their backend routes were left in place — removing the API contract itself is Epic HRA-36's job — but nothing in the frontend calls them anymore.
- **The two mix percentages in that gradient (and `.card`'s own matching radial) are `:root` custom
  properties, not literals baked into the formula** — `--ambient-accent-mix`/`--ambient-dark-mix` for
  `body::before`, `--card-accent-mix`/`--card-dark-mix` for `.card`. Light theme overrides all four to
  noticeably higher values than dark theme's: the same 8%/9% accent concentration that reads clearly
  against a near-black `--bg`/`--card-bg` barely registers against a near-white one, which used to make
  the light theme's ambient glow and card tint look the same regardless of the chosen accent — fixed by
  raising the percentages per-theme (`:root[data-theme="light"]`), not by changing the gradient formula
  itself, which stays identical between themes.
- **`.hra-runner-playbtn` (the Play/Stop controls above an activity's chart, `ActivityChartSection.tsx`)
  is themed via `var(--text-primary)`, not a literal `white`** — dark theme's `--text-primary` is
  near-white (`#e8eaf0`, same look as before the fix), light theme's is near-black (`#1a1d27`), so the
  icon/border stay legible against `--bg-card` on both themes instead of a near-invisible white-on-
  light-gray icon on light theme.
- **`RUNNER_IDLE_COLOR` (`ActivityChartSection.tsx`) is `hrRunnerColor(80)`, not a literal `"white"`** —
  shown standing at rest (before any hover/play, on mouse-leave, stop, and once autoplay finishes): the
  same pale pink `hrRunnerColor` already uses for an easy 80bpm effort (`shared.ts`'s `HR_COLOR_STOPS`),
  so the "at rest" pose reads as the calm end of the runner's own HR-driven color scale rather than an
  arbitrary neutral — identical in both themes, since it's a fixed RGB value, not a CSS token.
## Units (metric/imperial)
- **`utils/units.ts`** holds a module-level `ResolvedUnitSystem` (`'metric' | 'imperial'`, never `'auto'` — resolution happens in `useAppearance.ts`) plus conversion functions (`kmToMi`, `mToFt`, `kgToLb`, `paceKmToMi`, `kmhToMph`) and unit-label helpers (`distanceUnitLabel()`, `paceUnitLabel()`, `speedUnitLabel()`, `weightUnitLabel()`, `elevationUnitLabel()`). State lives in a plain module variable, **not React context** — the same "global side-channel every component reads at render time" pattern the CSS theme already uses. This works here specifically because unit system only ever changes from the Settings tab, and every other tab is conditionally rendered in `App.tsx` (`{tab === "x" && <XTab/>}`, a real unmount/remount on every switch, not a hide) — so a tab always picks up the latest value the next time it's viewed, without needing a change to propagate into an already-mounted, unrelated tree.
- **`'auto'` resolves via browser locale**, not a real OS API — there is no equivalent of `prefers-color-scheme` for measurement system. `detectUnitSystemFromLocale()` checks the browser's locale region (`Intl.Locale(navigator.language).maximize().region`, falling back to parsing `navigator.language` directly) against a small imperial-region set (`US`, `LR`, `MM`) — the same heuristic most web apps use for this exact problem. Disclosed as a best-effort guess in the Settings tab UI, not presented as authoritative.
- **`fmt.ts`'s `fmtKm`/`fmtWeight`/`fmtPace` are unit-aware** (read `getUnitSystem()` internally) — existing call sites across the app got the conversion for free. Two new shared formatters were added for elevation and speed, which didn't have one before: `fmtElevation()` (ascent/descent/altitude, m↔ft) and `fmtSpeed()` (m/s input → km/h or mph, **no unit suffix** — matches `fmtPace`'s existing "value only, caller appends the label" convention, since several call sites show the unit on its own styled line below the number).
- **Double-conversion trap, and how each file avoids it**: `fmtPace`/`fmtKm`/`fmtWeight` each independently self-convert from their fixed internal unit (min/km, meters, kg respectively) — so anything that pre-converts a value *before* passing it to one of these would double-convert. `ActivityModal.tsx`'s chart (`metricValue()`) and `OverviewTab.tsx`'s `SportTrendChart` both need pre-converted numbers for a different reason (the same value drives both the chart's Y-position/axis-domain math *and* its displayed text, and only the latter can safely go through a self-converting formatter) — both files solve this the same way: convert once in the data-prep step, then format the already-converted number with a **local, non-converting** `m:ss`-style helper (`fmtMetricValue()`'s pace branch in `ActivityModal.tsx`; `fmtMinSecRaw()` in `OverviewTab.tsx` and again independently in `SettingsTab.tsx`, since the latter's live pace preview for `outlier_min_speed_kmh` deliberately stays metric-only regardless of the app's unit system — see the `settings` schema note above).
- **Swimming pace stays "/100m" always**, not converted to yards for imperial — a deliberate scoping choice noted where it's implemented (`OverviewTab.tsx`'s `SportTrendChart`), not full imperial swim-pace support.
- **Verified against real data**: the reference activity (2026-08-04) converts to 3.86 mi / 102 ft ascent / 9:20 min/mi / 6.4 mph, and a real body-weight reading of 78.8 kg → 173.7 lb — all cross-checked by hand against the conversion constants (1 mi = 1.609344 km, 1 ft = 0.3048 m, 1 lb = 0.45359237 kg) and confirmed realistic.

## Body metrics chart (BodyTab.tsx)
Six chart cards, each built from a shared `MetricChartCard` component (chart view + a per-card "Chart / Table" toggle showing the same series as a `<table>` — Date + one column per active metric):

1. **Primary chart — Weight, Fat mass, Muscle mass**: one inline pill with three always-visible checkboxes (all on by default). Plots **kg change since the start of the selected range** (`computeKgDelta()`), not raw values — this is the one deliberate exception to "no shared axis across different-magnitude series": since weight ≈ fat mass + muscle mass + water + bone, their *deltas* (unlike their absolute values, ~80kg vs ~13kg vs ~65kg) are naturally comparable, so sharing one axis directly shows how a weight change decomposes into fat vs muscle. A 0 `ReferenceLine` anchors gains vs losses.
2. **Five independent single-metric charts** (Fat %, Bone mass, Hydration, BMI, Heart rate) — one toggle pill each, opt-in, each rendering its own small chart in real units on its own axis. This is the small-multiples alternative from the dataviz skill's anti-patterns doc for metrics whose units genuinely can't share a scale (%, bpm, kg, unitless BMI all mixed) — no forced/arbitrary dual-axis anywhere in this set.

Colors are this app's existing accent hues, re-validated as one 8-color set (via the dataviz skill's `validate_palette.js`) against this chart's actual dark surface (`--bg-card` `#1e2330`) — several needed darker variants than the literal CSS var values (e.g. `--accent-orange`/`--accent-green` are too light for the dark-mode lightness band), so `fat_ratio`/`muscle_mass_kg` use `#d97706`/`#15965f` instead of the exact tokens, and `fat_mass_kg` uses a new pink (`#db2777`) not previously in the app. Each metric's color stays fixed regardless of which chart it appears in ("color follows the entity"); don't reassign colors without re-running the validator.

The correlation chart below it is untouched and still uses a dual y-axis (km/kg) — a known pre-existing anti-pattern that wasn't in scope to fix.

## Manage tab (ManageTab.tsx, tab label "Data & Sync")
- **No longer browses activities** — the "Activities in range" list (and its `from`/`to` props from `App.tsx`) was removed; `ActivitiesTab` (with pagination, see below) is now the one place to browse. `ManageTab` takes no props at all now. `DeleteSection`'s own "Show data" preview (its own local delete-range date pickers, not the global range) is a *different*, still-present feature — a compact read-only preview of what a pending delete would remove — and wasn't touched.
- **Sync all**: `SyncAllBar` checks device/token status fresh at click time (not reused from the individual cards below), runs whichever sources are ready (Garmin, Withings, Strava), and skips the rest with a note rather than failing outright. Reuses `runGarminSync()` — a module-level function factored out of `UploadSection` so both the individual "Sync from device" button and Sync All use the exact same streaming/parsing logic.
- **Garmin sync has no date range**: the MTP bridge diffs the device's files against what's already imported, not a date-queried API — a date picker here would be decorative, so it was removed (it never actually did anything even before this).
- **Withings and Strava each have their own date range**, lifted to `ManageTab` (`withingsFrom`/`withingsTo`, `stravaFrom`/`stravaTo`) and passed down to both their respective section and `SyncAllBar` so there's exactly one control per source, not a duplicate hidden in each. Withings wired end-to-end: the picker → `api.body.sync(from, to)` → `POST /api/sync/withings?from=&to=` → `--from`/`--to` args on the spawned script (same pattern for Strava). Previously the UI had no Withings date control at all and the query params were silently dropped even if you'd sent them.
- **`StravaSyncSection`** is a structural copy of `WithingsSyncSection` (status line, login popup, own date range, sync button) — see "Strava sync" above for the OAuth/dedup details behind it. (Both are now unified into one `OAuthSyncSection` driven by an explicit `OAuthProvider` descriptor — `oauthProviders.ts`'s `WITHINGS_PROVIDER`/`STRAVA_PROVIDER` — rather than two near-duplicate components.)
- **`DateRangesSection`** (`components/manage/DateRangesSection.tsx`), rendered just above "AI workout classification": three separate full-width rows, each with one fixed purpose (no auto-detected create/edit guessing, no separate read-only list — each row's own dropdown is the one place a saved range is looked up by name) — save/edit/delete named date ranges for later recall, mainly comparing training blocks (e.g. week 2 vs week 3 of a marathon's prep). Structural twin of `OAuthSyncSection` (Card, description, form row, action button).
  - **Create row**: plain text Name input → always `POST`s a new row.
  - **Update row**: a plain `Select` dropdown listing existing ranges (`{name} ({from} → {to})`, no free typing — renaming isn't supported, a deliberate simplification) — picking one loads its `from`/`to`/race into the row and snapshots it in `loaded` state. Save is disabled until `from`/`to`/race differs from the snapshot (`isUpdateDirty`), then always `PUT`s the loaded row's id with its unchanged name (`PUT /api/v1/date-ranges/:id`), never creates a new one.
  - **Delete row**: its own `Select` (same options) plus a Delete button with an inline "Delete this range? Yes/Cancel" confirm step (same pattern as the activity-detail Delete button) — no separate trash, a saved range is just a recall label, not synced data (see `docs/schema.md`'s `date_ranges` section).
  - **Column widths match top-to-bottom**: Create's Name input and Update's/Delete's picker `Select` all share one `firstColumnStyle` (`flex: "2 1 120px"`); every action button (`Create`/`Update`/`Delete`/`Yes, delete`) shares one fixed `width: 100` (`actionButtonStyle`) instead of sizing to its own label — so the three stacked rows read as one aligned column set, not three independently-sized rows.
  - Create/Update's race `Select` is populated from `api.garmin.races()` (`GET /api/v1/activities/races`, all race-typed activities, full history) filtered client-side to `date_only > to` (that row's own `to`) — same eligibility rule the backend enforces at save time (`date-ranges.controller.ts`).
  - **Ellipsis + tooltip for long names/dropdown items**: `Select`'s trigger and each `SelectPrimitive.Item` both carry a native `title` (the full label) plus `overflow:hidden;text-overflow:ellipsis` (`index.css`'s `.hra-select-item`).
- **`PlanTemplatesSection`** (`components/manage/PlanTemplatesSection.tsx`, HRA-117): the training-plan template CRUD card, rendered just above "AI workout classification". Two modes, `list`/`editor` (own local state, not a route):
  - **List**: `api.planTemplates.list()`, one row per template (`name`, `event`, an approved/not-approved `Badge`), `Edit` and `Delete` (confirm step naming the instance cascade, same UX pattern as the Delete card) per row, a `New template` button.
  - **Editor** (create or edit an existing row): a plain name input + a DSL-text `<textarea>`, an `.txt`/`.csv` file-upload button (`file.text()`, dropped into the same textarea state — **no separate parsing path**, confirmed by the Story: a `.csv` is handled byte-identically to pasted text), a `Generate / refresh preview` button (`api.planTemplates.generate`), Save, Approve, Cancel. Opening an **existing** template auto-generates once on load (one network call) so the accordion appears immediately; a **new** template requires the explicit Generate click first (there's nothing to preview before that). Editing a field does **not** auto-regenerate on every keystroke — a deliberate choice to avoid a request-per-keystroke storm; the accordion's preview only refreshes when the button is clicked again.
  - **Save is disabled** unless the template has been generated at least once, carries zero outstanding warnings anywhere in the tree (plan-scoped `warnings` from `generate`'s response, or any day's own `needs_review` — `hasOutstandingWarnings()`), and has a non-blank name — mirroring the backend's own zero-warning gate. **Approve is disabled** unless the template is already saved (`editingId` set) **and** the current `dslSource` still matches the last-saved one (no unsaved local edits) **and** zero warnings — matching the backend clearing `approved_at` on every `PUT`.
  - **Content-anchored `dsl_source` patching** (`domain/runplan-patch.ts`) is what makes "editing a field in the accordion, then Save" only touch that one line rather than regenerating the whole document: `serializeSectionHeader`/`serializeWeekHeader` rebuild a `SECTION`/`WEEK` header line from the node's own *current* `raw_dsl` (re-deriving the untouched `WEEKS` spec / week number / `START` date via small regexes mirroring the backend parser's own `SECTION_RE`/`WEEK_RE` — no separate `week_spec`/`start_date` fields needed on `SectionView`/`WeekView` for this), preserving whichever of name/notes wasn't the one just edited; `recomposeDayLine` treats a Day's `dsl` and `notes` fields as two facets of **one** line (`DayEntry.raw_dsl` already includes any trailing `# note`) — a `dsl` edit replaces the whole line outright, a `notes`-only edit re-composes onto the current line's own main clause via `splitNote`, so the two inputs never fight each other. `replaceSpan` then does the actual substitution, content-anchored (finds the *exact* old text) and refusing to guess when it's missing or appears more than once — same "no blind line-number mutation" discipline CLAUDE.md already requires for file edits, applied one level down at the DSL-text level. Each of `PlanTemplatesSection`'s three edit handlers (`onSectionEdit`/`onWeekEdit`/`onDayEdit`) both patches `dslSource` **and** updates the just-edited node's own `raw_dsl`/`dsl` field in the local `SectionView[]` mirror in the same state update, so a second edit to the same field chains correctly off the *previous* edit's own output rather than a now-stale original — verified in `runplan-patch.test.ts`'s multi-section/week/day fixture (a chained name-then-note edit on one `SECTION` line touches only that line, nothing else in the document, and the intermediate step's own output — not the original text — is what the second edit targets).
  - **The implicit default section's name is never patched** — `onSectionEdit` no-ops when `section.raw_dsl === ""` (mirrors the accordion's own read-only treatment of that case, HRA-116) — there is no real header line to rewrite yet.
- **`PlanInstancesSection`** (`components/manage/PlanInstancesSection.tsx`, HRA-118): the plan-instance CRUD card, rendered just below the template card. Three modes, `list`/`instantiate`/`editor`. Structural sibling of `PlanTemplatesSection` but **simpler at save time**: each day `PUT`s its own `{section_name, week_number, date, dsl}` directly (HRA-115) — there's no whole-document `dsl_source` to content-anchor-patch here, only a local `SectionView[]` mirror updated in place per edit.
  - **List** — `api.planInstances.list()` (added this Story, `GET /api/v1/plan-instances`, optionally `?template_id=`; no prior endpoint returned more than one instance at a time — confirmed with the user before adding it, since it's backend work inside a Story framed as frontend-only). One row per instance: `name`, `event`, `start_date`, an approved/not-approved `Badge`, `Edit`/`Delete` (confirm step).
  - **Instantiate form** — explicit separate fields, not a generic override blob (the Story's own requirement): `name`, `start_date` (`DatePicker`), a template picker (`Select`, populated from `api.planTemplates.list()`), a pace-input mode toggle (`hra-toggle-pill`, matching `SettingsTab`'s existing segmented-pill pattern) between **Goal time** (`goal_time` + a conditionally-shown/required `distance_m` when the selected template's `event` is `ultra`/`custom`) and **Anchor override** (a bare anchor name + a pace-string value, becoming `pace_overrides: {[anchor]: value}`), and a race-link `Select` (`api.garmin.races()`) for `target_activity_id`. **Deviation, flagged**: unlike `DateRangesSection`'s race picker, this one does **not** client-side pre-filter races to "after the plan's last day" — that day isn't knowable before the instantiate call actually resolves the plan (no preview/generate-equivalent endpoint exists for instances). The backend still validates it fully before any write, same as always; an invalid pick just surfaces as a 422 instead of being pre-excluded from the dropdown.
  - **Edit — day level only, section/week read-only.** `TrainingPlanAccordion` gets `readOnlySectionWeek` (new prop, HRA-118) — Section name/note and Week note render as plain text, only Day `dsl`/note stay editable, per the Story's explicit design decision (`plan_instance_days` rows have no first-class Section/Week entities to rename, only a denormalized `section_name`/`week_number` string each).
  - **Reconstructing a day's `dsl` text** (`domain/runplan-aggregate.ts`'s `reconstructDslFromResolvedDay`, resolving the gap HRA-116 flagged): `plan_instance_days` stores only resolved segments, never the original D-line. Every `Target`'s `raw` text survives resolution untouched (`instantiate.ts` never rewrites it, only intensities get resolved) — so target text (`"5km"`, `"1000m"`) reconstructs losslessly. **Intensity does not** — a resolved segment carries only `resolved_pace_sec_per_km`, never the original anchor/offset, so every intensity re-renders as an absolute pace (`"4:40/km"`), never the plan's original symbolic notation. This is a real, unavoidable loss flagged in the HRA-118 review, not an oversight — the reconstructed line is fully valid, re-parseable, re-editable DSL text, just not a promise to reproduce the original authoring.
  - **Grouping a flat day list into the accordion's tree** (`groupResolvedDaysIntoSectionViews`): an instance has no nested Section/Week objects like a template's `RunPlan` does — just a flat list of days each carrying its own `section_name`/`week_number`. Groups by `section_name` then `week_number`, preserving first-seen order (days normally already arrive date-ordered).
  - ⚠️ **A real bug, caught by the live smoke test and fixed before shipping**: `raw_dsl === ""` means two different things depending on mode — for a template, "the implicit default section, substitute the owner's name" (HRA-116); for an instance, **every** section lacks `raw_dsl` by construction (there's no header text at all, ever), even though `section.name` is a real, meaningful value. Reusing the same check unconditionally caused every instance section to wrongly display the instance's own name instead of its real section name (e.g. "Base"/"Peak"). Fixed in `TrainingPlanAccordion.tsx`: the default-section substitution now only applies when `!readOnlySectionWeek`.
  - **Save/Approve gating is simpler than the template card's**: Save just requires the editor to have loaded at least one day; there's no client-side zero-warning pre-check (no preview endpoint for instance edits, unlike `generate` for templates) — a day that still needs review after the real `PUT`'s own re-parse surfaces as a 422, shown via the same generic `ErrorBanner` every other card uses. **Deviation, flagged**: this is a coarser signal than the template card's per-day warning list — `api/client.ts`'s `ApiError` only carries the response's `detail` string, not its structured `errors[]` array, so there's no per-day breakdown surfaced client-side without a broader change to the shared error-handling layer (out of this Story's own slice).

## Overview & Trends' date-range rows (DateRangeBar.tsx, OverviewTab.tsx)
`DateRangeBar`'s stacked-rows layout (heading + Compare switch, the Current picker row, the
conditional Compare picker row) is described in full in the Header section above — this section
covers what `OverviewTab` itself does with `compareRange`, notably `compareRange.enabled`.

`OverviewTab.tsx` now takes `range: DateRangeState` / `compareRange: CompareRangeState` (the full
live objects with setters, not plain `from`/`to`/`compareFrom`/`compareTo` strings) — it renders its
own `DateRangeBar` internally now (moved out of `App.tsx`, which still renders it for
Activities/Body) specifically so the bar and the Summary card can share one sticky wrapper:
- **`.hra-sticky-summary`** (`index.css`) wraps `[DateRangeBar + its extra row(s)] + [the "SUMMARY
  ..." SectionTitle + Card]` — `position: sticky; top: var(--header-height)` (a new `:root` token,
  `48px`, matching `.hra-header`'s own rendered height so the two sticky elements sit flush, not
  overlapping), solid `background: var(--bg)` so scrolled content underneath doesn't show through.
  Present in every render branch (loading/error/empty/success) so the range can still be changed out
  of any of those states — only the Summary Card itself is conditional on `state.status === "success"
  && sports.length > 0`.
- **Card title is computed, not a fixed literal** (`OverviewTab`'s `summaryTitle`, passed as
  `PeriodHeroRing`'s `title` prop): `"SUMMARY"` alone while comparison is off; `"SUMMARY - {current}
  vs {compare}"` while it's on, where each side is the REAL current value — its matching named range's
  own name (same derivation `compareNamedRange` already used, applied to Current too via
  `currentNamedRange`) if one is selected for that side, else the plain formatted date span
  (`` `${fmtDate(from)} → ${fmtDate(to)}` ``) — never a generic placeholder. An earlier version used a
  fixed literal title regardless of state; corrected per explicit feedback that the title must show
  what's actually selected.
- **`compareRange.enabled` gates EVERY comparison on this tab, not just the extra picker row** —
  flipping the "Compare" switch off means no comparison data anywhere, not just a hidden row:
  `prevActivitiesQ` (hero rings' outer ring + Total/Running `Stat` cards' "vs previous period"
  tooltips) and `TrendsBySport`'s own `compareQ` (each sport's second "- comparison" trend chart,
  rendered by `SportTrendPair`) both skip their fetch entirely (`() => enabled ?
  api.garmin.activities(...) : Promise.resolve([])`) rather than fetching and discarding — since the
  fetch resolves to `[]`, `hasPrevData`/`prevActs` etc. fall back to `null` through the SAME "no
  comparison without data" logic that already existed (no new branch needed there). `SportTrendPair`
  takes a `compareEnabled` prop and skips rendering its second chart block outright when false (not
  just an empty state). `compareNamedRange`/`linkedRaceId` (next bullet) are also `undefined`/`null`
  while disabled — no linked-race lookup happens with comparison off.
- **The hero rings themselves never carry a hover tooltip, in any state** (`DualRingGauge` dropped its
  `tooltip` prop/wiring entirely — not just an empty `data-tooltip`, which would still have shown a
  visible blank bordered bubble on hover since `.hra-tooltip::after`'s box is unconditional; the whole
  `.hra-tooltip` class was removed from the ring's wrapper). The comparison figure is already shown
  inline (`comparisonText`, the small bracketed "(previous value, ±N%)" line under the center value),
  so a redundant hover tooltip was removed per explicit feedback. `Stat`'s own `tooltip` prop (Total/
  Running StatGrid, By-sport rows) is untouched — this only affects the four rings.
- **Linked race row**: when the compare-side's derived named-range selection has `activity_id` set,
  `OverviewTab` fetches that activity (`api.garmin.activity(id)`) and renders it via the shared
  `components/activity/ActivityRow.tsx` — the same row component `ActivitiesTab.tsx` uses (extracted
  out of it for exactly this reuse) — appended inside the Summary Card, below a divider. Click
  behavior matches the `activity_detail_view` setting: `'accordion'` expands `ActivityDetailBody`
  inline (local `raceExpanded` state); `'modal'` opens the same `ActivityModal` popup Activities tab
  uses (local `raceModalOpen` state) — "exactly as if we were in the Activities tab," not just
  visually similar.
- **Delete card** now: (1) explicitly labeled "local database only" in both the section title and card copy — deleting never touches the Garmin device, Strava, or the Withings account; (2) checkboxes ("Activities (Garmin + Strava)" / "Withings measurements", both start unchecked) instead of a single-select dropdown, so checking both is "delete all" — the activities checkbox covers both sources at once since `DELETE /api/activities` doesn't filter by `source` (the label was updated to say so explicitly once Strava activities could share that table); (3) shows a live count for the selected range/target(s) instead of always showing full data, via the count endpoints; (4) a "Show data" checkbox reveals the actual matching records (compact preview, including `source` for activities) on demand instead of always fetching/rendering them; (5) is soft-delete now, not permanent — copy/confirm-step wording says "trash"/"move to trash", not "delete"/"permanent" (see "Soft delete & trash").
- **Trash section** (`TrashSection`, below Delete): lists both entity types (`GET /api/activities/trash`, `GET /api/body/trash`) via a shared `TrashList<T>` generic component — checkbox per row + "select all", Restore selected (`POST .../restore`), and Delete permanently (`POST .../purge`, with its own confirm step, same UX pattern as Delete card's confirm). Each list fetches independently on mount; a manual ⟳ refresh button (`StatusLine`'s recheck-button pattern) re-fetches both, since deleting something via the Delete card above doesn't otherwise propagate into `TrashSection`'s already-mounted state within the same tab visit.

## Activities tab (ActivitiesTab.tsx)
Client-side pagination via `ui.tsx`'s `Pagination` component (per-page selector, first/prev/next/last, jump-to-page input) — the `/api/activities` endpoint has no server-side paging, so this slices the already-fully-fetched array; fine at this app's personal-dashboard data volumes. `Pagination` is a generic, reusable primitive (props: `page`, `totalPages`, `onPageChange`, `perPage`, `perPageOptions`, `onPerPageChange`, `totalItems`) — not activities-specific, so it's the one to reuse for any future paginated list. Rendered **both above and below** the list (same shared state, one `pagination` JSX variable used twice) so long lists don't force a scroll back down just to change page. Page resets to 1 whenever the date range or per-page count changes (`useEffect` on `[from, to, perPage]`) so it can't get stranded past the new last page.

**Detail view: accordion (default) or modal popup**, per the `activity_detail_view` setting (fetched here via its own `useQuery(() => api.settings.get(), [])`, matching the pattern `OverviewTab.tsx` already uses for `min_trend_group_size`). Accordion is **single-expand** — clicking a row toggles `expandedId`, and only one row's detail can be open at a time (clicking a different row collapses the previous one); multi-expand for side-by-side comparison was explicitly deferred as a future dedicated feature, not implemented here. The expanded row renders `ActivityDetailBody` (see "Activity detail chart" above) directly inline, in a bordered panel visually attached to the row (`borderRadius` split between the row and panel so they read as one joined block); in `'modal'` mode, row clicks still open the original `ActivityModal` popup unchanged. `expandedId` resets on range change (`useEffect` on `[from, to]`), same reasoning as the pagination reset above.

## Overview tab (OverviewTab.tsx, tab label "Overview & Trends")
Absorbed the former `TrendsTab.tsx` (deleted — its monthly/weekly bar charts were superseded by this section, which is strictly more capable: per-sport, groupable, with pace/HR overlaid). `api.garmin.weekly`/`monthly` client methods were removed too (dead — no remaining caller); the backend `/api/weekly`/`/api/monthly` routes themselves were left in place, not in scope to remove.

**The "compare to" range drives every comparison on this tab** (Hero Ring's outer ring, Total/Running/
By-sport tooltips, AND each sport's second trend chart below) — one `prevActivitiesQ` fetch, reused for
all of them, same as before. What changed: this range used to be computed unconditionally inside
`OverviewTab` (`windowDays`/`prevFrom`/`prevTo`, always exactly "the previous period of equal length");
it's now `compareFrom`/`compareTo` **props**, normally the live, user-editable pair from `App.tsx`'s
`useCompareRange` (see the Header section above for the picker UI) — a caller that omits them (tests,
mainly) still gets the identical default via `defaultCompareRange(from, to)` (`hooks/useCompareRange.ts`),
computed once and used as the fallback. Because the range is now freely editable and not guaranteed to
match the current period's length, the Hero Ring's period label dropped its old "vs previous N-day
period" claim for a plain "vs compare range (from – to)".

"Distance & pace/HR trend" section, one combined bar+line chart **per sport** (running, cycling, etc. each get their own chart — deliberately not mixed, since averaging pace/HR across different sports in one number is meaningless). **All three metrics (Distance/Avg pace/Avg HR) are always rendered — no toggle pills, no `ReferenceLine` avg/min/max bands** (both removed entirely per explicit feedback; the `hidden`/`ChartPillLegend` machinery described in earlier revisions of this doc no longer exists on this tab).

**Uniform across Single/Week/Month** — a single pairing/rendering pipeline handles all three grouping
modes identically, not a Single-only special case plus a separate Week/Month path. This works because
`buildTrendPoints(activities, mode)` (`domain/trends.ts`) already reduces every mode to the same
`TrendPoint[]` shape (one point per activity in Single mode, one per ISO week/month in Week/Month) —
everything downstream (pairing, domains, rendering) operates on that shape and never needs to know which
mode produced it.

- **`SportTrendPair`** (`OverviewTab.tsx`) is the per-sport orchestrator: builds `curPoints`/`cmpPoints`
  via `buildTrendPoints`, builds `overlapPoints` via `domain/trends.ts`'s `buildOverlapPoints(curPoints,
  cmpPoints, from, compareFrom, alignMode)`, scales all three point sets once (imperial/swim conversion,
  applied exactly once so nothing double-converts), computes the shared cross-side Y-axis domains, and
  renders either the merged overlap chart or two distinct charts depending on `viewMode`.
- **`viewMode: "overlap" | "distinct"`** — one switch (segmented pill pair, defaults to `"overlap"`),
  owned by `TrendsBySport` and shared across every sport's chart, shown only while `compareEnabled`
  (nothing to distinguish otherwise). `"Overlapping"` renders one `SportTrendOverlapChart` per sport;
  `"Distinct"` renders two stacked `SportTrendChart`s (`"{Sport} - current"` / `"{Sport} - comparison"`),
  both fed the same shared domain props so they still read on one common scale despite being visually
  separate.
- **`domain/trends.ts`'s `buildOverlapPoints(currentPoints, comparePoints, currentFrom, compareFrom,
  mode: AlignMode)`** builds the shared x-axis slots that both `viewMode`s' current/compare pairing is
  based on (the "distinct" pair's own two `buildTrendPoints` outputs are unpaired; only the domains and
  the align-mode choice come from this). `AlignMode` is `"index" | "time"`:
  - `"index"` — positional 1:1 pairing in chronological order; the longer side's leftover points each
    get their own trailing slot with only their own side filled. The only mode Week/Month ever use —
    each bucket ("week 2 of the period") is already a period-relative slot, so position IS "distance in
    time" there; no separate alignment choice is offered for those modes.
  - `"time"` — Single mode only. A sorted merge of both periods' points by **days since that period's
    own start** (`daysBetween(periodFrom, p.sortDate)`, `utils/date.ts`) — an EXACT day-offset match
    becomes one shared slot, everything else gets its own slot, interleaved in chronological day-offset
    order (a classic sorted-merge, NOT nearest-neighbor matching — a 1-day difference does not merge).
    Pinned spec example (also a `domain/trends.test.ts` regression test): current activities on days
    `[0,2,5,9]` of their period vs compare activities on days `[0,3,8]` of theirs → **6 slots, only the
    first (day 0 = day 0) overlaps** — days 2,3,5,8,9 each land in their own slot, interleaved in that
    chronological order.
  - **The align-mode switch (two toggle pills, "Match order"/"Match by time") is only shown in Single
    mode when the two periods' point counts actually differ** (`mode === "single" && compareEnabled &&
    curPoints.length !== cmpPoints.length`) — per spec, it's "when the number of activities does not
    match," not a permanent control; default is `"index"`.
- **Shared cross-side Y-axis domains — "min of the mins, max of the maxes," across BOTH current and
  compare, for all three measures (km/pace/HR)** — computed ONCE per sport pair (`SportTrendPair`, from
  the combined scaled `overlapPoints`) and passed as `kmDomain`/`paceDomain`/`hrDomain` props into
  whichever chart(s) render. This is what makes the vertical axis cover the same range for both sides
  **in both `viewMode`s** — the overlap chart's one shared axis and the distinct mode's two separate
  charts all read off the identical domain values, so a bar/line's height is comparable across either
  view. km's floor is fixed at 0 (bars start there); pace/HR reuse the app's existing mean-centered
  domain pattern (`meanCenteredDomain`), just fed the combined current+compare array instead of one
  side's own values.
- **Exact bar-on-bar overlap via the Recharts dual-XAxis trick** (`SportTrendOverlapChart`) — Recharts
  auto-groups multiple `<Bar>`s sharing one `xAxisId` side by side by default, which would defeat "bar
  and correspondent value must overlap exactly." Fixed with two `<XAxis dataKey="slot">`s on the same
  data, different `xAxisId`s (`"xMain"`, visible/tick-labeled; `"xOverlay"`, `hide`) — only elements
  sharing one `xAxisId` get auto-spaced relative to each other, so putting the compare bar on its own
  hidden axis stops it being pushed aside; both axes compute identical x positions from the same
  `dataKey`, so the two bars land exactly on top of each other. The compare bar renders FIRST (paint
  order = behind) at `barSize={24}`, flat `fill="var(--data-pace)" fillOpacity={0.18}`; the current bar
  renders second (on top) at `barSize={14}` with its usual gradient fill — larger and more transparent
  underneath, narrower and opaque on top, so the compare bar visibly peeks out on every side ("must
  always see it," per spec) without ever obscuring current. Every other element (Lines, the visible
  XAxis, both YAxes) is pinned to `xAxisId="xMain"` explicitly.
- **Current vs compare, beyond the bars** — pace/HR compare lines are the same color as their current
  counterpart (`--data-pace`/`--data-hr`, "color follows the metric" everywhere else in this app) but
  dashed (`strokeDasharray="5 4"`) and dimmed (`strokeOpacity={0.55}`), vs. current's solid full-strength
  line — color alone can't distinguish the two sides, so a small non-interactive legend in `ChartCard`'s
  `legend` slot (a short solid line + "Current", a translucent swatch + "Compare") carries that instead,
  shown only while `compareEnabled`.
- **Two-row x-axis tick** (`makeTwoRowTick`, a factory closing over the display points since Recharts'
  `tick` render prop only receives `{x, y, index}`, not the actual data) — current period's date/period
  label on top, compare period's underneath, at the same shared slot position (each formatted via
  `fmtDateChart`/the month-key string, same as `buildTrendPoints`' own label already was).
- **X-axis label sampling** — `sampleInterval(count)` (`OverviewTab.tsx`, `MAX_X_LABELS = 8`) returns a
  numeric Recharts `interval` (a tick skip-count) so a long Single-mode range or a many-bucket Week/Month
  span shows at most ~8 evenly-sampled labels instead of one illegible label per bar/point. Applied to
  every chart's `XAxis` (both `SportTrendChart` and `SportTrendOverlapChart`), keyed off that chart's own
  point count.
- **Tooltip** (overlap chart) reads straight off the hovered point's own `payload[0].payload` (the full
  `OverlapPoint`, not a per-series name lookup) and renders two stacked lines — current's date/km/pace/HR,
  then (dimmed, `compareEnabled` only) compare's — rather than Recharts' default per-series rows. The
  distinct-mode charts (`SportTrendChart`) keep the single-line combined tooltip ("07-24 · 6.5 km · pace
  5:12 · HR 158") described below.
- **Bars = total distance** for that sport/group, fill is a **muted `--data-pace` volume wash** (a
  vertical gradient, `stopOpacity` 0.28 at the top fading to 0.08 at the base — the SVG
  `<linearGradient>` stops live in each chart component itself, keyed by a `useId()`-derived id so
  multiple chart instances never collide, since Recharts gradients have no CSS-class equivalent) — not
  `SPORT_COLOR` (an earlier version colored bars by sport, which could collide with the pace/HR line
  colors). Bars intentionally read as **background volume, never as the pace series itself** — that's
  what the low opacity buys, even though the fill is drawn from the same `--data-pace` token the pace
  line uses at full strength. Sport identity still shows via the `Badge` above the chart pair, which
  keeps `SPORT_COLOR`.
- **Lines = avg pace and avg HR**, one point per bar, connected (`connectNulls`), full-strength
  `--data-pace`/`--data-hr` at `strokeWidth={2.5}` for current, small always-visible dots (`dot={{r:2.5}}`)
  plus a larger `activeDot` on hover, and a subtle per-line glow (`.hra-trend-line-pace`/
  `.hra-trend-line-hr` in `index.css`, a `drop-shadow` filter class passed via each `<Line>`'s
  `className`). Pace's color intentionally matches `ActivityModal.tsx`'s `METRIC_DEFS.speed.color`
  exactly — the activity detail view is this app's color "reference" for speed/pace. HR uses `--data-hr`.
- **Swimming pace is shown per 100m, not per km** (`sport === "swimming"` → `swimPacePer100m()`, ×0.1,
  unit `/100m`) — `avg_pace_minkm` is a plain per-km value regardless of sport, so this is a pure
  display-side unit conversion, not a different data source. Verified against the one real swim in this
  app's DB: 23.21 min/km → 2.32 min/100m. **Scoped to this tab only** — `ActivityModal` and everywhere
  else still show swimming pace as /km.
- **Pace's axis is on the left (paired with the km axis) and reversed** (this chart always shows pace,
  never speed, unlike `ActivityModal`, so it isn't conditional here); **HR's axis is on the right**,
  opposite it. Both are real, visible tick-label columns tinted to match their line.
- **Grouping** (Single/Week/Month, shared toggle across all sport charts) defaults from range length —
  `defaultGroupMode()`: ≤21 days → single, ≤120 days → week, else month — and re-picks automatically
  whenever `from`/`to` changes, though it's always manually overridable via the toggle. "Week" buckets by
  ISO week (Monday start, `isoWeekStart()`); "Month" by `YYYY-MM`; "Single" by activity id.
- **Week/Month are disabled when they'd produce fewer than `min_trend_group_size` distinct groups**
  (settings-configurable, default 5) across the CURRENT period's data only (the compare period has no
  vote over which modes are offered, only over what its own side of the pairing shows once a mode is
  picked). Disabled buttons show a tooltip explaining why; a `useEffect` downgrades an invalid mode
  (month→week→single) once data has actually loaded.
- **In "Single" mode, a sport's whole chart is replaced by a "too few activities" message** (`Empty`)
  when that side (current or compare — `SportTrendPair`'s `tooFew()`, applied to each side independently)
  has fewer than `min_trend_group_size` activities in range. Week/Month modes stay gated at the
  shared-toggle level (disabling the mode entirely), not per-sport/per-side.
- Verified against real data: summing the "week" and "month" grouped totals both reproduce the exact same
  overall total (429.77 km on a real 65-activity running range) — grouping logic reconciles correctly.

## Empty states (RangeEmpty, ui.tsx)
`OverviewTab`, `ActivitiesTab`, and `BodyTab` all distinguish two different "nothing to show" cases instead of one generic message: no data *at all* yet (nothing synced) vs. no data *in the currently-selected range* (data exists, just not here). `RangeEmpty` (`ui.tsx`) takes the entity's overall min/max date (`GET /api/range` / `GET /api/body/range`, fetched once per tab via its own `useQuery(..., [])`) plus the current `from`/`to`, and picks the message: `range.min_date == null` → "No {entity} yet — sync some data from the Data & Sync tab"; otherwise → "No {entity} in the selected range (X to Y). Data available from {min_date} to {max_date}." Generic `Empty` (no range awareness) is still used for everything else that isn't a range query (e.g. `OverviewTab`'s per-sport "too few activities" message above, `BodyTab`'s correlation-chart empty state).

## CSS design tokens
```
--accent-green: #17a06c (dark) / #087a52 (light)   distance, positive
--accent-blue:  #3a8ef5   weight, info
--accent-red:   #e24b4a   HR, danger, delete
--accent-orange:#f59e0b   body fat, cadence
```

**Two further token families were added on top of the above (HRA-94, Design System Foundation), each with its own `@theme inline` mapping in `index.css` so they're usable both as `var(--x)` and as Tailwind utility classes (`bg-accent`, `text-data-pace`, …):**

- **Fixed semantic data colors** — `--data-pace` (`#15965f`), `--data-hr` (`#e24b4a`), `--data-elev` (`#3a8ef5`), `--data-weight` (`#3a8ef5`), `--data-fat` (`#d97706`), `--data-muscle` (`#15965f`). Same metric = same color everywhere; these do **not** vary per theme, mirroring the existing chart-color precedent above (`METRIC_DEFS`, `PACE_LINE_COLOR`, `domain/body-metrics.ts` — see "Body metrics chart" and "Activity detail chart"). Declared once in bare `:root` (inherited regardless of `data-theme`), not repeated per theme block. **Not yet wired into any component** — existing chart files still hold their own literal hex per the docs above; a future story (HRA-97, Data Visualization Upgrade) is where chart code switches to referencing these tokens instead of repeating the literals.
- **Selectable `--accent`** — one per theme (`dark`/`dark-blue`/`light`/`light-warm`), each currently seeded to that theme's own `--accent-blue` (`var(--accent-blue)`, not a new literal) so introducing the token changed no rendered pixel. Meant to govern interactive chrome only (buttons, active pills, links, rings, focus) once wired — but the actual picker UI and the rewiring of `a`/`input:focus`/etc. off their hardcoded `--accent-blue` onto `--accent` is **HRA-95's job, not this story's**; HRA-94 only builds the token and seeds it to a value that preserves today's look.

**Tailwind v4 + shadcn/ui setup**: `@tailwindcss/vite` plugin in `vite.config.ts`, `@import "tailwindcss";` at the top of `index.css`, `components.json` at the `garmin-dashboard/` root (style `new-york`, `cssVariables: true`, baseColor `zinc`), and `src/lib/utils.ts`'s `cn()` (clsx + tailwind-merge) for the `shadcn` CLI to target when later stories start adding components. No `tailwind.config.*` file — v4 is CSS-first, all configuration lives in `index.css`'s `@theme` block.
`--text-muted` and `--accent-green` are the two tokens that needed contrast correction after the 4-theme system shipped: WCAG contrast against their own theme's `--bg` came out to ~2.9-3.1:1 for `dark`'s and `light`'s `--text-muted`, and ~3.1:1 for `light`'s `--accent-green` — all noticeably below a readable ~4.5:1 target (`dark`'s `--accent-green` measured fine at ~6.9:1 already, but was still perceptually "too dark"/muddy, so it was brightened too). Fixed by lightening both tokens in the two dark themes (`dark`, `dark-blue`) and darkening both in the two light themes (`light`, `light-warm`), each re-checked to land at ≥4.5:1 against its own theme's `--bg`. See `index.css` for the actual per-theme hex values (they differ per theme, unlike the other CSS-var-driven chart colors above which are effectively theme-agnostic named constants here).

**`dark`'s `--accent-green` was retuned again (2026-08-06)**, from `#26cc8c` to `#17a06c` — real-world use found the brightened value from the fix above had overshot: at `vsBg=9.07:1` it read noticeably more vivid/dominant than `--accent-red` (`4.80:1`) and `--accent-blue` (`5.72:1`) at their own default lightness, so the three accents didn't feel like one consistent set. `#17a06c` lands at `vsBg=5.64:1` — close to red/blue's own numbers, still comfortably ≥4.5:1 against both `--bg` and `--bg-card` (4.69:1, used for `Stat`'s `accent` text). Separately, **buttons filled with `--accent-green` now use `color: var(--bg)` instead of hardcoded `color: "#fff"`** for their label (`ManageTab.tsx`'s three sync buttons, `SettingsTab.tsx`'s Save button) — white-on-`#17a06c` only manages `3.34:1`, under the readable threshold, and darkening green further to fix that would have undone the "balanced with red/blue" goal above. `var(--bg)` sidesteps the tradeoff entirely and happens to work in both directions: dark themes' `--bg` is near-black (good dark text on a mid-brightness green), light themes' `--bg` is near-white (good light text on light themes' already-dark green, e.g. `light`'s `#087a52`) — verified ≥4.5:1 (4.96–11.28:1) across all 4 themes without per-theme special-casing.

Per-instance custom-property hooks declared in :root (2026-08-17) — --swatch-color (default var(--accent)), --kpi-color (default var(--text-primary)), --legend-color (default var(--text-secondary)). Components set them inline only where a value is genuinely per-instance; declaring them with defaults keeps every var() reference valid CSS without the inline hook and lets IDE inspection (WebStorm) resolve the names (it previously warned on all three).
--accent-glow removed (2026-08-17) — the fixed cyan pairing token existed for the two-glow ambient and the pill's second gradient stop; both went single-hue/monochromatic on 2026-08-17, so the token was deleted. --accent-light now serves both the hero ring (--accent-strong → --accent-light) and the active pill gradient.
Action-button primitive .hra-btn (2026-08-17) — filled/outline action buttons get a hover glow tinted to their own semantic color via a --btn-glow hook (same philosophy as .hra-swatch's per-swatch glow): data-variant="accent" | "green" | "danger" | "outline". Call sites to migrate: ManageTab's three sync buttons (green), SettingsTab Save (green), Delete/Restore/Purge (danger), .hra-chrome-preview-button (accent). The quiet hover glow was also extended to .hra-toggle-pill, .hra-date-trigger, .hra-select-trigger (box-shadow added to their transitions). All of it lives in index.css per the "styles live in index.css" rule; .hra-btn is included in the prefers-reduced-motion transition-none list.

## Training-plan accordion (`TrainingPlanAccordion.tsx`, `domain/runplan-aggregate.ts`, `types/runplan.ts`)
Shared Section → Week → Day review/edit UI for the RunPlan DSL v1 (`docs/runplan-dsl.md`), built once
(HRA-116) so the two Data & Sync cards — template CRUD (HRA-117) and instance CRUD (HRA-118) — don't
each duplicate the nesting or the aggregate math. **Pure component + computation only**: no API
wiring lives here, no `generate`/save/approve/delete/instantiate call — those are the two card
Stories' job.

**Types (`types/runplan.ts`)** duplicate the backend's `domain/runplan/types.ts`/`instantiate.ts`
shapes (`Target`/`Intensity`/`WorkoutSegment`/`DayEntry`/`Section`/`Week`/`ResolvedSegment`/
`ResolvedDay`) — this app has no shared client-type layer yet (Epic HRA-36), so these are a
deliberate hand-kept duplicate, same convention as every other API-shaped type in `types/api.ts`.

**Aggregate module (`domain/runplan-aggregate.ts`)** owns every domain-shape-specific computation:
- **Pace resolution** (`resolveIntensityPaceSecPerKm`, `getEffectivePacePolicy`) mirrors the backend's
  `domain/runplan/pace.ts` — anchor/offset chains, circular-reference safety, Plan→Section→Week
  shallow-merge inheritance.
- **The distance rule**: a `distance`-kind target sums directly; a `duration`-kind target converts
  via its resolved pace when one is available, and is excluded entirely otherwise (an unresolved
  anchor, or a segment with `kind: "unknown"`). Two deliberate, documented assumptions where the
  Story text didn't fully pin the behavior down (flagged in HRA-116's review comment as a real
  design choice): **an interval's rest leg is excluded from the total — only `reps × work_target`
  counts** (training-plan volume convention, "4x1000m" = 4km of work, not recovery jogs); **a
  progression's duration→distance conversion uses the START intensity's resolved pace**, not an
  average of start/end or the end pace alone.
- **Day-count categorization**: `totalDays`/`activeDays` (every day whose `workout_type` isn't
  `rest`/`todo`)/`runningDays` (`workout_type === "run"` only)/`restDays`. Section and Week totals
  are the *same* reduction over a different day list — `aggregateTemplateWeek`/
  `aggregateTemplateSection` are thin wrappers over one shared `aggregateTemplateDays`, deliberately
  not two parallel implementations.
- **View-model builders** (`buildTemplateSectionView`/`buildInstanceSectionView`) turn either a real
  template `Section` (+ the plan's top-level `PacePolicy`) or a grouped list of instance
  `ResolvedDay`s into one render-ready `SectionView` tree (`SectionView` → `WeekView[]` →
  `DayView[]`, each already carrying its own computed `totals`/`distance`) — `TrainingPlanAccordion`
  itself knows nothing about `WorkoutSegment`/`ResolvedSegment`/`PacePolicy`, only this tree shape.
  **Instance days have no persisted DSL text on the backend** (`plan_instance_days` stores only
  resolved segments, never the original D-line) — `buildInstanceSectionView`'s day input type
  requires the caller to supply a `dsl: string` per day; sourcing that text for a real instance is
  left to HRA-118, flagged as an open question rather than solved speculatively here.

**Component (`TrainingPlanAccordion.tsx`)**: `Section`/`Week`/`Day` each render as their own
`AccordionCard` (`ui/AccordionCard.tsx`), independently collapsible (no single-expand constraint —
several can be open at once, unlike `SettingsTab`'s accordion). Section starts expanded, Week/Day
start collapsed. Editable fields: Section name + note, Week note only (weeks are identified by
number, never a name), Day `dsl` text (`<textarea>`, monospace) + note — all plain `<input>`/
`<textarea>` with this app's existing `hra-border-strong hra-bg-card hra-text-primary` classes (no
new `Input`/`Textarea` primitive was added; none exists yet and one wasn't needed for this scope).
Edits go out via `onSectionEdit`/`onWeekEdit`/`onDayEdit` callbacks keyed by index — the component
never mutates its own props.

**Default-section name substitution (AC3)**: when `SectionView.raw_dsl === ""` (HRA-115's signal for
"no real `SECTION` line exists"), the accordion displays the owning template's/instance's own
`ownerName` prop instead of the section's stored `name`, and shows a read-only line explaining why
instead of a name input — editing a name that has nowhere to persist yet (no real header line to
patch) would be misleading before HRA-115's "add a new `SECTION` line" editor exists. **Display-only**
— `ownerName` is never written into `section.name`; the builder's own `name` field stays whatever the
parser produced (`"Plan"`), untouched, and the substitution happens at render time in the component.

**Warnings/`needs_review` (AC4)**: shown inline inside each Day's own panel — the day's
`ParseWarning[]` list line-by-line when non-empty; a plain "needs review" message when
`needs_review` is true but the (instance-mode) day carries no structured warnings at all (instance
rows only ever have the 0/1 flag, never a warnings array).

**i18n**: every label goes through `t()` (`runplan.accordion.*` keys, `garmin-stats/locales/en.json`/
`it.json`). ⚠️ Every dynamic label's `defaultValue` is a pre-substituted JS template literal, never a
literal `{{var}}` placeholder — the `notReadyT` stub (CLAUDE.md's i18n mechanics note) returns
`defaultValue` verbatim without interpolating it, so a `{{n}}`/`{{km}}` placeholder inside
`defaultValue` itself would render as the literal text `{{n}}` in exactly this component's own unit
tests (and briefly in production before the locale bundle loads) — caught and fixed during this
Story, not a pre-existing pattern elsewhere copied wrong.

**Tests**: `domain/runplan-aggregate.test.ts` — pure fixture-based coverage of the distance rule
(every segment type, unresolved anchors, the `~`/approximate flag, the interval-rest and
progression-pace assumptions above), day-count categorization, Plan→Section→Week pace inheritance,
and both view-model builders. No `TrainingPlanAccordion.test.tsx` render test is checked in — the
component was verified live (render, expand, edit-callback wiring, default-section substitution,
warning surfacing) via a temporary test during implementation, then removed, since a durable render
test would need real fixture data from a real template/instance that doesn't exist as a consumer yet
(HRA-117/118); adding one now would only exercise this Story's own hand-built fixtures a second time.
