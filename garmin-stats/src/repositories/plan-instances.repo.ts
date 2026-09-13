/**
 * repositories/plan-instances.repo.ts
 * Data access for resolved plan instances + their days (HRA-112) — the only
 * layer that runs SQL for this domain (rest-api-standards §11). Transactions
 * spanning both tables belong to services/plan-instances.service.ts, not here.
 */
import type { DatabaseSync } from "node:sqlite";
import { prepareLive as prepareLiveGlobal } from "../db.ts";
import type { PlanInstanceDayRow, PlanInstanceRow } from "../db.ts";

const INSTANCE_FIELDS = "id, template_id, start_date, pace_overrides, target_activity_id, approved_at, name, event, race_name, race_date, race_url, schedule_timezone, original_start_date, original_days_snapshot, current_revision, original_revision, created_at FROM plan_instances";
const DAY_FIELDS = "id, instance_id, section_name, week_number, date, day, suffix, category, workout_type, segments, activity_target, activity_description, notes, needs_review, scheduled_time, customized_at, workout_id FROM plan_instance_days";

// HRA-336: current_revision/original_revision are never caller-supplied at
// creation — both always start at 1 via the column's own DEFAULT (see
// insertInstance below, which never references either column), the same way
// approved_at is omitted here rather than accepted as a creation-time input.
export type PlanInstanceInput = Omit<PlanInstanceRow, "id" | "created_at" | "approved_at" | "current_revision" | "original_revision">;
export type PlanInstanceDayInput = Omit<PlanInstanceDayRow, "id">;
// HRA-206: a plan_instance_days row denormalized with its owning instance's
// own name — GET /api/v1/plan-instance-days needs this to label a same-day
// picker across multiple instances without a second round trip per row.
export type PlanInstanceDayWithInstance = PlanInstanceDayRow & { instance_name: string | null };

export function createPlanInstancesRepo(db: DatabaseSync) {
  // Bound to this repo's own `db` — see activities.repo.ts's own comment /
  // db.ts's prepareLive() for the full reasoning (test-db isolation fix).
  const prepareLive = (sql: string) => prepareLiveGlobal(sql, db);
  const findInstanceById = prepareLive(`SELECT ${INSTANCE_FIELDS} WHERE id = ?`);
  // HRA-118: the instance card's list view — optionally scoped to one
  // template ("per-template instance list", the Story's own AC1 wording).
  // Separate prepared statements per shape (all vs. by-template) rather than
  // one query with a nullable bound param reused twice, matching this repo's
  // existing style of one statement per query shape.
  const listAllStmt = prepareLive(`SELECT ${INSTANCE_FIELDS} ORDER BY created_at DESC LIMIT ? OFFSET ?`);
  const countAllStmt = prepareLive("SELECT COUNT(*) AS count FROM plan_instances");
  const listByTemplateStmt = prepareLive(`SELECT ${INSTANCE_FIELDS} WHERE template_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`);
  const countByTemplateStmt = prepareLive("SELECT COUNT(*) AS count FROM plan_instances WHERE template_id = ?");
  const insertInstance = prepareLive(`
    INSERT INTO plan_instances
      (template_id, start_date, pace_overrides, target_activity_id, name, event, race_name, race_date, race_url,
       schedule_timezone, original_start_date, original_days_snapshot)
    VALUES
      ($template_id, $start_date, $pace_overrides, $target_activity_id, $name, $event, $race_name, $race_date, $race_url,
       $schedule_timezone, $original_start_date, $original_days_snapshot)
  `);
  const findDaysByInstance = prepareLive(`SELECT ${DAY_FIELDS} WHERE instance_id = ? ORDER BY date ASC, day ASC`);
  const findDayByIdStmt = prepareLive(`SELECT ${DAY_FIELDS} WHERE id = ?`);
  // HRA-203: the section/week .fit-zip export's own scoping queries — same
  // DAY_FIELDS projection and date/day ordering as findDaysByInstance above,
  // just narrowed by section_name (and, for the week variant, week_number
  // too). Two prepared statements rather than one with a nullable bound
  // param, matching this repo's existing "one statement per query shape"
  // style (see findDaysByDateAndWorkoutTypeStmt's own comment above).
  const findDaysBySectionStmt = prepareLive(`SELECT ${DAY_FIELDS} WHERE instance_id = ? AND section_name = ? ORDER BY date ASC, day ASC`);
  const findDaysBySectionAndWeekStmt = prepareLive(
    `SELECT ${DAY_FIELDS} WHERE instance_id = ? AND section_name = ? AND week_number = ? ORDER BY date ASC, day ASC`,
  );
  // HRA-206: every run-type plan_instance_day matching a calendar date,
  // across every instance (any approved_at state, per the Story's own scope)
  // — joined with the owning instance's name so ActivityDetailBody's picker
  // can label each option without a second lookup per match. Newest-instance
  // first, matching this repo's other list queries' own default ordering.
  const findDaysByDateAndWorkoutTypeStmt = prepareLive(`
    SELECT pid.id, pid.instance_id, pid.section_name, pid.week_number, pid.date, pid.day, pid.suffix, pid.category,
           pid.workout_type, pid.segments, pid.activity_target, pid.activity_description, pid.notes, pid.needs_review,
           pid.scheduled_time, pid.customized_at, pid.workout_id, pi.name AS instance_name
    FROM plan_instance_days pid
    JOIN plan_instances pi ON pi.id = pid.instance_id
    WHERE pid.date = ? AND pid.workout_type = ?
    ORDER BY pi.created_at DESC
  `);
  // HRA-248: "Your agenda"'s today-centered home view — the one APPROVED
  // instance (approved_at IS NOT NULL) whose resolved days cover a given
  // date. No workout_type filter, unlike findDaysByDateAndWorkoutTypeStmt
  // above — a REST day is a real dated row too (HRA-124) and must resolve
  // just as well as a workout day. Newest-instance-first on the (out of
  // scope here, see the sibling overlap-detection Story) chance more than
  // one approved instance's days cover the same date.
  const findActiveInstanceIdForDateStmt = prepareLive(`
    SELECT pi.id
    FROM plan_instance_days pid
    JOIN plan_instances pi ON pi.id = pid.instance_id
    WHERE pid.date = ? AND pi.approved_at IS NOT NULL
    ORDER BY pi.created_at DESC
    LIMIT 1
  `);
  const insertDay = prepareLive(`
    INSERT INTO plan_instance_days
      (instance_id, section_name, week_number, date, day, suffix, category, workout_type, segments, activity_target, activity_description, notes, needs_review, workout_id)
    VALUES
      ($instance_id, $section_name, $week_number, $date, $day, $suffix, $category, $workout_type, $segments, $activity_target, $activity_description, $notes, $needs_review, $workout_id)
  `);
  const deleteDaysByInstanceStmt = prepareLive("DELETE FROM plan_instance_days WHERE instance_id = ?");
  // HRA-333: the previous occupant of a (section_name, week_number, day)
  // slot, looked up BEFORE deleteDayByIdentity removes it — regenerateFrom's
  // own way of carrying that slot's workout_id over to the freshly
  // regenerated row replacing it, same positional-identity reasoning
  // deleteDayByIdentity itself already relies on.
  const dayByIdentityStmt = prepareLive(
    "SELECT workout_id FROM plan_instance_days WHERE instance_id = ? AND section_name = ? AND week_number = ? AND day = ?",
  );
  // HRA-149: PATCH /api/v1/plan-instances/:id/days/:dayId — a single day's
  // dsl-derived columns (re-parsed+resolved) vs. its independent notes/
  // scheduled_time overrides are separate statements, run conditionally by
  // the service, same "one statement per field" style as updateFields above.
  const updateDayFromDslStmt = prepareLive(`
    UPDATE plan_instance_days SET
      day = ?, suffix = ?, category = ?, workout_type = ?, segments = ?,
      activity_target = ?, activity_description = ?, notes = ?, needs_review = ?
    WHERE id = ?
  `);
  const updateDayNotesStmt = prepareLive("UPDATE plan_instance_days SET notes = ? WHERE id = ?");
  const updateDayScheduledTimeStmt = prepareLive("UPDATE plan_instance_days SET scheduled_time = ? WHERE id = ?");
  // HRA-333: PATCH .../days/:dayId's own way of moving identity onto a row
  // whose dsl just became a swap partner's content — see
  // plan-instances.service.ts's patchDay.
  const updateDayWorkoutIdStmt = prepareLive("UPDATE plan_instance_days SET workout_id = ? WHERE id = ?");
  // HRA-299: sets the customization provenance marker on one day — called
  // whenever that day's workout content is individually edited or swapped
  // (never for a notes-only or scheduled_time-only patch, and never for a
  // bulk days-replace/regenerate, both of which recreate the row from
  // scratch with this column left NULL — see the schema comment in db.ts).
  const markDayCustomizedStmt = prepareLive("UPDATE plan_instance_days SET customized_at = datetime('now') WHERE id = ?");
  // HRA-299: every day of an instance, from `effective_from` onward, that
  // still carries a customization marker — the regenerate preflight's own
  // detection query, run against the CURRENTLY persisted rows before any
  // mutation. Text comparison on ISO YYYY-MM-DD dates sorts chronologically,
  // same reasoning as instanceDateRangeStmt/overlappingApprovedStmt above.
  const customizedDaysFromStmt = prepareLive(`
    SELECT ${DAY_FIELDS} WHERE instance_id = ? AND date >= ? AND customized_at IS NOT NULL ORDER BY date ASC, day ASC
  `);
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
  const deleteDayByIdentityStmt = prepareLive(
    "DELETE FROM plan_instance_days WHERE instance_id = ? AND section_name = ? AND week_number = ? AND day = ?",
  );
  // HRA-334: the automatic-matcher's own candidate pool — every "run"-type
  // day across every instance (any approved_at state, same "any instance may
  // contain candidates" scope as findDaysByDateAndWorkoutTypeStmt above),
  // paired with its owning instance's schedule_timezone so the matcher can
  // convert an activity's UTC-ish activity_date into the SAME local calendar
  // frame this day's own `date` was authored in (AC3). REST/OTHER/etc. are
  // never included — the matcher never even sees them (AC5/AC6).
  const runDaysWithTimezoneStmt = prepareLive(`
    SELECT pid.workout_id, pid.date, pi.schedule_timezone
    FROM plan_instance_days pid JOIN plan_instances pi ON pi.id = pid.instance_id
    WHERE pid.workout_type = 'run'
  `);
  // HRA-334: the CURRENT plan day a given workout_id resolves to right now
  // (a workout_id survives a swap/regenerate, but the row it lives on can
  // change) — undefined once the workout has been removed from Current
  // entirely (e.g. its instance was deleted). Denormalized with the owning
  // instance's name, same convenience findDaysByDateAndWorkoutTypeStmt above
  // already provides.
  const dayByWorkoutIdStmt = prepareLive(`
    SELECT pid.id, pid.instance_id, pid.section_name, pid.week_number, pid.date, pid.day, pid.suffix, pid.category,
           pid.workout_type, pid.segments, pid.activity_target, pid.activity_description, pid.notes, pid.needs_review,
           pid.scheduled_time, pid.customized_at, pid.workout_id, pi.name AS instance_name
    FROM plan_instance_days pid
    JOIN plan_instances pi ON pi.id = pid.instance_id
    WHERE pid.workout_id = ?
  `);
  const clearApprovalStmt = prepareLive("UPDATE plan_instances SET approved_at = NULL WHERE id = ?");
  const approveStmt = prepareLive("UPDATE plan_instances SET approved_at = datetime('now') WHERE id = ?");
  // HRA-249: the candidate's own resolved date range for the overlap check
  // below — MIN/MAX over its days rather than a dedicated stored range,
  // since plan_instance_days.date is already the source of truth. Text
  // comparison on ISO YYYY-MM-DD strings sorts chronologically, so this
  // (and overlappingApprovedStmt below) never needs a Date object and is
  // immune to the timezone boundary defects a Date-based comparison risks.
  const instanceDateRangeStmt = prepareLive(
    "SELECT MIN(date) AS start_date, MAX(date) AS end_date FROM plan_instance_days WHERE instance_id = ?",
  );
  // HRA-249: every OTHER approved instance whose own [MIN(date), MAX(date)]
  // range overlaps a given [start, end] inclusively — start/end-boundary,
  // full containment either direction, and a shared boundary date all count
  // (standard inclusive interval overlap: existing.end >= candidateStart AND
  // existing.start <= candidateEnd). `pi.id != ?` excludes the candidate
  // itself (re-activating/re-approving never conflicts with itself);
  // `approved_at IS NOT NULL` excludes every not-yet-approved instance.
  const overlappingApprovedStmt = prepareLive(`
    SELECT pi.id, pi.name, MIN(pid.date) AS start_date, MAX(pid.date) AS end_date
    FROM plan_instances pi
    JOIN plan_instance_days pid ON pid.instance_id = pi.id
    WHERE pi.approved_at IS NOT NULL AND pi.id != ?
    GROUP BY pi.id
    HAVING MAX(pid.date) >= ? AND MIN(pid.date) <= ?
  `);
  const updateNameStmt = prepareLive("UPDATE plan_instances SET name = ? WHERE id = ?");
  // HRA-135: one statement per field, run conditionally in updateFields() —
  // same granular-primitive style as updateName/updateStartDateAndPaceOverrides
  // above, so a PATCH that omits a field never touches its column.
  const updateRaceNameStmt = prepareLive("UPDATE plan_instances SET race_name = ? WHERE id = ?");
  const updateRaceDateStmt = prepareLive("UPDATE plan_instances SET race_date = ? WHERE id = ?");
  const updateRaceUrlStmt = prepareLive("UPDATE plan_instances SET race_url = ? WHERE id = ?");
  // HRA-132: written together — a regenerate always resolves both (falling
  // back to the instance's own current value for whichever the caller didn't
  // supply) before running instantiatePlan, so both columns stay consistent
  // with whatever was actually used to produce the regenerated days.
  const updateStartDateAndPaceOverridesStmt = prepareLive("UPDATE plan_instances SET start_date = ?, pace_overrides = ? WHERE id = ?");
  // HRA-332: schedule_timezone correction (rejected by the service once
  // Original is frozen) and the Original-baseline mirror write, run by the
  // service after every pre-freeze Current mutation — see
  // plan-instances.service.ts's syncOriginalIfNotFrozen.
  const updateScheduleTimezoneStmt = prepareLive("UPDATE plan_instances SET schedule_timezone = ? WHERE id = ?");
  const updateOriginalStmt = prepareLive(
    "UPDATE plan_instances SET original_start_date = ?, original_days_snapshot = ?, original_revision = ? WHERE id = ?",
  );
  // HRA-336: bumped exactly once per successful semantic mutation of Current
  // — the service layer decides WHETHER a call changed anything (a failed or
  // semantic no-op operation never calls this), always inside the same
  // transaction as the mutation itself, so a rolled-back mutation never
  // leaves a stray bump behind.
  const bumpCurrentRevisionStmt = prepareLive("UPDATE plan_instances SET current_revision = current_revision + 1 WHERE id = ?");
  // ON DELETE CASCADE (plan_instance_days.instance_id) removes the instance's days too.
  const deleteInstanceStmt = prepareLive("DELETE FROM plan_instances WHERE id = ?");

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
    daysBySection: (instanceId: number, sectionName: string): PlanInstanceDayRow[] =>
      findDaysBySectionStmt.all(instanceId, sectionName) as unknown as PlanInstanceDayRow[],
    daysBySectionAndWeek: (instanceId: number, sectionName: string, weekNumber: number): PlanInstanceDayRow[] =>
      findDaysBySectionAndWeekStmt.all(instanceId, sectionName, weekNumber) as unknown as PlanInstanceDayRow[],
    daysByDateAndWorkoutType: (date: string, workoutType: string): PlanInstanceDayWithInstance[] =>
      findDaysByDateAndWorkoutTypeStmt.all(date, workoutType) as unknown as PlanInstanceDayWithInstance[],
    activeInstanceIdForDate: (date: string): number | undefined =>
      (findActiveInstanceIdForDateStmt.get(date) as { id: number } | undefined)?.id,
    runDaysWithTimezone: (): { workout_id: string; date: string; schedule_timezone: string | null }[] =>
      runDaysWithTimezoneStmt.all() as unknown as { workout_id: string; date: string; schedule_timezone: string | null }[],
    dayByWorkoutId: (workoutId: string): PlanInstanceDayWithInstance | undefined =>
      dayByWorkoutIdStmt.get(workoutId) as unknown as PlanInstanceDayWithInstance | undefined,
    createInstance: (i: PlanInstanceInput): PlanInstanceRow => {
      const info = insertInstance.run({
        $template_id: i.template_id, $start_date: i.start_date,
        $pace_overrides: i.pace_overrides, $target_activity_id: i.target_activity_id,
        $name: i.name, $event: i.event, $race_name: i.race_name, $race_date: i.race_date, $race_url: i.race_url,
        $schedule_timezone: i.schedule_timezone, $original_start_date: i.original_start_date,
        $original_days_snapshot: i.original_days_snapshot,
      });
      return findInstanceById.get(Number(info.lastInsertRowid)) as unknown as PlanInstanceRow;
    },
    createDay: (d: PlanInstanceDayInput) => {
      insertDay.run({
        $instance_id: d.instance_id, $section_name: d.section_name, $week_number: d.week_number,
        $date: d.date, $day: d.day, $suffix: d.suffix, $category: d.category, $workout_type: d.workout_type,
        $segments: d.segments, $activity_target: d.activity_target, $activity_description: d.activity_description,
        $notes: d.notes, $needs_review: d.needs_review, $workout_id: d.workout_id,
      });
    },
    // HRA-333: undefined when no day currently occupies that slot (a
    // template DSL change introducing a new day the previous version didn't
    // have) — the caller mints a fresh workout_id in that case.
    dayByIdentity: (instanceId: number, sectionName: string, weekNumber: number, day: number): string | undefined =>
      (dayByIdentityStmt.get(instanceId, sectionName, weekNumber, day) as { workout_id: string } | undefined)?.workout_id,
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
    updateScheduleTimezone: (id: number, scheduleTimezone: string) => { updateScheduleTimezoneStmt.run(scheduleTimezone, id); },
    updateOriginal: (id: number, originalStartDate: string, originalDaysSnapshot: string, originalRevision: number) => {
      updateOriginalStmt.run(originalStartDate, originalDaysSnapshot, originalRevision, id);
    },
    bumpCurrentRevision: (id: number) => { bumpCurrentRevisionStmt.run(id); },
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
    updateDayWorkoutId: (dayId: number, workoutId: string) => { updateDayWorkoutIdStmt.run(workoutId, dayId); },
    markDayCustomized: (dayId: number) => { markDayCustomizedStmt.run(dayId); },
    customizedDaysFrom: (instanceId: number, effectiveFrom: string): PlanInstanceDayRow[] =>
      customizedDaysFromStmt.all(instanceId, effectiveFrom) as unknown as PlanInstanceDayRow[],
    approve: (id: number): PlanInstanceRow => {
      approveStmt.run(id);
      return findInstanceById.get(id) as unknown as PlanInstanceRow;
    },
    dateRangeForInstance: (id: number): { start_date: string; end_date: string } | undefined => {
      const row = instanceDateRangeStmt.get(id) as { start_date: string | null; end_date: string | null };
      return row.start_date != null && row.end_date != null ? { start_date: row.start_date, end_date: row.end_date } : undefined;
    },
    overlappingApproved: (excludeId: number, startDate: string, endDate: string): { id: number; name: string | null; start_date: string; end_date: string }[] =>
      overlappingApprovedStmt.all(excludeId, startDate, endDate) as unknown as { id: number; name: string | null; start_date: string; end_date: string }[],
    remove: (id: number) => { deleteInstanceStmt.run(id); },
  };
}

export type PlanInstancesRepo = ReturnType<typeof createPlanInstancesRepo>;
