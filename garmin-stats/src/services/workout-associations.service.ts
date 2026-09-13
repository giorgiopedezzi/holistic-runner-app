/**
 * services/workout-associations.service.ts
 * Business logic for HRA-334's planned-workout/activity association: the
 * sync-triggered automatic reconciliation, and the human-facing
 * inspect/confirm/replace/remove operations. No http, no validation of
 * caller-supplied ids — controllers/activities.controller.ts checks
 * existence before calling in, same division of labor as every other
 * service in this codebase (e.g. setType's own activity/type lookups).
 */
import type { DatabaseSync } from "node:sqlite";
import type { AssociationStatus, WorkoutAssociationRow } from "../db.ts";
import type { ActivitiesRepo } from "../repositories/activities.repo.ts";
import type { PlanInstanceDayWithInstance, PlanInstancesRepo } from "../repositories/plan-instances.repo.ts";
import type { WorkoutAssociationsRepo } from "../repositories/workout-associations.repo.ts";
import { reconcileAssociations, type CandidateActivity, type CandidateWorkout, type ExistingAssociation } from "../domain/workout-association.ts";
import { localDateInTimeZone, SCHEDULE_TIMEZONE_BACKFILL_FALLBACK } from "../domain/plan-timezone.ts";

// The manual write endpoints' response shape — the raw association row
// (possibly "none yet") denormalized with its CURRENT plan-day context, so
// the frontend never has to make a second call to label what it's pointing
// at. Plan-day fields are all null when workout_id is null/unset, or once
// the workout it named has left Current entirely (e.g. its instance was
// deleted) — see plan-instances.repo.ts's dayByWorkoutId.
export interface AssociationView {
  activity_id: number;
  workout_id: string | null;
  status: AssociationStatus | null;
  instance_id: number | null;
  instance_name: string | null;
  section_name: string | null;
  week_number: number | null;
  date: string | null;
}

export function createWorkoutAssociationsService(
  db: DatabaseSync, activities: ActivitiesRepo, planInstances: PlanInstancesRepo, associations: WorkoutAssociationsRepo,
) {
  // Run after every activity import (sync-garmin.ts / sync-strava.ts) — see
  // domain/workout-association.ts's reconcileAssociations for the actual
  // matching/demotion rules. Idempotent: a no-op run just re-upserts the same
  // 'automatic' rows and demotes nothing.
  function reconcile(): void {
    const workouts: CandidateWorkout[] = planInstances.runDaysWithTimezone().map(d => ({
      workout_id: d.workout_id, date: d.date, timeZone: d.schedule_timezone ?? SCHEDULE_TIMEZONE_BACKFILL_FALLBACK,
    }));
    const candidateActivities: CandidateActivity[] = activities.runningActivitiesForAssociation()
      .map(a => ({ activity_id: a.id, activity_date: a.activity_date }));
    const existing: ExistingAssociation[] = associations.all()
      .map(a => ({ activity_id: a.activity_id, workout_id: a.workout_id, status: a.status }));

    const plan = reconcileAssociations(workouts, candidateActivities, existing);
    if (plan.accept.length === 0 && plan.demote.length === 0) return;

    db.exec("BEGIN");
    try {
      for (const a of plan.accept) associations.upsert(a.activity_id, a.workout_id, "automatic");
      for (const d of plan.demote) associations.demoteToUnresolved(d.activity_id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  function toView(row: WorkoutAssociationRow | undefined, activityId: number): AssociationView {
    const day: PlanInstanceDayWithInstance | undefined = row?.workout_id ? planInstances.dayByWorkoutId(row.workout_id) : undefined;
    return {
      activity_id: activityId,
      workout_id: row?.workout_id ?? null,
      status: row?.status ?? null,
      instance_id: day?.instance_id ?? null,
      instance_name: day?.instance_name ?? null,
      section_name: day?.section_name ?? null,
      week_number: day?.week_number ?? null,
      date: day?.date ?? null,
    };
  }

  function getForActivity(activityId: number): AssociationView {
    return toView(associations.byActivityId(activityId), activityId);
  }

  // PUT .../association — a human sets/replaces/confirms this activity's
  // link (the controller has already confirmed workoutId names a real,
  // current plan day). 'manual_confirmed' when workoutId is unchanged from
  // what's already on record (accepting the current suggestion, whether it
  // was automatic or already manual); 'manual_changed' for anything else,
  // including a first-ever manual pick with no prior row at all. Both
  // statuses are immune to reconcile() from this point on (AC9).
  function setAssociation(activityId: number, workoutId: string): AssociationView {
    const current = associations.byActivityId(activityId);
    const status: AssociationStatus = current?.workout_id === workoutId ? "manual_confirmed" : "manual_changed";
    associations.upsert(activityId, workoutId, status);
    return getForActivity(activityId);
  }

  // DELETE .../association — an explicit, permanent "this activity is not
  // part of any plan" (Scope: "represent extra/unplanned activities
  // truthfully"). Recorded as workout_id NULL + 'manual_changed' rather than
  // deleting the row: deleting it would make the activity look "never
  // evaluated" again, indistinguishable from one reconcile() simply hasn't
  // reached yet, and would let a later import silently re-attach it —
  // exactly what a manual decision must never allow (AC9).
  function clearAssociation(activityId: number): AssociationView {
    associations.upsert(activityId, null, "manual_changed");
    return getForActivity(activityId);
  }

  // GET .../association-candidates — every "run" day, across any instance,
  // whose own local calendar date (in ITS OWN instance's schedule_timezone)
  // matches this activity's local date under that same timezone (AC3) — the
  // manual picker's option list. Mirrors the automatic matcher's date
  // predicate without its uniqueness requirement: a human may deliberately
  // choose among several candidates, which is exactly the case the automatic
  // matcher itself refuses to guess at (AC4).
  function candidatesForActivity(activityId: number): PlanInstanceDayWithInstance[] {
    const activity = activities.byId(activityId) as { activity_date: string };
    return planInstances.runDaysWithTimezone()
      .filter(d => localDateInTimeZone(new Date(activity.activity_date), d.schedule_timezone ?? SCHEDULE_TIMEZONE_BACKFILL_FALLBACK) === d.date)
      .map(d => planInstances.dayByWorkoutId(d.workout_id))
      .filter((d): d is PlanInstanceDayWithInstance => d != null);
  }

  return { reconcile, getForActivity, setAssociation, clearAssociation, candidatesForActivity };
}

export type WorkoutAssociationsService = ReturnType<typeof createWorkoutAssociationsService>;
