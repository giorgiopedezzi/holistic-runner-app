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
import type { PostgresDatabase } from "../db/postgres.ts";
import type { WorkoutAssociationsRepo } from "../repositories/workout-associations.repo.ts";
import type { ActivitiesRepo } from "../repositories/activities.repo.ts";
import type { WorkoutSegmentAlignmentsRepo } from "../repositories/workout-segment-alignments.repo.ts";
import type { ManualSegmentAlignment } from "../domain/reporting/quality-evidence.ts";
import type { PlanInstanceDayRow, WorkoutAssociationRow } from "../db.ts";
import type { OriginalDaySnapshot } from "../domain/runplan/lineage.ts";
import { computeWorkoutDayStatus } from "../domain/workout-association.ts";
import { ACCEPTED_STATUSES, classifyActualPopulation, type AssociationLookup } from "../domain/reporting/scope.ts";
import { buildWorkoutReport, type WorkoutReportResult } from "../domain/reporting/workout-report.ts";
import { buildReport, type ReportActivityInput, type ReportInputs } from "../domain/reporting/report.ts";
import type { AcceptedEvidence, DimensionDenominator, ReportRangeMode, ReportRequest, WorkoutEvidenceState } from "../domain/reporting/types.ts";
import { computeHrEvidence, computeStaminaEvidence, type PauseEvidencePointInput } from "../domain/reporting/evidence.ts";
import { aggregatePauseEvidence, selectComparableStaminaCandidate } from "../domain/reporting/aggregate-evidence.ts";
import { SCHEDULE_TIMEZONE_BACKFILL_FALLBACK } from "../domain/plan-timezone.ts";
import { buildCanonicalQualityStructure } from "../domain/reporting/quality-workout.ts";
import { buildStructuredQualityComparison } from "../domain/reporting/quality-evidence.ts";
import { aggregatePaceSecPerKm } from "../domain/reporting/metrics.ts";
import {
  buildWorkoutIdentities, collectPlanWeeks, planDateSpan, weekDateSpan,
  type AggregateEvidence, type PlanReportResult, type PlanWeekKey, type PlanWeekSummary, type WeekReportResult,
} from "../domain/reporting/plan-report.ts";
import {
  actualDatasetFromAccepted, aggregateDatasetMetrics, aggregateDenominator, buildRangeQualityEvidence,
  mergeDrillDown, resolveRangeGrouping, type RangeInstanceReport, type RangeQualityWorkoutEntry, type RangeReportResult,
} from "../domain/reporting/range-report.ts";
import { createOwnedActivitiesRepo } from "../repositories/owned-activities.repo.ts";
import { createOwnedPlanInstancesRepo } from "../repositories/owned-plan-instances.repo.ts";
import { createOwnedWorkoutAssociationsRepo } from "../repositories/owned-workout-associations.repo.ts";
import { createOwnedWorkoutSegmentAlignmentsRepo } from "../repositories/owned-workout-segment-alignments.repo.ts";

export function createReportingService(
  db: PostgresDatabase, planInstances: PlanInstancesRepo, workoutAssociations: WorkoutAssociationsRepo, activities: ActivitiesRepo,
  workoutSegmentAlignments: WorkoutSegmentAlignmentsRepo,
) {
  const forUser = (userId: string) => createReportingService(
    db,
    createOwnedPlanInstancesRepo(db, userId) as unknown as PlanInstancesRepo,
    createOwnedWorkoutAssociationsRepo(db, userId) as unknown as WorkoutAssociationsRepo,
    createOwnedActivitiesRepo(db, userId) as unknown as ActivitiesRepo,
    createOwnedWorkoutSegmentAlignmentsRepo(db, userId) as unknown as WorkoutSegmentAlignmentsRepo,
  );
  async function getWorkoutReport(instanceId: number, workoutId: string, asOf?: Date): Promise<WorkoutReportResult | undefined> {
    const instance = await planInstances.instanceById(instanceId);
    if (!instance) return undefined;

    const currentDays = await planInstances.daysByInstance(instanceId);
    const current = currentDays.find(d => d.workout_id === workoutId) ?? null;

    const originalDays: OriginalDaySnapshot[] = instance.original_days_snapshot != null
      ? (JSON.parse(instance.original_days_snapshot) as OriginalDaySnapshot[])
      : [];
    const original = originalDays.find(d => d.workout_id === workoutId) ?? null;

    if (!current && !original) return undefined; // this workout_id never belonged to this instance

    const associationRows = await workoutAssociations.byWorkoutId(workoutId);
    const activityInputs = (await Promise.all(associationRows.map(async a => {
      const row = await activities.byId(a.activity_id) as {
        id: number; activity_date: string; distance_m: number | null; duration_sec: number | null; moving_time_sec: number | null;
        avg_hr: number | null; max_hr: number | null;
      } | undefined;
      return row
        ? {
          activity_id: row.id, activity_date: row.activity_date, distance_m: row.distance_m, duration_sec: row.duration_sec,
          moving_time_sec: row.moving_time_sec, avg_hr: row.avg_hr, max_hr: row.max_hr,
        }
        : null;
    }))).filter((a): a is NonNullable<typeof a> => a != null);

    // HRA-337: track_points loaded ONLY for the accepted evidence activities
    // (never Original/Current, never ambiguous/extra ones) — the pure domain
    // needs them for "the one recorded stamina series" and pause detail/
    // count/longest; every other reporting.service.ts read stays as light as
    // HRA-336 already made it.
    const trackPointsByActivity = new Map<number, PauseEvidencePointInput[]>();
    for (const a of associationRows) {
      if (!ACCEPTED_STATUSES.includes(a.status)) continue;
      trackPointsByActivity.set(a.activity_id, await activities.track(a.activity_id) as unknown as PauseEvidencePointInput[]);
    }

    const manualQualityAlignments: ManualSegmentAlignment[] = (await workoutSegmentAlignments.byWorkoutId(workoutId))
      .map(a => ({ segmentIndex: a.segment_index, activityId: a.activity_id, distanceM: a.distance_m, durationSec: a.duration_sec }));

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
      manualQualityAlignments,
      asOf,
    });
  }

  // ── HRA-342: manual quality-workout segment alignment (reliable-evidence
  // tier 3) — confirm/correct/replace/remove without ever touching the
  // underlying activity/track_points rows (AC12).

  // A manual alignment may only point at an activity that is ACCEPTED
  // evidence for this exact workout (automatic/manual_confirmed/
  // manual_changed) — never an arbitrary/ambiguous activity id, so a manual
  // segment value always traces back to real, already-trusted evidence for
  // the session it claims to describe.
  async function isAcceptedActivityForWorkout(workoutId: string, activityId: number): Promise<boolean> {
    return (await workoutAssociations.byWorkoutId(workoutId))
      .some(a => a.activity_id === activityId && ACCEPTED_STATUSES.includes(a.status));
  }

  async function setQualityAlignment(
    workoutId: string, segmentIndex: number, activityId: number, distanceM: number | null, durationSec: number | null,
  ): Promise<{ ok: true } | { ok: false; reason: "activity_not_accepted_evidence" }> {
    if (!await isAcceptedActivityForWorkout(workoutId, activityId)) return { ok: false, reason: "activity_not_accepted_evidence" };
    await workoutSegmentAlignments.upsert(workoutId, segmentIndex, activityId, distanceM, durationSec);
    return { ok: true };
  }

  async function removeQualityAlignment(workoutId: string, segmentIndex: number): Promise<void> {
    await workoutSegmentAlignments.remove(workoutId, segmentIndex);
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
  async function loadActivitiesInRange(from: string, to: string): Promise<{ activityInputs: ReportActivityInput[]; rowsById: Map<number, ReportingActivityRow> }> {
    const rows = await activities.list(from, to) as unknown as ReportingActivityRow[];
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
  async function computeAggregateEvidence(
    accepted: AcceptedEvidence[], rowsById: Map<number, ReportingActivityRow>,
    currentDateByWorkoutId: Map<string, string>, raceDate: string | null,
  ): Promise<AggregateEvidence> {
    if (accepted.length === 0) return { hr: null, pauses: null, comparableStamina: null };

    const hr = computeHrEvidence(accepted.map(e => {
      const row = rowsById.get(e.activity_id);
      return { avg_hr: row?.avg_hr ?? null, max_hr: row?.max_hr ?? null, duration_sec: row?.duration_sec ?? null };
    }));

    const trackPointsByActivity = new Map<number, PauseEvidencePointInput[]>();
    for (const e of accepted) trackPointsByActivity.set(e.activity_id, await activities.track(e.activity_id) as unknown as PauseEvidencePointInput[]);
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

  async function getWeekReport(
    instanceId: number, sectionName: string, weekNumber: number, range: ReportRangeMode, asOf?: Date,
  ): Promise<WeekReportResult | undefined> {
    const instance = await planInstances.instanceById(instanceId);
    if (!instance) return undefined;

    const currentDays = await planInstances.daysByInstance(instanceId);
    const originalDays = loadOriginalDays(instance);
    const week: PlanWeekKey = { section_name: sectionName, week_number: weekNumber };
    const belongsToWeek = (d: { section_name: string; week_number: number }) => d.section_name === sectionName && d.week_number === weekNumber;
    // This week never existed on this instance (neither side ever placed a
    // day there) — same "never belonged to this instance" 404 convention
    // getWorkoutReport already uses for an unknown workout_id.
    if (!currentDays.some(belongsToWeek) && !originalDays.some(belongsToWeek)) return undefined;

    const span = weekDateSpan(originalDays, currentDays, week);
    const { activityInputs, rowsById } = await loadActivitiesInRange(span.start!, span.end!);
    const associationLookups = associationsForActivities(await workoutAssociations.all(), new Set(activityInputs.map(a => a.activity_id)));

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

    const evidence = await computeAggregateEvidence(report.actual.accepted, rowsById, buildCurrentDateLookup(currentDays), instance.race_date);

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

  async function getPlanReport(instanceId: number, range: ReportRangeMode, asOf?: Date): Promise<PlanReportResult | undefined> {
    const instance = await planInstances.instanceById(instanceId);
    if (!instance) return undefined;

    const currentDays = await planInstances.daysByInstance(instanceId);
    const originalDays = loadOriginalDays(instance);
    const span = planDateSpan(originalDays, currentDays);

    // AC "empty ... cases have explicit truthful states": a plan with no
    // days on either side yet never queries activities at all — an empty
    // report, not a fabricated one.
    const { activityInputs, rowsById } = span.start != null && span.end != null
      ? await loadActivitiesInRange(span.start, span.end)
      : { activityInputs: [] as ReportActivityInput[], rowsById: new Map<number, ReportingActivityRow>() };
    const allAssociations = await workoutAssociations.all();
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
    const overallEvidence = await computeAggregateEvidence(overall.actual.accepted, rowsById, currentDateByWorkoutId, instance.race_date);

    // AC "entire-plan reports group by week": each week gets its OWN
    // buildReport call, scoped to ITS OWN activities-in-range query (never
    // the whole plan's activities reused as-is) — the same isolation
    // getWeekReport's own standalone endpoint gives a single week, so a
    // week's own accepted/coverage population here matches exactly what
    // requesting that week directly would return.
    const weeks: PlanWeekSummary[] = await Promise.all(collectPlanWeeks(originalDays, currentDays).map(async key => {
      const weekSpan = weekDateSpan(originalDays, currentDays, key);
      const { activityInputs: weekActivityInputs, rowsById: weekRowsById } = await loadActivitiesInRange(weekSpan.start!, weekSpan.end!);
      const weekAssociations = associationsForActivities(allAssociations, new Set(weekActivityInputs.map(a => a.activity_id)));
      const weekRequest: ReportRequest = {
        instanceId, range, granularity: "week", week: key,
        dimensions: ["adaptation", "execution", "outcome"], metrics: ["distance", "duration", "pace"], asOf,
      };
      const weekReport = buildReport(weekRequest, { instance: instanceInput, currentDays, associations: weekAssociations, activities: weekActivityInputs });
      const weekEvidence = await computeAggregateEvidence(weekReport.actual.accepted, weekRowsById, currentDateByWorkoutId, instance.race_date);
      return { key, dateSpan: weekSpan, report: weekReport, evidence: weekEvidence };
    }));

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

  // ── date-range and race-range reports (HRA-341) ───────────────────────
  // Cross-plan: unlike getWeekReport/getPlanReport (one plan instance), this
  // scans every plan instance whose Original or Current span overlaps
  // [from,to] and gives each its OWN isolated buildReport call — associations
  // are pre-filtered to that instance's own workout ids so an activity
  // accepted-associated to a DIFFERENT instance's workout can never leak
  // into this one's totals (Scope: "handle cross-plan ... periods without
  // corrupting dataset identity"). Range-wide ambiguous/unplanned counts and
  // the range-wide Actual dataset are computed ONCE against every activity
  // in the window (never per instance, never summed per instance), so they
  // can never be inflated by one instance's own trusted evidence reading as
  // "extra" relative to another's isolated view — see domain/reporting/
  // range-report.ts's own top-of-file comment.
  function instanceOwnWorkoutIds(originalDays: OriginalDaySnapshot[], currentDays: PlanInstanceDayRow[]): Set<string> {
    const ids = new Set<string>();
    for (const d of originalDays) ids.add(d.workout_id);
    for (const d of currentDays) ids.add(d.workout_id);
    return ids;
  }

  function associationsForWorkoutIds(allAssociations: WorkoutAssociationRow[], workoutIds: Set<string>): AssociationLookup[] {
    return allAssociations
      .filter(a => a.workout_id != null && workoutIds.has(a.workout_id))
      .map(a => ({ activity_id: a.activity_id, workout_id: a.workout_id, status: a.status }));
  }

  function toRangeEvidenceState(status: "pending" | "missed" | "completed"): WorkoutEvidenceState {
    return status === "pending" ? "upcoming" : status;
  }

  async function getRangeReport(from: string, to: string, range: ReportRangeMode, asOf?: Date): Promise<RangeReportResult> {
    const now = new Date();
    const effectiveAsOf = asOf ?? now;

    const [allInstances, allAssociations, { activityInputs, rowsById }] = await Promise.all([planInstances.allInstances(), workoutAssociations.all(), loadActivitiesInRange(from, to)]);

    // Range-wide trust classification — the FULL association map, never a
    // per-instance-filtered one, so an activity accepted for SOME instance
    // never reads as "extra" merely because that instance isn't scanned
    // below (e.g. its own span doesn't overlap [from,to] at all).
    const globalAssociationsByActivity = new Map<number, AssociationLookup>(allAssociations.map(a => [a.activity_id, a]));
    const classification = classifyActualPopulation(activityInputs, globalAssociationsByActivity, SCHEDULE_TIMEZONE_BACKFILL_FALLBACK);

    const candidates = await Promise.all(allInstances.map(async instance => {
      const currentDays = await planInstances.daysByInstance(instance.id);
      const originalDays = loadOriginalDays(instance);
      const span = planDateSpan(originalDays, currentDays);
      return { instance, currentDays, originalDays, span };
    }));
    const included = candidates.filter(c => c.span.start != null && c.span.end != null && c.span.start! <= to && c.span.end! >= from);

    const instances: RangeInstanceReport[] = [];
    const qualityEntries: RangeQualityWorkoutEntry[] = [];

    for (const { instance, currentDays, originalDays, span } of included) {
      const ownWorkoutIds = instanceOwnWorkoutIds(originalDays, currentDays);
      const instanceAssociations = associationsForWorkoutIds(allAssociations, ownWorkoutIds);
      const instanceActivityIds = new Set(instanceAssociations.map(a => a.activity_id));
      const instanceActivityInputs = activityInputs.filter(a => instanceActivityIds.has(a.activity_id));

      const instanceInput = {
        id: instance.id, schedule_timezone: instance.schedule_timezone,
        original_start_date: instance.original_start_date, original_days_snapshot: instance.original_days_snapshot,
      };
      const request: ReportRequest = {
        instanceId: instance.id, range, granularity: "plan",
        dimensions: ["adaptation", "execution", "outcome"], metrics: ["distance", "duration", "pace"],
        asOf: effectiveAsOf, dateWindow: { from, to },
      };
      const report = buildReport(request, {
        instance: instanceInput, currentDays, associations: instanceAssociations, activities: instanceActivityInputs, now,
      });

      const timeZone = instance.schedule_timezone ?? SCHEDULE_TIMEZONE_BACKFILL_FALLBACK;
      const acceptedByWorkout = new Map(report.actual.accepted.map(e => [e.workout_id, e]));

      // HRA-341 quality-workout range requirements — CURRENT days only
      // (execution's own Current-vs-Actual scope, never Original), scoped to
      // [from,to], reusing HRA-342's own per-workout structure/evidence
      // primitives rather than a second classification engine.
      for (const day of currentDays) {
        if (day.workout_type !== "run") continue;
        if (day.date < from || day.date > to) continue;
        const structure = buildCanonicalQualityStructure({ category: day.category ?? undefined, segments: JSON.parse(day.segments) });
        if (!structure) continue;

        const state = toRangeEvidenceState(computeWorkoutDayStatus(day.date, timeZone, acceptedByWorkout.has(day.workout_id), effectiveAsOf));
        if (state === "upcoming" && range === "plan_to_date") continue;

        const workoutAcceptedActivities = instanceAssociations
          .filter(a => a.workout_id === day.workout_id && ACCEPTED_STATUSES.includes(a.status))
          .map(a => rowsById.get(a.activity_id))
          .filter((a): a is ReportingActivityRow => a != null);
        const wholeSessionPace = aggregatePaceSecPerKm(workoutAcceptedActivities.map(a => ({ distanceM: a.distance_m, timeSec: a.duration_sec })));
        const manualAlignments = (await workoutSegmentAlignments.byWorkoutId(day.workout_id))
          .map(a => ({ segmentIndex: a.segment_index, activityId: a.activity_id, distanceM: a.distance_m, durationSec: a.duration_sec }));

        qualityEntries.push({
          instanceId: instance.id, workoutId: day.workout_id, planInstanceName: instance.name,
          sectionName: day.section_name, weekNumber: day.week_number, day: day.day, currentDate: day.date,
          comparison: buildStructuredQualityComparison(structure, { manual: manualAlignments }, wholeSessionPace),
        });
      }

      const spanStart = span.start!;
      const spanEnd = span.end!;
      instances.push({
        instanceId: instance.id, planInstanceName: instance.name, scheduleTimezone: report.provenance.scheduleTimezone,
        dateSpan: { start: spanStart < from ? from : spanStart, end: spanEnd > to ? to : spanEnd },
        report,
      });
    }

    return {
      provenance: { from, to, range, grouping: resolveRangeGrouping(from, to), generatedAt: now.toISOString(), asOf: effectiveAsOf.toISOString() },
      instances,
      aggregate: {
        datasets: {
          original: aggregateDatasetMetrics(instances.map(i => i.report.datasets.original)),
          current: aggregateDatasetMetrics(instances.map(i => i.report.datasets.current)),
          actual: actualDatasetFromAccepted(classification.accepted, rowsById),
        },
        denominators: {
          execution: aggregateDenominator(instances.map(i => i.report.denominators.execution).filter((d): d is DimensionDenominator => d != null)),
          outcome: aggregateDenominator(instances.map(i => i.report.denominators.outcome).filter((d): d is DimensionDenominator => d != null)),
        },
        coverage: {
          totalActivitiesInScope: classification.accepted.length + classification.ambiguous.length + classification.extra.length,
          trustedActivities: classification.accepted.length,
          ambiguousActivities: classification.ambiguous.length,
          extraActivities: classification.extra.length,
        },
        drillDown: mergeDrillDown(instances.map(i => i.report.drillDown), classification.extra.map(e => e.activity_id)),
      },
      unplanned: classification.extra,
      ambiguous: classification.ambiguous,
      qualityEvidence: buildRangeQualityEvidence(qualityEntries),
    };
  }

  return { forUser, getWorkoutReport, getWeekReport, getPlanReport, setQualityAlignment, removeQualityAlignment, getRangeReport };
}

export type ReportingService = ReturnType<typeof createReportingService>;
