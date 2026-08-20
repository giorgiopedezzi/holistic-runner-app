# RunPlan DSL v1 (HRA-111)

> Reference detail, loaded on demand. Rules that PREVENT a mistake live in `CLAUDE.md`;
> this file DESCRIBES how the system works. Reachable from CLAUDE.md's routing table.

Pure-logic parser (no I/O, no DB, no HTTP — mirrors `fit-parser.ts`/`workout-metrics.ts`'s
domain-layer convention) at `garmin-stats/src/domain/runplan/`, for a line-based training-plan text
format. `garmin-stats/openapi.json` and `docs/schema.md`/`docs/api.md` do **not** yet cover this —
there is no persistence or HTTP surface for it (see "Scope" below).

## Files
- `types.ts` — `RunPlan`, `PlanMetadata`, `Section`, `Week`, `DayEntry`, `WorkoutSegment` (the
  `ContinuousSegment`/`IntervalSegment`/`ProgressionSegment`/`RestBlockSegment` union), `Target`
  (`DistanceTarget`/`DurationTarget`), `Intensity` (`AnchorIntensity`/`OffsetIntensity`/`AbsoluteIntensity`),
  `PacePolicy`, `ParseResult`/`ParseError`/`ParseWarning`, `DayParseContext`.
- `schema.ts` — Zod schemas mirroring every type in `types.ts`. `zod` is this backend's one
  deliberate exception to its zero-runtime-dependency default (confirmed for this Story).
- `parser.ts` — `parseRunPlanDSL(input: string): ParseResult` (the whole-document parser) and
  `parseDayEntry(rawLine: string, ctx: DayParseContext): DayEntry` (a single day, independent of
  the rest of the document — for a future "edit one day" UI flow).
- `pace.ts` — `getEffectivePacePolicy(plan, section, week): PacePolicy` and
  `resolveIntensityToPace(intensity, policy): PaceResolutionResult`, plus `detectCircularPaceRefs`.

## Grammar (line-based)
A document is `PLAN`, then metadata lines (`NAME`/`EVENT`/`DISTANCE`/`GOAL`/`START`/`UNIT`/
`OFFSET_UNIT`/`DEFAULT_REST`/`PACE`, only valid before the first `SECTION`/`WEEK`/`DAY` line),
then `SECTION "<name>" WEEKS <spec>` blocks (a default `{name:"Plan", week_spec:"*"}` section is
created if none is declared), each containing `WEEK <n> [START <date>]` blocks, each containing
`D<1-7><suffix?> [tag]?: <workout>` lines. Trailing `# note` is captured on `SECTION`/`WEEK`/`DAY`
lines; full-line `#...` comments and blank lines are ignored everywhere.

A day's workout is one of `REST`, `TODO` (→ `needs_review:true`), `CROSS <target> <description>`,
`STRENGTH <target> <description>`, or one or more `;`-separated segments:
- **continuous**: `TARGET @ INTENSITY`
- **interval**: `REPS x TARGET @ INTENSITY r: REST` — **the `r:` clause is mandatory.** An interval
  without it (`4x3000m @ RG-20`, no `r:`) is a hard `ParseError`
  (`"Interval segment must include rest between repetitions."`), not a warning — this is a
  deliberate amendment on top of the base grammar (see HRA-108's Jira description, §9.2, for the
  original text before this tightened).
- **progression**: `TARGET PROG START_INTENSITY -> END_INTENSITY`
- **rest_block** (only meaningful inside a `;`-joined multi-segment day): `REST TARGET [rest_type]`

`Target`s always need an explicit unit (`m`/`km`/`mi` distance, `s`/`sec`/`min`/`h`/`'` duration) —
normalized internally to meters/seconds. `Intensity` is a named anchor (`RG`, `FL`, `10K`, ...), an
anchor ± an offset (`RG-20`, explicit unit `RG-5s/mi` overrides `OFFSET_UNIT`), or an absolute pace
(`4:16/km`, `6:55/mi`) — normalized internally to seconds/km (mile conversions use `1609.34` for
distances and `1.60934` for pace/offset rates — same ratio, different units, both taken verbatim
from the spec's given constants).

## Pace scoping (Plan → Section → Week)
`PACE <ANCHOR>=<value>` lines are scoped by where they appear (§18): before any `SECTION`/`WEEK` →
plan-level; after a `SECTION` but before a `WEEK` → that section; after a `WEEK` → that week — even
if it appears after day entries already in the week (still applies to the whole week, with a
warning). `getEffectivePacePolicy` is a shallow merge, child overriding parent by anchor name;
`resolveIntensityToPace` follows offset chains (`FL = RG+45s/km`) against that merged policy and
detects circular references. **A relative anchor recalculates whenever its base anchor is
overridden in a more specific scope** — this is the DSL's central feature (see the golden-fixture
tests below for worked examples).

## Validity model (bottom-up, not whole-document all-or-nothing)
Built for a not-yet-implemented future UI: a nested accordion (Section → Week → Day) where one
day's error marks it invalid, cascading to an invalid week → invalid section → the plan can't be
saved, while a single day stays independently editable. Concretely: `DayEntry`/`Week`/`Section`/
`RunPlan` each carry `valid: boolean` + `errors: ParseError[]`; a week/section/plan is valid only if
its own `errors` is empty **and** every child is valid. `parseRunPlanDSL` returns `ok:false` (no
plan at all) only for genuinely unparseable input (missing `PLAN` header, empty input) — everything
else returns a full plan tree with the broken parts marked `valid:false`. `needs_review` (e.g. an
intensity referencing a pace anchor missing from the effective policy, HRA-108 §5.7) is a separate,
softer signal — a day can be `valid:true, needs_review:true`.

## Golden-fixture tests
`test/domain/runplan/parser.test.ts` includes two full 4-week plans as regression fixtures — a
Boston-style plan (miles, `RG`/`LONG` anchors, section+week pace overrides, mixed units) and an
Italian-style plan (km, `RG`/`FL`/`FM`/`STRIDE` anchors, progressions, multi-segment days,
`D6a`/`D6b` doubles, `TODO`). Both are reproduced verbatim, with every documented expected
resolution, in HRA-111's Jira description — treat that as the canonical source if the two ever
drift apart.

## Scope — what this Story does NOT cover
No persistence (DB tables, HTTP endpoints) — a parsed `RunPlan` is not yet saved anywhere. No UI
(the accordion described above doesn't exist). No planned-vs-actual comparison against
`activities`. See HRA-112 ("Training-plan templates") for the persistence/reuse layer built on top
of this parser.
