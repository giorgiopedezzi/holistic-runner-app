// ── Shared reporting domain — the trust-contract boundary (HRA-335) ─────────
// Pure, no I/O — the one reproducible calculation engine every report scope
// is meant to share (this Story's own "User value / intent"), so callers
// never re-derive Original-vs-Current-vs-Actual trust independently. All raw
// rows arrive already loaded by the caller (a future report-consuming
// Story's service, e.g. HRA-336) — this module never queries the DB and
// never touches track_points, so "aggregate-only avoids raw streams" holds
// by construction rather than by caller discipline (this Story's own Scope:
// "supply aggregate and detail-ready results without loading unnecessary raw
// streams").
//
// Contract for `activities`/`associations` below: the CALLER is responsible
// for narrowing these to the instance's own relevant window (same "caller
// scopes the query, domain stays pure" division of labor as
// workout-association.ts's reconcileAssociations) — this function does not
// re-derive which activities are candidates, only how to classify the ones
// it's given.
import type { PlanInstanceDayRow } from "../../db.ts";
import { computeWorkoutDayStatus } from "../workout-association.ts";
import type { OriginalDaySnapshot } from "../runplan/lineage.ts";
import type { ResolvedSegment } from "../runplan/instantiate.ts";
import { localDateInTimeZone, SCHEDULE_TIMEZONE_BACKFILL_FALLBACK } from "../plan-timezone.ts";
import { classifyActualPopulation, classifyScopeBoundary, type AssociationLookup } from "./scope.ts";
import { aggregatePaceSecPerKm, type DistanceTimeRecord } from "./metrics.ts";
import { computePlannedDayDistance, computePlannedDayDurationSec } from "./planned-metrics.ts";
import type {
  AcceptedEvidence, ComparisonDimension, DatasetMetrics, DimensionDenominator, DrillDownIds,
  ExecutionEntry, OutcomeEntry, ReportRangeMode, ReportRequest, ReportResult, WorkoutEvidenceState,
} from "./types.ts";

export interface ReportInstanceInput {
  id: number;
  schedule_timezone: string | null;
  original_start_date: string | null;
  original_days_snapshot: string | null;
}

export interface ReportActivityInput {
  activity_id: number;
  activity_date: string;
  distance_m: number | null;
  duration_sec: number | null;
}

export interface ReportInputs {
  instance: ReportInstanceInput;
  currentDays: PlanInstanceDayRow[];
  associations: AssociationLookup[];
  activities: ReportActivityInput[];
  now?: Date; // injectable for tests, same convention as plan-timezone.ts/workout-association.ts
}

// The full bundle, always computed internally regardless of the request's
// own metric selection — pace needs distance+duration either way, and
// computing all three over already-in-memory rows costs nothing worth
// gating. `selectMetrics` below is what actually enforces AC1's selection.
interface FullDatasetMetrics { distanceM: number; approximate: boolean; durationSec: number; paceSecPerKm: number | null }

function plannedMetrics(days: { workout_type: string; segments: string }[]): FullDatasetMetrics {
  let meters = 0;
  let approximate = false;
  let durationSec = 0;
  for (const day of days) {
    if (day.workout_type !== "run") continue;
    const segments = JSON.parse(day.segments) as ResolvedSegment[];
    const distance = computePlannedDayDistance(day.workout_type, segments);
    meters += distance.meters;
    approximate = approximate || distance.approximate;
    durationSec += computePlannedDayDurationSec(day.workout_type, segments);
  }
  return { distanceM: meters, approximate, durationSec, paceSecPerKm: aggregatePaceSecPerKm([{ distanceM: meters, timeSec: durationSec }]) };
}

function actualMetrics(accepted: AcceptedEvidence[], activitiesById: Map<number, ReportActivityInput>): FullDatasetMetrics {
  let meters = 0;
  let durationSec = 0;
  const records: DistanceTimeRecord[] = [];
  for (const evidence of accepted) {
    const activity = activitiesById.get(evidence.activity_id);
    if (!activity) continue;
    if (activity.distance_m != null) meters += activity.distance_m;
    if (activity.duration_sec != null) durationSec += activity.duration_sec;
    records.push({ distanceM: activity.distance_m, timeSec: activity.duration_sec });
  }
  return { distanceM: meters, approximate: false, durationSec, paceSecPerKm: aggregatePaceSecPerKm(records) };
}

// AC1: projects the always-computed full bundle down to exactly the metrics
// the request asked for — an unselected field is ABSENT from the result,
// never present-as-zero (AC14).
function selectMetrics(full: FullDatasetMetrics, metrics: ReportRequest["metrics"]): DatasetMetrics {
  const result: DatasetMetrics = {};
  if (metrics.includes("distance")) { result.distanceM = full.distanceM; result.approximate = full.approximate; }
  if (metrics.includes("duration")) result.durationSec = full.durationSec;
  if (metrics.includes("pace")) result.paceSecPerKm = full.paceSecPerKm;
  return result;
}

function toEvidenceState(status: "pending" | "missed" | "completed"): WorkoutEvidenceState {
  return status === "pending" ? "upcoming" : status;
}

// AC4: plan_to_date drops `upcoming` rows entirely; full_plan keeps them as
// context, flagged out of the denominator via includedInDenominator=false.
// HRA-338: `isInRange` also carries the week-membership filter (a no-op
// "always true" at plan granularity, so full_plan/plan_to_date-only callers
// see no behavior change — the `range==="plan_to_date"` skip below already
// excludes the same future dates isInRange's own range half would) — at week
// granularity it keeps a week-scoped report's execution/outcome entries
// confined to THIS week's own days, the same way datasets below already are,
// rather than leaking the whole plan's entries into a "week" report.
function buildExecutionEntries(
  currentDays: PlanInstanceDayRow[], acceptedByWorkout: Map<string, AcceptedEvidence>,
  timeZone: string, asOf: Date, range: ReportRangeMode, isInRange: (date: string) => boolean,
): ExecutionEntry[] {
  const entries: ExecutionEntry[] = [];
  for (const day of currentDays) {
    if (day.workout_type !== "run") continue;
    if (!isInRange(day.date)) continue;
    const evidence = acceptedByWorkout.get(day.workout_id) ?? null;
    const state = toEvidenceState(computeWorkoutDayStatus(day.date, timeZone, evidence != null, asOf));
    if (state === "upcoming" && range === "plan_to_date") continue;
    entries.push({ workout_id: day.workout_id, scheduled_date: day.date, state, evidence, includedInDenominator: state !== "upcoming" });
  }
  return entries;
}

// AC5: keyed off the ORIGINAL date, never Current's — a workout that moved
// is still judged against when it was ORIGINALLY due, so adaptation
// (Original-vs-Current) and outcome (Original-vs-Actual) never blend.
// Entries with no Original counterpart at all (lineage "added") are outside
// outcome's own definition and are never fabricated here (AC5/AC14).
function buildOutcomeEntries(
  originalDays: OriginalDaySnapshot[], acceptedByWorkout: Map<string, AcceptedEvidence>,
  timeZone: string, asOf: Date, range: ReportRangeMode, isInRange: (date: string) => boolean,
): OutcomeEntry[] {
  const entries: OutcomeEntry[] = [];
  for (const day of originalDays) {
    if (day.workout_type !== "run") continue;
    if (!isInRange(day.date)) continue;
    const evidence = acceptedByWorkout.get(day.workout_id) ?? null;
    const state = toEvidenceState(computeWorkoutDayStatus(day.date, timeZone, evidence != null, asOf));
    if (state === "upcoming" && range === "plan_to_date") continue;
    entries.push({ workout_id: day.workout_id, original_date: day.date, state, evidence, includedInDenominator: state !== "upcoming" });
  }
  return entries;
}

function summarizeDenominator(entries: { state: WorkoutEvidenceState }[]): DimensionDenominator {
  let completed = 0, missed = 0, upcoming = 0;
  for (const e of entries) {
    if (e.state === "completed") completed++;
    else if (e.state === "missed") missed++;
    else upcoming++;
  }
  return { total: completed + missed, completed, missed, upcoming };
}

function wantsDimension(request: ReportRequest, dimension: ComparisonDimension): boolean {
  return request.dimensions.includes(dimension);
}

// HRA-338: every date belonging to the requested week, checked directly
// against each day's OWN section_name/week_number (never inferred through a
// date lookup) — matches lineage.ts's own "moved" definition (structural
// slot, not calendar date), so a workout whose date shifted but whose
// section/week didn't is correctly still "this week", and one that moved to
// a DIFFERENT section/week is correctly excluded even if its old date would
// otherwise fall inside this week's calendar span.
function weekMembershipDates(
  days: { date: string; section_name: string; week_number: number }[],
  week: { section_name: string; week_number: number },
): Set<string> {
  const dates = new Set<string>();
  for (const d of days) {
    if (d.section_name === week.section_name && d.week_number === week.week_number) dates.add(d.date);
  }
  return dates;
}

export function buildReport(request: ReportRequest, inputs: ReportInputs): ReportResult {
  const timeZone = inputs.instance.schedule_timezone ?? SCHEDULE_TIMEZONE_BACKFILL_FALLBACK;
  const now = inputs.now ?? new Date();
  const asOf = request.asOf ?? now;
  const asOfLocalDate = localDateInTimeZone(asOf, timeZone);

  // AC4: full_plan treats every date as "in range" (future stays visible as
  // context); plan_to_date is a hard local-date cutoff at `asOf`.
  const rangeFilter = request.range === "full_plan" ? () => true : (date: string) => date <= asOfLocalDate;

  const originalDays: OriginalDaySnapshot[] = inputs.instance.original_days_snapshot != null
    ? (JSON.parse(inputs.instance.original_days_snapshot) as OriginalDaySnapshot[])
    : [];

  // HRA-338: granularity "week" ANDs a week-membership filter on top of the
  // same range filter above — plan_to_date/full_plan still governs future
  // handling WITHIN the requested week, exactly as it already does for the
  // whole plan (AC4's "plan-to-date is the default execution scope" applies
  // identically at week granularity).
  const weekFilter = request.granularity === "week" && request.week
    ? (() => {
      const dates = weekMembershipDates([...originalDays, ...inputs.currentDays], request.week!);
      return (date: string) => dates.has(date);
    })()
    : () => true;

  // HRA-341: an explicit calendar-date window (date-range/race-range
  // reports) — ANDed on top of the existing filters, same composition as
  // weekFilter above; a no-op "always true" for every caller that never
  // sets dateWindow, so week/plan reports see no behavior change.
  const windowFilter = request.dateWindow
    ? (date: string) => date >= request.dateWindow!.from && date <= request.dateWindow!.to
    : () => true;

  const isInRange = (date: string) => rangeFilter(date) && weekFilter(date) && windowFilter(date);

  const scope = classifyScopeBoundary(originalDays, inputs.currentDays, isInRange);

  const associationsByActivity = new Map<number, AssociationLookup>(inputs.associations.map(a => [a.activity_id, a]));
  const actual = classifyActualPopulation(inputs.activities, associationsByActivity, timeZone);
  const acceptedByWorkout = new Map(actual.accepted.map(e => [e.workout_id, e]));

  const comparisons: ReportResult["comparisons"] = {};
  const denominators: ReportResult["denominators"] = {};

  if (wantsDimension(request, "adaptation")) comparisons.adaptation = scope;

  if (wantsDimension(request, "execution")) {
    const entries = buildExecutionEntries(inputs.currentDays, acceptedByWorkout, timeZone, asOf, request.range, isInRange);
    comparisons.execution = entries;
    denominators.execution = summarizeDenominator(entries);
  }

  if (wantsDimension(request, "outcome")) {
    const entries = buildOutcomeEntries(originalDays, acceptedByWorkout, timeZone, asOf, request.range, isInRange);
    comparisons.outcome = entries;
    denominators.outcome = summarizeDenominator(entries);
  }

  const activitiesById = new Map(inputs.activities.map(a => [a.activity_id, a]));
  const datasets: ReportResult["datasets"] = {
    original: selectMetrics(plannedMetrics(originalDays.filter(d => isInRange(d.date))), request.metrics),
    current: selectMetrics(plannedMetrics(inputs.currentDays.filter(d => isInRange(d.date))), request.metrics),
    actual: selectMetrics(actualMetrics(actual.accepted, activitiesById), request.metrics),
  };

  const coverage: ReportResult["coverage"] = {
    totalActivitiesInScope: actual.accepted.length + actual.ambiguous.length + actual.extra.length,
    trustedActivities: actual.accepted.length,
    ambiguousActivities: actual.ambiguous.length,
    extraActivities: actual.extra.length,
  };

  // HRA-338: at week granularity, a workout with NEITHER side inside this
  // week (`not_applicable`) is unrelated to the requested week and never
  // belongs in ITS drill-down — a moved_in/moved_out workout still qualifies
  // (exactly one side is `true`), so a week's own adaptation entry stays
  // reachable. Plan granularity with no dateWindow (the pre-existing,
  // already-tested behavior) is untouched: isInRange has no week/window
  // component there, so this condition never excludes anything it didn't
  // already include. HRA-341: a dateWindow (date-range/race-range reports)
  // gets the SAME confining treatment as week granularity — "every count and
  // aggregate drills down to the exact referenced workouts" (AC) would
  // otherwise leak an instance's workouts from outside the requested window
  // into its drill-down.
  const drillDownScope = request.granularity === "week" || request.dateWindow
    ? scope.filter(s => s.originalInRange || s.currentInRange)
    : scope;
  const drillDown: DrillDownIds = {
    workoutIds: drillDownScope.map(s => s.workout_id),
    activityIds: [...actual.accepted, ...actual.ambiguous, ...actual.extra].map(a => a.activity_id),
  };

  return {
    provenance: {
      instanceId: inputs.instance.id,
      scheduleTimezone: timeZone,
      hasOriginalBaseline: inputs.instance.original_start_date != null,
      generatedAt: now.toISOString(),
      asOf: asOf.toISOString(),
    },
    scope,
    actual,
    datasets,
    comparisons,
    denominators,
    coverage,
    drillDown,
    structuredQualityEvidence: { available: false, reason: "not_implemented" },
  };
}
