/**
 * repositories/plan-instances.repo.ts
 * Data access for resolved plan instances + their days (HRA-112) — the only
 * layer that runs SQL for this domain (rest-api-standards §11). Transactions
 * spanning both tables belong to services/plan-instances.service.ts, not here.
 */
import type { DatabaseSync } from "node:sqlite";
import type { PlanInstanceDayRow, PlanInstanceRow } from "../db.ts";

const INSTANCE_FIELDS = "id, template_id, start_date, pace_overrides, target_activity_id, approved_at, name, event, race_name, race_date, race_url, created_at FROM plan_instances";
const DAY_FIELDS = "id, instance_id, section_name, week_number, date, day, suffix, category, workout_type, segments, activity_target, activity_description, notes, needs_review FROM plan_instance_days";

export type PlanInstanceInput = Omit<PlanInstanceRow, "id" | "created_at" | "approved_at">;
export type PlanInstanceDayInput = Omit<PlanInstanceDayRow, "id">;

export function createPlanInstancesRepo(db: DatabaseSync) {
  const findInstanceById = db.prepare(`SELECT ${INSTANCE_FIELDS} WHERE id = ?`);
  // HRA-118: the instance card's list view — optionally scoped to one
  // template ("per-template instance list", the Story's own AC1 wording).
  // Separate prepared statements per shape (all vs. by-template) rather than
  // one query with a nullable bound param reused twice, matching this repo's
  // existing style of one statement per query shape.
  const listAllStmt = db.prepare(`SELECT ${INSTANCE_FIELDS} ORDER BY created_at DESC LIMIT ? OFFSET ?`);
  const countAllStmt = db.prepare("SELECT COUNT(*) AS count FROM plan_instances");
  const listByTemplateStmt = db.prepare(`SELECT ${INSTANCE_FIELDS} WHERE template_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`);
  const countByTemplateStmt = db.prepare("SELECT COUNT(*) AS count FROM plan_instances WHERE template_id = ?");
  const insertInstance = db.prepare(
    "INSERT INTO plan_instances (template_id, start_date, pace_overrides, target_activity_id, name, event, race_name, race_date, race_url) VALUES ($template_id, $start_date, $pace_overrides, $target_activity_id, $name, $event, $race_name, $race_date, $race_url)",
  );
  const findDaysByInstance = db.prepare(`SELECT ${DAY_FIELDS} WHERE instance_id = ? ORDER BY date ASC, day ASC`);
  const insertDay = db.prepare(`
    INSERT INTO plan_instance_days
      (instance_id, section_name, week_number, date, day, suffix, category, workout_type, segments, activity_target, activity_description, notes, needs_review)
    VALUES
      ($instance_id, $section_name, $week_number, $date, $day, $suffix, $category, $workout_type, $segments, $activity_target, $activity_description, $notes, $needs_review)
  `);
  const deleteDaysByInstanceStmt = db.prepare("DELETE FROM plan_instance_days WHERE instance_id = ?");
  const clearApprovalStmt = db.prepare("UPDATE plan_instances SET approved_at = NULL WHERE id = ?");
  const approveStmt = db.prepare("UPDATE plan_instances SET approved_at = datetime('now') WHERE id = ?");
  const updateNameStmt = db.prepare("UPDATE plan_instances SET name = ? WHERE id = ?");
  // ON DELETE CASCADE (plan_instance_days.instance_id) removes the instance's days too.
  const deleteInstanceStmt = db.prepare("DELETE FROM plan_instances WHERE id = ?");

  return {
    instanceById: (id: number): PlanInstanceRow | undefined => findInstanceById.get(id) as unknown as PlanInstanceRow | undefined,
    listPage: (limit: number, offset: number, templateId?: number): PlanInstanceRow[] =>
      (templateId != null
        ? listByTemplateStmt.all(templateId, limit, offset)
        : listAllStmt.all(limit, offset)) as unknown as PlanInstanceRow[],
    count: (templateId?: number): { count: number } =>
      (templateId != null ? countByTemplateStmt.get(templateId) : countAllStmt.get()) as unknown as { count: number },
    daysByInstance: (instanceId: number): PlanInstanceDayRow[] => findDaysByInstance.all(instanceId) as unknown as PlanInstanceDayRow[],
    createInstance: (i: PlanInstanceInput): PlanInstanceRow => {
      const info = insertInstance.run({
        $template_id: i.template_id, $start_date: i.start_date,
        $pace_overrides: i.pace_overrides, $target_activity_id: i.target_activity_id,
        $name: i.name, $event: i.event, $race_name: i.race_name, $race_date: i.race_date, $race_url: i.race_url,
      });
      return findInstanceById.get(Number(info.lastInsertRowid)) as unknown as PlanInstanceRow;
    },
    createDay: (d: PlanInstanceDayInput) => {
      insertDay.run({
        $instance_id: d.instance_id, $section_name: d.section_name, $week_number: d.week_number,
        $date: d.date, $day: d.day, $suffix: d.suffix, $category: d.category, $workout_type: d.workout_type,
        $segments: d.segments, $activity_target: d.activity_target, $activity_description: d.activity_description,
        $notes: d.notes, $needs_review: d.needs_review,
      });
    },
    // Compound operations (delete+insert+clear-approval) belong to
    // services/plan-instances.service.ts, which owns the transaction — these
    // are the single-statement primitives it composes (rest-api-standards §11).
    deleteDaysByInstance: (instanceId: number) => { deleteDaysByInstanceStmt.run(instanceId); },
    clearApproval: (id: number) => { clearApprovalStmt.run(id); },
    updateName: (id: number, name: string) => { updateNameStmt.run(name, id); },
    approve: (id: number): PlanInstanceRow => {
      approveStmt.run(id);
      return findInstanceById.get(id) as unknown as PlanInstanceRow;
    },
    remove: (id: number) => { deleteInstanceStmt.run(id); },
  };
}

export type PlanInstancesRepo = ReturnType<typeof createPlanInstancesRepo>;
