import type { Queryable } from "../db/query.ts";
import type { AssociationStatus, WorkoutAssociationRow } from "../db.ts";
const FIELDS = "id, activity_id, workout_id, status, created_at, updated_at";
export function createWorkoutAssociationsRepo(db: Queryable) { const repo = {
  byActivityId: (activityId: number) => db.get<WorkoutAssociationRow>(`SELECT ${FIELDS} FROM workout_associations WHERE activity_id=$1`, [activityId]),
  byWorkoutId: (workoutId: string) => db.all<WorkoutAssociationRow>(`SELECT ${FIELDS} FROM workout_associations WHERE workout_id=$1`, [workoutId]),
  all: () => db.all<WorkoutAssociationRow>(`SELECT ${FIELDS} FROM workout_associations`),
  upsert: (activityId: number, instanceId: number | null, workoutId: string | null, status: AssociationStatus) => db.run(`INSERT INTO workout_associations (user_id, activity_id, instance_id, workout_id, status, updated_at) VALUES ((SELECT user_id FROM activities WHERE id=$1), $1, $2, $3, $4, now()) ON CONFLICT(activity_id) DO UPDATE SET instance_id=excluded.instance_id, workout_id=excluded.workout_id, status=excluded.status, updated_at=now()`, [activityId, instanceId, workoutId, status]),
  demoteToUnresolved: (activityId: number) => db.run("UPDATE workout_associations SET status='unresolved', updated_at=now() WHERE activity_id=$1 AND status='automatic'", [activityId]),
}; return { ...repo, withDb: (query: Queryable) => createWorkoutAssociationsRepo(query) }; }
export type WorkoutAssociationsRepo = ReturnType<typeof createWorkoutAssociationsRepo>;
