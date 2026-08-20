/**
 * repositories/training-plans.repo.ts
 * Data access for training plans (HRA-109 — the only layer that runs SQL for this
 * domain, rest-api-standards §11). A plan is the header row; its sessions live in
 * planned_workouts (planned-workouts.repo.ts), FK'd with ON DELETE CASCADE.
 */
import type { DatabaseSync } from "node:sqlite";
import type { TrainingPlanRow } from "../db.ts";

const SELECT_FIELDS = "id, name, sport, start_date, end_date, target_activity_id, created_at FROM training_plans";

export type TrainingPlanInput = Omit<TrainingPlanRow, "id" | "created_at">;

export function createTrainingPlansRepo(db: DatabaseSync) {
  const listAll     = db.prepare(`SELECT ${SELECT_FIELDS} ORDER BY start_date DESC LIMIT ? OFFSET ?`);
  const countAll     = db.prepare("SELECT COUNT(*) AS count FROM training_plans");
  const findById     = db.prepare(`SELECT ${SELECT_FIELDS} WHERE id = ?`);
  const insert       = db.prepare("INSERT INTO training_plans (name, sport, start_date, end_date, target_activity_id) VALUES ($name, $sport, $start_date, $end_date, $target_activity_id)");
  const update       = db.prepare("UPDATE training_plans SET name = $name, sport = $sport, start_date = $start_date, end_date = $end_date, target_activity_id = $target_activity_id WHERE id = $id");
  const deleteById   = db.prepare("DELETE FROM training_plans WHERE id = ?");

  return {
    listPage: (limit: number, offset: number): TrainingPlanRow[] => listAll.all(limit, offset) as unknown as TrainingPlanRow[],
    count:    (): { count: number } => countAll.get() as unknown as { count: number },
    byId:     (id: number): TrainingPlanRow | undefined => findById.get(id) as unknown as TrainingPlanRow | undefined,
    create:   (p: TrainingPlanInput): TrainingPlanRow => {
      const info = insert.run({
        $name: p.name, $sport: p.sport, $start_date: p.start_date, $end_date: p.end_date,
        $target_activity_id: p.target_activity_id,
      });
      return findById.get(Number(info.lastInsertRowid)) as unknown as TrainingPlanRow;
    },
    update:   (id: number, p: TrainingPlanInput): TrainingPlanRow => {
      update.run({
        $id: id, $name: p.name, $sport: p.sport, $start_date: p.start_date, $end_date: p.end_date,
        $target_activity_id: p.target_activity_id,
      });
      return findById.get(id) as unknown as TrainingPlanRow;
    },
    // ON DELETE CASCADE (planned_workouts.plan_id) removes the plan's sessions too.
    remove:   (id: number) => deleteById.run(id),
  };
}

export type TrainingPlansRepo = ReturnType<typeof createTrainingPlansRepo>;
