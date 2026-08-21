# RunPlan DSL v1 (HRA-111, amended HRA-113)

> Reference detail, loaded on demand. Rules that PREVENT a mistake live in `CLAUDE.md`;
> this file DESCRIBES how the system works. Reachable from CLAUDE.md's routing table.

Pure-logic parser (no I/O, no DB, no HTTP — mirrors `fit-parser.ts`/`workout-metrics.ts`'s
domain-layer convention) at `garmin-stats/src/domain/runplan/`, for a line-based training-plan text
format. Persistence + HTTP surface (templates, instances, generate/save/approve) is built on top of
it — see `docs/schema.md`'s `plan_templates`/`plan_instances`/`plan_instance_days` section and
`docs/api.md`'s plan-templates/plan-instances endpoints (HRA-112, amended HRA-113).

## Files
- `types.ts` — `RunPlan`, `PlanMetadata`, `Section`, `Week`, `DayEntry`, `WorkoutSegment` (the
  `ContinuousSegment`/`IntervalSegment`/`ProgressionSegment`/`RestBlockSegment` union), `Target`
  (`DistanceTarget`/`DurationTarget`/`UnknownTarget`), `Intensity`
  (`AnchorIntensity`/`OffsetIntensity`/`AbsoluteIntensity`/`UnknownIntensity`),
  `PacePolicy`, `ParseResult`/`ParseError`/`ParseWarning`, `DayParseContext`.
- `schema.ts` — Zod schemas mirroring every type in `types.ts`. `zod` is this backend's one
  deliberate exception to its zero-runtime-dependency default (confirmed for this Story).
- `parser.ts` — `parseRunPlanDSL(input: string): ParseResult` (the whole-document parser) and
  `parseDayEntry(rawLine: string, ctx: DayParseContext): DayEntry` (a single day, independent of
  the rest of the document — for a future "edit one day" UI flow).
- `pace.ts` — `getEffectivePacePolicy(plan, section, week): PacePolicy` and
  `resolveIntensityToPace(intensity, policy): PaceResolutionResult`, plus `detectCircularPaceRefs`.
- `instantiate.ts` — `instantiatePlan(plan, options): ResolvedDay[]`, resolving a template's
  symbolic paces into concrete `*_sec_per_km` values for one race (HRA-112).

## Grammar (line-based)
A document is `PLAN`, then metadata lines (`NAME`/`EVENT`/`DISTANCE`/`GOAL`/`START`/`UNIT`/
`OFFSET_UNIT`/`DEFAULT_REST`/`PACE`, only valid before the first `SECTION`/`WEEK`/`DAY` line),
then `SECTION "<name>" WEEKS <spec>` blocks (a default `{name:"Plan", week_spec:"*"}` section is
created if none is declared), each containing `WEEK <n> [START <date>]` blocks, each containing
`D<1-7><suffix?> [tag]?: <workout>` lines. Trailing `# note` is captured on `SECTION`/`WEEK`/`DAY`
lines; full-line `#...` comments and blank lines are ignored everywhere.

A day's workout is one of `REST`, `TODO` (→ `needs_review:true`), `CROSS [<target>] <description>`,
`STRENGTH [<target>] <description>`, or one or more `;`-separated segments:
- **continuous**: `TARGET @ INTENSITY`
- **interval**: `REPS x TARGET @ INTENSITY [r: REST]` — the `r:` clause is **optional** (HRA-113
  reverses HRA-111's earlier mandatory-rest amendment): an interval without it
  (`4x3000m @ RG-20`, no `r:`) still parses, producing a `ParseWarning` ("Interval segment has no
  rest specified between repetitions.") and `needs_review:true` on that day, never a hard rejection.
- **progression**: `TARGET PROG START_INTENSITY -> END_INTENSITY`
- **rest_block** (only meaningful inside a `;`-joined multi-segment day): `REST TARGET [rest_type]`

`Target`s normally need an explicit unit (`m`/`km`/`mi` distance, `s`/`sec`/`min`/`h`/`'`
duration) — normalized internally to meters/seconds. `Intensity` is a named anchor (`RG`, `FL`,
`10K`, ...), an anchor ± an offset (`RG-20`, explicit unit `RG-5s/mi` overrides `OFFSET_UNIT`), or
an absolute pace (`4:16/km`, `6:55/mi`) — normalized internally to seconds/km (mile conversions use
`1609.34` for distances and `1.60934` for pace/offset rates — same ratio, different units, both
taken verbatim from the spec's given constants).

**`CROSS`/`STRENGTH` target is optional (HRA-113)** — validation for these two day types is
presence-only, no pace/duration/distance required at all. `STRENGTH core` (description only, no
target) is valid, `needs_review:false`. If the text after the keyword starts with a token that
parses as a real `Target` *and* there's more text after it, that first token is still captured as
`activity_target` (e.g. `CROSS 45min bike` → target=45min, description="bike"); otherwise the whole
remainder is just the description.

**The `?` placeholder (HRA-113):** a literal `?` is valid anywhere a `Target`, `Intensity`, or an
interval's rep-count is expected — always accepted, never a parse failure, always producing a
specific `ParseWarning` naming what was unclear (`"Work target is unspecified or unrecognized: ?"`,
`"Number of repetitions is unspecified."`, etc.). This is distinct from the whole-day `TODO` type:
`?` marks *partial* ambiguity within an otherwise fully-specified session (e.g.
`10km @ FL ; 8x? @ ?` — the first segment is completely known, only the strides aren't), where
`TODO` marks the whole day as not yet planned. Any other token the parser can't make sense of falls
back to the same `{kind:"unknown", raw: token}` shape as an explicit `?` — the placeholder isn't
special-cased in the grammar, it's just a token that fails every specific pattern the same way
garbage input does.

## Pace scoping (Plan → Section → Week)
`PACE <ANCHOR>=<value>` lines are scoped by where they appear (§18): before any `SECTION`/`WEEK` →
plan-level; after a `SECTION` but before a `WEEK` → that section; after a `WEEK` → that week — even
if it appears after day entries already in the week (still applies to the whole week, with a
warning). `getEffectivePacePolicy` is a shallow merge, child overriding parent by anchor name;
`resolveIntensityToPace` follows offset chains (`FL = RG+45s/km`) against that merged policy and
detects circular references. **A relative anchor recalculates whenever its base anchor is
overridden in a more specific scope** — this is the DSL's central feature (see the golden-fixture
tests below for worked examples).

## Warnings-only model (HRA-113 — no more hard parse errors)
Everything the parser encounters short of two document-level cases degrades to a `ParseWarning`,
never a rejection — reverses HRA-111's earlier bottom-up `valid`/`errors` model (`DayEntry`/`Week`/
`Section`/`RunPlan` no longer carry `valid`/`errors` at all; those fields were removed, not just
deprecated). `parseRunPlanDSL` still returns `ok:false` (no plan at all) for genuinely unparseable
input — **empty input, or a document missing the `PLAN` header as its first line** — nothing
broader; everything else returns a full plan tree, with problem days flagged instead of the parse
failing.

**`DayEntry.warnings: ParseWarning[]`** holds every day-scoped issue (missing interval rest, an
unresolved pace anchor, an unrecognized token, a `?` placeholder, invalid day-line syntax).
`needs_review` is `true` whenever a day has any warnings (or is a `TODO`). Plan/section/week-scoped
issues (an unrecognized top-level line, a `PACE` value that doesn't parse, a circular pace
reference) live in the top-level `ParseResult.warnings` array instead — day-scoped and plan-scoped
warnings are two separate lists, not one flattened one. **Week/section "has warnings" is always
derived by walking children (any day → any week → any section), never stored** — same pattern
`valid` used before its removal.

This was built for a not-yet-implemented accordion review UI (Section → Week → Day): any day is
editable regardless of whether it's flagged, warnings clear only when the underlying data changes
(no "dismiss without fixing"), and saving a template/instance is gated on the tree carrying zero
warnings anywhere (`docs/schema.md`'s "two independent save gates" — gate 1, automatic zero-warning
check; gate 2, a separate deliberate `approved_at` sign-off, revoked by any edit). See
`docs/schema.md` and `docs/api.md` for the persisted gate/endpoint details
(`POST /api/v1/plan-templates/generate`, `.../approve`, `PUT /api/v1/plan-instances/:id`).

## Golden-fixture tests
`test/domain/runplan/parser.test.ts` includes two full 4-week plans as regression fixtures — a
Boston-style plan (miles, `RG`/`LONG` anchors, section+week pace overrides, mixed units) and an
Italian-style plan (km, `RG`/`FL`/`FM`/`STRIDE` anchors, progressions, multi-segment days,
`D6a`/`D6b` doubles, `TODO`). Both are reproduced verbatim, with every documented expected
resolution, in HRA-111's Jira description — treat that as the canonical source if the two ever
drift apart. Neither fixture exercises the HRA-113 warnings-only paths (missing rest, `?`,
optional `CROSS`/`STRENGTH` target) — those are covered by separate, smaller unit tests in the same
file.

## Scope — what this Story does NOT cover
No UI (the accordion described above doesn't exist yet — HRA-113 only builds the backend surface it
depends on: generate/save/approve/edit endpoints, the warning model). No planned-vs-actual
comparison against `activities`. No AI-assisted transcription. `CROSS`/`STRENGTH` days stay excluded
from any future planned-vs-actual comparison — presence is all that's ever validated for them.

## Future direction (not implemented)
Some discussion from before HRA-113 remains open — AI-assisted transcription of messy real-world
plans into this format, and `plan_instances` gaining its own `name`/`event` columns (discussed, not
part of HRA-113's shipped slice). See `docs/runplan-dsl-future-notes.md` before starting any
follow-on Story in this area — most of that file's items are now resolved and shipped (this note),
but it still records what's genuinely still open.
