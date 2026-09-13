/**
 * test/domain/reporting/workout-report.test.ts (HRA-336)
 * buildWorkoutReport — the single-workout/race report's pure calculation.
 * Every case reproduced purely from explicit inputs, same convention as
 * report.test.ts (HRA-335).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkoutReport, type WorkoutReportInputs, type WorkoutReportInstanceInput } from "../../../src/domain/reporting/workout-report.ts";
import type { ResolvedSegment } from "../../../src/domain/runplan/instantiate.ts";
import type { PlanInstanceDayRow } from "../../../src/db.ts";
import type { OriginalDaySnapshot } from "../../../src/domain/runplan/lineage.ts";

const ROME = "Europe/Rome";
const NOW = new Date("2026-09-19T12:00:00Z"); // 2026-09-19 local in Rome

const RUN_10K: ResolvedSegment[] = [
  { type: "continuous", target: { kind: "distance", distance_m: 10000, raw: "10km" }, resolved_pace_sec_per_km: 300, raw: "10km @ RG" },
];

function day(overrides: Partial<PlanInstanceDayRow> & { workout_id: string; date: string }): PlanInstanceDayRow {
  return {
    id: 1, instance_id: 1, section_name: "Base", week_number: 1, day: 1, suffix: null, category: null,
    workout_type: "run", segments: JSON.stringify(RUN_10K), activity_target: null, activity_description: null,
    notes: null, needs_review: 0, scheduled_time: null, customized_at: null,
    ...overrides,
  };
}

function original(overrides: Partial<OriginalDaySnapshot> & { workout_id: string; date: string }): OriginalDaySnapshot {
  const { id: _id, instance_id: _instanceId, ...rest } = day(overrides as Partial<PlanInstanceDayRow> & { workout_id: string; date: string });
  return rest;
}

function instance(overrides: Partial<WorkoutReportInstanceInput> = {}): WorkoutReportInstanceInput {
  return {
    id: 1, name: "Boston 2026", schedule_timezone: ROME, current_revision: 1, original_revision: 1,
    original_start_date: "2026-09-01", race_date: null, ...overrides,
  };
}

function baseInputs(overrides: Partial<WorkoutReportInputs> = {}): WorkoutReportInputs {
  return {
    instance: instance(), workoutId: "w1", original: null, current: null, associations: [], activities: [],
    now: NOW, ...overrides,
  };
}

test("unchanged workout: Original equals Current, lineage 'unchanged', one planned dataset on each side agrees", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const o = original({ workout_id: "w1", date: "2026-09-10" });
  const result = buildWorkoutReport(baseInputs({ original: o, current: d }));

  assert.equal(result.lineage, "unchanged");
  assert.equal(result.originalEqualsCurrent, true);
  assert.equal(result.planned.original?.distanceM, 10000);
  assert.equal(result.planned.current?.distanceM, 10000);
  assert.equal(result.state, "missed", "past date, no accepted evidence");
});

test("modified workout: Current's segments differ from Original — lineage 'modified', originalEqualsCurrent false", () => {
  const o = original({ workout_id: "w1", date: "2026-09-10" });
  const modifiedSegments: ResolvedSegment[] = [
    { type: "continuous", target: { kind: "distance", distance_m: 15000, raw: "15km" }, resolved_pace_sec_per_km: 300, raw: "15km @ RG" },
  ];
  const d = day({ workout_id: "w1", date: "2026-09-10", segments: JSON.stringify(modifiedSegments) });
  const result = buildWorkoutReport(baseInputs({ original: o, current: d }));

  assert.equal(result.lineage, "modified");
  assert.equal(result.originalEqualsCurrent, false);
  assert.equal(result.planned.original?.distanceM, 10000);
  assert.equal(result.planned.current?.distanceM, 15000);
});

test("moved workout: same content, different slot — lineage 'moved'", () => {
  const o = original({ workout_id: "w1", date: "2026-09-10", week_number: 1 });
  const d = day({ workout_id: "w1", date: "2026-09-17", week_number: 2 });
  const result = buildWorkoutReport(baseInputs({ original: o, current: d }));
  assert.equal(result.lineage, "moved");
  assert.equal(result.originalEqualsCurrent, false);
});

test("removed workout: present only in Original — lineage 'removed', current dataset null", () => {
  const o = original({ workout_id: "w1", date: "2026-09-10" });
  const result = buildWorkoutReport(baseInputs({ original: o, current: null }));
  assert.equal(result.lineage, "removed");
  assert.equal(result.planned.current, null);
  assert.equal(result.identity.currentDate, null);
});

test("added workout: present only in Current — lineage 'added', original dataset null", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const result = buildWorkoutReport(baseInputs({ original: null, current: d }));
  assert.equal(result.lineage, "added");
  assert.equal(result.planned.original, null);
});

test("accepted evidence: an 'automatic' association's activity feeds actual metrics and evidence, never a zero when absent", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const result = buildWorkoutReport(baseInputs({
    current: d,
    associations: [{ activity_id: 42, status: "automatic" }],
    activities: [{ activity_id: 42, activity_date: "2026-09-10T07:00:00Z", distance_m: 10200, duration_sec: 3050, moving_time_sec: 3000 }],
  }));
  assert.equal(result.actual.metrics?.distanceM, 10200);
  assert.equal(result.actual.metrics?.paceSecPerKm, 3050 / 10.2);
  assert.equal(result.actual.evidence.length, 1);
  assert.equal(result.actual.evidence[0].elapsedSec, 3050);
  assert.equal(result.actual.evidence[0].activeSec, 3000);
  assert.equal(result.state, "completed");
  assert.equal(result.actual.hasAmbiguousEvidence, false);
});

test("no evidence at all: actual metrics stay null (never a fabricated zero)", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const result = buildWorkoutReport(baseInputs({ current: d }));
  assert.equal(result.actual.metrics, null);
  assert.equal(result.actual.evidence.length, 0);
});

test("unresolved association: visible as ambiguous evidence, never counted toward trusted actual metrics", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const result = buildWorkoutReport(baseInputs({
    current: d,
    associations: [{ activity_id: 7, status: "unresolved" }],
    activities: [{ activity_id: 7, activity_date: "2026-09-10T07:00:00Z", distance_m: 10000, duration_sec: 3000, moving_time_sec: 2950 }],
  }));
  assert.equal(result.actual.metrics, null);
  assert.equal(result.actual.hasAmbiguousEvidence, true);
  assert.equal(result.actual.evidence.length, 0);
});

test("upcoming workout: a future date with no evidence is 'upcoming', not 'missed'", () => {
  const d = day({ workout_id: "w1", date: "2026-09-25" }); // after NOW's local 2026-09-19
  const result = buildWorkoutReport(baseInputs({ current: d }));
  assert.equal(result.state, "upcoming");
});

test("race day: instance.race_date matches the workout's own date — target fields from Current's planned segments, actual uses elapsed time", () => {
  const raceInstance = instance({ race_date: "2026-09-10" });
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const result = buildWorkoutReport(baseInputs({
    instance: raceInstance,
    current: d,
    associations: [{ activity_id: 1, status: "manual_confirmed" }],
    activities: [{ activity_id: 1, activity_date: "2026-09-10T07:00:00Z", distance_m: 10050, duration_sec: 2999, moving_time_sec: 2950 }],
  }));
  assert.equal(result.race.isRace, true);
  if (result.race.isRace) {
    assert.equal(result.race.targetDistanceM, 10000);
    assert.equal(result.race.targetDurationSec, 3000);
    assert.equal(result.race.actualElapsedSec, 2999, "elapsed (duration_sec), never moving_time_sec");
    assert.equal(result.race.actualMovingSec, 2950);
    assert.equal(result.race.actualSource, "activity");
  }
});

test("race day with no accepted evidence stays unresolved — actualSource 'none', never a zero-looking result", () => {
  const raceInstance = instance({ race_date: "2026-09-10" });
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const result = buildWorkoutReport(baseInputs({ instance: raceInstance, current: d }));
  assert.equal(result.race.isRace, true);
  if (result.race.isRace) {
    assert.equal(result.race.actualElapsedSec, null);
    assert.equal(result.race.actualSource, "none");
  }
});

test("non-race workout: race.isRace is false, no target fields fabricated", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const result = buildWorkoutReport(baseInputs({ current: d }));
  assert.equal(result.race.isRace, false);
});

test("provenance carries both revisions and the instance's schedule_timezone", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const result = buildWorkoutReport(baseInputs({
    instance: instance({ current_revision: 5, original_revision: 3 }),
    current: d,
  }));
  assert.equal(result.provenance.currentRevision, 5);
  assert.equal(result.provenance.originalRevision, 3);
  assert.equal(result.provenance.scheduleTimezone, ROME);
});

test("structuredQualityEvidence is always the not-yet-available sentinel (HRA-342 slot)", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const result = buildWorkoutReport(baseInputs({ current: d }));
  assert.deepEqual(result.structuredQualityEvidence, { available: false, reason: "not_implemented" });
});
