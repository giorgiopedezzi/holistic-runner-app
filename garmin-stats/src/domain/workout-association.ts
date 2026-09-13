// ── Planned-workout ↔ actual-activity association (HRA-334) ─────────────────
// Pure, no I/O — the conservative, uniqueness-only matching engine plus the
// pending/missed/completed predicate. Callers (services/workout-associations.
// service.ts) own every DB read/write; this module only decides WHAT should
// change, given the current state.
//
// Automatic acceptance is symmetric 1:1: a workout and an activity only pair
// up automatically when each is the OTHER's only remaining compatible
// candidate (AC2/AC4) — no distance/duration/pace/title/similarity scoring,
// ever (Story's own out-of-scope list). REST/OTHER/etc. plan days are never
// passed in here at all — the caller only ever includes workout_type "run"
// days (AC5/AC6), so this module has no workout_type of its own to check.
import type { AssociationStatus } from "../db.ts";
import { localDateInTimeZone } from "./plan-timezone.ts";

export interface CandidateWorkout {
  workout_id: string;
  // The plan's own local calendar date for this day (plan_instance_days.date
  // — already authored in the owning instance's schedule_timezone, so it's
  // compared directly against an activity's own computed local date, never
  // re-derived here).
  date: string;
  // The owning plan_instance's schedule_timezone — used to convert an
  // activity's UTC-ish activity_date into a local calendar date comparable
  // to `date` above (AC3).
  timeZone: string;
}

export interface CandidateActivity {
  activity_id: number;
  // activities.activity_date — a naive local-ish timestamp string, parsed as
  // a Date the same way the rest of this codebase does (new Date(string)).
  activity_date: string;
}

export interface ExistingAssociation {
  activity_id: number;
  workout_id: string | null;
  status: AssociationStatus;
}

export interface ReconciliationPlan {
  // Every (activity, workout) pair that is now the other's sole compatible
  // candidate and should be written/kept as 'automatic'.
  accept: { activity_id: number; workout_id: string }[];
  // Every currently-'automatic' row whose uniqueness broke (AC10) — demoted
  // to 'unresolved', never deleted, so the case stays inspectable.
  demote: { activity_id: number }[];
}

function activityLocalDate(activity: CandidateActivity, timeZone: string): string {
  return localDateInTimeZone(new Date(activity.activity_date), timeZone);
}

// Rows a human has already decided about are immune forever (AC9) — excluded
// from the matching universe entirely, on both sides.
const LOCKED: AssociationStatus[] = ["manual_confirmed", "manual_changed"];

export function reconcileAssociations(
  workouts: CandidateWorkout[],
  activities: CandidateActivity[],
  existing: ExistingAssociation[],
): ReconciliationPlan {
  const lockedWorkoutIds = new Set(
    existing.filter(a => LOCKED.includes(a.status) && a.workout_id != null).map(a => a.workout_id),
  );
  const lockedActivityIds = new Set(existing.filter(a => LOCKED.includes(a.status)).map(a => a.activity_id));

  const movableWorkouts = workouts.filter(w => !lockedWorkoutIds.has(w.workout_id));
  const movableActivities = activities.filter(a => !lockedActivityIds.has(a.activity_id));

  const compatibleActivitiesFor = (w: CandidateWorkout) =>
    movableActivities.filter(a => activityLocalDate(a, w.timeZone) === w.date);
  const compatibleWorkoutsFor = (a: CandidateActivity) =>
    movableWorkouts.filter(w => activityLocalDate(a, w.timeZone) === w.date);

  const accept: ReconciliationPlan["accept"] = [];
  for (const workout of movableWorkouts) {
    const candidateActivities = compatibleActivitiesFor(workout);
    if (candidateActivities.length !== 1) continue;
    const activity = candidateActivities[0];
    const candidateWorkouts = compatibleWorkoutsFor(activity);
    if (candidateWorkouts.length !== 1 || candidateWorkouts[0].workout_id !== workout.workout_id) continue;
    accept.push({ activity_id: activity.activity_id, workout_id: workout.workout_id });
  }
  const acceptedActivityIds = new Set(accept.map(a => a.activity_id));

  // AC10: an existing 'automatic' row that did NOT come out of the fresh
  // computation above has lost its uniqueness (a later import introduced a
  // competing candidate, or its workout no longer exists) — flip it to
  // 'unresolved' rather than silently leaving it accepted or deleting it.
  const demote = existing
    .filter(a => a.status === "automatic" && !acceptedActivityIds.has(a.activity_id))
    .map(a => ({ activity_id: a.activity_id }));

  return { accept, demote };
}

export type PlanDayEvidenceStatus = "pending" | "missed" | "completed";

// AC11/AC12: a future/current local plan day is always "pending" regardless
// of evidence; a past one is "completed" only with accepted evidence
// (automatic/manual_confirmed/manual_changed all count — 'unresolved' does
// NOT, since it is explicitly not-yet-resolved) and otherwise "missed".
// "Completed" never implies targets were hit — it only means evidence exists.
export function computeWorkoutDayStatus(
  planDate: string, timeZone: string, hasAcceptedEvidence: boolean, now: Date = new Date(),
): PlanDayEvidenceStatus {
  if (hasAcceptedEvidence) return "completed";
  return planDate < localDateInTimeZone(now, timeZone) ? "missed" : "pending";
}
