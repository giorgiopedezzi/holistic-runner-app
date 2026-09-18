# Workout classification

> Reference detail, loaded on demand. Preventive rules live in `AGENTS.md` and
> `.claude/rules/`; this file describes the current behavior.

Runs Free classifies an imported running activity into one of seven
actual-running categories, reusing the same training vocabulary planned
workouts already use (HRA-394). The user-facing product exposes one stored
system result and an optional manual override; it does not expose
implementation methods.

## Canonical actual-running taxonomy

`easy_recovery`, `long_run`, `intervals`, `progressive`, `threshold`, `tempo`
reuse planned-workout `TrainingLoadCategory` semantics 1:1 (same meaning, same
icon, same localized label). `tapasciata` (displayed "Tapasciata / Light
Maintenance") is the one actual-running-only category — the conservative
fallback for insufficient configured training context or evidence, not a
detected pattern. `cross_training`/`rest` are planned-only and never valid for
an imported running activity. Non-running sports (cycling, swimming, …) are
untouched by this taxonomy.

## Deterministic system result

`services/classification.service.ts` loads the activity, track points, and
the authenticated owner's current athlete metrics each time classification is
explicitly run. `domain/workout-metrics.ts` reduces track points into pace
variance and distance-based splits. The service then calls
`domain/stats-classifier.ts`'s `classifyByStatistics`; no sync/Settings write
triggers reclassification of an existing row.

The classifier's rule order:

1. current easy pace, current race pace, and current long-run target **all**
   missing → `tapasciata` immediately, before any other evidence check.
2. a clean descending pace staircase across splits → `progressive`.
3. a sawtooth pace pattern with high overall variance → `intervals`.
4. the day's clear distance/duration outlier (scaled by the current long-run
   target, or the general 15 km / 90 min fallback when absent) → `long_run`,
   regardless of pace tier.
5. otherwise, the run's average pace placed against the athlete's configured
   easy/race pace range (slowest/middle/fastest third) → `easy_recovery` /
   `tempo` / `threshold`. A single configured boundary (only easy pace, or
   only race pace) can still deterministically resolve `easy_recovery` or
   `threshold` on its own side of that boundary; missing both never fabricates
   the split.
6. insufficient evidence to place the run in any structured category →
   `tapasciata`.

**Pauses never define `tapasciata`.** Multiple real stops used to be an
unconditional first-checked rule; they no longer influence classification at
all — only missing training context or unresolvable pace evidence do.

Current easy pace and current race pace scale the existing pace-variance
threshold used by rule 3 when both are present and ordered. Current long-run
target replaces the existing 15 km distance threshold used by rule 4 when
present. These are explicit classifier fallbacks, not fabricated athlete
values, and the UI names every missing metric.

## Classification lifecycle

Classification is part of ingestion, not primarily an on-demand action.
`services/fit-import.service.ts`'s `importOne` computes and persists
`system_classification` for a running activity inside the same database
transaction as the activity/track-point insert — before that transaction
commits, using the domain-level `summarizeWorkout`/`classifyByStatistics`
calls directly (not a call to `classification.service.ts`, which runs its own
top-level statements rather than this transaction's client). A classifier
failure rolls back the whole import; there is no "imported but unclassified"
state. Both FIT archive import and Garmin sync converge on this same
`importOne` path, so neither duplicates classifier logic.

## Persistence and effective value

The `activities` table stores:

- `system_classification` / `system_explanation`: latest deterministic result;
- `manual_classification`: nullable persistent override.

The effective displayed value is
`manual_classification ?? system_classification`. Reclassification updates only
the system pair and therefore never replaces a manual override. Restoring the
system classification clears only `manual_classification`; it does not run the
classifier.

`jobs/backfill-actual-classification.ts` (`npm run
backfill:actual-classification`) is the one-time HRA-394 migration off the
retired vocabulary (`Recovery Run`, `Long Session`, `Repeats/Intervals`,
`Fartlek`, and the old `Progressive Run`/`Tapasciata / Light Maintenance`
spellings): it recomputes `system_classification` for every active running
activity through the classifier above (never a blind label-similarity
rename), maps a manual override of exactly the legacy `Tapasciata / Light
Maintenance` label to `tapasciata` (the one safe semantic equivalence), and
clears any other legacy manual value so the recomputed system result becomes
effective.

## Routes and UI

- `POST /api/v1/activities/:id/classify` with optional `{splitMeters}` runs the
  deterministic system classifier using metric values read at execution time.
- `PUT /api/v1/activities/:id/classification-override` with
  `{classification}` stores a manual override, validated against the seven
  canonical actual-running values (`domain/stats-classifier.ts`'s
  `ACTUAL_RUNNING_CLASSIFICATIONS`).
- `DELETE /api/v1/activities/:id/classification-override` clears the override
  and reveals the latest stored system result.

The current effective classification renders as icon + localized label
wherever it's shown (activity detail, activity row). A compact
shadcn/Radix icon dropdown (`components/activity/ClassificationPicker.tsx`)
is the normal control for changing it — no native `<select>`, no separate
Classify/Override workflow. Selecting an option calls the override PUT
directly; a "Use automatic classification" action clears it via the DELETE
route when a manual override is active. Explicit recalculation
(`ClassificationCard`'s secondary action) still calls `POST /classify` and
states that it uses current training settings. Guest/read-only users see the
effective classification but cannot mutate or recompute it.
