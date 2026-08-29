/**
 * repositories/plan-instances.repo.ts
 * Data access for resolved plan instances + their days (HRA-112) — the only
 * layer that runs SQL for this domain (rest-api-standards §11). Transactions
 * spanning both tables belong to services/plan-instances.service.ts, not here.
 */
import type { DatabaseSync } from "node:sqlite";
import type { PlanInstanceDayRow, PlanInstanceRow } from "../db.ts";

const INSTANCE_FIELDS = "id, template_id, start_date, pace_overrides, target_activity_id, approved_at, name, event, race_name, race_date, race_url, created_at FROM plan_instances";
const DAY_FIELDS = "id, instance_id, section_name, week_number, date, day, suffix, category, workout_type, segments, activity_target, activity_description, notes, needs_review, scheduled_time FROM plan_instance_days";

export type PlanInstanceInput = Omit<PlanInstanceRow, "id" | "created_at" | "approved_at">;
export type PlanInstanceDayInput = Omit<PlanInstanceDayRow, "id">;
// HRA-206: a plan_instance_days row denormalized with its owning instance's
// own name — GET /api/v1/plan-instance-days needs this to label a same-day
// picker across multiple instances without a second round trip per row.
export type PlanInstanceDayWithInstance = PlanInstanceDayRow & { instance_name: string | null };

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
  const findDayByIdStmt = db.prepare(`SELECT ${DAY_FIELDS} WHERE id = ?`);
  // HRA-206: every run-type plan_instance_day matching a calendar date,
  // across every instance (any approved_at state, per the Story's own scope)
  // — joined with the owning instance's name so ActivityDetailBody's picker
  // can label each option without a second lookup per match. Newest-instance
  // first, matching this repo's other list queries' own default ordering.
  const findDaysByDateAndWorkoutTypeStmt = db.prepare(`
    SELECT pid.id, pid.instance_id, pid.section_name, pid.week_number, pid.date, pid.day, pid.suffix, pid.category,
           pid.workout_type, pid.segments, pid.activity_target, pid.activity_description, pid.notes, pid.needs_review,
           pid.scheduled_time, pi.name AS instance_name
    FROM plan_instance_days pid
    JOIN plan_instances pi ON pi.id = pid.instance_id
    WHERE pid.date = ? AND pid.workout_type = ?
    ORDER BY pi.created_at DESC
  `);
  const insertDay = db.prepare(`
    INSERT INTO plan_instance_days
      (instance_id, section_name, week_number, date, day, suffix, category, workout_type, segments, activity_target, activity_description, notes, needs_review)
    VALUES
      ($instance_id, $section_name, $week_number, $date, $day, $suffix, $category, $workout_type, $segments, $activity_target, $activity_description, $notes, $needs_review)
  `);
  const deleteDaysByInstanceStmt = db.prepare("DELETE FROM plan_instance_days WHERE instance_id = ?");
  // HRA-149: PATCH /api/v1/plan-instances/:id/days/:dayId — a single day's
  // dsl-derived columns (re-parsed+resolved) vs. its independent notes/
  // scheduled_time overrides are separate statements, run conditionally by
  // the service, same "one statement per field" style as updateFields above.
  const updateDayFromDslStmt = db.prepare(`
    UPDATE plan_instance_days SET
      day = ?, suffix = ?, category = ?, workout_type = ?, segments = ?,
      activity_target = ?, activity_description = ?, notes = ?, needs_review = ?
    WHERE id = ?
  `);
  const updateDayNotesStmt = db.prepare("UPDATE plan_instance_days SET notes = ? WHERE id = ?");
  const updateDayScheduledTimeStmt = db.prepare("UPDATE plan_instance_days SET scheduled_time = ? WHERE id = ?");
  // HRA-155: replaces the earlier HRA-132 `deleteDaysFromDate` (a raw
  // `date >= fromDate` threshold) — that comparison silently broke whenever
  // `start_date` changed as part of the same regenerate call, since the OLD
  // rows' dates and the FRESHLY regenerated rows' dates are then computed
  // from two different baselines, so a single date threshold can't reliably
  // tell which old row a fresh one is replacing (produced orphaned stale
  // rows and/or duplicate rows for the same day). Deleting by day identity
  // instead — the caller only ever calls this once per day about to be
  // (re)inserted (services/plan-instances.service.ts's regenerateFrom) — so
  // that day's previous row, whatever date it happened to carry, is always
  // removed first, with no dependence on dates lining up across the change.
  const deleteDayByIdentityStmt = db.prepare(
    "DELETE FROM plan_instance_days WHERE instance_id = ? AND section_name = ? AND week_number = ? AND day = ?",
  );
  const clearApprovalStmt = db.prepare("UPDATE plan_instances SET approved_at = NULL WHERE id = ?");
  const approveStmt = db.prepare("UPDATE plan_instances SET approved_at = datetime('now') WHERE id = ?");
  const updateNameStmt = db.prepare("UPDATE plan_instances SET name = ? WHERE id = ?");
  // HRA-135: one statement per field, run conditionally in updateFields() —
  // same granular-primitive style as updateName/updateStartDateAndPaceOverrides
  // above, so a PATCH that omits a field never touches its column.
  const updateRaceNameStmt = db.prepare("UPDATE plan_instances SET race_name = ? WHERE id = ?");
  const updateRaceDateStmt = db.prepare("UPDATE plan_instances SET race_date = ? WHERE id = ?");
  const updateRaceUrlStmt = db.prepare("UPDATE plan_instances SET race_url = ? WHERE id = ?");
  // HRA-132: written together — a regenerate always resolves both (falling
  // back to the instance's own current value for whichever the caller didn't
  // supply) before running instantiatePlan, so both columns stay consistent
  // with whatever was actually used to produce the regenerated days.
  const updateStartDateAndPaceOverridesStmt = db.prepare("UPDATE plan_instances SET start_date = ?, pace_overrides = ? WHERE id = ?");
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
    dayById: (id: number): PlanInstanceDayRow | undefined => findDayByIdStmt.get(id) as unknown as PlanInstanceDayRow | undefined,
    daysByDateAndWorkoutType: (date: string, workoutType: string): PlanInstanceDayWithInstance[] =>
      findDaysByDateAndWorkoutTypeStmt.all(date, workoutType) as unknown as PlanInstanceDayWithInstance[],
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
    deleteDayByIdentity: (instanceId: number, sectionName: string, weekNumber: number, day: number) => {
      deleteDayByIdentityStmt.run(instanceId, sectionName, weekNumber, day);
    },
    clearApproval: (id: number) => { clearApprovalStmt.run(id); },
    // HRA-135: PATCH /api/v1/plan-instances/:id — each field is applied only
    // if the caller actually supplied it (checked via `!== undefined`, not
    // truthiness — an explicit null clears a nullable race_* column).
    updateFields: (id: number, fields: Partial<{ name: string; race_name: string | null; race_date: string | null; race_url: string | null }>) => {
      if (fields.name !== undefined) updateNameStmt.run(fields.name, id);
      if (fields.race_name !== undefined) updateRaceNameStmt.run(fields.race_name, id);
      if (fields.race_date !== undefined) updateRaceDateStmt.run(fields.race_date, id);
      if (fields.race_url !== undefined) updateRaceUrlStmt.run(fields.race_url, id);
    },
    updateStartDateAndPaceOverrides: (id: number, startDate: string, paceOverrides: string | null) => {
      updateStartDateAndPaceOverridesStmt.run(startDate, paceOverrides, id);
    },
    // HRA-149: dsl-derived columns for one day, re-parsed+resolved by the caller.
    updateDayFromDsl: (dayId: number, d: {
      day: number; suffix: string | null; category: string | null; workout_type: string; segments: string;
      activity_target: string | null; activity_description: string | null; notes: string | null; needs_review: number;
    }) => {
      updateDayFromDslStmt.run(
        d.day, d.suffix, d.category, d.workout_type, d.segments,
        d.activity_target, d.activity_description, d.notes, d.needs_review, dayId,
      );
    },
    updateDayNotes: (dayId: number, notes: string | null) => { updateDayNotesStmt.run(notes, dayId); },
    updateDayScheduledTime: (dayId: number, scheduledTime: string | null) => { updateDayScheduledTimeStmt.run(scheduledTime, dayId); },
    approve: (id: number): PlanInstanceRow => {
      approveStmt.run(id);
      return findInstanceById.get(id) as unknown as PlanInstanceRow;
    },
    remove: (id: number) => { deleteInstanceStmt.run(id); },
  };
}

export type PlanInstancesRepo = ReturnType<typeof createPlanInstancesRepo>;
