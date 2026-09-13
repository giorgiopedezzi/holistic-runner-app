/**
 * repositories/workout-segment-alignments.repo.ts
 * Data access for workout_segment_alignments (HRA-342) — the only layer that
 * runs SQL for this domain (rest-api-standards §11). Mirrors
 * workout-associations.repo.ts's own shape/upsert convention.
 */
import type { DatabaseSync } from "node:sqlite";
import { prepareLive as prepareLiveGlobal } from "../db.ts";
import type { WorkoutSegmentAlignmentRow } from "../db.ts";

const FIELDS = "id, workout_id, segment_index, activity_id, distance_m, duration_sec, created_at, updated_at FROM workout_segment_alignments";

export function createWorkoutSegmentAlignmentsRepo(db: DatabaseSync) {
  const prepareLive = (sql: string) => prepareLiveGlobal(sql, db);
  const byWorkoutIdStmt = prepareLive(`SELECT ${FIELDS} WHERE workout_id = ? ORDER BY segment_index ASC`);
  // One row per (workout_id, segment_index) — upsert on conflict so a
  // "correct"/"replace" is the same call as the initial "confirm".
  const upsertStmt = prepareLive(`
    INSERT INTO workout_segment_alignments (workout_id, segment_index, activity_id, distance_m, duration_sec, updated_at)
    VALUES ($workout_id, $segment_index, $activity_id, $distance_m, $duration_sec, datetime('now'))
    ON CONFLICT(workout_id, segment_index) DO UPDATE SET
      activity_id = excluded.activity_id, distance_m = excluded.distance_m,
      duration_sec = excluded.duration_sec, updated_at = excluded.updated_at
  `);
  const deleteStmt = prepareLive("DELETE FROM workout_segment_alignments WHERE workout_id = ? AND segment_index = ?");

  return {
    byWorkoutId: (workoutId: string): WorkoutSegmentAlignmentRow[] =>
      byWorkoutIdStmt.all(workoutId) as unknown as WorkoutSegmentAlignmentRow[],
    upsert: (workoutId: string, segmentIndex: number, activityId: number, distanceM: number | null, durationSec: number | null) => {
      upsertStmt.run({
        $workout_id: workoutId, $segment_index: segmentIndex, $activity_id: activityId,
        $distance_m: distanceM, $duration_sec: durationSec,
      });
    },
    remove: (workoutId: string, segmentIndex: number) => { deleteStmt.run(workoutId, segmentIndex); },
  };
}

export type WorkoutSegmentAlignmentsRepo = ReturnType<typeof createWorkoutSegmentAlignmentsRepo>;
