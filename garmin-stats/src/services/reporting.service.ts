/**
 * services/reporting.service.ts
 * The single-workout/race report's own read boundary (HRA-336). Composes the
 * already-existing plan-instances/workout-associations/activities repos —
 * no new repo layer, since every read this needs already has a method.
 *
 * "One consistent application-level read boundary" (the Story's own AC): this
 * function makes no `await` between its first and last DB read. node:sqlite
 * is fully synchronous and Node is single-threaded, so with no intervening
 * yield point nothing else in this process can mutate plan_instances between
 * the moment current_revision/original_revision are read here and the moment
 * the days/associations/activities used to build the report are read — the
 * whole function executes as one uninterruptible tick. Report.ts's own
 * multi-day boundary relies on the same property.
 */
import type { PlanInstancesRepo } from "../repositories/plan-instances.repo.ts";
import type { WorkoutAssociationsRepo } from "../repositories/workout-associations.repo.ts";
import type { ActivitiesRepo } from "../repositories/activities.repo.ts";
import type { PlanInstanceDayRow, WorkoutAssociationRow } from "../db.ts";
import type { OriginalDaySnapshot } from "../domain/runplan/lineage.ts";
import { ACCEPTED_STATUSES, type AssociationLookup } from "../domain/reporting/scope.ts";
import { buildWorkoutReport, type WorkoutReportResult } from "../domain/reporting/workout-report.ts";
import { buildReport, type ReportActivityInput, type ReportInputs } from "../domain/reporting/report.ts";
import type { AcceptedEvidence, ReportRangeMode, ReportRequest } from "../domain/reporting/types.ts";
import { computeHrEvidence, computeStaminaEvidence, type PauseEvidencePointInput } from "../domain/reporting/evidence.ts";
import { aggregatePauseEvidence, selectComparableStaminaCandidate } from "../domain/reporting/aggregate-evidence.ts";
import {
  buildWorkoutIdentities, collectPlanWeeks, planDateSpan, weekDateSpan,
  type AggregateEvidence, type PlanReportResult, type PlanWeekKey, type PlanWeekSummary, type WeekReportResult,
} from "../domain/reporting/plan-report.ts";

export function createReportingService(
  planInstances: PlanInstancesRepo, workoutAssociations: WorkoutAssociationsRepo, activities: ActivitiesRepo,
) {
  function getWorkoutReport(instanceId: number, workoutId: string, asOf?: Date): WorkoutReportResult | undefined {
    const instance = planInstances.instanceById(instanceId);
    if (!instance) return undefined;

    const currentDays = planInstances.daysByInstance(instanceId);
    const current = currentDays.find(d => d.workout_id === workoutId) ?? null;

    const originalDays: OriginalDaySnapshot[] = instance.original_days_snapshot != null
      ? (JSON.parse(instance.original_days_snapshot) as OriginalDaySnapshot[])
      : [];
    const original = originalDays.find(d => d.workout_id === workoutId) ?? null;

    if (!current && !original) return undefined; // this workout_id never belonged to this instance

    const associationRows = workoutAssociations.byWorkoutId(workoutId);
    const activityInputs = associationRows.map(a => {
      const row = activities.byId(a.activity_id) as {
        id: number; activity_date: string; distance_m: number | null; duration_sec: number | null; moving_time_sec: number | null;
        avg_hr: number | null; max_hr: number | null;
      } | undefined;
      return row
        ? {
          activity_id: row.id, activity_date: row.activity_date, distance_m: row.distance_m, duration_sec: row.duration_sec,
          moving_time_sec: row.moving_time_sec, avg_hr: row.avg_hr, max_hr: row.max_hr,
        }
        : null;
    }).filter((a): a is NonNullable<typeof a> => a != null);

    // HRA-337: track_points loaded ONLY for the accepted evidence activities
    // (never Original/Current, never ambiguous/extra ones) — the pure domain
    // needs them for "the one recorded stamina series" and pause detail/
    // count/longest; every other reporting.service.ts read stays as light as
    // HRA-336 already made it.
    const trackPointsByActivity = new Map<number, PauseEvidencePointInput[]>();
    for (const a of associationRows) {
      if (!ACCEPTED_STATUSES.includes(a.status)) continue;
      trackPointsByActivity.set(a.activity_id, activities.track(a.activity_id) as unknown as PauseEvidencePointInput[]);
    }

    return buildWorkoutReport({
      instance: {
        id: instance.id,
        name: instance.name,
        schedule_timezone: instance.schedule_timezone,
        current_revision: instance.current_revision,
        original_revision: instance.original_revision,
        original_start_date: instance.original_start_date,
        race_date: instance.race_date,
      },
      workoutId,
      original,
      current,
      associations: associationRows.map(a => ({ activity_id: a.activity_id, status: a.status })),
      activities: activityInputs,
      trackPointsByActivity,
      asOf,
    });
  }

  // ── week and entire-plan reports (HRA-338) ────────────────────────────
  // Reuses HRA-335's buildReport engine (domain/reporting/report.ts) as the
  // ONE calculation engine for every scope (the Story's own Scope) — this
  // section only orchestrates which rows to load and hands them to that same
  // pure function, never re-deriving Original/Current/Actual trust itself.

  interface ReportingActivityRow {
    id: number; activity_date: string; distance_m: number | null; duration_sec: number | null;
    avg_hr: number | null; max_hr: number | null;
  }

  function loadOriginalDays(instance: { original_days_snapshot: string | null }): OriginalDaySnapshot[] {
    return instance.original_days_snapshot != null ? (JSON.parse(instance.original_days_snapshot) as OriginalDaySnapshot[]) : [];
  }

  // Activities are scoped by the CALLER to the exact date span in question
  // (this instance's whole span, or one week's own span) — same "caller
  // scopes the query, domain stays pure" division of labor report.ts's own
  // top-of-file comment already documents; `allAssociations` is loaded once
  // by the caller (workout_associations has no per-instance index) and
  // filtered down here to only the activities actually in scope.
  function loadActivitiesInRange(from: string, to: string): { activityInputs: ReportActivityInput[]; rowsById: Map<number, ReportingActivityRow> } {
    const rows = activities.list(from, to) as unknown as ReportingActivityRow[];
    return {
      activityInputs: rows.map(r => ({ activity_id: r.id, activity_date: r.activity_date, distance_m: r.distance_m, duration_sec: r.duration_sec })),
      rowsById: new Map(rows.map(r => [r.id, r])),
    };
  }

  function associationsForActivities(allAssociations: WorkoutAssociationRow[], activityIds: Set<number>): AssociationLookup[] {
    return allAssociations
      .filter(a => activityIds.has(a.activity_id))
      .map(a => ({ activity_id: a.activity_id, workout_id: a.workout_id, status: a.status }));
  }

  function buildCurrentDateLookup(currentDays: PlanInstanceDayRow[]): Map<string, string> {
    return new Map(currentDays.map(d => [d.workout_id, d.date]));
  }

  // HR/pauses are safe to blend across every accepted activity in scope
  // (HR is already duration-weighted; pause count/longest/total are sums/
  // max, not averages) — stamina deliberately is NOT (aggregate-evidence.ts's
  // own design note): at most one comparable session's own stamina series is
  // surfaced, never a blended curve. Track_points are loaded ONLY for
  // accepted evidence activities (HRA-337's own rule, extended here from "one
  // workout's accepted activities" to "this report scope's accepted
  // activities" — never for Original/Current, never for ambiguous/extra).
  function computeAggregateEvidence(
    accepted: AcceptedEvidence[], rowsById: Map<number, ReportingActivityRow>,
    currentDateByWorkoutId: Map<string, string>, raceDate: string | null,
  ): AggregateEvidence {
    if (accepted.length === 0) return { hr: null, pauses: null, comparableStamina: null };

    const hr = computeHrEvidence(accepted.map(e => {
      const row = rowsById.get(e.activity_id);
      return { avg_hr: row?.avg_hr ?? null, max_hr: row?.max_hr ?? null, duration_sec: row?.duration_sec ?? null };
    }));

    const trackPointsByActivity = new Map<number, PauseEvidencePointInput[]>();
    for (const e of accepted) trackPointsByActivity.set(e.activity_id, activities.track(e.activity_id) as unknown as PauseEvidencePointInput[]);
    const pauses = aggregatePauseEvidence(accepted.map(e => e.activity_id), trackPointsByActivity);

    const candidate = selectComparableStaminaCandidate(
      accepted,
      new Map(accepted.map(e => [e.activity_id, { activity_id: e.activity_id, distance_m: rowsById.get(e.activity_id)?.distance_m ?? null }])),
      currentDateByWorkoutId, raceDate,
    );
    const comparableStamina = candidate
      ? { ...candidate, stamina: computeStaminaEvidence(trackPointsByActivity.get(candidate.activity_id) ?? []) }
      : null;

    return { hr, pauses, comparableStamina };
  }

  function getWeekReport(
    instanceId: number, sectionName: string, weekNumber: number, range: ReportRangeMode, asOf?: Date,
  ): WeekReportResult | undefined {
    const instance = planInstances.instanceById(instanceId);
    if (!instance) return undefined;

    const currentDays = planInstances.daysByInstance(instanceId);
    const originalDays = loadOriginalDays(instance);
    const week: PlanWeekKey = { section_name: sectionName, week_number: weekNumber };
    const belongsToWeek = (d: { section_name: string; week_number: number }) => d.section_name === sectionName && d.week_number === weekNumber;
    // This week never existed on this instance (neither side ever placed a
    // day there) — same "never belonged to this instance" 404 convention
    // getWorkoutReport already uses for an unknown workout_id.
    if (!currentDays.some(belongsToWeek) && !originalDays.some(belongsToWeek)) return undefined;

    const span = weekDateSpan(originalDays, currentDays, week);
    const { activityInputs, rowsById } = loadActivitiesInRange(span.start!, span.end!);
    const associationLookups = associationsForActivities(workoutAssociations.all(), new Set(activityInputs.map(a => a.activity_id)));

    const request: ReportRequest = {
      instanceId, range, granularity: "week", week,
      dimensions: ["adaptation", "execution", "outcome"], metrics: ["distance", "duration", "pace"], asOf,
    };
    const reportInputs: ReportInputs = {
      instance: {
        id: instance.id, schedule_timezone: instance.schedule_timezone,
        original_start_date: instance.original_start_date, original_days_snapshot: instance.original_days_snapshot,
      },
      currentDays, associations: associationLookups, activities: activityInputs,
    };
    const report = buildReport(request, reportInputs);

    const originalById = new Map(originalDays.map(d => [d.workout_id, d]));
    const currentById = new Map(currentDays.map(d => [d.workout_id, d]));
    const relevantScope = report.scope.filter(s => s.originalInRange || s.currentInRange);
    const workouts = buildWorkoutIdentities(relevantScope, originalById, currentById);

    const evidence = computeAggregateEvidence(report.actual.accepted, rowsById, buildCurrentDateLookup(currentDays), instance.race_date);

    return {
      provenance: {
        instanceId: instance.id, planInstanceName: instance.name, sectionName, weekNumber,
        scheduleTimezone: report.provenance.scheduleTimezone, hasOriginalBaseline: report.provenance.hasOriginalBaseline,
        generatedAt: report.provenance.generatedAt, asOf: report.provenance.asOf, range,
      },
      dateSpan: span,
      report,
      workouts,
      evidence,
      structuredQualityEvidence: { available: false, reason: "not_implemented" },
    };
  }

  function getPlanReport(instanceId: number, range: ReportRangeMode, asOf?: Date): PlanReportResult | undefined {
    const instance = planInstances.instanceById(instanceId);
    if (!instance) return undefined;

    const currentDays = planInstances.daysByInstance(instanceId);
    const originalDays = loadOriginalDays(instance);
    const span = planDateSpan(originalDays, currentDays);

    // AC "empty ... cases have explicit truthful states": a plan with no
    // days on either side yet never queries activities at all — an empty
    // report, not a fabricated one.
    const { activityInputs, rowsById } = span.start != null && span.end != null
      ? loadActivitiesInRange(span.start, span.end)
      : { activityInputs: [] as ReportActivityInput[], rowsById: new Map<number, ReportingActivityRow>() };
    const allAssociations = workoutAssociations.all();
    const associationLookups = associationsForActivities(allAssociations, new Set(activityInputs.map(a => a.activity_id)));
    const currentDateByWorkoutId = buildCurrentDateLookup(currentDays);

    const instanceInput = {
      id: instance.id, schedule_timezone: instance.schedule_timezone,
      original_start_date: instance.original_start_date, original_days_snapshot: instance.original_days_snapshot,
    };

    const overallRequest: ReportRequest = {
      instanceId, range, granularity: "plan",
      dimensions: ["adaptation", "execution", "outcome"], metrics: ["distance", "duration", "pace"], asOf,
    };
    const overall = buildReport(overallRequest, { instance: instanceInput, currentDays, associations: associationLookups, activities: activityInputs });
    const overallEvidence = computeAggregateEvidence(overall.actual.accepted, rowsById, currentDateByWorkoutId, instance.race_date);

    // AC "entire-plan reports group by week": each week gets its OWN
    // buildReport call, scoped to ITS OWN activities-in-range query (never
    // the whole plan's activities reused as-is) — the same isolation
    // getWeekReport's own standalone endpoint gives a single week, so a
    // week's own accepted/coverage population here matches exactly what
    // requesting that week directly would return.
    const weeks: PlanWeekSummary[] = collectPlanWeeks(originalDays, currentDays).map(key => {
      const weekSpan = weekDateSpan(originalDays, currentDays, key);
      const { activityInputs: weekActivityInputs, rowsById: weekRowsById } = loadActivitiesInRange(weekSpan.start!, weekSpan.end!);
      const weekAssociations = associationsForActivities(allAssociations, new Set(weekActivityInputs.map(a => a.activity_id)));
      const weekRequest: ReportRequest = {
        instanceId, range, granularity: "week", week: key,
        dimensions: ["adaptation", "execution", "outcome"], metrics: ["distance", "duration", "pace"], asOf,
      };
      const weekReport = buildReport(weekRequest, { instance: instanceInput, currentDays, associations: weekAssociations, activities: weekActivityInputs });
      const weekEvidence = computeAggregateEvidence(weekReport.actual.accepted, weekRowsById, currentDateByWorkoutId, instance.race_date);
      return { key, dateSpan: weekSpan, report: weekReport, evidence: weekEvidence };
    });

    return {
      provenance: {
        instanceId: instance.id, planInstanceName: instance.name,
        scheduleTimezone: overall.provenance.scheduleTimezone, hasOriginalBaseline: overall.provenance.hasOriginalBaseline,
        generatedAt: overall.provenance.generatedAt, asOf: overall.provenance.asOf, range,
      },
      dateSpan: span,
      overall,
      overallEvidence,
      weeks,
      structuredQualityEvidence: { available: false, reason: "not_implemented" },
    };
  }

  return { getWorkoutReport, getWeekReport, getPlanReport };
}

export type ReportingService = ReturnType<typeof createReportingService>;
