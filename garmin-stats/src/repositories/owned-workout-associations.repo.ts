import type { AssociationStatus, WorkoutAssociationRow } from "../db.ts";
import type { Queryable } from "../db/query.ts";

const FIELDS = "wa.id,wa.activity_id,wa.workout_id,wa.status,wa.created_at,wa.updated_at";

export function createOwnedWorkoutAssociationsRepo(db: Queryable, userId: string) {
  return {
    byActivityId: (activityId: number) => db.get<WorkoutAssociationRow>(`SELECT ${FIELDS} FROM workout_associations wa WHERE wa.user_id=$1 AND wa.activity_id=$2`, [userId, activityId]),
    byWorkoutId: (workoutId: string) => db.all<WorkoutAssociationRow>(`SELECT ${FIELDS} FROM workout_associations wa WHERE wa.user_id=$1 AND wa.workout_id=$2`, [userId, workoutId]),
    all: () => db.all<WorkoutAssociationRow>(`SELECT ${FIELDS} FROM workout_associations wa WHERE wa.user_id=$1`, [userId]),
    upsert: (activityId: number, instanceId: number | null, workoutId: string | null, status: AssociationStatus) => db.run(`INSERT INTO workout_associations (user_id,activity_id,instance_id,workout_id,status,updated_at) SELECT $1::uuid,a.id,$3::bigint,$4::text,$5::text,now() FROM activities a WHERE a.id=$2 AND a.user_id=$1::uuid AND ($3::bigint IS NULL OR EXISTS (SELECT 1 FROM plan_instances pi WHERE pi.id=$3::bigint AND pi.user_id=$1::uuid)) ON CONFLICT(activity_id) DO UPDATE SET instance_id=excluded.instance_id,workout_id=excluded.workout_id,status=excluded.status,updated_at=now() WHERE workout_associations.user_id=$1::uuid`, [userId,activityId,instanceId,workoutId,status]),
    demoteToUnresolved: (activityId: number) => db.run("UPDATE workout_associations SET status='unresolved',updated_at=now() WHERE user_id=$1 AND activity_id=$2 AND status='automatic'", [userId, activityId]),
  };
}
