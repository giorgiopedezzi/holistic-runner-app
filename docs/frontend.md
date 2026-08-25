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

### Layout, top to bottom (dashboard design-system rework, "reorganize activity layout")
1. **Classification accordion** (`sport === "running"` only) — `AccordionCard`, collapsed by default. Its
   title packs a compact summary (AI classification, Statistical classification, current sampling
   granularity, overall status) next to the "Classification" label, so the essentials are visible without
   expanding; expanding reveals the full `ClassificationCard`. `splitMeters` (the 1km/0.5km sampling
   toggle) is lifted from `ClassificationCard` into `ActivityDetailBody` as an *optional* prop
   (`splitMeters`/`onSplitMetersChange`, falling back to local state when omitted) purely so the
   collapsed summary can read the current value — `ClassificationCard.test.tsx`'s hand-written harness
   (which passes neither) keeps working unmodified.
2. **One row of badges** (`StatGrid`) — Moving time, Duration, Calories, Cadence, Elevation, Max HR, in
   that order (Max HR deliberately LAST). Distance, Avg speed/pace, AND Avg HR moved OUT of this row and
   into the graph itself (below, in its `controlsRow`, alongside Play/Stop — see below); Ascent/Descent
   merged into one Elevation badge (`Mountain` icon, value = `↑{ascent}  ↓{descent}`, whichever side(s)
   are non-null). Max HR still uses `hrRunnerColor(bpm)` (interpolated per the actual value) for both
   icon and `accent`, not a flat `--accent-red` — same gradient the chart line and mouse-follow runner
   use, so a badge's color already tells you roughly how hard that number was; Avg HR's `GraphKpiCard`
   (inside the graph) does the same via its `valueColor`/`iconColor` props.
   - **`StatGrid` (`ui/StatGrid.tsx`) uses `repeat(auto-fit, minmax(140px, 1fr))`, not `auto-fill`** —
     dashboard design-system rework, "space badges equally": `auto-fill` creates extra empty grid tracks
     to fill the row, leaving the real badges packed to the left with only the 10px gap between them;
     `auto-fit` collapses those empty tracks to 0 width so the existing badges themselves stretch to
     share the full row evenly. This is a shared primitive — the change applies everywhere `StatGrid` is
     used (Overview, Body tab, Activity detail), not just this view.
3/4. **The chart section's own two rows** (`ActivityChartSection.tsx`) — see below.
5. **The graph(s)** — the main overlay chart, then any per-metric standalone cards.
- **`GraphKpiCard`** (Overview's own compact icon+label→value→delta mini-card) moved from being a private
  function inside `OverviewTab.tsx` to `components/ui/GraphKpiCard.tsx` (dashboard design-system rework,
  "harmonize badges") specifically so this chart section could reuse the exact same shape for its
  Distance/Speed-Pace/Avg HR KPIs, not a re-implementation — `OverviewTab.tsx` now imports it like every
  other `ui/` primitive. Gained an optional `valueColor` prop (a `--graph-kpi-color` hook, same pattern as
  `Stat`'s `accent`) purely for Avg HR's interpolated color — every other `GraphKpiCard` call site leaves
  it unset and gets the default `--text-primary`.
- **The main chart's `controlsRow` holds Play/Stop (left) and Distance/Speed-Pace/Avg HR (right)**, one
  flex row with `justify-content: space-between` — the badge group stays right-aligned as a unit
  regardless of how many badges it holds (Avg HR is conditionally omitted when the activity has no HR
  data, and the row still reads correctly). Play/Stop moved here from their own row above the runner
  (an earlier pass of this same rework) — this **replaced** that placement, not added to it.
- **If the track is too short to plot at all (`track.length <= 5`), `ActivityChartSection` doesn't render
  and an `Empty` "Not enough track data to plot a chart." message takes its place** — since Distance/
  Speed-Pace/Avg HR now live inside the graph, this is also the one place they'd otherwise silently
  vanish for a near-empty recording; the message makes that explicit instead.
- **X-axis ticks land on round values, never an arbitrary fraction like "3.01 km" or a stray
  elapsed-seconds mark** (`domain/activity-chart.ts`'s `distanceTicks()`/`timeTicks()`, sharing an
  internal `niceTicks()` helper) — Recharts' own auto-tick placement evenly subdivides the chart's
  synthetic `x` (cursor) domain, which does NOT correspond 1:1 to real distance/time (pauses/outlier
  steps are collapsed to fixed notches, see `buildChartData`), so an auto-tick's nearest real sample
  lands on an arbitrary value. `niceTicks()` instead picks a "nice" step from a candidate list — distance
  mode: unit-aware nice numbers (km normally, mi under imperial); time mode: just 5/10/15 minutes,
  deliberately narrower since duration is conventionally read in round minutes, not an arbitrary nice
  number — landing the tick COUNT closest to an 8-10 target, then for each round target finds the row
  whose `realX` is closest and uses THAT row's `x` as the tick position. `xTickFormatter` (unchanged)
  then formats whichever row a tick lands on by its real value, which is why the result reads clean.
- **Per-metric Y-axis visibility is now a hardcoded rule, not a user toggle** (dashboard design-system
  rework, "reorganize activity layout" — the "Axis" checkbox that used to live in `MetricRow` is gone
  entirely, along with the `axisVisible`/`toggleAxis` state that drove it): **Heart rate's axis is always
  shown whenever HR is active; Cadence's and Power's are never shown**, full stop, regardless of whether
  their line is plotted. This means Heart rate is the ONLY optional metric that can ever occupy real
  right-side width — Cadence/Power still get a real (but always `hide`, always `width={0}`) `YAxis`
  element when active, purely so their `Line` has a scale to bind to.
- **The main chart's right-side width is ALWAYS a fixed total (`RIGHT_AXES_WIDTH = AXIS_WIDTH`, exactly
  one axis-width — not one per optional metric, since only HR can ever need one), regardless of whether
  HR is currently active** (dashboard design-system rework: "reserve space for the right axis without
  adding them if not required — the chart must never shrink or widen"). This is done via the
  `ComposedChart`'s own `margin.right` (`mainChartRightMargin`, topping up to the constant whenever HR
  isn't active), **not** an extra hidden "spacer" `YAxis` — that was tried first and reverted: Recharts
  doesn't reserve width for an axis nothing plots against (no `Line`/`Scatter` bound to its `yAxisId`),
  unlike the validated `pauseFlag` axis below (which DOES have a real `Scatter` consumer, which is why
  *its* `hide`+`width` trick genuinely works) — so that spacer's `width` was silently a no-op, and the
  chart's actual plot width kept varying with toggle state exactly like before the "fix." `margin`, by
  contrast, is unconditionally honored, so this is the correct mechanism. `playCtxRef`'s and
  `terrainXs`'s own `rightInset` calculations (autoplay/terrain pixel math) use this same fixed constant,
  so the runner's position tracking always matches the chart's actual (constant) geometry.
- **Every standalone per-metric card reserves that same fixed total via its own `margin.right =
  MARGIN_RIGHT + RIGHT_AXES_WIDTH`** — a plain constant, not a spacer axis or a computed value, since a
  standalone card never has a real right-side axis of its own (always exactly one `width={42}` axis, on
  the left). Without this, a standalone card and the main chart would reserve different total widths for
  the same container width, so their plot areas would differ and the same `x` value would land at a
  different pixel offset between the two — dashboard design-system rework: "additional graphs must have
  exactly the same width of the main graph, otherwise there is a misalignment."

Multi-metric overlay chart (Speed/Pace mandatory, plus optional HR/cadence/power — Altitude dropped from
the toggleable set, see `shared.ts`'s `OPTIONAL_METRIC_ORDER` comment: `RunnerTerrain` already visualizes
the elevation profile under the runner, and ascent/descent are now their own Elevation badge, so a
separate Altitude line/axis toggle was redundant — each active metric gets its own mean-centered Y-axis;
**Heart rate starts active by default**, the rest are opt-in), with a global Distance/Time X-axis toggle
and pause detection:
- **The chart section's one selector row**: Distance/Time + Speed/Pace (both `.hra-segment` switches) +
  the pause-threshold input + the outlier checkbox + the Heart rate/Cadence/Power `MetricRow` toggles all
  share ONE row now (previously two separate rows, then three before that) — dropping `MetricRow`'s
  "Axis" checkbox (see above) freed up enough width per row to fold what used to be its own row into
  this one.
- **Play/Stop controls live in the main chart's `controlsRow`** (pinned left, badges pinned right — see
  the layout list above), not the runner's own row — the runner row is the terrain + glyph alone.
- **Speed/Pace's axis has no on/off toggle and is never hidden** (fixed 2026-08-06 — it used to have the same "Axis" checkbox as the optional metrics, tied to `axisVisible.speed`; the checkbox is gone and the axis's `hide`/`width` are now hardcoded `false`/`42`, with no state path that can ever zero its width). **What looked like a second, still-unresolved rendering bug after that fix turned out to be a false alarm**: an early follow-up attempt (reordering it first among the `YAxis` elements) was chasing a bug that didn't exist — the axis was rendering correctly the whole time, just on a side the user didn't expect. A **second, real regression then followed**: fixing Speed to `orientation="right"` in isolation (nothing else on that side) genuinely worked, but the very next change — moving Speed back to `orientation="left"` to sit opposite HR, per an explicit "put Speed left, HR right" request — only isolated Speed from *HR specifically*, leaving `altitude_m`/`cadence`/`power` still mapped to `"left"` too. Toggling any of those back on put Speed back in a multi-axis-same-side stack, reintroducing the disappearing-axis symptom. **Fixed 2026-08-07**: `AXIS_SIDE` now puts Speed alone on the left unconditionally and *every* optional metric (not just HR) on the right — Speed never shares a side with anything, under any toggle combination, while still keeping Speed/HR on opposite sides as asked. Lesson: "isolate Speed from the one axis I'm comparing it to right now" isn't the same guarantee as "isolate Speed from everything, always" — the latter is what's actually load-bearing here, and the former quietly regresses the moment a *different* optional metric gets toggled on.
- **`axisVisible`/`toggleAxis` (the state this paragraph and the next originally described) no longer
  exist at all** — per-metric axis visibility was later replaced entirely by the hardcoded HR-only rule
  above (dashboard design-system rework). The bug this bullet describes (a stale default value) is
  moot now that there's no per-metric axis STATE left to default incorrectly; kept only because the
  Speed-axis regression story right below it still references the same DOM investigation.
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
- **StatGrid conditionals use `!= null`, never bare truthy checks** (`{activity.moving_time_sec != null && <Stat .../>}`, not `{activity.moving_time_sec && ...}`) — a bare truthy check on a legitimately-zero numeric field renders the literal text "0" in the DOM instead of nothing, since `0 && <X/>` evaluates to `0`, not `false`. Card order (post-reorg, see the layout list above): Avg HR, Max HR, Moving time, Duration, Calories, Cadence, Elevation. `SpeedPaceStat.tsx` (the old combined avg-speed/avg-pace card) is deleted — that measurement now lives inside the graph via `GraphKpiCard`, showing only whichever of speed/pace the chart's own switch currently has selected, not both at once.

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
- **4 theme×palette combinations — Theme (`dark`/`light`) crossed with Palette (`metal`/`warm`) —
  plus a 5th, standalone Graphite palette (dark-only, does not cross with Theme).** Dashboard
  design-system rework, replacing the earlier 2-theme + StylePack (HRA-119) system entirely. Each of
  the 4 crossed combinations is a full `:root[data-theme="…"][data-palette="…"] { --bg, --bg-surface,
  --bg-card, --border, --border-strong, --text-primary/secondary/muted, --accent, --on-accent,
  --accent-green/blue/red/orange, color-scheme }` block in `index.css`. `--accent` is now baked
  directly into each of the 4 blocks (an exact fixed hex per theme×palette — steel blue for Metal,
  amber/gold for Warm) rather than a separately user-selectable value — see the AccentColor note
  below. `:root` itself duplicates Dark Metal's values directly (not just a fallback, the same
  reasoning as before) since it's the default/primary theme, so the very first paint — before
  `useAppearance()`'s `GET /api/settings` resolves — still looks right.
- **Graphite is a third `Palette` value, but standalone, not a 5th theme×palette cell.** Its CSS
  block matches on `[data-palette="graphite"]` ALONE (no `[data-theme]` qualifier) — Theme becomes
  irrelevant while it's active, so there is no "light Graphite." Selecting it in `PalettePicker`
  disables both `ThemePicker` swatches (`ThemeSwatch`'s `disabled` prop, titled via
  `settings.theme.disabledForGraphite`) rather than silently ignoring the stored Theme value. Its
  ambient shimmer (see below) is switched off entirely (`[data-palette="graphite"] body::before {
  animation: none; }`) rather than just toned down, per the original design brief's instruction to
  reduce Graphite's motion further than the other themes.
- **Palette is the user-facing choice; Theme still exists alongside it for the 4 non-Graphite
  combinations.** `types/api.ts`'s `Palette` (`'metal' | 'warm' | 'graphite'`) is applied as a
  `data-palette` attribute on `<html>`, compounding with the existing `data-theme` attribute (except
  for Graphite, see above) — `SettingsTab`'s `PalettePicker` (3 swatches, same visual language as
  `ThemePicker`'s) replaces the earlier `StylePackPicker` entirely.
- **`'auto'` is the Palette DEFAULT, resolved by the (already-resolved) Theme — same pattern as
  Theme's own `'auto'`.** `StoredPalette` (`Palette | 'auto'`) is the DB/`Settings`-field type;
  `useAppearance.ts`'s `resolvePalette(stored, theme)` returns `stored` unchanged once a concrete
  choice has been made, and otherwise resolves to `'graphite'` when the resolved Theme is dark,
  `'warm'` when light ("make Graphite the default dark look, Warm the default light look" — a later
  design-system pass than the 4-theme rework above, superseding its flat `'metal'`-default). `'auto'`
  is never itself writable via `PUT /settings/palette` (`updatePalette` still only accepts
  `metal`/`warm`/`graphite`) — exactly the same asymmetry Theme's own `'auto'` has with `setTheme`.
  `PalettePicker`/`ThemePicker` both read `appearance.resolvedPalette` (not the raw, possibly-`'auto'`
  `settings.palette`) for swatch highlighting and for `ThemePicker`'s Graphite-disables-Theme check —
  a settings row that's never had a palette chosen can still resolve to Graphite, and the picker must
  disable itself then too, not only once Graphite is explicitly persisted.
- **AccentColor is no longer an independent user choice.** The earlier 6-hue curated `AccentPicker`
  (HRA-95) is gone — each palette bakes in its own exact accent. `AccentColor`
  (`'sky' | 'amber' | 'graphite'`) still exists as a `Settings` field, paired 1:1 with Palette
  (`sky`=metal, `amber`=warm, `graphite`=graphite) — the backend's `updatePalette` writes both
  columns together so they can never drift apart, but nothing in the frontend reads `accent_color`
  for rendering any more; `useAppearance.ts` no longer sets `--accent`/`--on-accent` from JS at all
  (no more inline-style vs. stylesheet specificity fight to reason about).
- **`--text-muted` and `--accent-green` were contrast-corrected** in the original 2-theme system after
  real-world use surfaced them as too low-contrast — see the CSS design tokens section below for the
  values that carried forward into the 4-theme system's Metal variants.
- **`'auto'` is no longer a user-selectable Theme value** — `ThemePicker` only offers Dark/Light, and
  `setTheme`'s type narrowed to `Theme` (no `StoredTheme`) so the client literally cannot write it
  again. It survives purely as the DB column's internal default/sentinel: a settings row that was never
  explicitly set still reads back as `'auto'` on `GET`, and `useAppearance.ts`'s `resolveTheme()` treats
  that — and any other non-`'dark'`/`'light'` value, e.g. a retired theme name — identically: resolve
  from the OS's `prefers-color-scheme` at render time, live, via a `matchMedia("(prefers-color-scheme:
  dark)")` change listener, no reload needed. `ThemePicker` still highlights whichever swatch matches
  `resolvedTheme` while no explicit choice is stored.
- **Only general UI chrome is themed.** Chart-specific colors defined in TS (`ActivityModal.tsx`'s
  `METRIC_DEFS`, `BodyTab.tsx`'s per-metric hexes) were validated specifically against
  the dark `--bg-card` surface and are **not** re-validated per theme — they still render on light
  themes, just without a fresh contrast pass. Pace and HR are the one deliberate exception: their
  gradients (`shared.ts`'s `SPEED_COLOR_STOPS`/`HR_COLOR_STOPS`, see the Activity detail chart section)
  are fixed and theme-invariant BY DESIGN (dashboard design-system rework, sections 4/7) — identical
  across all 4 themes, never derived from `--accent`.
- **`types/api.ts`'s `SPORT_COLOR` IS theme-aware, unlike the chart colors above** — `Record<Theme,
  Record<string, string>>`, keyed first by resolved theme then by sport, since a flat per-sport hex
  couldn't stay legible against both a near-black and a near-white background. Read via
  `utils/theme.ts`'s `getResolvedTheme()` — a module-scope global set by `useAppearance()`'s
  `applyToDocument()` alongside the `data-theme` attribute, same "global side-channel every component
  reads at render time" pattern `utils/units.ts` already uses for unit system (see that file's own
  comment for why a plain variable, not React context, is sufficient). Consumers: `ActivityRow.tsx`,
  `ActivityDetailBody.tsx`, `OverviewTab.tsx`'s two `Badge` call sites.
- **`useAppearance()`** (`hooks/useAppearance.ts`) fetches the full `settings` row once, applies
  `theme` (resolved) as `data-theme` and `palette` as `data-palette` on `<html>`, and `unit_system`
  (resolved) to `utils/units.ts`'s module state, then exposes `setTheme`/`setUnits`/`setPalette` — each
  updates the backend *and* immediately re-applies, so `SettingsTab` and the actual document never
  drift out of sync. `setAccentColor` still exists on the hook (kept as inert plumbing, matching the
  narrowed-but-still-present `accent_color` field) but no UI calls it. Lifted to `App.tsx` (not fetched
  again per-tab) so appearance applies regardless of which tab is open, and passed down to
  `SettingsTab` as a prop.
- ** Automatic ambient glow, not a background picture (corrected 2026-08-16, then again 2026-08-17 — supersedes the earlier per-user picker). The old SettingsTab.tsx "Background picture" gallery (BackgroundPicker, bundled presets + custom upload, --bg-image) is gone: useAppearance.ts no longer computes or sets --bg-image, and index.css's body::before paints ONE page-sized single-hue radial ramp — radial-gradient(135% 135% at 0% 0%, color-mix(accent 8%, --bg) 0%, --bg 46%, color-mix(black 30%, --bg) 100%) — lighter at the top-left, darker toward the bottom-right, per the approved soft-ambient render. The brief 2026-08-16 two-glow version (accent + fixed cyan --accent-glow) was replaced the next day: two independent hues read as "two colors", the user asked for one accent-derived ramp. --accent-glow itself was removed from :root on 2026-08-17 when .hra-pill-active went monochromatic (--accent → --accent-light), leaving nothing that references it. CSS-only, no JS, no per-user setting; follows theme + accent automatically via var(), nothing to persist. types/api.ts's background_kind/background_value fields and their backend routes were left in place — removing the API contract itself is Epic HRA-36's job — but nothing in the frontend calls them anymore.
- **The ambient glow shimmers subtly** — `hra-atmosphere-shimmer` (`index.css`), a 12s ease-in-out
  `opacity: 0.92 → 1 → 0.92` loop on `body::before`. Deliberately restrained per the design brief:
  atmosphere only, never a data-color or hue change. Disabled for Graphite (see above) and under
  `prefers-reduced-motion: reduce` (`animation: none !important`).
- **Chart hover-highlight** (`ActivityChartSection.tsx`) dims the rest of the plot and brightens a
  narrow band around the cursor, via two absolutely-positioned overlay divs (`.hra-chart-hover-dim`,
  `.hra-chart-hover-glow`) whose `--hover-x` custom property and `data-active` are set imperatively
  from refs in `handleChartMouseMove`/`handleChartMouseLeave` — not React state, so hovering never
  re-renders the `ComposedChart` (same pattern as the pre-existing `RunnerIcon`/`RunnerReadout`).
  Both fade via `transition: opacity 120ms ease, filter 120ms ease`, respect
  `prefers-reduced-motion`, and never touch the underlying data-color gradients.
- **The two mix percentages in that gradient (and `.card`'s own matching radial) are `:root` custom
  properties, not literals baked into the formula** — `--ambient-accent-mix`/`--ambient-dark-mix` for
  `body::before`, `--card-accent-mix`/`--card-dark-mix` for `.card`. Light theme overrides all four to
  noticeably higher values than dark theme's: the same 8%/9% accent concentration that reads clearly
  against a near-black `--bg`/`--card-bg` barely registers against a near-white one, which used to make
  the light theme's ambient glow and card tint look the same regardless of the chosen accent — fixed by
  raising the percentages per-theme (set identically in both `:root[data-theme="light"][data-palette="…"]`
  blocks), not by changing the gradient formula itself, which stays identical between themes.
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
  - **Editor** (create or edit an existing row): a fixed-width Name input, an **Event type dropdown** (`Select`, required, the 5 `EventType` values — HRA-120, replacing the old DSL-text `EVENT` line, its trigger sized to the longest translated option so switching options never resizes it) and a **Distance** input + km/mi segmented toggle — required only when Event type = Custom, but **always mounted and visible**, merely `disabled` (dimmed) otherwise, never conditionally rendered (CLAUDE.md's "no moving UI" rule: a field whose presence depends on another field's value must not shift its stable siblings — Name and Event type are fixed-width `flex: "0 0 <px>"`, not `flex-grow`, so nothing here ever reflows). The Distance value is entered in whichever of km/mi is active and only converted to the `distance_m` the API wants at load/submit time, never per keystroke. Replaces the old DSL-text `DISTANCE` line. Opening an **existing** template auto-generates once on load (one network call) so the accordion appears immediately, and reads its Event/Distance from `template.event`/`JSON.parse(template.parsed_plan).metadata.distance_m` (the only place `distance_m` is exposed — no dedicated column) — that load never runs the auto-fill guess below, since a saved value is already authoritative. For a **new** template, once Generate produces a preview, an empty Distance field is auto-filled by finding a day tagged `[race]` with a real (non-duration-derived) distance, guessing its unit from the DSL's own `UNIT` declaration — never overwrites a value already typed, and quietly does nothing for a duration-only plan with no such day to find.
  - **Debounced auto-regenerate (follow-up fix)**: editing a Section/Week/Day field, pasting fresh text, or uploading a file all change `editor.dslSource` without calling `generate()` themselves — originally this left the accordion's totals/warnings, and therefore `Save`'s real enabled state, stale until the user noticed and clicked "Generate / refresh preview" again (reported: "when I correct a dsl, plan is not updated, no button enabled"). Fixed with a `useEffect` keyed on `editor.dslSource` that calls `runGenerate` ~700ms after the last change — long enough to avoid a request per keystroke (the original concern the no-auto-regenerate note used to describe here), short enough to feel automatic. A `lastGeneratedRef` tracks which `dslSource` the current preview reflects, so the effect no-ops once a generate (manual or debounced) has already caught up, rather than looping on its own `setEditor` call. The manual button is unchanged, for an instant refresh without waiting.
  - **Save is disabled** unless the template has been generated at least once, carries zero outstanding warnings anywhere in the tree (plan-scoped `warnings` from `generate`'s response, or any day's own `needs_review` — `hasOutstandingWarnings()`), and has a non-blank name — mirroring the backend's own zero-warning gate. **Approve is disabled** unless the template is already saved (`editingId` set) **and** the current `dslSource` still matches the last-saved one (no unsaved local edits) **and** zero warnings — matching the backend clearing `approved_at` on every `PUT`.
  - **Content-anchored `dsl_source` patching** (`domain/runplan-patch.ts`) is what makes "editing a field in the accordion, then Save" only touch that one line rather than regenerating the whole document: `serializeSectionHeader`/`serializeWeekHeader` rebuild a `SECTION`/`WEEK` header line from the node's own *current* `raw_dsl` (re-deriving the untouched `WEEKS` spec / week number / `START` date via small regexes mirroring the backend parser's own `SECTION_RE`/`WEEK_RE` — no separate `week_spec`/`start_date` fields needed on `SectionView`/`WeekView` for this), preserving whichever of name/notes wasn't the one just edited; `recomposeDayLine` treats a Day's `dsl` and `notes` fields as two facets of **one** line (`DayEntry.raw_dsl` already includes any trailing `# note`) — a `dsl` edit replaces the whole line outright, a `notes`-only edit re-composes onto the current line's own main clause via `splitNote`, so the two inputs never fight each other. `replaceSpan` then does the actual substitution, content-anchored (finds the *exact* old text) and refusing to guess when it's missing or appears more than once — same "no blind line-number mutation" discipline CLAUDE.md already requires for file edits, applied one level down at the DSL-text level. Each of `PlanTemplatesSection`'s three edit handlers (`onSectionEdit`/`onWeekEdit`/`onDayEdit`) both patches `dslSource` **and** updates the just-edited node's own `raw_dsl`/`dsl` field in the local `SectionView[]` mirror in the same state update, so a second edit to the same field chains correctly off the *previous* edit's own output rather than a now-stale original — verified in `runplan-patch.test.ts`'s multi-section/week/day fixture (a chained name-then-note edit on one `SECTION` line touches only that line, nothing else in the document, and the intermediate step's own output — not the original text — is what the second edit targets).
  - **The implicit default section's name is never patched** — `onSectionEdit` no-ops when `section.raw_dsl === ""` (mirrors the accordion's own read-only treatment of that case, HRA-116) — there is no real header line to rewrite yet.
- **`PlanInstancesSection`** (`components/manage/PlanInstancesSection.tsx`, HRA-118): the plan-instance CRUD card, rendered just below the template card. Three modes, `list`/`instantiate`/`editor`. Structural sibling of `PlanTemplatesSection` but **simpler at save time**: each day `PUT`s its own `{section_name, week_number, date, dsl}` directly (HRA-115) — there's no whole-document `dsl_source` to content-anchor-patch here, only a local `SectionView[]` mirror updated in place per edit.
  - **List** — `api.planInstances.list()` (added this Story, `GET /api/v1/plan-instances`, optionally `?template_id=`; no prior endpoint returned more than one instance at a time — confirmed with the user before adding it, since it's backend work inside a Story framed as frontend-only). One row per instance: `name`, `event`, `start_date`, an approved/not-approved `Badge`, `Edit`/`Delete` (confirm step).
  - **Instantiate form** — explicit separate fields, not a generic override blob (the Story's own requirement): `name`, `start_date` (`DatePicker`), a template picker (`Select`, populated from `api.planTemplates.list()`), a pace-input mode toggle (`hra-toggle-pill`, matching `SettingsTab`'s existing segmented-pill pattern) between **Goal time** (`goal_time` + a conditionally-shown, now **optional** `distance_m` override when the selected template's `event` is `custom` — HRA-120: a custom-event template always carries its own `distance_m`, mandatory at save time, so this field only overrides it, never satisfies a missing one) and **Anchor override** (a bare anchor name + a pace-string value, becoming `pace_overrides: {[anchor]: value}`), and a race-link `Select` (`api.garmin.races()`) for `target_activity_id`. **Deviation, flagged**: unlike `DateRangesSection`'s race picker, this one does **not** client-side pre-filter races to "after the plan's last day" — that day isn't knowable before the instantiate call actually resolves the plan (no preview/generate-equivalent endpoint exists for instances). The backend still validates it fully before any write, same as always; an invalid pick just surfaces as a 422 instead of being pre-excluded from the dropdown.
  - **Edit — day level only, section/week read-only.** `TrainingPlanAccordion` gets `readOnlySectionWeek` (new prop, HRA-118) — Section name/note and Week note render as plain text, only Day `dsl`/note stay editable, per the Story's explicit design decision (`plan_instance_days` rows have no first-class Section/Week entities to rename, only a denormalized `section_name`/`week_number` string each).
  - **Locked once approved (HRA-126).** `TrainingPlanAccordion` gets a second, independent prop, `readOnlyDays` — when true, Day `dsl`/note stop being editable too (the inputs simply don't render, same "hide the input, the title/tooltip already shows the value" treatment `readOnlySectionWeek` already uses one level up). `PlanInstancesSection` tracks the edited instance's own `approved_at` in local state (`editApprovedAt` — set from `startEdit`'s fetched instance, kept in sync after every `onSave`/`onApprove` response, since a `PUT` clears approval per gate 2 and `POST .../approve` sets it) and derives `isApproved = editApprovedAt != null`, passed straight through as `readOnlyDays`. Once approved: the Name input, Save button, and Approve button (no double-approve) are all `disabled`; nothing is hidden or deleted — `startEdit`/`getById` still load and display the instance exactly as before, only the editing affordances go away. An `Approved`/`Not approved` `Badge` (the same one the list row already shows) now also renders next to "Edit instance"'s own title, so the locked state is visible without inferring it from which buttons happen to be grayed out. Deliberately out of scope (per the Story): no "unapprove" action, no versioning an approved plan into a new editable copy.
  - **Reconstructing a day's `dsl` text** (`domain/runplan-aggregate.ts`'s `reconstructDslFromResolvedDay`, resolving the gap HRA-116 flagged): `plan_instance_days` stores only resolved segments, never the original D-line. Every `Target`'s `raw` text survives resolution untouched (`instantiate.ts` never rewrites it, only intensities get resolved) — so target text (`"5km"`, `"1000m"`) reconstructs losslessly. **Intensity does not** — a resolved segment carries only `resolved_pace_sec_per_km`, never the original anchor/offset, so every intensity re-renders as an absolute pace (`"4:40/km"`), never the plan's original symbolic notation. This is a real, unavoidable loss flagged in the HRA-118 review, not an oversight — the reconstructed line is fully valid, re-parseable, re-editable DSL text, just not a promise to reproduce the original authoring.
  - **Grouping a flat day list into the accordion's tree** (`groupResolvedDaysIntoSectionViews`): an instance has no nested Section/Week objects like a template's `RunPlan` does — just a flat list of days each carrying its own `section_name`/`week_number`. Groups by `section_name` then `week_number`, preserving first-seen order (days normally already arrive date-ordered).
  - ⚠️ **A real bug, caught by the live smoke test and fixed before shipping**: `raw_dsl === ""` means two different things depending on mode — for a template, "the implicit default section, substitute the owner's name" (HRA-116); for an instance, **every** section lacks `raw_dsl` by construction (there's no header text at all, ever), even though `section.name` is a real, meaningful value. Reusing the same check unconditionally caused every instance section to wrongly display the instance's own name instead of its real section name (e.g. "Base"/"Peak"). Fixed in `TrainingPlanAccordion.tsx`: the default-section substitution now only applies when `!readOnlySectionWeek`.
  - **Save/Approve gating is simpler than the template card's**: Save just requires the editor to have loaded at least one day; there's no client-side zero-warning pre-check (no preview endpoint for instance edits, unlike `generate` for templates) — a day that still needs review after the real `PUT`'s own re-parse surfaces as a 422, shown via the same generic `ErrorBanner` every other card uses. **Deviation, flagged**: this is a coarser signal than the template card's per-day warning list — `api/client.ts`'s `ApiError` only carries the response's `detail` string, not its structured `errors[]` array, so there's no per-day breakdown surfaced client-side without a broader change to the shared error-handling layer (out of this Story's own slice).
  - **Day/week swap (HRA-127).** The Story's own interaction pattern was left open ("pick-two-then-swap, a per-row 'swap with…' selector, or drag-and-drop… left as an implementation-time decision") — implemented as a per-row "swap with…" selector: two `Select` pickers + a Swap button for days, another pair for weeks, rendered above the accordion (only while `!isApproved` and there are ≥2 days/weeks to pick from — HRA-126's lock). Picker option values are `"sectionIndex-weekIndex-dayIndex"` / `"sectionIndex-weekIndex"` strings (`dayOptions()`/`weekOptions()`, same string-value convention every other `Select` in this file already uses), labeled `Week N — <the day's own dsl line>` / `Week N`. Clicking Swap only mutates the local `sections` mirror (deep-cloned per section/week/day, same shallow-clone-per-level pattern `onDayEdit` already uses) — nothing is sent to the backend until the existing Save button runs its normal `PUT`, so no new endpoint was needed (AC4). **Day swap** (`onSwapDays`) exchanges two days' whole `dsl` line via a new pure `domain/runplan-patch.ts` helper, `swapDayContent(dslA, dslB)`: it splits each line at the D-line grammar's `D<n>[suffix][ [tag]]:` prefix (mirrors the backend's `DAY_RE`, same independent-mirror-of-the-backend-regex pattern `SECTION_RE`/`WEEK_RE` in the same file already use) and swaps only the text *after* the colon — so each day keeps its own D-number/suffix/tag (and therefore its own resolved date once instantiated) while the workout content, and any trailing `# note`, exchanges (AC1). **Week swap** (`onSwapWeeks`) applies `swapDayContent` to every day-number both weeks actually declare (matched by `day.day`, not array position) — a day-number present in only one side is left untouched rather than guessed at, so two weeks with different declared day-sets (e.g. a pre-HRA-124 partial week) still swap everything they have in common (AC2). Both handlers `notify()` on completion — `"Days/Weeks swapped — remember to Save."` — since the swap's own visual result (new text inside a collapsed accordion row) may not be obvious until the row is expanded or Save is clicked (AC5, this repo's CTA-notification rule). `swapDaysByRef`/`swapWeeksByRef` factor the actual mutation out of `onSwapDays`/`onSwapWeeks` so a second UX (below) can drive the same logic from different input.
  - **Drag-and-drop, an alternative UX to the picker (HRA-127 follow-up — clarified after review: "mechanism is ok, add drag-and-drop too", i.e. additive, not a replacement).** `TrainingPlanAccordion` gains two more optional props, `onDaySwap`/`onWeekSwap` (typed `DayRef`/`WeekRef`, exported from that file — plain `{sectionIndex, weekIndex[, dayIndex]}` tuples, the same shape `onSectionEdit`/`onWeekEdit`/`onDayEdit` already key by). `DayEditor`/`WeekEditor` wrap their own `AccordionCard` in a plain `<div>` carrying native HTML5 drag handlers (`useDragSwap()`, a small local hook — no drag-and-drop library added, this app stays zero-dependency): `draggable`, `onDragStart` (writes the row's own ref as JSON into `dataTransfer`'s `text/plain`), `onDragOver`/`onDrop` (reads the dragged ref back and calls the swap callback with `[source, self]`, no-opping a drop onto the row's own self). Draggability is gated by `readOnlyDays` exactly like the picker panel — an approved instance gets neither. `PlanInstancesSection` wires `onDaySwap={onDayDragSwap}`/`onWeekSwap={onWeekDragSwap}`, two thin wrappers around the same `swapDaysByRef`/`swapWeeksByRef` core the picker's `onSwapDays`/`onSwapWeeks` already use, each still `notify()`-ing on completion (AC5 applies here too). A dragged-over valid drop target gets a `.hra-swap-drop-target` outline (`index.css`, a plain `outline` using `var(--accent)` — not a color/background inline style, per this repo's theming rule). Because a Day row's own `draggable` div is nested inside its Week row's `draggable` div, starting a drag from a day correctly targets the day (the browser resolves to the *nearest* draggable ancestor to the drag gesture's start point) rather than accidentally dragging the whole week — verified by reasoning through the native DnD spec, not by a render test (no `TrainingPlanAccordion.test.tsx` exists to extend, same precedent HRA-118/125/126 already established for this file).
  - **Week-1 Monday-anchor warning, also in the editor (HRA-130).** The instantiate form's own non-blocking `week1AnchorMismatch` check (HRA-124 — day 1's calendar date should land on the weekday its D-number implies, Monday-anchored) only ever ran against the form's live `startDate` + the selected template's parsed `RunPlan`, neither of which exists once an instance is loaded for editing. `editorWeek1AnchorMismatch(sections)` recomputes the same check straight from the loaded instance's own resolved days instead — the `SectionView[]` `startEdit` already populates carries every day's real `date` and D-number (`DayView.day`) — so no template re-fetch/re-parse is needed. For each week numbered `1` (a plan can have more than one, if a section restarts its own numbering), it finds that week's own K0 day (lowest `day.day`) and checks whether that day's actual `date` falls on the weekday `(k0 - 1) % 7` implies; any mismatch anywhere shows the warning. Rendered with the exact same message/style as the instantiate form (same `week1AnchorWarning` i18n key), unconditionally of `isApproved` — it's informational only and never gates Save/Approve, which stay governed solely by `isApproved` as before. Fixed a pre-existing theming-rule violation on touch: both this warning and the instantiate form's original one used to set `color: "var(--accent-orange)"` as an inline style — moved to a new single-property `.hra-text-warning` utility class in `index.css` (same pattern as the existing `.hra-text-danger`/`.hra-text-success`), used by both sites now.
  - **Confirm before a day/week swap (HRA-131).** `onSwapDays`/`onSwapWeeks` (the picker's Swap button) and `onDayDragSwap`/`onWeekDragSwap` (the drag-and-drop equivalents, HRA-127 follow-up) no longer call `swapDaysByRef`/`swapWeeksByRef` directly — all four now only stage a `pendingDaySwap`/`pendingWeekSwap` (`{a, b}` refs), same pending-then-confirm/cancel shape `pendingTemplateId` already established for the instantiate form's template-switch warning. Two confirm modals (reusing that same modal markup/classes) name both sides concretely: the day modal shows `${instanceDayDateLabel(day.date)} (${workoutText})` for each side (`workoutText` = `day.dsl` with the `D<n>:` prefix stripped via the exported `DAY_PREFIX_RE`, same stripping `InstanceDayRow` already does for its own editable field); the week modal shows `week ${start} → ${end}` for each side via `weekDateRange()` — both sides of both modals use `instanceDayDateLabel()` (weekday-first), not a bare `fmtDate()`, per explicit review feedback asking for consistency with the day/week accordion formats below. Confirm runs the exact same `swapDaysByRef`/`swapWeeksByRef` + `notify()` as before; Cancel only clears the pending state, leaving `sections` untouched. **Two formatters moved out of `TrainingPlanAccordion.tsx` to fix new `react-refresh/only-export-components` lint warnings** (a component file exporting a plain function trips that rule) — `instanceDayDateLabel` to `utils/fmt.ts` (next to `fmtDate`/`fmtWeekdayShort`, which it composes) and `weekDateRange` to `domain/runplan-aggregate.ts` (a pure `WeekView` computation, alongside that file's other view-model builders); `TrainingPlanAccordion.tsx` now imports both rather than defining them, with no behavior change.

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

### ⚠️ Consistency rule — metric card layout and difference format (binding, whole app)
Established after the graph-first reorg kept drifting between rounds because each metric card
(`Stat`, `GraphKpiCard`, the old hero rings) had been styled slightly differently. **These two
conventions are now the ONE canonical shape for any card showing a metric + a period-over-period
comparison, anywhere in this app — not just this tab.** If a future ask seems to want a different
shape for a *specific* card, that is very likely a misunderstanding, not a deliberate exception:
**ask before building a one-off variant.**

1. **Vertical order, top to bottom, always:** indicator (icon + label) → value → difference. The
   indicator is never beside the value (that was tried and reverted — explicit feedback: "Metric
   indicator must be ON TOP").
2. **Difference format, always:** an arrow, then `{previous value} ({signed percentage})` — e.g.
   `↗ 40.02 km (-7%)`. **No connecting word** — no "vs", no "vs previous period:", nothing between
   the arrow and the value (explicit feedback, stated twice: "just show up or down arrow, value,
   percentage"). Never omit the arrow, never omit the previous value, never show a bare percentage
   with no context. (`comparisonTooltip()` in `OverviewTab.tsx` is the one function that builds this
   string — reuse it, don't hand-roll a shorter or longer variant per card. Its `prefix` parameter
   defaults to none; the By-sport row's inline combined tooltip is the one legitimate exception,
   since there each figure needs its own word — "sessions:", "HR:" — to read as one sentence.)
3. **A measure where LOWER is better (pace) still gets a positive percentage when it improved** — the
   raw current-vs-previous percentage is negative in that case, and showing it unmodified would
   contradict the (correctly green/up) arrow next to it. `comparisonTooltip()`'s `invert` parameter
   exists for exactly this; use it for pace, not for anything where higher is better (distance,
   activities, calories, HR-as-effort, etc.).
4. **Icon coloring**: heart matches whatever color its own value uses (HR is `--accent-red`
   app-wide); flame is a filled dark orange (`color-mix(in srgb, var(--accent-orange) 65%, black)`,
   both `stroke` and `fill`); every other icon uses the plain `var(--accent)` token. Two
   physiologically-themed exceptions, everything else uniform — not "whatever color felt right for
   that metric."
5. **Whether a difference shows at all is a single page-level `showDiff` flag**
   (`compareEnabled && viewMode === "overlap"`), not a per-card decision. Distinct mode shows each
   period's own numbers with no computed delta anywhere on the tab; overlap mode shows deltas
   everywhere. A card that decides this on its own (e.g. always showing a delta regardless of mode)
   is a bug, not a valid alternate reading.
6. **Every `Stat`'s leading icon is `size={18}`**, app-wide (dashboard design-system rework,
   "harmonize badges" — raised from 14 in the same pass; `GraphKpiCard`'s own icon stays a separate,
   deliberately smaller 16, per its own "smaller/plainer than Stat" design). Applies equally to the
   activity detail view's `StatGrid` (`ActivityDetailBody.tsx`) and `SpeedPaceStat.tsx` — those ten
   badges had no icon at all before this pass; every one now follows the Icon coloring rule above.

### ⚠️ Segmented switches (binding, whole app)
**Every in-view mode toggle uses `.hra-segment`/`.hra-segment-item` (index.css)** — dashboard
design-system rework, "harmonize switches". One joined pill per switch (the container clips its
children to a capsule shape, so the first/last segment is rounded at its outer edge only and every
middle segment is a plain rectangle, with no gap between segments), never a row of independently-
bordered pills. Covers: Overview's Overlap/Distinct, Single/Week/Month, and Match order/Match by time;
Body tab's Chart/Table; Settings' Units/Date format/Activity detail view pickers; the plan-instance
pace-mode picker; and the activity detail chart's Speed/Pace and Distance/Time switches (both were
previously bespoke inline styles, now the same shared class). `--segment-color` is the one
per-instance hook (defaults to `--accent`) — Speed/Pace is the one switch that overrides it, tinting
to the metric's own color (`METRIC_DEFS.speed.color`) instead of the app accent. **The header's own
primary nav tabs (`App.tsx`) deliberately keep `.hra-pill`/`.hra-pill-active`** (the louder
gradient+glow identity) — that's page navigation, not an in-view switch, and the two are intentionally
different controls. The earlier `.hra-toggle-pill`/`.hra-nav-pill--sm`/`.hra-segmented-group` classes
are gone — replaced entirely, not kept alongside the new one.

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
Per-theme×palette values (dashboard design-system rework — see the Appearance section above for the
full rationale). `--accent`/`--accent-green`/`--accent-red` differ per block; `--accent-blue` and
`--accent-orange` are close-but-tuned-per-block too. See `index.css`'s 4
`:root[data-theme="…"][data-palette="…"]` blocks for the authoritative values — this table is a quick
reference, not a duplicate source of truth:
```
Dark Metal:  --accent #3B82F6  --accent-green #22C55E  --accent-red #EF4444  --accent-orange #f59e0b
Dark Warm:   --accent #F59E0B  --accent-green #22C55E  --accent-red #EF4444  --accent-orange #d97706
Light Metal: --accent #2563EB  --accent-green #16A34A  --accent-red #DC2626  --accent-orange #d97706
Light Warm:  --accent #F59E0B  --accent-green #22C55E  --accent-red #D14343  --accent-orange #b45309
```

**Two further token families sit on top of the above (HRA-94, Design System Foundation), each with its own `@theme inline` mapping in `index.css` so they're usable both as `var(--x)` and as Tailwind utility classes (`bg-accent`, `text-data-pace`, …):**

- **Fixed semantic data colors** — `--data-pace` (`#4A8FC7`), `--data-hr` (`#C92F3D`), `--data-elev` (`#3a8ef5`), `--data-weight` (`#3a8ef5`), `--data-fat` (`#d97706`), `--data-muscle` (`#15965f`). Same metric = same color everywhere; these do **not** vary per theme — declared once in bare `:root`, not repeated per theme×palette block. `--data-pace`/`--data-hr` are each their ramp's fastest/highest anchor (the actual continuous gradients live in `components/activity/shared.ts`'s `SPEED_COLOR_STOPS`/`HR_COLOR_STOPS`, see the Activity detail chart section) and are deliberately theme-invariant by design (dashboard design-system rework sections 4/7) — never derived from `--accent`, unlike the chrome tokens above. `--data-hr` is deliberately its own red, distinct from `--accent-red` (system danger) — see section 8.
- **`--accent`** now governs interactive chrome only (buttons, active pills, links, rings, focus) and is fixed per theme×palette block (see the table above) — no longer independently user-selectable (the HRA-95 `AccentPicker` was removed in the dashboard design-system rework; see the Appearance section).

**Tailwind v4 + shadcn/ui setup**: `@tailwindcss/vite` plugin in `vite.config.ts`, `@import "tailwindcss";` at the top of `index.css`, `components.json` at the `garmin-dashboard/` root (style `new-york`, `cssVariables: true`, baseColor `zinc`), and `src/lib/utils.ts`'s `cn()` (clsx + tailwind-merge) for the `shadcn` CLI to target when later stories start adding components. No `tailwind.config.*` file — v4 is CSS-first, all configuration lives in `index.css`'s `@theme` block.

**Typography scale (dashboard design-system rework)** — 6 sizes app-wide, `--fs-display`(22px)/`--fs-heading`(18px)/`--fs-body`(15px)/`--fs-data`(16px)/`--fs-label`(13px)/`--fs-meta`(11px), each paired with an `--fw-*` weight (600/600/400/600/500/400). Applied throughout `index.css`'s own classes (KPI values, labels, buttons, tooltips, etc.); hierarchy comes from weight/spacing, not from adding more sizes. Literal font-size/font-weight values inside individual component TSX files (inline styles) are a separate, later sweep — not yet done.

Per-instance custom-property hooks declared in :root (2026-08-17) — --swatch-color (default var(--accent)), --kpi-color (default var(--text-primary)), --legend-color (default var(--text-secondary)). Components set them inline only where a value is genuinely per-instance; declaring them with defaults keeps every var() reference valid CSS without the inline hook and lets IDE inspection (WebStorm) resolve the names (it previously warned on all three).
--accent-glow removed (2026-08-17) — the fixed cyan pairing token existed for the two-glow ambient and the pill's second gradient stop; both went single-hue/monochromatic on 2026-08-17, so the token was deleted. --accent-light now serves both the hero ring (--accent-strong → --accent-light) and the active pill gradient.
Action-button primitive .hra-btn (2026-08-17) — filled/outline action buttons get a hover glow tinted to their own semantic color via a --btn-glow hook (same philosophy as .hra-swatch's per-swatch glow): data-variant="accent" | "green" | "danger" | "outline". Call sites to migrate: ManageTab's three sync buttons (green), SettingsTab Save (green), Delete/Restore/Purge (danger), .hra-chrome-preview-button (accent). The quiet hover glow was also extended to .hra-toggle-pill, .hra-date-trigger, .hra-select-trigger (box-shadow added to their transitions). All of it lives in index.css per the "styles live in index.css" rule; .hra-btn is included in the prefers-reduced-motion transition-none list.

## Form fields (canonical classes — check this before styling a new form)
Written after two consistency bugs on the same form (HRA-121's New Instance redesign) both came from
the same root cause: styling a field locally instead of checking what the rest of the app already
does. Read this section before adding or restyling a form — the goal is "look it up," not
"reconstruct it from the mockup."

- **Label text: Capital Case, never uppercase.** This is the one app-wide rule that actually matters —
  every label in the app (`PlanTemplatesSection.tsx`'s `<label>`s, `BodyTab.tsx`'s only `<table>`
  header) renders as plain Capital Case (`Name`, `Event type`, `Date`), never `text-transform:
  uppercase`. `PlanInstancesSection.tsx`'s `.hra-field-label` class (`font-size: 12px; font-weight:
  400; color: var(--text-secondary);`, no transform) is the canonical field-label style — reuse it,
  don't invent a per-form label style from a mockup's visual design. The same casing rule applies to
  table column headers, not just field labels — `.hra-anchor-table`'s two-tier header used to disagree
  with itself (uppercase main row vs Capitalized sub row) *and* with `BodyTab`'s plain headers; both
  are now Capital Case throughout.
- **Row height: target bare `input`, never `input[type="text"]` / `input[type="number"]`.** A CSS
  attribute selector only matches an attribute that is actually present in the rendered DOM — a
  `<input value={x} onChange={...} />` with no explicit `type=` prop still behaves as text, but
  `input[type="text"]` will never match it. This is exactly how three fields in the New Instance
  form's Row 1 silently fell through the height rule and rendered at the browser's unstyled default
  height next to fields that did match. Scope height rules to plain `input` (`.hra-instantiate-form
  input { height: var(--hra-field-h); }`), and still add an explicit `type="text"`/`type="number"` to
  every input in the JSX for its own sake (semantics, mobile keyboards) — but never let a selector's
  correctness *depend* on that attribute being remembered at every call site.
- **`DatePicker`'s trigger has a fixed 128px width by default** (`.hra-date-trigger`, sized for
  `DateRangeBar`'s own column-alignment needs) — it will not stretch to fill a grid/flex cell on its
  own. A form that wants its date field to span its column like every other field needs its own scoped
  override, e.g. `.hra-instantiate-form .hra-date-trigger { width: 100%; }` — don't assume a `Select`-
  or `input`-style `triggerStyle`/inline `width: "100%"` is enough; `DatePicker` doesn't expose a style
  prop, so the fix has to be a CSS rule, not a per-call-site prop.
- **Placeholders: one italic/muted style app-wide, `::placeholder` on the input, not per-field
  inline styling.** Prefix the placeholder text itself with `"e.g. "` only when it shows a concrete
  example value (`"e.g. 5:10/km"`, `"e.g. https://…"`) — leave purely instructional placeholders
  (`"Optional"`, `"Set a race date above"`) as plain text.
- **Number-input spinners**: removed via `-webkit-appearance: none` on the spin buttons +
  `-moz-appearance: textfield` / `appearance: textfield` on the input itself, scoped per form
  (`.hra-instantiate-form input[type="number"]::-webkit-outer-spin-button, ...`) — copy this rule into
  any new form that uses `type="number"` fields rather than re-deriving it.
- **Before adding a new field-styling rule to any form, grep for the pattern first**
  (`grep -rn "text-transform\|hra-field-label\|<label" garmin-dashboard/src` is a reasonable start) —
  the two bugs above both existed because the new form's styles were derived from a standalone mockup
  instead of from what `PlanTemplatesSection.tsx` / `BodyTab.tsx` already do. A mockup fixes layout and
  interaction; it is not the source of truth for typography/casing once real classes already exist.

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

**Warnings/`needs_review` (AC4)**: the *detailed* per-warning message list still only renders inside
each Day's own expanded panel — the day's `ParseWarning[]` list line-by-line when non-empty, a plain
"needs review" message when `needs_review` is true but the (instance-mode) day carries no structured
warnings at all (instance rows only ever have the 0/1 flag, never a warnings array).

**Title-bar summary, note tooltip, warning roll-up (follow-up pass, post-HRA-118)**: every level's
`AccordionCard` `title` is now a `TitleRow` — a small flex component (`AccordionCard.title` was
widened from `string` to `ReactNode` to allow this; every other existing caller, e.g.
`SettingsTab.tsx`'s cards, still just passes a string, which remains valid) carrying the label on the
left and, always visible regardless of expand state, a right-aligned cluster of: the level's own
computed totals (`compactTotals()` — the same figures the body's old `TotalsLine` showed, now joined
into one string and moved into the title; the separate body-level totals block was removed as
redundant once the title always shows it), a **⚠ warning badge** when any descendant day needs
review, and an **ⓘ note icon** (this app's existing generic `.hra-tooltip`/`data-tooltip` hover
pattern, `index.css`, previously only used on `Card`) when a note exists. The intent: reviewing a
plan's state — is anything flagged, is there a note worth reading — no longer requires expanding
anything; expanding is now only for the two things you can't get from the collapsed title: reading
the day's full warning list, or actually editing a field.

- **Warning roll-up is derived, never stored** (`weekHasWarnings(week) = week.days.some(d =>
  d.needs_review)`, `sectionHasWarnings(section) = section.weeks.some(weekHasWarnings)`) — matches
  `docs/runplan-dsl.md`'s own documented rule for this exact concept ("Week/section 'has warnings' is
  always derived by walking children… never stored"). A day flagged in week 2 shows the ⚠ badge on
  that Week's title **and** the owning Section's title, not just the Day's.
- **The now-redundant read-only note text blocks were removed** from Week/Section's expanded body
  (previously shown only for instance mode, since template mode already had an editable input) — the
  title's ⓘ tooltip covers the "glance at the note" need for both modes now; the editable Note
  `<input>` still lives in the body for template mode, since the tooltip is read-only by nature.
- **The default section's note is never shown via the tooltip** (`note={isDefaultSection ? undefined
  : section.notes}`) — consistent with that section having no real header line to hold a note against
  in the first place.
- **A Day's title label is its `dsl` text itself, not a bare `"D3"`** (reported: "the day summary must
  report the DSL too") — `day.dsl` is already the whole raw line (`"D3: 5km @ RG"`, `DayEntry.raw_dsl`
  carries the full original text including the `D`-prefix), so a separate label would only have been
  redundant; `TitleRow`'s existing ellipsis truncation handles a long workout line gracefully.
  **For an instance day (HRA-125), the `D<n>` placeholder prefix is swapped for the day's real
  calendar date + a 3-letter weekday abbreviation** (`TrainingPlanAccordion.tsx`'s `dayLabel()`, e.g.
  `"24/08/2026 Mon 5km @ RG"`) — `day.date` (`DayView.date`) is only ever set for instance days
  (`buildInstanceSectionView`), so template days (`day.date == null`) keep the unmodified `day.dsl`
  label exactly as before; only the prefix up to the D-line's colon is replaced, the workout text (and
  any trailing `# note`) after it stays untouched. Date formatting reuses `utils/fmt.ts`'s `fmtDate()`
  (the app's one date-format-setting-aware formatter); the weekday abbreviation is `fmtWeekdayShort()`
  in the same file — **localized to the app's current language** (`i18next.language`, HRA-129
  follow-up correction: originally fixed English `Mon`..`Sun` regardless of language, per this
  Story's own now-superseded reasoning about `fmtDateChart`'s numeric-only chart-axis ticks; corrected
  per explicit feedback that a plan reviewed in Italian must read `Lun`, not `Mon`) — same per-call
  `Intl.DateTimeFormat(language, { weekday: "short" })` pattern `localizedMonthShort()` already uses
  for a literal date's month token, not a cached formatter, since the language can change at runtime.

**Instance day row redesign (HRA-128)**: `DayEditor` is now a thin, hook-free dispatcher on
`day.date` (the same instance-vs-template signal `dayLabel()` above already uses) — `InstanceDayRow`
(`day.date != null`) replaces the click-to-expand `AccordionCard`+textarea with a single always-visible
compact row: a prominent, non-editable date badge (`.hra-day-date-badge`, `index.css` — `var(--accent)`
background/`var(--on-accent)` text, never derived from the theme's chart-color set) on the left, the
DSL as a single-line `<input>` (not a `<textarea>` — an instance day's DSL is always one line) and the
Notes `<input>` beneath it, both wired to the same `onEdit`/`onDayEdit` callback chain as before —
nothing new became editable. `readOnlyDays` (HRA-126) still renders plain text instead of the two
inputs, same lock semantics as before.

**D<n> prefix hidden from the instance DSL input (review follow-up)**: the raw `D<n>[suffix][tag]:`
prefix only carries meaning in template mode (it's how the DSL text addresses a specific day) — an
instance day already shows its real date via the date badge, so showing/editing the prefix too is
dead weight and confusing once the row became directly editable (HRA-128 originally round-tripped
the whole `day.dsl`, prefix included, straight through the `<input>`). `InstanceDayRow` now derives
`dayPrefix` (`day.dsl.match(DAY_PREFIX_RE)?.[0] ?? ""`) once, displays/edits only the remainder
(`workoutText`), and reattaches `dayPrefix` verbatim on every `onEdit({ dsl: ... })` call —
`recomposeDayLine`'s `patch.dsl` branch replaces the whole line, so dropping the prefix here would
otherwise silently corrupt `day.dsl` (losing the D-number that HRA-127's swap logic and the backend
parser both key off). The read-only (`readOnlyDays`) text path already stripped the prefix
identically before this fix; both paths now share the same `workoutText` derivation.

`TemplateDayRow` (`day.date == null`) is the original accordion-with-textarea layout, verbatim,
unmodified — templates were out of this Story's scope. The split into two components (rather than
one `DayEditor` with an early return) exists specifically so each branch's `useState`/`useDragSwap`
hooks are called unconditionally — an early return before a hook call inside one component would
violate the rules of hooks.

**Weekday-first day date + week date-range summary (HRA-129)**: the instance day date badge
(`InstanceDayRow`'s `dateBadge`, and `dayLabel()`'s now-unreachable-since-HRA-128 date branch) is
built by a shared `instanceDayDateLabel(date)` helper — weekday first, then the date, joined by
`", "` for a `_us` `date_format` region or a plain `" "` for `_uk`, e.g. `"Fri, Oct 17, 2025"` /
`"Fri, 08/17/2026"` (US) vs `"Fri 17 Oct 2025"` / `"Fri 17/08/2026"` (UK) — driven by
`utils/dateFormat.ts`'s `dateFormatRegion()`. **The comma is a US-vs-UK region rule, not a
literal-vs-numeric one** — confirmed with the user, since the Story text itself flagged this as
ambiguous (numeric_us reads `"Fri, 08/17/2026"` with the comma, same as literal_us). `fmtWeekdayShort`
itself is localized to the app's current language (see its own comment above) — only the
separator/order around it is driven by `date_format`'s region here. `WeekEditor`'s title `label`
(not its right-aligned `summary` — review follow-up, see below) now carries a `(start → end)` date
range (`weekDateRange()` — plain min/max over `week.days[].date`, pure derivation, no schema change)
appended right after `"Week N"`, using the same bracket punctuation `DateRangeBar.tsx`/
`manage/DateRangesSection.tsx` use for a named range — `(start → end)`, no `t()` wrapping (the
arrow/parens are punctuation, not a translatable label, matching those two existing call sites) —
**each side is `instanceDayDateLabel(date)`, the same weekday-first day format the day rows
themselves use, not a bare `fmtDate()`** (review follow-up: the initial version used `fmtDate()`
alone, e.g. `"(17 Oct 2026 → 23 Oct 2026)"`; corrected per explicit feedback that the week range
should read consistently with the day format — `"Week 1 (Sat 17 Oct 2026 → Fri 23 Oct 2026)"`).
**Placement in `label`, not `summary`, is itself a second review correction** — the range initially
appended to the right-aligned `compactTotals()` summary text; moved to sit directly next to the
`"Week N"` label per explicit feedback, since the range identifies *which* week this is (the
label's job), not a computed statistic about it (the summary's job) — `summary` is now
`compactTotals()` alone again, unchanged from before HRA-129. Template weeks (every
`day.date == null`) have nothing to derive a range from, so `weekDateRange()` returns `null` and
`label` falls back to the plain `"Week N"` text, unchanged.

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
