/**
 * repositories/planned-workouts.repo.ts
 * Data access for planned sessions within a training plan (HRA-109 — the only layer
 * that runs SQL for this domain, rest-api-standards §11). Always scoped by plan_id
 * for list/count; single-row reads/writes go through `byId` (top-level
 * /api/v1/planned-workouts/:id routes — nesting a 3rd path level under
 * /training-plans/:id/workouts/:id would violate rest-api-standards §1's ≤2-levels
 * rule, so the item routes live at top level instead).
 */
import type { DatabaseSync } from "node:sqlite";
import type { PlannedWorkoutRow } from "../db.ts";

const SELECT_FIELDS = "id, plan_id, date, workout_type, distance_m, duration_sec, target_pace_minkm, steps, created_at FROM planned_workouts";

export type PlannedWorkoutInput = Omit<PlannedWorkoutRow, "id" | "created_at">;

export function createPlannedWorkoutsRepo(db: DatabaseSync) {
  const listByPlan   = db.prepare(`SELECT ${SELECT_FIELDS} WHERE plan_id = ? ORDER BY date ASC LIMIT ? OFFSET ?`);
  const countByPlan  = db.prepare("SELECT COUNT(*) AS count FROM planned_workouts WHERE plan_id = ?");
  const findById     = db.prepare(`SELECT ${SELECT_FIELDS} WHERE id = ?`);
  const insert       = db.prepare(`
    INSERT INTO planned_workouts (plan_id, date, workout_type, distance_m, duration_sec, target_pace_minkm, steps)
    VALUES ($plan_id, $date, $workout_type, $distance_m, $duration_sec, $target_pace_minkm, $steps)
  `);
  const update        = db.prepare(`
    UPDATE planned_workouts SET
      date = $date, workout_type = $workout_type, distance_m = $distance_m,
      duration_sec = $duration_sec, target_pace_minkm = $target_pace_minkm, steps = $steps
    WHERE id = $id
  `);
  const deleteById    = db.prepare("DELETE FROM planned_workouts WHERE id = ?");

  return {
    listPageByPlan: (planId: number, limit: number, offset: number): PlannedWorkoutRow[] =>
      listByPlan.all(planId, limit, offset) as unknown as PlannedWorkoutRow[],
    countByPlan:    (planId: number): { count: number } => countByPlan.get(planId) as unknown as { count: number },
    byId:           (id: number): PlannedWorkoutRow | undefined => findById.get(id) as unknown as PlannedWorkoutRow | undefined,
    create:         (w: PlannedWorkoutInput): PlannedWorkoutRow => {
      const info = insert.run({
        $plan_id: w.plan_id, $date: w.date, $workout_type: w.workout_type,
        $distance_m: w.distance_m, $duration_sec: w.duration_sec,
        $target_pace_minkm: w.target_pace_minkm, $steps: w.steps,
      });
      return findById.get(Number(info.lastInsertRowid)) as unknown as PlannedWorkoutRow;
    },
    // plan_id is immutable after creation (a workout doesn't move between plans) —
    // Omit<..., "plan_id"> here mirrors that; move it by deleting + recreating instead.
    update:         (id: number, w: Omit<PlannedWorkoutInput, "plan_id">): PlannedWorkoutRow => {
      update.run({
        $id: id, $date: w.date, $workout_type: w.workout_type,
        $distance_m: w.distance_m, $duration_sec: w.duration_sec,
        $target_pace_minkm: w.target_pace_minkm, $steps: w.steps,
      });
      return findById.get(id) as unknown as PlannedWorkoutRow;
    },
    remove:         (id: number) => deleteById.run(id),
  };
}

export type PlannedWorkoutsRepo = ReturnType<typeof createPlannedWorkoutsRepo>;
