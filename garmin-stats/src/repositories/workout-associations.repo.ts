/**
 * repositories/workout-associations.repo.ts
 * Data access for workout_associations (HRA-334) — the only layer that runs
 * SQL for this domain (rest-api-standards §11).
 */
import type { DatabaseSync } from "node:sqlite";
import { prepareLive } from "../db.ts";
import type { AssociationStatus, WorkoutAssociationRow } from "../db.ts";

const FIELDS = "id, activity_id, workout_id, status, created_at, updated_at FROM workout_associations";

export function createWorkoutAssociationsRepo(db: DatabaseSync) {
  const byActivityIdStmt = prepareLive(`SELECT ${FIELDS} WHERE activity_id = ?`);
  const byWorkoutIdStmt = prepareLive(`SELECT ${FIELDS} WHERE workout_id = ?`);
  const allStmt = prepareLive(`SELECT ${FIELDS}`);
  // One row per activity (UNIQUE) — upsert on conflict rather than a
  // select-then-branch, so a repeated reconcile() run is a cheap no-op write
  // instead of two round trips.
  const upsertStmt = prepareLive(`
    INSERT INTO workout_associations (activity_id, workout_id, status, updated_at)
    VALUES ($activity_id, $workout_id, $status, datetime('now'))
    ON CONFLICT(activity_id) DO UPDATE SET
      workout_id = excluded.workout_id, status = excluded.status, updated_at = excluded.updated_at
  `);
  // Only ever demotes a row that is CURRENTLY 'automatic' — never touches a
  // manual/confirmed row even if a caller passes its activity_id by mistake.
  const demoteStmt = prepareLive(
    "UPDATE workout_associations SET status = 'unresolved', updated_at = datetime('now') WHERE activity_id = ? AND status = 'automatic'",
  );

  return {
    byActivityId: (activityId: number): WorkoutAssociationRow | undefined =>
      byActivityIdStmt.get(activityId) as unknown as WorkoutAssociationRow | undefined,
    byWorkoutId: (workoutId: string): WorkoutAssociationRow[] =>
      byWorkoutIdStmt.all(workoutId) as unknown as WorkoutAssociationRow[],
    all: (): WorkoutAssociationRow[] => allStmt.all() as unknown as WorkoutAssociationRow[],
    upsert: (activityId: number, workoutId: string | null, status: AssociationStatus) => {
      upsertStmt.run({ $activity_id: activityId, $workout_id: workoutId, $status: status });
    },
    demoteToUnresolved: (activityId: number) => { demoteStmt.run(activityId); },
  };
}

export type WorkoutAssociationsRepo = ReturnType<typeof createWorkoutAssociationsRepo>;
