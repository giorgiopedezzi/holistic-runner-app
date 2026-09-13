/**
 * services/plan-instances.service.ts
 * Business logic for instantiating a plan template (HRA-112): runs the pure
 * domain instantiation (domain/runplan/instantiate.ts), then owns the DB
 * transaction that persists the resulting instance + its resolved days
 * (spans two repository calls, so it belongs above the repo layer — same
 * pattern as activities.service.ts).
 */
import type { DatabaseSync } from "node:sqlite";
import type { PlanInstanceDayRow, PlanInstanceRow } from "../db.ts";
import type { PlanInstanceDayInput, PlanInstancesRepo } from "../repositories/plan-instances.repo.ts";
import { instantiatePlan, type InstantiateOptions } from "../domain/runplan/instantiate.ts";
import type { RunPlan } from "../domain/runplan/types.ts";
import { isOriginalFrozen } from "../domain/plan-timezone.ts";
import { newWorkoutId } from "../domain/runplan/workout-identity.ts";
import { dayPatchChanged, daySetChanged, type RevisionComparableDay } from "../domain/plan-revision.ts";

// HRA-333: the bulk days-replace's own per-day input — like
// PlanInstanceDayInput minus instance_id, but workout_id is a caller
// SUGGESTION rather than a requirement. patchInstance resolves the final
// value itself (echoed back only when it belongs to one of this instance's
// own CURRENT days, else freshly minted) — a caller may not have one yet (a
// brand-new day) and a stale/foreign value must never be trusted blindly.
export type PlanInstanceDayReplacement = Omit<PlanInstanceDayInput, "instance_id" | "workout_id"> & { workout_id?: string };

export function createPlanInstancesService(db: DatabaseSync, instances: PlanInstancesRepo) {
  // HRA-332: mirrors the instance's Current start_date/days into its
  // Original baseline columns, but only while Original isn't frozen yet —
  // a no-op once (today, in the instance's own schedule_timezone) has
  // reached original_start_date. Called at the end of every mutating
  // operation's transaction, after the Current-side writes, so Original
  // always reflects exactly what Current was at the moment freeze took
  // effect (AC6/AC7) with no scheduler involved.
  function syncOriginalIfNotFrozen(instanceId: number): void {
    const instance = instances.instanceById(instanceId);
    if (!instance || !instance.schedule_timezone || !instance.original_start_date) return;
    if (isOriginalFrozen(instance.original_start_date, instance.schedule_timezone)) return;
    // HRA-336: original_revision follows current_revision in lockstep while
    // still pre-freeze — read AFTER any bumpCurrentRevision() this same
    // transaction already applied, so the two numbers can never disagree for
    // an instance that hasn't frozen yet.
    instances.updateOriginal(
      instanceId, instance.start_date, JSON.stringify(instances.daysByInstance(instanceId)), instance.current_revision,
    );
  }

  // HRA-336: bumps current_revision exactly once, but only when the caller
  // has already determined a real semantic change occurred — a failed
  // operation never reaches this (the surrounding BEGIN/COMMIT rolls back),
  // and a semantic no-op simply never calls it.
  function bumpIfChanged(instanceId: number, changed: boolean): void {
    if (changed) instances.bumpCurrentRevision(instanceId);
  }

  function toRevisionComparable(d: { section_name: string; week_number: number; day: number; date: string;
    suffix: string | null; category: string | null; workout_type: string; segments: string;
    activity_target: string | null; activity_description: string | null; notes: string | null; needs_review: number | boolean },
  ): RevisionComparableDay {
    return {
      section_name: d.section_name, week_number: d.week_number, day: d.day, date: d.date,
      suffix: d.suffix, category: d.category, workout_type: d.workout_type, segments: d.segments,
      activity_target: d.activity_target, activity_description: d.activity_description, notes: d.notes,
      needs_review: typeof d.needs_review === "boolean" ? (d.needs_review ? 1 : 0) : d.needs_review,
    };
  }

  function instantiate(
    templateId: number, plan: RunPlan, options: InstantiateOptions, targetActivityId: number | null, name: string,
    raceName: string | null, raceDate: string | null, raceUrl: string | null, scheduleTimezone: string,
  ): { instance: PlanInstanceRow; days: PlanInstanceDayRow[] } {
    const resolvedDays = instantiatePlan(plan, options);

    db.exec("BEGIN");
    try {
      const instance = instances.createInstance({
        template_id: templateId,
        start_date: options.startDate,
        pace_overrides: options.paceOverrides ? JSON.stringify(options.paceOverrides) : null,
        target_activity_id: targetActivityId,
        name,
        // Denormalized copy of the template's event at creation time
        // (docs/runplan-dsl-future-notes.md §6) — never independently set.
        event: plan.metadata.event ?? null,
        // HRA-121: the instance's own free-text race description —
        // independent of target_activity_id.
        race_name: raceName,
        race_date: raceDate,
        race_url: raceUrl,
        // HRA-332: Original mirrors Current at creation unconditionally
        // (there is no prior Original to protect yet) — original_days_snapshot
        // is filled in below once the days themselves exist.
        schedule_timezone: scheduleTimezone,
        original_start_date: options.startDate,
        original_days_snapshot: null,
      });
      for (const day of resolvedDays) {
        instances.createDay({
          instance_id: instance.id,
          section_name: day.section_name,
          week_number: day.week_number,
          date: day.date,
          day: day.day,
          suffix: day.suffix ?? null,
          category: day.category ?? null,
          workout_type: day.workout_type,
          segments: JSON.stringify(day.segments),
          activity_target: day.activity_target ? JSON.stringify(day.activity_target) : null,
          activity_description: day.activity_description ?? null,
          notes: day.notes ?? null,
          needs_review: day.needs_review ? 1 : 0,
          // HRA-149: never backfilled at creation — NULL reads as the 08:00
          // display default until explicitly set via the per-day PATCH.
          scheduled_time: null,
          // HRA-299: a freshly instantiated day has never been individually
          // edited or swapped.
          customized_at: null,
          // HRA-333: a brand-new instance has no prior lineage to inherit —
          // every day gets its own freshly minted, independent identity.
          workout_id: newWorkoutId(),
        });
      }
      // HRA-332: the initial Original snapshot, now that the days actually
      // exist — an instance whose start_date is already in the past is
      // frozen from this very write onward (syncOriginalIfNotFrozen isn't
      // used here: creation always establishes Original once, unconditionally).
      instances.updateOriginal(
        instance.id, options.startDate, JSON.stringify(instances.daysByInstance(instance.id)), instance.current_revision,
      );
      db.exec("COMMIT");
      return { instance: instances.instanceById(instance.id)!, days: instances.daysByInstance(instance.id) };
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  // PATCH /api/v1/plan-instances/:id (HRA-135, replacing the earlier PUT):
  // partial update of name/race_name/race_date/race_url — each provided
  // field replaces its current value, every omitted field stays untouched.
  // `days`, when provided, still fully replaces the day set (same semantics
  // the old PUT already had) — only the wrapper resource's own
  // method/partiality changed, not per-day patch semantics. Never touches or
  // re-instantiates the source template — an instance is an independent
  // artifact once created, and is allowed to diverge from what the template
  // would currently produce (docs/runplan-dsl-future-notes.md §7). `event`
  // stays read-only/derived, never part of this update. Clearing approved_at
  // is part of the same transaction: an edit that fails must not leave a
  // cleared approval with stale days/fields, or vice versa. The controller
  // guarantees at least one of fields/days is present before calling this.
  function patchInstance(
    instanceId: number,
    fields: Partial<{ name: string; race_name: string | null; race_date: string | null; race_url: string | null }>,
    days?: PlanInstanceDayReplacement[],
    // HRA-332: already validated (IANA format) and freeze-checked by the
    // controller before this is called — the controller has the instance
    // loaded anyway to build the freeze check's own error message.
    scheduleTimezone?: string,
  ): { instance: PlanInstanceRow; days: PlanInstanceDayRow[] } {
    const instanceBefore = instances.instanceById(instanceId)!;
    db.exec("BEGIN");
    try {
      let daysChanged = false;
      if (days) {
        // HRA-333: read BEFORE the delete below wipes them — a day/week
        // swap, section move, or plain re-save of an untouched day all
        // arrive here as this same wholesale replace, and the only signal
        // that an incoming entry is "the same workout, now here" is whether
        // it echoes back a workout_id this instance's CURRENT rows already
        // recognize. Never trust a workout_id the caller supplies that
        // doesn't match one of THESE rows — that would let a stale or
        // cross-instance value silently steal another workout's lineage.
        const daysBefore = instances.daysByInstance(instanceId);
        const currentWorkoutIds = new Set(daysBefore.map(d => d.workout_id));
        // HRA-336: no-op detection compares SLOT (section/week/day) + content,
        // never workout_id — a re-save that doesn't echo any workout_id back
        // still mints fresh ones below, which must never itself count as a
        // change (see domain/plan-revision.ts).
        daysChanged = daySetChanged(daysBefore.map(toRevisionComparable), days.map(toRevisionComparable));
        instances.deleteDaysByInstance(instanceId);
        for (const day of days) {
          const workoutId = day.workout_id && currentWorkoutIds.has(day.workout_id) ? day.workout_id : newWorkoutId();
          instances.createDay({ ...day, instance_id: instanceId, workout_id: workoutId });
        }
      }
      const fieldsChanged = (fields.name !== undefined && fields.name !== instanceBefore.name)
        || (fields.race_name !== undefined && fields.race_name !== instanceBefore.race_name)
        || (fields.race_date !== undefined && fields.race_date !== instanceBefore.race_date)
        || (fields.race_url !== undefined && fields.race_url !== instanceBefore.race_url);
      const timezoneChanged = scheduleTimezone !== undefined && scheduleTimezone !== instanceBefore.schedule_timezone;
      instances.updateFields(instanceId, fields);
      if (scheduleTimezone) instances.updateScheduleTimezone(instanceId, scheduleTimezone);
      instances.clearApproval(instanceId);
      // HRA-336: exactly one bump for this whole call, regardless of how many
      // of days/fields/timezone actually changed together.
      bumpIfChanged(instanceId, daysChanged || fieldsChanged || timezoneChanged);
      // HRA-332: mirrors the (possibly just-replaced) days and/or the
      // just-corrected timezone into Original — a no-op once frozen.
      syncOriginalIfNotFrozen(instanceId);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { instance: instances.instanceById(instanceId)!, days: instances.daysByInstance(instanceId) };
  }

  // PATCH /api/v1/plan-instances/:id/days/:dayId (HRA-149): each of dsl,
  // notes, scheduled_time is applied independently — the controller has
  // already re-parsed+resolved `dsl` (if supplied) into `dslFields`, and
  // resolved which of `notes`/`scheduledTime` the caller actually supplied
  // (undefined = omitted, distinct from an explicit null clearing a nullable
  // column). An explicit `notes` always wins over whatever the fresh dsl
  // parse produced for that same field. No approval-clearing here — the
  // controller rejects the whole request before this runs if the instance is
  // already approved (mirrors HRA-126's intended lock rule), so there is
  // nothing to clear.
  function patchDay(
    dayId: number,
    dslFields: { day: number; suffix: string | null; category: string | null; workout_type: string; segments: string; activity_target: string | null; activity_description: string | null; notes: string | null; needs_review: number } | undefined,
    notes: string | null | undefined,
    scheduledTime: string | null | undefined,
    // HRA-333: a swap flow (AgendaTab/MobileWorkoutSwap) persists via two of
    // these single-day PATCHes rather than the bulk days-replace — each one
    // supplies the OTHER day's workout_id alongside its swapped-in dsl, so
    // the identity travels with the content it now represents instead of
    // staying pinned to this row. Trusted the same way dsl/notes/
    // scheduled_time already are (the controller has already confirmed
    // dayId belongs to instanceId): deliberately NOT re-validated against
    // "one of this instance's current workout_ids" here, since the paired
    // partner call in the same swap may commit first and briefly move that
    // exact value off of every current row — an order-dependent check would
    // make the very race Promise.all already accepts for scheduled_time
    // (see AgendaTab.tsx/MobileWorkoutSwap.tsx) silently drop this write.
    workoutId?: string,
  ): PlanInstanceDayRow {
    const dayBefore = instances.dayById(dayId)!;
    const instanceId = dayBefore.instance_id;
    const changed = dayPatchChanged(dayBefore, { dslFields, notes, scheduledTime, workoutId });
    db.exec("BEGIN");
    try {
      if (dslFields) {
        instances.updateDayFromDsl(dayId, { ...dslFields, notes: notes !== undefined ? notes : dslFields.notes });
        // HRA-299: a dsl write is "an instantiated workout DSL saved" — the
        // Story's own trigger for the customization marker. Notes-only or
        // scheduled-time-only patches (the branches below/after this one)
        // don't touch the day's actual workout content, so they never set it.
        instances.markDayCustomized(dayId);
      } else if (notes !== undefined) {
        instances.updateDayNotes(dayId, notes);
      }
      if (scheduledTime !== undefined) {
        instances.updateDayScheduledTime(dayId, scheduledTime);
      }
      if (workoutId !== undefined) {
        instances.updateDayWorkoutId(dayId, workoutId);
      }
      // HRA-336: this single day's edit is the whole semantic mutation here.
      bumpIfChanged(instanceId, changed);
      // HRA-332: mirrors this day's change into Original — a no-op once frozen.
      syncOriginalIfNotFrozen(instanceId);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return instances.dayById(dayId)!;
  }

  // HRA-132: regenerates a plan instance's days from `effectiveFrom` onward,
  // leaving every day before it completely untouched. `options` already
  // carries whichever of startDate/paceOverrides the caller changed, with
  // the instance's own current values substituted for whatever it didn't
  // (the controller resolves that merge before calling this) — so
  // instantiatePlan always runs against one coherent, fully-specified view.
  // Always regenerates from the *template's* DSL (via instantiatePlan), never
  // from the instance's own already-resolved days — those already discarded
  // each day's original symbolic anchor, so there's nothing to re-resolve
  // them from (see HRA-129/130's own notes on this same data-model gap).
  function regenerateFrom(
    instanceId: number, plan: RunPlan, options: InstantiateOptions, effectiveFrom: string,
  ): { instance: PlanInstanceRow; days: PlanInstanceDayRow[] } {
    const regeneratedDays = instantiatePlan(plan, options).filter(d => d.date >= effectiveFrom);

    const instanceBefore = instances.instanceById(instanceId)!;
    // HRA-336: the affected slice's own before-state, captured before any
    // delete below — compared against regeneratedDays (which already only
    // contains this same slice) to detect a genuine no-op regenerate (e.g.
    // re-running with identical start_date/pace_overrides against an
    // already-up-to-date instance).
    const daysBeforeInScope = instances.daysByInstance(instanceId).filter(d => d.date >= effectiveFrom);
    const newPaceOverridesJson = options.paceOverrides ? JSON.stringify(options.paceOverrides) : null;
    const startOrPaceChanged = options.startDate !== instanceBefore.start_date
      || newPaceOverridesJson !== instanceBefore.pace_overrides;
    const daysChanged = daySetChanged(
      daysBeforeInScope.map(toRevisionComparable),
      regeneratedDays.map(d => toRevisionComparable({
        section_name: d.section_name, week_number: d.week_number, day: d.day, date: d.date,
        suffix: d.suffix ?? null, category: d.category ?? null, workout_type: d.workout_type,
        segments: JSON.stringify(d.segments), activity_target: d.activity_target ? JSON.stringify(d.activity_target) : null,
        activity_description: d.activity_description ?? null, notes: d.notes ?? null, needs_review: d.needs_review,
      })),
    );

    db.exec("BEGIN");
    try {
      // HRA-333: capture each regenerated slot's previous occupant's
      // identity BEFORE any delete below runs — the freshly created row
      // replacing it inherits that slot's workout_id, extending
      // deleteDayByIdentity's own "same (section_name, week_number, day)
      // tuple = same slot" reasoning to workout_id. A slot with no previous
      // occupant (a template DSL change introducing a new day) gets none —
      // it's a genuinely new workout, not a continuation of anything.
      const priorWorkoutIds = new Map(regeneratedDays.map(day => [
        `${day.section_name} ${day.week_number} ${day.day}`,
        instances.dayByIdentity(instanceId, day.section_name, day.week_number, day.day),
      ]));
      // HRA-155: delete each regenerated day's previous row by identity
      // (section_name/week_number/day), not by a date threshold — see
      // deleteDayByIdentity's own comment in the repo for why a raw date
      // comparison breaks once start_date changes in this same call. Every
      // day in `regeneratedDays` already passed the `date >= effectiveFrom`
      // filter above using its FRESH date, so this only ever touches days
      // actually being regenerated; a day whose fresh date falls before the
      // cutover is excluded from `regeneratedDays` entirely and its old row
      // (whatever identity) is left completely untouched, preserving the
      // "protects already-logged history" guarantee.
      for (const day of regeneratedDays) {
        instances.deleteDayByIdentity(instanceId, day.section_name, day.week_number, day.day);
      }
      for (const day of regeneratedDays) {
        const priorWorkoutId = priorWorkoutIds.get(`${day.section_name} ${day.week_number} ${day.day}`);
        instances.createDay({
          instance_id: instanceId,
          section_name: day.section_name,
          week_number: day.week_number,
          date: day.date,
          day: day.day,
          suffix: day.suffix ?? null,
          category: day.category ?? null,
          workout_type: day.workout_type,
          segments: JSON.stringify(day.segments),
          activity_target: day.activity_target ? JSON.stringify(day.activity_target) : null,
          activity_description: day.activity_description ?? null,
          notes: day.notes ?? null,
          needs_review: day.needs_review ? 1 : 0,
          // HRA-149: never backfilled at creation — NULL reads as the 08:00
          // display default until explicitly set via the per-day PATCH.
          scheduled_time: null,
          // HRA-299: regeneration always recreates the row from scratch —
          // a day just regenerated from the template's own DSL has no
          // customization of its own, regardless of what the row it
          // replaces carried (the preflight below is what protects a
          // customized day from reaching this point without confirmation).
          customized_at: null,
          workout_id: priorWorkoutId ?? newWorkoutId(),
        });
      }
      instances.updateStartDateAndPaceOverrides(
        instanceId, options.startDate, options.paceOverrides ? JSON.stringify(options.paceOverrides) : null,
      );
      // Same gate-2 rule every other instance-mutating operation already
      // applies (updateDays above, the template PUT) — regenerating changes
      // persisted day content, exactly the class of edit that revokes
      // approval.
      instances.clearApproval(instanceId);
      // HRA-336: one bump for the whole regenerate, whether the change was to
      // start_date/pace_overrides, the regenerated day content, or both.
      bumpIfChanged(instanceId, startOrPaceChanged || daysChanged);
      // HRA-332: mirrors the regenerated days + new start_date into
      // Original — a no-op once frozen.
      syncOriginalIfNotFrozen(instanceId);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return { instance: instances.instanceById(instanceId)!, days: instances.daysByInstance(instanceId) };
  }

  return { instantiate, patchInstance, patchDay, regenerateFrom };
}

export type PlanInstancesService = ReturnType<typeof createPlanInstancesService>;
