import type { WorkoutSegmentAlignmentRow } from "../db.ts";
import type { Queryable } from "../db/query.ts";

const FIELDS = "wsa.id,wa.workout_id,wsa.segment_index,wa.activity_id,wsa.distance_m,wsa.duration_sec,wsa.created_at,wsa.updated_at";

export function createOwnedWorkoutSegmentAlignmentsRepo(db: Queryable, userId: string) {
  return {
    byWorkoutId: (workoutId: string) => db.all<WorkoutSegmentAlignmentRow>(`SELECT ${FIELDS} FROM workout_segment_alignments wsa JOIN workout_associations wa ON wa.id=wsa.association_id WHERE wa.user_id=$1 AND wa.workout_id=$2 ORDER BY wsa.segment_index`, [userId, workoutId]),
    upsert: (workoutId: string, segmentIndex: number, activityId: number, distanceM: number | null, durationSec: number | null) => db.run(`INSERT INTO workout_segment_alignments (association_id,segment_index,distance_m,duration_sec,updated_at) SELECT wa.id,$3,$4,$5,now() FROM workout_associations wa WHERE wa.user_id=$1 AND wa.workout_id=$2 AND wa.activity_id=$6 ON CONFLICT (association_id,segment_index) DO UPDATE SET distance_m=excluded.distance_m,duration_sec=excluded.duration_sec,updated_at=now()`, [userId,workoutId,segmentIndex,distanceM,durationSec,activityId]),
    remove: (workoutId: string, segmentIndex: number) => db.run(`DELETE FROM workout_segment_alignments wsa USING workout_associations wa WHERE wsa.association_id=wa.id AND wa.user_id=$1 AND wa.workout_id=$2 AND wsa.segment_index=$3`, [userId,workoutId,segmentIndex]),
  };
}
