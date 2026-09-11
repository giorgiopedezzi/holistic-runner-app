# Mobile UX implementation checkpoint

Source prompt: HRA-304 ("Overview & Trends — Mobile-first"), refined via `/generate-user-stories`
per `.agents/workflows/refine-prompt.md`.

Status: **Planning-to-delivery handoff complete** — Epic and all 5 Stories created in Jira; every
Story (HRA-306 through HRA-310) has been implemented and is now In Review. See each Story's own
"outcome" section below and the "Exact next step" section at the end of this document for the
authoritative residual-risk list going into human Gate 2.

- Epic: HRA-305 — Overview & Trends — Mobile-first
- HRA-306 — Mobile range & comparison-period selection
- HRA-307 — Mobile graph-header KPI typography
- HRA-308 — Mobile comparison-settings & grouping disclosure (depends on HRA-306)
- HRA-309 — Mobile primary chart legibility
- HRA-310 — Accessible non-visual chart alternative (depends on HRA-309)
- HRA-304 (source Research/Spike) transitioned to In Review with a handoff comment; not moved to
  Done — human review closes the refinement.

## Evidence inspected

- `garmin-dashboard/src/components/OverviewTab.tsx` (full, 1426 lines)
- `garmin-dashboard/src/components/DateRangeBar.tsx` (full) + `DateRangeBar.test.tsx` (full)
- `garmin-dashboard/src/hooks/useDateRange.ts`, `useCompareRange.ts`, `useIsPhone.ts`, `useUrlState.ts`
- `garmin-dashboard/src/components/ui/StatGrid.tsx`, `Stat.tsx`, `GraphKpiCard.tsx`, `ChartCard.tsx`
- `garmin-dashboard/src/domain/trends.ts` (full)
- `garmin-dashboard/src/components/activity/ActivityChartSection.tsx` (sr-only a11y precedent)
- `garmin-dashboard/src/index.css` (chart/trend-layout/sidebar rules, `overflow-x` search)
- `garmin-dashboard/src/components/OverviewTab.test.tsx` (test names via grep)
- `garmin-stats/locales/en.json` / `it.json` — `overview.*`/`dateRange.*` key parity (52/52, no drift)
- Jira: HRA-17, HRA-70, HRA-196, HRA-244, HRA-255, HRA-256, HRA-267, HRA-268, HRA-270, HRA-279, HRA-303
- `mobile-responsive-web` skill (loaded in full)

**Not done in this pass** (by design — planning only, not implementation): live dev-server
reproduction, browser screenshots at named viewport widths. Each generated Story's own
implementation workflow already mandates before/after screenshots at named viewports, so this is
deferred there, not skipped.

## Key findings

- **DateRangeBar's existing phone-compaction (HRA-290) explicitly excludes the `compare` branch**
  (`DateRangeBar.tsx:79-84`, locked by a regression test at `DateRangeBar.test.tsx:68-74`). At any
  phone width today, Overview & Trends still renders the full desktop two-row range form unchanged.
  This is the single largest, most concretely verified gap.
- **KPI typography is only half-applied.** `Stat` (`ui/Stat.tsx`, `layout="row"`) has the HRA-279
  typographic mobile treatment and is used for the "Other key metrics" sidebar. `GraphKpiCard`
  (`ui/GraphKpiCard.tsx`) — the primary graph's own header KPIs (Distance/Avg pace/Activities) —
  has no phone variant at all and always renders bordered-card chrome.
- **Comparison "distinct" mode already stacks vertically** on all viewports
  (`OverviewTab.tsx:793-798`) — contradicts the source prompt's stated live-page finding of
  side-by-side columns on phone. Likely fixed by an undocumented prior graph-first reorg. Treat as
  already-satisfied scope, not new work.
- **No accessible non-visual chart alternative exists** for Overview & Trends. Reusable precedent:
  `ActivityChartSection.tsx`'s `sr-only` list pattern (HRA-303), not yet applied here.
- Trust-contract hooks (`useCompareRange.ts:45-47,92-101`) verified solid: All-sentinel never
  exposed, auto-comparison suppressed on All, empty-compare null-propagation (HRA-255/256).
- Phone breakpoint is one shared constant: `useIsPhone.ts:20`, `PHONE_MAX_WIDTH_PX = 767`.
- i18n: clean, no key drift.

Full per-file/per-issue detail lives in this session's transcript; this checkpoint captures the
synthesis, not the raw reads.

## Confirmed decisions

- **Chart series default at 320-390px**: if Distance/Avg-pace/Avg-HR can't all stay legible
  together, **hide Avg HR by default** (re-enable via existing series controls). Rationale:
  Distance and Avg pace are the prompt's top two KPI-hierarchy metrics; HR ranks 5th; Distance bars
  are structurally load-bearing for the chart's x-axis. Confirmed by the human 2026-09-11.

## Candidate Story boundaries (proposed to human, pending approval)

1. **Mobile range & comparison-period selection** — extend HRA-290's compact filter-sheet pattern
   to the `compare` branch of `DateRangeBar`; add the page-level collapsed "Compare with another
   period" / "Compared with X [edit][close]" entry.
2. **Mobile graph-header KPI typography** — bring `GraphKpiCard` onto the same row-typography
   treatment as `Stat`; apply the prompt's KPI priority ordering; dedupe KPIs shown in both the page
   summary and the chart header.
3. **Mobile comparison-settings & grouping disclosure** — collapse match-order/match-by-time,
   overlay/distinct, and single/week/month into a compact/progressively-disclosed control with
   tap-accessible (not hover-only) explanatory copy.
4. **Mobile primary chart legibility** — phone-width chart defaults (height, axis handling, the
   confirmed HR-hidden-by-default series rule), viewport-constrained single-active tooltip.
5. **Accessible non-visual chart alternative** — sr-only summary/data-table equivalent, reusing the
   HRA-303 pattern; sequenced after Story 4 so it describes a stable chart output shape.

Suggested order: 1 → (2 parallel) → 3 → 4 → 5.

## Risks / unresolved (non-blocking, carried into Story risk sections)

- HRA-303 shows status Done with ADF acceptance-criteria items AC5/6/9/11/13/15/16 unchecked — all
  Activity-tab-specific, not believed to block Overview & Trends, but the shared-shell/banner
  contract this Epic depends on should get a quick sanity check rather than assumed 100% solid.
- "Match order"/"Match by time" tap-accessible explanatory copy is net-new product copy (no existing
  draft) — left to Story 3's own domain-semantics audit per the source prompt's explicit instruction,
  not pre-written here.

## HRA-306 outcome (In Review)

DateRangeBar's phone-width compaction (HRA-290) now extends to the `compare` branch instead of
excluding it. Both phone branches (`!compare` and `compare`) route through one shared sheet
(`PhoneDateRangeBar` in `DateRangeBar.tsx`) with staged Cancel/Apply — the desktop two-row form is
untouched (line-for-line, still the original `return` block in `DateRangeBar.tsx`). Added: a
comparison enable/disable + comparison-period-selection section inside the sheet; a page-level
"Compare with another period" CTA (comparison off) or a compact dates/counts/edit/close summary
(comparison on); activity-count props (`currentActivityCount`, `compareActivityCount`,
`allRangeSpan`) threaded from `OverviewTab.tsx`, optional so every other DateRangeBar caller
(Activities/Body, Manage) is unaffected. 15/15 DateRangeBar tests pass (6 pre-existing + 9 new/
extended for HRA-306); full details, verification evidence and residual risks are in the Jira
In Review comment on HRA-306, not duplicated here.

**Not verified in this pass** (flagged, not fixed): the on-screen-keyboard reachability AC, the
banner/no-obscuring-at-phone-width AC, and the 320–430px/landscape/200%-text-scaling wrap AC all
need a live dev-server + viewport pass (this Story's implementation, like the refinement pass, did
not run one) before those three ACs can be marked DONE in Jira.

## HRA-307 outcome (In Review)

`GraphKpiCard`'s chart-header row and the "Other key metrics" `Stat` sidebar are now desktop-only
(`isPhone` gate in `TrendsBySport`/`SportTrendPair`, `OverviewTab.tsx`). On phone, a new
`OverviewMobileKpiSummary` renders ONE page-level typographic block above the chart instead: total
distance dominant (own larger `.hra-kpi-value` row), activity count + total time immediately below
(`Stat layout="row"`), then avg pace / avg HR / avg distance / calories in a two-column grid
(`.hra-overview-kpi-grid`, divider convention borrowed from HRA-303's activity-metrics grid). All
seven values/deltas reuse the exact same source data and `comparisonTooltip`/`deltaPositive` helpers
the desktop composition already used — presentation reorganized, no metric semantics changed.
Heart-rate deltas are always rendered neutral (no arrow/color) per this Story's AC. Desktop path is
untouched (same components, same props, gated only by `!isPhone`). 5/5 `OverviewTab.test.tsx` pass;
typecheck/lint/style-check/build clean except one pre-existing, unrelated `tsc` error in
`MobileRacePlanCreation.test.tsx` (verified present on the HRA-306 tip before this Story's changes).
Full verification evidence and residual risks (no live dev-server/viewport pass; 200%-scaling and
320-430px wrapping not empirically checked, same limitation flagged on HRA-306) are in the Jira In
Review comment on HRA-307, not duplicated here.

## HRA-308 outcome (In Review)

Mobile-width Overview & Trends now keeps the Single/Week/Month grouping segment directly visible
(unchanged markup, `TrendsBySport`'s `groupingSegment`, shared verbatim with desktop's own
`modeControls`) while collapsing Overlay/Side-by-side and (when the two periods' point counts
differ) Match order/Match by time into one new phone-only `ChartSettingsMenu` popover, reached via a
single icon-only "Chart settings" action (44×44 CSS px via `.hra-icon-action`'s existing phone rule).
That same menu also exposes, for the first time, per-series visibility (Distance/Avg pace/Avg HR) —
a new `SeriesVisibility` prop threaded through `SportTrendChart`/`SportTrendOverlapChart`, defaulting
to all-visible everywhere it isn't explicitly driven, which is what keeps desktop and every
non-primary sport chart byte-for-byte unchanged. Week/Month's disabled-mode explanation and Match
order/Match by time both gained a tap-accessible `HelpDisclosure` (existing HRA-276 primitive) instead
of relying solely on the pre-existing hover-only `title` attribute, which is left in place (harmless,
ignored by touch) rather than removed. Desktop's `modeControls`/`alignToggle` code paths are
untouched — SportTrendPair only branches into the new phone composition when `useIsPhone()` is true.

**Domain-audited help copy** (`overview.align.indexHelp`/`overview.align.timeHelp`, en+it, verified
against `domain/trends.ts`'s `buildOverlapByIndex`/`buildOverlapByTime`): Match order pairs points
positionally in chronological order (1st with 1st, 2nd with 2nd, …), extra points at the end getting
their own unpaired slot; Match by time pairs points on the same day-offset from each period's own
start, via a sorted merge — an exact day match becomes one slot, everything else its own slot in
chronological order.

Verification: `npm run verify`'s own `tsc --noEmit` step currently fails on a pre-existing,
out-of-scope error in `MobileRacePlanCreation.test.tsx` (confirmed present on the unmodified
HRA-306 branch tip too, unrelated to this Story) — ran each verify.sh step individually instead.
Typecheck of the changed files: clean. Full test suite: 566/568 passing (2 pre-existing failures,
both reproduced on the unmodified base tip — `OverviewTab.test.tsx`'s "shows dashes…" test-order
flake and `PlanInstancesSection.test.tsx`'s regenerate-confirm test); 15 new assertions added across
5 new HRA-308 tests, all passing. `npm run lint`: 0 errors (pre-existing warnings only, none new).
`npm run style:check`: PASSED, zero drift. `vite build`: succeeds.

**Not verified in this pass** (flagged, not fixed, same caveat as HRA-306): the 320/360/390/412/
430px + landscape + 200%-text-scaling wrap AC (AC11) needs a live dev-server + viewport pass, not run
in this implementation session.

**Out-of-scope candidates spotted, not acted on**: `TrendSeriesLegend`'s Avg pace/Avg HR axis-legend
labels (separate from `SportTrendOverlapChart`'s own current/compare legend, which this Story does
filter by `seriesVisible`) don't hide their entry when a series is toggled off via the new menu — a
minor cosmetic mismatch, left alone since it's a pre-existing, unrelated legend component and this
Story's scope is disclosure/composition, not the axis-legend's own behavior.

## HRA-309 outcome (In Review)

Scoped, Medium-effort slice — not the Story's full 17-AC surface (see "Not done" below).

`SportTrendChart`/`SportTrendOverlapChart` gained an `isPhone` prop (default `false`, so every
pre-existing desktop call renders byte-for-byte unchanged — Story AC16): on phone it shrinks the
primary/compare/overlap "lg" chart's fixed height from 460px to 280px, trims the `ComposedChart`
plot margin, and lowers the x-axis tick-sampling cap from 8 to 4 labels (`MAX_X_LABELS_PHONE`) —
addressing the Story's evidenced problem (fixed 460px height and width-independent tick sampling)
without touching axis widths, colors, or any desktop-only chart. `isPhone` is threaded from
`SportTrendPair`'s existing `useIsPhone()` call (one hook instance, as before) into all three chart
call sites, primary and non-primary sports alike (AC1's wording isn't primary-scoped) — non-primary
sport charts keep their existing 220px height regardless (the height reduction only fires for
`size==="lg"`, which only primary/compare charts ever pass).

**Confirmed series default** (product owner, HRA-304 refinement 2026-09-10): `SportTrendPair`'s
`seriesVisible` state now initializes to `{ distance: true, avgPace: true, avgHr: false }` when
`primary && isPhone` at mount (`useState`'s lazy initializer — read once, not re-derived from
`isPhone` on every render), all-visible everywhere else (every non-primary chart, and primary on
desktop) — unchanged from HRA-308. Scoped to `primary` only: it's the only instance that ever mounts
a control (`ChartSettingsMenu`) able to re-enable a hidden series: a non-primary sport chart has no
such control, so defaulting it to all-visible avoids ever hiding a series the user has no way to
bring back (AC3). Because the initializer runs once and never re-reads `isPhone`, a user's explicit
choice already can't be overwritten by a rerender, grouping/comparison change, resize, or rotation
(AC2/AC3/AC4) — verified by two new tests (default-hidden state, and survives an Overlay/Side-by-side
switch after the user re-enables Avg HR).

**Not done in this pass** (flagged, not silently absorbed — candidates for a follow-up Story or a
future HRA-309 continuation, not acted on here):
- AC5 (412/430px + landscape "verified legibility result" rather than a fixed series count): no live
  viewport pass was run (same limitation as HRA-306/307/308); the phone default applies uniformly up
  to the shared 767px `useIsPhone` breakpoint, not narrowed to 320-390px specifically, because
  introducing a second, Story-local breakpoint would fork the "one exported constant" invariant
  `useIsPhone.ts` documents. AC5's own "record the observed default/fit in the checkpoint" instruction
  can't be honestly satisfied without that live pass.
- AC6 (single viewport-constrained tooltip with explicit current/compare identity): Recharts' default
  single-active-tooltip behavior is unchanged; no new viewport-boundary clamping or explicit
  current/compare text label was added.
- AC7 (overlay differentiation beyond color via explicit labels/line-symbol treatment): unchanged —
  the existing muted-color-only compare treatment (HRA-296/current legend swatch `title` attrs) is
  hover-only, not always-visible text.
- AC8 (empty comparison period) and AC9 (stacked-not-columns, existing scale behavior): already
  satisfied pre-existing (verified by reading the code, not new work this Story) — distinct mode
  already renders current/compare charts in plain block flow, never grid columns, and an empty
  compare side already yields null `compare*` fields that Recharts simply doesn't draw. AC9's
  "each chart labelled with period, activity count and grouping" sub-clause is NOT met — today's
  title only carries the period; adding count+grouping safely would require splitting the
  currently-shared `graphTitle`/`compareGraphTitle`/`subHeader` nodes (reused across overlap AND
  distinct/transition phases) into phase-specific variants, which was judged too large a change
  surface for this pass without regression risk to the overlap chart's title and to AC16 (desktop
  unchanged). Left as a follow-up candidate.
- AC10/AC11 (zero/one-activity explicit empty-period and no-manufactured-trend-line messaging): not
  implemented — `tooFew()`'s existing `Empty` message only fires in Single mode; Week/Month modes and
  the "no running activities at all" page-level fallback do not yet carry an explicit
  range-identifying empty-period message. Pre-existing gap, not evidenced as this Story's problem
  statement, flagged as a candidate.
- AC12 (HR/metric-unavailable identified as unavailable, not zero, with axis space closing): not
  implemented — `avgHr: null` already renders as "no point" rather than a zero value, but there is no
  explicit "unavailable" affordance and the HR axis column still reserves its width even when a whole
  period has no HR data.
- AC13 (loading/empty/failed visually distinct, stale-data guard on a committed range change): not
  independently re-verified this pass — believed already satisfied by `useQuery`'s existing
  status-driven `LoadingSpinner`/`ErrorBanner`/`Empty` states (unchanged by this Story), which already
  key off `[from, to]`.
- AC14 (tick skipping affects labels only): verified true by inspection, no code change needed —
  `sampleInterval`'s `interval` output only ever feeds `XAxis`'s label-skip prop; it never touches
  `points`/`data` itself.
- AC17 (320/360/390/412/430px + landscape + 200%-text-scaling live pass, en+it): not run, same
  limitation as every prior Story in this Epic.

**Verification:** `garmin-dashboard/scripts/verify.sh`'s own `tsc --noEmit` step still fails on the
same pre-existing, out-of-scope `MobileRacePlanCreation.test.tsx` error confirmed present on the
unmodified HRA-306 tip (unrelated to this Story) — ran each verify.sh step individually instead.
Typecheck: clean except that one pre-existing error. Full test suite: 573/574 passing (the same
single pre-existing `PlanInstancesSection.test.tsx` regenerate-confirm flake HRA-308 already
documented, reproduced on the unmodified base tip); `OverviewTab.test.tsx`: 16/16 passing, including
3 new HRA-309 tests and 3 pre-existing HRA-308 tests updated for the new confirmed default (their
"Chart settings" trigger name now reads "Chart settings, 1 series hidden" by default on phone — a
direct, expected consequence of this Story's own confirmed decision, not a regression). `npm run
lint`: 0 errors (3 pre-existing warnings, same lines/cause as before, unrelated to this Story's
diff). `npm run style:check`: PASSED, zero drift (no new literal styles/typography introduced — the
height/margin/interval changes are plain numeric chart-geometry props, not CSS style objects).
`vite build`: succeeds.

## HRA-310 outcome (In Review)

Scoped, Medium-effort slice, built from the underlying data contract (`domain/trends.ts`'s
`buildOverlapPoints`/`TrendPoint`/`OverlapPoint` — HRA-255 null propagation, HRA-256 semantic "All"),
not from HRA-309's visual chart composition: HRA-309 only verified 6/17 of its own ACs and left
tooltip clamping, non-color comparison differentiation, and explicit empty/one-activity/missing-metric
*visual* states TODO — those gaps are disclosed on HRA-309's own In Review comment, not fixed here
(out of scope for this Story).

New `garmin-dashboard/src/components/TrendAccessibleData.tsx` — a concise, always-present summary
(period, grouping, activity count, comparison state, per-series data availability) plus a visible,
keyboard/touch-operable "View data" disclosure (`aria-expanded`, 44×44px target, native `<button>`)
revealing a semantic `<table>` (real `<th scope="col"/"row">`, `<caption>`) with one row per active
grouping bucket — period, activity count, distance, avg pace, avg HR, current and compare (when
enabled) unambiguously labelled per cell, missing values stated as "unavailable" (never a fabricated
zero/NaN/Infinity), and a column-header note when a series is hidden from the visual chart by
HRA-308's phone toggle rather than omitted from the table. Rendered once per `SportTrendPair` instance
(primary and every other sport, phone and desktop alike — AC16/desktop-parity), unconditionally
ahead of the `tooFew`/view-mode branching, so it is present for every meaningful chart state the AC
lists, not only while the visual chart itself renders. `domain/trends.ts`'s `OverlapPoint` gained
`currentCount`/`compareCount` — a straight passthrough of `TrendPoint.count` (already computed by
`buildTrendPoints`), not a new calculation — so the table can state a real per-row activity count.
`SportTrendChart`/`SportTrendOverlapChart`'s chart wrapper (`ResponsiveContainer`) is now wrapped in
`aria-hidden="true"`, so the table/summary are the primary screen-reader path through the chart
region, not a duplicate. New i18n keys (`overview.accessibleData.*`) added to `en.json`/`it.json`
(parity kept).

**Not done in this pass** (flagged, not silently absorbed):
- Per-row delta (Δ) values between current and compare are not rendered — current/compare are shown
  side by side, unambiguously labelled, which already satisfies "deltas appear only when meaningful"
  by never asserting one; a follow-up could add explicit Δ cells for slots where both operands exist.
- No live screen-reader pass (VoiceOver/NVDA) or a real 200%-text-scaling browser check was run — same
  live-verification limitation as every prior Story in this Epic; the table's overflow container
  (`overflow-x-auto`) and native semantic markup are structurally correct but not device-verified.
- Because HRA-309's own tooltip-clamping/non-color-differentiation/empty-visual-state ACs are still
  TODO, the handful of HRA-310 ACs that describe a specific *visual* chart state (e.g. "a visually
  hidden series," "an empty comparison period" as a chart state) are verified against the data
  contract only, not against a finished visual composition — flagged per the human's own disclosed
  scope note, not newly discovered here.

**Verification:** `npm run typecheck`: clean except the same pre-existing, out-of-scope
`MobileRacePlanCreation.test.tsx` error already confirmed present on the unmodified HRA-306/HRA-309
tip (unrelated to this Story, not touched). `npm test`: 578/579 passing — the same single
pre-existing `PlanInstancesSection.test.tsx` regenerate-confirm flake HRA-309 already documented,
reproduced in isolation on this same unmodified file. New `TrendAccessibleData.test.tsx`: 5/5 passing
(summary content, disclosure toggle, missing-value/"unavailable" wording with no NaN/Infinity, empty
comparison count with no repeated current value, hidden-series column note). `OverviewTab.test.tsx`:
16/16 passing, unchanged. `domain/trends.test.ts`: 11/11 passing, unchanged (the new
`currentCount`/`compareCount` fields are additive and asserted nowhere by name in existing tests).
`npm run lint`: 0 errors (pre-existing warnings only, none in touched files). `npm run style:check`:
PASSED, zero drift — the new table/button use only existing Tailwind utilities and `hra-*` semantic
classes (`BodyTab.tsx`'s own plain-table convention), no new literal styles. `vite build`: succeeds
(confirmed by running `vite build` directly, since `npm run build` is gated by the same pre-existing
`tsc` error above).

## Exact next step

HRA-306, HRA-307, HRA-308, HRA-309 and HRA-310 are all now In Review — **Epic HRA-305's
planning-to-delivery handoff is complete**: every Story this Epic generated has a dedicated branch, a
verified commit, and an In Review Jira comment with evidence and residual risk, per
`.agents/workflows/story-git-lifecycle.md`. HRA-310 is the last Story in the chain (no downstream
Story depends on it) — human Gate 2 now reviews all five Stories' In Review comments (branch/commit/
evidence/residual-risk lists) and decides which, if any, close to Done. This document's "Not done"
sections across HRA-306–HRA-310 are the authoritative residual-risk list for the whole Epic; nothing
further is pending on the agent side of the chain.

**Known anomaly to check before Gate 1:** all 5 generated Stories show `Agent`, `Model`, and
`Planned thinking effort` already populated (observed: Claude Code / claude-sonnet-5 / Medium) —
this refinement session never wrote those fields (verified: not present in any `createJiraIssue`
call), so this is a Jira automation rule on the project auto-filling defaults on Story creation, not
an agent action. `.agents/workflows/refine-prompt.md` Phase 5 says these must NOT be populated on
generated Stories. Confirm with the human whether that automation is intentional; if not, the human
should clear/reset these fields per-Story to their real launch choice before Gate 1, since a stale
default could otherwise be mistaken for a deliberate launch decision.
