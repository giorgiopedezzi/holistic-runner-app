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
import type { OriginalDaySnapshot } from "../domain/runplan/lineage.ts";
import { ACCEPTED_STATUSES } from "../domain/reporting/scope.ts";
import { buildWorkoutReport, type WorkoutReportResult } from "../domain/reporting/workout-report.ts";
import type { PauseEvidencePointInput } from "../domain/reporting/evidence.ts";

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

  return { getWorkoutReport };
}

export type ReportingService = ReturnType<typeof createReportingService>;
