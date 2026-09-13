/**
 * test/domain/workout-association.test.ts (HRA-334)
 * reconcileAssociations / computeWorkoutDayStatus — pure, no I/O. Covers the
 * Story's own AC14 list: sole-candidate, zero/multiple candidates, multiple
 * planned workouts, REST/OTHER exclusion (never passed in at all — proven by
 * construction, see the dedicated test below), split activities (many
 * activities manually linked to one workout), late imports (demotion),
 * manual override/removal (immunity), and DST/travel (via the same
 * localDateInTimeZone plan-timezone.ts already covers, reused here through
 * schedule_timezone).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeWorkoutDayStatus, reconcileAssociations,
  type CandidateActivity, type CandidateWorkout, type ExistingAssociation,
} from "../../src/domain/workout-association.ts";

const ROME = "Europe/Rome"; // UTC+2 in September (CEST)
const LA = "America/Los_Angeles"; // UTC-7 in September (PDT)

function workout(id: string, date: string, timeZone = ROME): CandidateWorkout {
  return { workout_id: id, date, timeZone };
}
function activity(id: number, activityDate: string): CandidateActivity {
  return { activity_id: id, activity_date: activityDate };
}

test("sole-candidate path: exactly one compatible workout and one compatible activity auto-accept", () => {
  const plan = reconcileAssociations(
    [workout("w1", "2026-09-14")],
    [activity(1, "2026-09-14T07:00:00Z")], // 09:00 local in Rome — same date
    [],
  );
  assert.deepEqual(plan.accept, [{ activity_id: 1, workout_id: "w1" }]);
  assert.deepEqual(plan.demote, []);
});

test("zero candidates: no activity on the workout's local date produces no match", () => {
  const plan = reconcileAssociations(
    [workout("w1", "2026-09-14")],
    [activity(1, "2026-09-15T07:00:00Z")],
    [],
  );
  assert.deepEqual(plan.accept, []);
});

test("multiple candidates: two compatible activities on the same date leave both unresolved (ambiguous)", () => {
  const plan = reconcileAssociations(
    [workout("w1", "2026-09-14")],
    [activity(1, "2026-09-14T07:00:00Z"), activity(2, "2026-09-14T08:00:00Z")],
    [],
  );
  assert.deepEqual(plan.accept, []);
  assert.deepEqual(plan.demote, []); // nothing was ever 'automatic' to demote
});

test("multiple planned workouts: one activity compatible with two workouts on its date is never auto-accepted for either", () => {
  const plan = reconcileAssociations(
    [workout("w1", "2026-09-14"), workout("w2", "2026-09-14")],
    [activity(1, "2026-09-14T07:00:00Z")],
    [],
  );
  assert.deepEqual(plan.accept, []);
});

test("REST/OTHER days are never even offered as candidates — the caller (service) never includes non-'run' days, so this module has nothing to exclude by construction", () => {
  // No workout_type field exists on CandidateWorkout at all — an activity
  // landing on a REST day's local date, with zero 'run' workouts passed in,
  // simply has zero candidates and is never automatically associated.
  const plan = reconcileAssociations([], [activity(1, "2026-09-14T07:00:00Z")], []);
  assert.deepEqual(plan.accept, []);
});

test("split activities: manual assignment allows many activities against one workout_id (not this module's concern — it only ever accepts unique 1:1 pairs)", () => {
  // Two activities both manually confirmed to the SAME workout_id (as the
  // service's setAssociation would record) are both locked and untouched by
  // reconciliation — this is how "many activities per planned workout, where
  // manually permitted" (AC1) survives a later reconcile() run.
  const existing: ExistingAssociation[] = [
    { activity_id: 1, workout_id: "w1", status: "manual_confirmed" },
    { activity_id: 2, workout_id: "w1", status: "manual_changed" },
  ];
  const plan = reconcileAssociations(
    [workout("w1", "2026-09-14")],
    [activity(1, "2026-09-14T07:00:00Z"), activity(2, "2026-09-14T08:00:00Z")],
    existing,
  );
  assert.deepEqual(plan.accept, []);
  assert.deepEqual(plan.demote, []);
});

test("late imports: a previously sole-candidate automatic match is demoted to unresolved once a competing activity is imported", () => {
  const existing: ExistingAssociation[] = [{ activity_id: 1, workout_id: "w1", status: "automatic" }];
  const plan = reconcileAssociations(
    [workout("w1", "2026-09-14")],
    [activity(1, "2026-09-14T07:00:00Z"), activity(2, "2026-09-14T08:00:00Z")], // 2 is a late import
    existing,
  );
  assert.deepEqual(plan.accept, []);
  assert.deepEqual(plan.demote, [{ activity_id: 1 }]);
});

test("late imports: an automatic match survives reconciliation when it's still the sole candidate", () => {
  const existing: ExistingAssociation[] = [{ activity_id: 1, workout_id: "w1", status: "automatic" }];
  const plan = reconcileAssociations([workout("w1", "2026-09-14")], [activity(1, "2026-09-14T07:00:00Z")], existing);
  assert.deepEqual(plan.accept, [{ activity_id: 1, workout_id: "w1" }]);
  assert.deepEqual(plan.demote, []);
});

test("manual override immunity: a manually confirmed activity/workout pair is excluded from the matching pool entirely, never reassigned or demoted", () => {
  // Locking activity 1 -> w1 removes BOTH from the movable pool — which
  // leaves w2/activity 2 (previously an ambiguous 3-way tangle) as a clean,
  // newly-unique pair. Activity 1 itself never appears in accept/demote: a
  // manual row is simply never revisited by reconciliation.
  const existing: ExistingAssociation[] = [{ activity_id: 1, workout_id: "w1", status: "manual_confirmed" }];
  const plan = reconcileAssociations(
    [workout("w1", "2026-09-14"), workout("w2", "2026-09-14")],
    [activity(1, "2026-09-14T07:00:00Z"), activity(2, "2026-09-14T08:00:00Z")],
    existing,
  );
  assert.deepEqual(plan.accept, [{ activity_id: 2, workout_id: "w2" }]);
  assert.deepEqual(plan.demote, []);
});

test("manual removal immunity: an activity explicitly marked unplanned (workout_id null, manual_changed) is never auto-reattached", () => {
  const existing: ExistingAssociation[] = [{ activity_id: 1, workout_id: null, status: "manual_changed" }];
  const plan = reconcileAssociations([workout("w1", "2026-09-14")], [activity(1, "2026-09-14T07:00:00Z")], existing);
  assert.deepEqual(plan.accept, []);
});

test("an unresolved (not locked) association is re-evaluated and can resolve once ambiguity clears", () => {
  // activity 2 (the former competitor) is gone from this run — 1 becomes the
  // sole candidate again and is re-accepted, since 'unresolved' isn't locked.
  const existing: ExistingAssociation[] = [{ activity_id: 1, workout_id: "w1", status: "unresolved" }];
  const plan = reconcileAssociations([workout("w1", "2026-09-14")], [activity(1, "2026-09-14T07:00:00Z")], existing);
  assert.deepEqual(plan.accept, [{ activity_id: 1, workout_id: "w1" }]);
});

test("DST/travel: local-date matching uses each workout's own schedule_timezone, not a shared/global one", () => {
  // Same instant is 2026-09-14 in Rome but still 2026-09-13 in LA — only the
  // Rome-scheduled workout matches.
  const instant = "2026-09-14T02:00:00Z";
  const plan = reconcileAssociations(
    [workout("w-rome", "2026-09-14", ROME), workout("w-la", "2026-09-14", LA)],
    [activity(1, instant)],
    [],
  );
  assert.deepEqual(plan.accept, [{ activity_id: 1, workout_id: "w-rome" }]);
});

// ── computeWorkoutDayStatus (AC11/AC12) ─────────────────────────────────────

test("a future local plan day is pending regardless of evidence", () => {
  assert.equal(computeWorkoutDayStatus("2026-09-20", ROME, false, new Date("2026-09-19T12:00:00Z")), "pending");
});

test("a past local plan day with no accepted evidence is missed", () => {
  assert.equal(computeWorkoutDayStatus("2026-09-10", ROME, false, new Date("2026-09-19T12:00:00Z")), "missed");
});

test("completed means accepted evidence exists, regardless of date — never implies targets were hit", () => {
  assert.equal(computeWorkoutDayStatus("2026-09-10", ROME, true, new Date("2026-09-19T12:00:00Z")), "completed");
  assert.equal(computeWorkoutDayStatus("2026-09-25", ROME, true, new Date("2026-09-19T12:00:00Z")), "completed");
});

test("today's own local plan day is still pending, not missed", () => {
  assert.equal(computeWorkoutDayStatus("2026-09-19", ROME, false, new Date("2026-09-19T12:00:00Z")), "pending");
});
