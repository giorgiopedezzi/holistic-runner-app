# Workout classification

> Reference detail, loaded on demand. Preventive rules live in `AGENTS.md` and
> `.claude/rules/`; this file describes the current behavior.

Runs Free classifies a running activity into one of the six existing workout
categories. The user-facing product exposes one stored system result and an
optional manual override; it does not expose implementation methods.

## Deterministic system result

`services/classification.service.ts` loads the activity, track points, and the
authenticated owner's current athlete metrics each time classification is
explicitly run. `domain/workout-metrics.ts` reduces track points into pace
variance, real pause events, and distance-based splits. The service then calls
`domain/stats-classifier.ts`; no sync or Settings write triggers classification.

The classifier preserves its existing rule order:

1. multiple real pauses → Tapasciata / Light Maintenance;
2. consistently faster splits → Progressive Run;
3. high variance plus repeated direction changes → Repeats/Intervals;
4. otherwise-high variance → Fartlek;
5. long distance/duration → Long Session;
6. otherwise → Recovery Run.

Current easy pace and current race pace scale the existing pace-variance
threshold when both are present and ordered. Current long-run target replaces
the existing 15 km distance threshold when present. Missing pace dimensions
retain the general 0.5 min/km variance rule; a missing long-run target retains
the general 15 km / 90 minute rule. These are explicit classifier fallbacks,
not fabricated athlete values, and the UI names every missing metric.

Split granularity remains an explicit 1 km / 0.5 km input. `computeSplits`
uses segment duration divided by segment distance, includes the trailing
partial split, and never averages instantaneous paces.

## Persistence and effective value

The `activities` table stores:

- `system_classification` / `system_explanation`: latest deterministic result;
- `manual_classification`: nullable persistent override.

The effective displayed value is
`manual_classification ?? system_classification`. Reclassification updates only
the system pair and therefore never replaces a manual override. Restoring the
system classification clears only `manual_classification`; it does not run the
classifier.

Migration `009_system_classification_override.sql` preserves earlier data. It
derives the system result from the previously confirmed source when known,
otherwise prefers the stored deterministic result, and maps a rejected/final
correction to the manual override. The earlier AI/statistical/feedback columns
remain for compatibility but no longer drive the classification UI.

## Routes and UI

- `POST /api/v1/activities/:id/classify` with optional `{splitMeters}` runs the
  deterministic system classifier using metric values read at execution time.
- `PUT /api/v1/activities/:id/classification-override` with
  `{classification}` stores a manual override.
- `DELETE /api/v1/activities/:id/classification-override` clears the override
  and reveals the latest stored system result.

`ClassificationCard` shows the effective category plus “Classified by Runs
Free” or “Classified by you.” Before classification it warns that current—not
activity-date—metrics are used. Authenticated users with missing metrics see
the missing field names and a Settings link; classification may still proceed
with the documented fallbacks. Guest controls remain non-persisting/disabled.

Data & Sync keeps sequential per-activity classification for truthful progress;
there is deliberately no bulk classifier route.
