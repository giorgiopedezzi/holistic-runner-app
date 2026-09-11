# Mobile UX implementation checkpoint

Source prompt: HRA-304 ("Overview & Trends — Mobile-first"), refined via `/generate-user-stories`
per `.agents/workflows/refine-prompt.md`.

Status: **DONE (planning)** — Epic and Stories created in Jira, source prompt handed off for human
review. Implementation has not started on any Story.

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

## Exact next step

HRA-306 and HRA-307 are both In Review — human Gate 2 decides whether either can close. HRA-308
depends on HRA-306 specifically (not HRA-307) — its Story branch should still fork from HRA-306's
tip, not HRA-307's, since HRA-307's own branch only adds independent Overview-page changes. Recommended
remaining order once HRA-306 clears: HRA-308 → HRA-309 → HRA-310 (HRA-307 already parallel-started).

**Known anomaly to check before Gate 1:** all 5 generated Stories show `Agent`, `Model`, and
`Planned thinking effort` already populated (observed: Claude Code / claude-sonnet-5 / Medium) —
this refinement session never wrote those fields (verified: not present in any `createJiraIssue`
call), so this is a Jira automation rule on the project auto-filling defaults on Story creation, not
an agent action. `.agents/workflows/refine-prompt.md` Phase 5 says these must NOT be populated on
generated Stories. Confirm with the human whether that automation is intentional; if not, the human
should clear/reset these fields per-Story to their real launch choice before Gate 1, since a stale
default could otherwise be mistaken for a deliberate launch decision.
