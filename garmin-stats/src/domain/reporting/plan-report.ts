// ── Week and entire-plan report grouping (HRA-338) ──────────────────────────
// Pure, no I/O — reuses HRA-335's buildReport engine (report.ts) as the ONE
// calculation engine for every scope (this Story's own Scope: "use the
// shared report engine"), grouping its OWN request/result shapes by week
// rather than computing anything new. A "week" here is a planned workout's
// structural slot (section_name + week_number, lineage.ts's own definition —
// see report.ts's weekMembershipDates), never a calendar-date span; two
// different weeks can and do have overlapping or reordered calendar dates
// once a plan is edited.
import type { OriginalDaySnapshot } from "../runplan/lineage.ts";
import type { PlanInstanceDayRow } from "../../db.ts";
import type { ReportRangeMode, ReportResult, ScopedWorkout } from "./types.ts";
import type { HrEvidence, PauseEvidence, StaminaEvidence } from "./evidence.ts";
import type { ComparableStaminaCandidate } from "./aggregate-evidence.ts";

export interface PlanWeekKey {
  section_name: string;
  week_number: number;
}

function weekKeyOf(day: { section_name: string; week_number: number }): string {
  return `${day.section_name}::${day.week_number}`;
}

// Every distinct (section_name, week_number) pair present on EITHER side
// (Original or Current) — a week that was entirely removed, or entirely
// added, since freeze still gets its own entry (AC "plan-to-date... entire-
// plan reports group by week" never silently drops a week just because one
// side has nothing left in it). Ordered by each week's own earliest known
// date (Current's, falling back to Original's, since Current is the plan's
// live truth) — never lexicographic on section_name/week_number, since
// section order isn't guaranteed alphabetical and this Story's own AC asks
// for "progression" (chronological) across weeks.
export function collectPlanWeeks(originalDays: OriginalDaySnapshot[], currentDays: PlanInstanceDayRow[]): PlanWeekKey[] {
  const byKey = new Map<string, { key: PlanWeekKey; earliestDate: string }>();
  const consider = (day: { section_name: string; week_number: number; date: string }) => {
    const k = weekKeyOf(day);
    const existing = byKey.get(k);
    if (!existing || day.date < existing.earliestDate) {
      byKey.set(k, { key: { section_name: day.section_name, week_number: day.week_number }, earliestDate: day.date });
    }
  };
  for (const d of currentDays) consider(d);
  for (const d of originalDays) consider(d);
  return [...byKey.values()].sort((a, b) => (a.earliestDate < b.earliestDate ? -1 : a.earliestDate > b.earliestDate ? 1 : 0)).map(v => v.key);
}

export interface WeekDateSpan { start: string | null; end: string | null }

// The week's own calendar span across BOTH sides — used by the caller
// (reporting.service.ts) to bound its activities-in-range query; never used
// by report.ts itself, which classifies membership structurally (see
// weekMembershipDates), not by this span.
export function weekDateSpan(
  originalDays: OriginalDaySnapshot[], currentDays: PlanInstanceDayRow[], week: PlanWeekKey,
): WeekDateSpan {
  const dates = [...originalDays, ...currentDays]
    .filter(d => d.section_name === week.section_name && d.week_number === week.week_number)
    .map(d => d.date);
  if (dates.length === 0) return { start: null, end: null };
  return { start: dates.reduce((a, b) => (a < b ? a : b)), end: dates.reduce((a, b) => (a > b ? a : b)) };
}

// The whole plan's own calendar span across both sides — bounds the
// entire-plan report's own activities-in-range query the same way
// weekDateSpan bounds a single week's.
export function planDateSpan(originalDays: OriginalDaySnapshot[], currentDays: PlanInstanceDayRow[]): WeekDateSpan {
  const dates = [...originalDays, ...currentDays].map(d => d.date);
  if (dates.length === 0) return { start: null, end: null };
  return { start: dates.reduce((a, b) => (a < b ? a : b)), end: dates.reduce((a, b) => (a > b ? a : b)) };
}

// ── per-workout display identity (drill-down labeling) ──────────────────
// report.ts's own ScopedWorkout/ExecutionEntry/OutcomeEntry deliberately
// carry only workout_id (this domain's "aggregate + drill-down IDs, not
// duplicated detail" contract, report.ts's own top-of-file comment) — a
// caller wanting to LABEL a workout_id (day/section/week/type/dates) for a
// grouped list still needs a lookup, without report.ts's pure engine having
// to know about display concerns. Mirrors workout-report.ts's own `identity`
// shape exactly, so the frontend can reuse one presentation for both.
export interface WorkoutIdentity {
  workoutId: string;
  sectionName: string | null;
  weekNumber: number | null;
  day: number | null;
  workoutType: string | null;
  originalDate: string | null;
  currentDate: string | null;
}

export function buildWorkoutIdentities(
  scope: ScopedWorkout[],
  originalById: Map<string, OriginalDaySnapshot>,
  currentById: Map<string, PlanInstanceDayRow>,
): WorkoutIdentity[] {
  return scope.map(s => {
    const original = originalById.get(s.workout_id) ?? null;
    const current = currentById.get(s.workout_id) ?? null;
    return {
      workoutId: s.workout_id,
      sectionName: current?.section_name ?? original?.section_name ?? null,
      weekNumber: current?.week_number ?? original?.week_number ?? null,
      day: current?.day ?? original?.day ?? null,
      workoutType: current?.workout_type ?? original?.workout_type ?? null,
      originalDate: original?.date ?? null,
      currentDate: current?.date ?? null,
    };
  });
}

// ── HR/stamina/pause evidence at report scope (HRA-337 coverage rules,
// aggregate-evidence.ts's own "never blend stamina" design) ────────────────
export interface AggregateEvidence {
  hr: HrEvidence | null; // null only when there are no accepted activities in scope at all
  pauses: PauseEvidence | null;
  comparableStamina: (ComparableStaminaCandidate & { stamina: StaminaEvidence }) | null;
}

// ── week report (AC: "week reports group by workout ... how the Original
// week changed and how Current week was executed") ─────────────────────────
export interface WeekReportProvenance {
  instanceId: number;
  planInstanceName: string | null;
  sectionName: string;
  weekNumber: number;
  scheduleTimezone: string;
  hasOriginalBaseline: boolean;
  generatedAt: string;
  asOf: string;
  range: ReportRangeMode;
}

export interface WeekReportResult {
  provenance: WeekReportProvenance;
  dateSpan: WeekDateSpan;
  report: ReportResult;
  workouts: WorkoutIdentity[];
  evidence: AggregateEvidence;
  structuredQualityEvidence: { available: false; reason: "not_implemented" };
}

// ── entire-plan report (AC: "entire-plan reports group by week, emphasize
// progression, and drill down to workouts") ─────────────────────────────────
export interface PlanWeekSummary {
  key: PlanWeekKey;
  dateSpan: WeekDateSpan;
  report: ReportResult;
  evidence: AggregateEvidence;
}

export interface PlanReportProvenance {
  instanceId: number;
  planInstanceName: string | null;
  scheduleTimezone: string;
  hasOriginalBaseline: boolean;
  generatedAt: string;
  asOf: string;
  range: ReportRangeMode;
}

export interface PlanReportResult {
  provenance: PlanReportProvenance;
  dateSpan: WeekDateSpan;
  // The whole plan's own isolated Original/Current/Actual totals — AC "a
  // completed/full-plan presentation remains distinct from plan-to-date":
  // this is the SAME range mode the request asked for (never both at once);
  // the caller re-requests with the other `range` for the other presentation.
  overall: ReportResult;
  overallEvidence: AggregateEvidence;
  weeks: PlanWeekSummary[];
  structuredQualityEvidence: { available: false; reason: "not_implemented" };
}
