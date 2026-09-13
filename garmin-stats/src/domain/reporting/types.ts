// ── Shared reporting domain — trust contract types (HRA-335) ───────────────
// Pure data shapes only, no I/O — same domain/ convention as lineage.ts and
// workout-association.ts, which this module builds directly on top of.
//
// The boundary this Epic (HRA-331) needs is ONE reproducible calculation
// engine instead of competing React-side calculations (garmin-dashboard's
// runplan-aggregate.ts computes plan-side totals today; nothing yet computes
// Original-vs-Current-vs-Actual trust the way a report needs). This file is
// the vocabulary every report screen (a future Story, e.g. HRA-336) will
// consume — never the screen itself (this Story's own "Out of scope").
import type { AssociationStatus } from "../../db.ts";
import type { WorkoutLineageStatus } from "../runplan/lineage.ts";

// ── request (AC1) ────────────────────────────────────────────────────────

// "plan_to_date" excludes future workouts from execution/outcome entirely
// (AC4); "full_plan" keeps them, tagged `upcoming` with no denominator/delta.
export type ReportRangeMode = "plan_to_date" | "full_plan";

export type ReportGranularity = "day" | "week" | "section" | "plan";

// AC5: adaptation (Original-vs-Current), execution (Current-vs-Actual), and
// outcome (Original-vs-Actual) are separate calculations that never silently
// substitute for one another — a caller selects which it wants computed.
export type ComparisonDimension = "adaptation" | "execution" | "outcome";

// AC1's own "metric selection": which fields of DatasetMetrics (below) the
// caller actually wants computed/returned — real behavior, not a request
// field the boundary ignores (report.ts projects the full internal totals
// down to exactly this set before returning them).
export type ReportMetric = "distance" | "duration" | "pace";

export interface ReportRequest {
  instanceId: number;
  range: ReportRangeMode;
  granularity: ReportGranularity;
  dimensions: ComparisonDimension[];
  metrics: ReportMetric[];
  // AC1: an explicit OR server-resolved `asOf` instant. `undefined` here
  // means "server-resolved" — report.ts's buildReport defaults it to `now`.
  asOf?: Date;
  // HRA-338: only meaningful when granularity === "week" — identifies a
  // planned workout's OWN structural slot (mirrors lineage.ts's own
  // definition of a workout's placement: section_name + week_number, never
  // a calendar-date span), never a calendar week. A day counts as inside
  // this week when ITS OWN section_name/week_number match, checked
  // independently on the Original side and the Current side — so a workout
  // that moved to/from this exact slot still surfaces as moved_in/moved_out
  // (AC6) instead of silently vanishing from one side's report.
  week?: { section_name: string; week_number: number };
}

// ── scope membership (AC6) ──────────────────────────────────────────────

export type BoundaryMovement = "moved_in" | "moved_out" | "stable" | "not_applicable";

export interface ScopedWorkout {
  workout_id: string;
  lineage: WorkoutLineageStatus;
  originalInRange: boolean;
  currentInRange: boolean;
  // Dimension-aware relative to the CALLER's own range predicate — a workout
  // can only be moved_in/moved_out relative to a stated boundary, never in
  // the abstract (AC6's "movement across week/range boundaries").
  boundaryMovement: BoundaryMovement;
}

// ── Actual population (AC6, AC7, AC10, AC11) ────────────────────────────

export interface AcceptedEvidence {
  activity_id: number;
  workout_id: string;
  status: Extract<AssociationStatus, "automatic" | "manual_confirmed" | "manual_changed">;
  local_date: string;
}

// AC11: visible in coverage, excluded from trusted totals — a workout_id may
// still be present (a demoted-but-not-deleted 'unresolved' row), but it is
// never trustworthy evidence.
export interface AmbiguousEvidence {
  activity_id: number;
  workout_id: string | null;
}

// AC7: extra/unplanned activities are a distinct Actual-only population —
// no accepted association at all (including an explicit human "not part of
// any plan" removal, which is workout_id=NULL under any status).
export interface ExtraActivity {
  activity_id: number;
  local_date: string;
}

export interface ActualPopulation {
  accepted: AcceptedEvidence[];
  ambiguous: AmbiguousEvidence[];
  extra: ExtraActivity[];
}

// ── execution / outcome entries (AC3, AC4, AC5) ─────────────────────────

export type WorkoutEvidenceState = "completed" | "missed" | "upcoming";

export interface ExecutionEntry {
  workout_id: string;
  scheduled_date: string; // Current's own placement date
  state: WorkoutEvidenceState;
  evidence: AcceptedEvidence | null;
  // false for `upcoming` (AC4) — the only lever that keeps a full_plan
  // view's future context out of the trusted denominator without dropping
  // the row entirely.
  includedInDenominator: boolean;
}

export interface OutcomeEntry {
  workout_id: string;
  original_date: string; // Original's own placement date — only ever computed for a workout that HAD an Original counterpart (AC5: never substitutes Current's placement)
  state: WorkoutEvidenceState;
  evidence: AcceptedEvidence | null;
  includedInDenominator: boolean;
}

// ── denominators / coverage (AC10, AC11) ────────────────────────────────

// A denominator is a fact about how many things a percentage was computed
// over, kept apart from the percentage itself so a percentage is NEVER
// produced without one (AC10 — see metrics.ts's safePercentage).
export interface DimensionDenominator {
  total: number;
  completed: number;
  missed: number;
  upcoming: number;
}

export interface CoverageSummary {
  totalActivitiesInScope: number;
  trustedActivities: number;
  ambiguousActivities: number;
  extraActivities: number;
}

// ── dataset metrics (AC8, AC9) ──────────────────────────────────────────

// One shared shape for all three isolated datasets (AC2) — Original/Current
// use planned-metrics.ts's segment-derived totals, Actual uses metrics.ts's
// trusted-evidence-only totals. `paceSecPerKm` is always distance÷time over
// the dataset's own totals (AC9), never an average of per-day/per-activity
// pace values, and is `null` (never 0) when nothing resolves (AC10).
//
// Every field is optional: report.ts always computes the full bundle
// internally (pace needs distance+duration either way), then PROJECTS it
// down to only the fields the request's own `metrics` selection asked for
// (AC1) — an omitted field is absent from the object, never present-as-zero.
export interface DatasetMetrics {
  distanceM?: number;
  approximate?: boolean; // true if any contributing segment/activity total was itself approximate (duration->distance conversion)
  durationSec?: number;
  paceSecPerKm?: number | null;
}

// ── result (AC2) ─────────────────────────────────────────────────────────

export interface ReportProvenance {
  instanceId: number;
  scheduleTimezone: string;
  hasOriginalBaseline: boolean; // false only for the (never-expected in practice) case of a row somehow missing its HRA-332 backfill
  generatedAt: string; // ISO instant this report was actually computed
  asOf: string; // ISO instant used for future/missed cutoffs — explicit request value or generatedAt
}

export interface DrillDownIds {
  workoutIds: string[];
  activityIds: number[];
}

export interface ReportResult {
  provenance: ReportProvenance;
  scope: ScopedWorkout[];
  actual: ActualPopulation;
  // AC2: isolated Original/Current/Actual datasets — each respects the
  // request's own range mode (plan_to_date filters out future days from the
  // totals too, not just from execution/outcome denominators, for the same
  // "future is context, not commitment" reasoning AC4 states explicitly).
  datasets: { original: DatasetMetrics; current: DatasetMetrics; actual: DatasetMetrics };
  comparisons: {
    adaptation?: ScopedWorkout[];
    execution?: ExecutionEntry[];
    outcome?: OutcomeEntry[];
  };
  denominators: {
    execution?: DimensionDenominator;
    outcome?: DimensionDenominator;
  };
  coverage: CoverageSummary;
  drillDown: DrillDownIds;
  // HRA-342 ("Compare structured quality-workout execution") is a future
  // Story that depends on THIS one — this boundary carries a slot for its
  // evidence/provenance so that Story never has to re-derive segments in
  // React (this Story's own "Quality-workout metric applicability" ACs),
  // but does not itself compute anything beyond "not yet available".
  structuredQualityEvidence: { available: false; reason: "not_implemented" };
}
