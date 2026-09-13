// ── Date-range and race-range report — cross-plan aggregation (HRA-341) ────
// Pure, no I/O. Reuses HRA-335's buildReport engine (report.ts) as the ONE
// calculation engine PER plan instance touched by the window — this module
// only combines already-computed per-instance ReportResults into one range-
// wide picture (grouping mode, summed datasets/denominators, merged
// drill-down ids) and rolls up HRA-342's per-workout structured
// quality-workout comparisons across the window. It never re-derives
// Original/Current/Actual trust itself. Row loading + per-instance
// buildReport orchestration is services/reporting.service.ts's job (same
// "caller loads, domain classifies" division of labor as report.ts/
// plan-report.ts).
import { aggregatePaceSecPerKm, type DistanceTimeRecord } from "./metrics.ts";
import type { CoverageSummary, DatasetMetrics, DimensionDenominator, DrillDownIds, ReportRangeMode, ReportResult } from "./types.ts";
import type { StructuredQualityComparison } from "./quality-evidence.ts";
import type { QualityWorkoutKind } from "./quality-workout.ts";

// ── automatic grouping (AC: "workout for short ranges, week for medium
// ranges, and month only where needed for long ranges") ────────────────────
export type RangeGrouping = "workout" | "week" | "month";

function inclusiveDaySpan(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

// Thresholds mirror the Overview & Trends preset ladder itself (garmin-
// dashboard's useDateRange.ts PRESETS: 7d/30d/90d/1y/All) rather than
// inventing a second scale (Scope: "reuse established Overview & Trends
// range semantics") — a window that fits inside the 30d preset stays
// per-workout, one up through roughly the 1y preset groups by week, and only
// a longer-than-a-year window groups by month.
export function resolveRangeGrouping(from: string, to: string): RangeGrouping {
  const span = inclusiveDaySpan(from, to);
  if (span <= 31) return "workout";
  if (span <= 366) return "week";
  return "month";
}

// ── cross-instance dataset/denominator aggregation ──────────────────────
// AC9: pace is always distance-total ÷ time-total across every contributing
// instance's own totals — never an average of per-instance pace values,
// same "never average a rate" rule report.ts's own actualMetrics/
// plannedMetrics already apply within one instance.
export function aggregateDatasetMetrics(list: DatasetMetrics[]): DatasetMetrics {
  let distanceM: number | undefined;
  let approximate = false;
  let durationSec: number | undefined;
  let sawPace = false;
  const records: DistanceTimeRecord[] = [];
  for (const m of list) {
    if (m.distanceM != null) { distanceM = (distanceM ?? 0) + m.distanceM; approximate = approximate || !!m.approximate; }
    if (m.durationSec != null) durationSec = (durationSec ?? 0) + m.durationSec;
    if ("paceSecPerKm" in m) { sawPace = true; records.push({ distanceM: m.distanceM ?? null, timeSec: m.durationSec ?? null }); }
  }
  const result: DatasetMetrics = {};
  if (distanceM !== undefined) { result.distanceM = distanceM; result.approximate = approximate; }
  if (durationSec !== undefined) result.durationSec = durationSec;
  if (sawPace) result.paceSecPerKm = aggregatePaceSecPerKm(records);
  return result;
}

export function aggregateDenominator(list: DimensionDenominator[]): DimensionDenominator | undefined {
  if (list.length === 0) return undefined;
  return list.reduce(
    (acc, d) => ({ total: acc.total + d.total, completed: acc.completed + d.completed, missed: acc.missed + d.missed, upcoming: acc.upcoming + d.upcoming }),
    { total: 0, completed: 0, missed: 0, upcoming: 0 },
  );
}

// AC "ambiguous activities are visible in coverage/counts but excluded from
// trusted totals": every per-instance drillDown here was already built from
// associations scoped to THAT instance's own workout ids (never another
// instance's, never a global "extra" — the caller filters before calling
// buildReport, see reporting.service.ts), so merging is a plain union;
// `extraActivityIds` (range-wide unplanned activities, never instance-
// scoped) is added on top rather than double-counted per instance.
export function mergeDrillDown(list: DrillDownIds[], extraActivityIds: number[]): DrillDownIds {
  const workoutIds = new Set<string>();
  const activityIds = new Set<number>();
  for (const d of list) {
    for (const w of d.workoutIds) workoutIds.add(w);
    for (const a of d.activityIds) activityIds.add(a);
  }
  for (const a of extraActivityIds) activityIds.add(a);
  return { workoutIds: [...workoutIds], activityIds: [...activityIds] };
}

// Mirrors report.ts's own private actualMetrics (AC8/AC9's "pace is
// distance-total/time-total over trusted evidence only") at RANGE scope
// rather than one instance's — kept as its own small function here (instead
// of exporting report.ts's private one) since this operates over the
// range-wide GLOBAL accepted population, never one instance's own.
export function actualDatasetFromAccepted(
  accepted: { activity_id: number }[], rowsById: Map<number, { distance_m: number | null; duration_sec: number | null }>,
): DatasetMetrics {
  let distanceM = 0;
  let durationSec = 0;
  const records: DistanceTimeRecord[] = [];
  for (const e of accepted) {
    const row = rowsById.get(e.activity_id);
    if (!row) continue;
    if (row.distance_m != null) distanceM += row.distance_m;
    if (row.duration_sec != null) durationSec += row.duration_sec;
    records.push({ distanceM: row.distance_m, timeSec: row.duration_sec });
  }
  return { distanceM, approximate: false, durationSec, paceSecPerKm: aggregatePaceSecPerKm(records) };
}

// ── HRA-341's own quality-workout range requirements ────────────────────
export interface RangeQualityWorkoutEntry {
  instanceId: number;
  workoutId: string;
  planInstanceName: string | null;
  sectionName: string | null;
  weekNumber: number | null;
  day: number | null;
  currentDate: string | null;
  comparison: StructuredQualityComparison;
}

export interface RangeQualityEvidence {
  totalWorkouts: number;
  workoutsWithEvidence: number; // "included-session coverage"
  segments: { totalWorkSegments: number; alignedWorkSegments: number }; // "segment coverage"
  byKind: Partial<Record<QualityWorkoutKind, { total: number; withEvidence: number }>>;
  workouts: RangeQualityWorkoutEntry[]; // range drill-down: exact workouts + full per-workout segment/provenance detail
}

// AC "sessions without reliable structure remain visible as
// unavailable/partial and are excluded from structured work-pace and
// target-range totals": every entry is retained (visible), but a session
// with comparison.available===false contributes 0 to alignedWorkSegments
// and is never counted toward workoutsWithEvidence.
export function buildRangeQualityEvidence(entries: RangeQualityWorkoutEntry[]): RangeQualityEvidence {
  const byKind: RangeQualityEvidence["byKind"] = {};
  let totalWorkSegments = 0;
  let alignedWorkSegments = 0;
  let workoutsWithEvidence = 0;
  for (const e of entries) {
    const bucket = byKind[e.comparison.kind] ?? { total: 0, withEvidence: 0 };
    bucket.total++;
    if (e.comparison.available) { bucket.withEvidence++; workoutsWithEvidence++; }
    byKind[e.comparison.kind] = bucket;
    totalWorkSegments += e.comparison.totals.coverage.totalWorkSegments;
    alignedWorkSegments += e.comparison.totals.coverage.alignedWorkSegments;
  }
  return { totalWorkouts: entries.length, workoutsWithEvidence, segments: { totalWorkSegments, alignedWorkSegments }, byKind, workouts: entries };
}

// ── result shape ─────────────────────────────────────────────────────────
export interface RangeInstanceReport {
  instanceId: number;
  planInstanceName: string | null;
  scheduleTimezone: string;
  dateSpan: { start: string | null; end: string | null }; // this instance's own span, intersected with [from,to]
  report: ReportResult;
}

export interface RangeReportProvenance {
  from: string;
  to: string;
  range: ReportRangeMode;
  grouping: RangeGrouping;
  generatedAt: string;
  asOf: string;
}

export interface RangeReportResult {
  provenance: RangeReportProvenance;
  // AC "explicitly identifies ... every included plan instance" — one entry
  // per plan instance whose Original or Current span overlaps [from,to];
  // empty is a truthful "no-plan" state (AC7), never an error.
  instances: RangeInstanceReport[];
  aggregate: {
    datasets: { original: DatasetMetrics; current: DatasetMetrics; actual: DatasetMetrics };
    denominators: { execution?: DimensionDenominator; outcome?: DimensionDenominator };
    coverage: CoverageSummary;
    drillDown: DrillDownIds;
  };
  // AC "extra/unplanned activities are included by their actual local date
  // and remain Actual-only" — range-wide, never duplicated per instance.
  unplanned: { activity_id: number; local_date: string }[];
  // AC "ambiguous activities are visible in coverage/counts but excluded
  // from trusted totals" — range-wide list, same reasoning as `unplanned`.
  ambiguous: { activity_id: number; workout_id: string | null }[];
  qualityEvidence: RangeQualityEvidence;
}
