/**
 * test/domain/reporting/workout-report.test.ts (HRA-336)
 * buildWorkoutReport — the single-workout/race report's pure calculation.
 * Every case reproduced purely from explicit inputs, same convention as
 * report.test.ts (HRA-335).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkoutReport, type WorkoutReportActivityInput, type WorkoutReportInputs, type WorkoutReportInstanceInput } from "../../../src/domain/reporting/workout-report.ts";
import type { ResolvedSegment } from "../../../src/domain/runplan/instantiate.ts";
import type { PlanInstanceDayRow } from "../../../src/db.ts";
import type { OriginalDaySnapshot } from "../../../src/domain/runplan/lineage.ts";
import type { PauseEvidencePointInput } from "../../../src/domain/reporting/evidence.ts";

function activityInput(overrides: Partial<WorkoutReportActivityInput> & { activity_id: number }): WorkoutReportActivityInput {
  return {
    activity_date: "2026-09-10T07:00:00Z", distance_m: null, duration_sec: null, moving_time_sec: null,
    avg_hr: null, max_hr: null, ...overrides,
  };
}

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
    activities: [activityInput({ activity_id: 42, distance_m: 10200, duration_sec: 3050, moving_time_sec: 3000 })],
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
    activities: [activityInput({ activity_id: 7, distance_m: 10000, duration_sec: 3000, moving_time_sec: 2950 })],
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
    activities: [activityInput({ activity_id: 1, distance_m: 10050, duration_sec: 2999, moving_time_sec: 2950 })],
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

// ── HRA-337: HR, stamina, and pause evidence ────────────────────────────────

function point(overrides: Partial<PauseEvidencePointInput>): PauseEvidencePointInput {
  return { elapsed_sec: null, timestamp_unix: null, distance_m: null, heart_rate: null, speed_ms: null, stamina: null, ...overrides };
}

test("hr: null when no accepted evidence (never a fabricated zero)", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const result = buildWorkoutReport(baseInputs({ current: d }));
  assert.equal(result.hr, null);
  assert.equal(result.stamina, null);
  assert.equal(result.pauses, null);
});

test("hr: average/max HR and coverage come from the accepted activity's own avg_hr/max_hr, never a planned value", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const result = buildWorkoutReport(baseInputs({
    current: d,
    associations: [{ activity_id: 42, status: "automatic" }],
    activities: [activityInput({ activity_id: 42, distance_m: 10200, duration_sec: 3050, moving_time_sec: 3000, avg_hr: 152, max_hr: 178 })],
  }));
  assert.equal(result.hr?.avgHr, 152);
  assert.equal(result.hr?.maxHr, 178);
  assert.deepEqual(result.hr?.coverage, { withHr: 1, total: 1 });
});

test("hr: missing avg_hr on the only accepted activity is explicitly unavailable, not a fabricated zero", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const result = buildWorkoutReport(baseInputs({
    current: d,
    associations: [{ activity_id: 42, status: "automatic" }],
    activities: [activityInput({ activity_id: 42, distance_m: 10200, duration_sec: 3050, moving_time_sec: 3000 })],
  }));
  assert.equal(result.hr?.avgHr, null);
  assert.equal(result.hr?.maxHr, null);
  assert.deepEqual(result.hr?.coverage, { withHr: 0, total: 1 });
});

test("stamina: first valid, finish, depletion, and minimum come from the one recorded stamina series — starting stamina is never assumed 100%", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const track: PauseEvidencePointInput[] = [
    point({ elapsed_sec: 0, stamina: null }), // device hadn't resolved stamina yet
    point({ elapsed_sec: 60, stamina: 82 }),
    point({ elapsed_sec: 600, stamina: 55 }),
    point({ elapsed_sec: 1200, stamina: 40 }), // minimum
    point({ elapsed_sec: 1800, stamina: 48 }),
  ];
  const result = buildWorkoutReport(baseInputs({
    current: d,
    associations: [{ activity_id: 42, status: "automatic" }],
    activities: [activityInput({ activity_id: 42, distance_m: 10200, duration_sec: 3050, moving_time_sec: 3000 })],
    trackPointsByActivity: new Map([[42, track]]),
  }));
  assert.equal(result.stamina?.firstValid, 82, "first VALID sample, never assumed 100");
  assert.equal(result.stamina?.finish, 48);
  assert.equal(result.stamina?.depletionPoints, 34);
  assert.equal(result.stamina?.minimum, 40);
  assert.deepEqual(result.stamina?.coverage, { withStamina: 4, total: 5 });
});

test("stamina: entirely missing series stays null/zero-coverage rather than a fabricated value", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const track: PauseEvidencePointInput[] = [point({ elapsed_sec: 0 }), point({ elapsed_sec: 60 })];
  const result = buildWorkoutReport(baseInputs({
    current: d,
    associations: [{ activity_id: 42, status: "automatic" }],
    activities: [activityInput({ activity_id: 42 })],
    trackPointsByActivity: new Map([[42, track]]),
  }));
  assert.equal(result.stamina?.firstValid, null);
  assert.equal(result.stamina?.finish, null);
  assert.equal(result.stamina?.depletionPoints, null);
  assert.deepEqual(result.stamina?.coverage, { withStamina: 0, total: 2 });
});

test("pauses: a real recording gap (timestamp_unix) is detected, counted, and marked 'recorded' provenance with HR-recovery + stamina context", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const track: PauseEvidencePointInput[] = [
    point({ elapsed_sec: 0, timestamp_unix: 1_000, distance_m: 0, heart_rate: 160, stamina: 70 }),
    point({ elapsed_sec: 1, timestamp_unix: 1_001, distance_m: 200, heart_rate: 158, stamina: 68 }),
    // A real Garmin auto-pause: the device FREEZES elapsed_sec (docs/schema.md)
    // while wall-clock timestamp_unix keeps advancing — elapsed advances by
    // only 1s here while 45 real seconds pass, the actual pause signal.
    point({ elapsed_sec: 2, timestamp_unix: 1_046, distance_m: 200, heart_rate: 130, stamina: 68 }),
    point({ elapsed_sec: 3, timestamp_unix: 1_047, distance_m: 400, heart_rate: 145, stamina: 66 }),
  ];
  const result = buildWorkoutReport(baseInputs({
    current: d,
    associations: [{ activity_id: 42, status: "automatic" }],
    activities: [activityInput({ activity_id: 42, distance_m: 10200, duration_sec: 3050, moving_time_sec: 3000 })],
    trackPointsByActivity: new Map([[42, track]]),
  }));
  assert.equal(result.pauses?.pauseCount, 1);
  assert.equal(result.pauses?.longestPauseSec, 45);
  assert.equal(result.pauses?.totalPausedFromPausesSec, 45);
  assert.equal(result.pauses?.details.length, 1);
  const detail = result.pauses?.details[0];
  assert.equal(detail?.index, 1);
  assert.equal(detail?.distanceM, 200);
  assert.equal(detail?.durationSec, 45);
  assert.equal(detail?.hrBefore, 158);
  assert.equal(detail?.hrAfter, 130);
  assert.equal(detail?.hrRecoveryDelta, 28);
  assert.equal(detail?.staminaBefore, 68);
  assert.equal(detail?.staminaAfter, 68);
  assert.equal(detail?.provenance, "recorded");
});

test("pauses: heuristic near-zero-speed detection (no real timestamps) is marked 'inferred' provenance", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const track: PauseEvidencePointInput[] = [
    point({ elapsed_sec: 0, distance_m: 0, speed_ms: 3.0, heart_rate: 155 }),
    point({ elapsed_sec: 10, distance_m: 30, speed_ms: 3.0, heart_rate: 155 }),
    point({ elapsed_sec: 20, distance_m: 30, speed_ms: 0.05, heart_rate: 150 }), // stopped
    point({ elapsed_sec: 55, distance_m: 30, speed_ms: 0.05, heart_rate: 135 }), // still stopped, 35s later
    point({ elapsed_sec: 65, distance_m: 60, speed_ms: 3.0, heart_rate: 140 }),
  ];
  const result = buildWorkoutReport(baseInputs({
    current: d,
    associations: [{ activity_id: 42, status: "automatic" }],
    activities: [activityInput({ activity_id: 42 })],
    trackPointsByActivity: new Map([[42, track]]),
  }));
  assert.equal(result.pauses?.pauseCount, 1);
  assert.equal(result.pauses?.details[0].provenance, "inferred");
});

test("pauses: a planned recovery interval (pace slows but never near-zero) is never treated as a pause", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  // A jogged recovery between intervals, sampled every 10s (well under the
  // 30s threshold, so no raw-gap false positive): speed drops from ~3.3 m/s
  // to ~2.0 m/s — well above the 0.3 m/s near-zero-speed floor — never a
  // real stop, purely a pace decrease.
  const track: PauseEvidencePointInput[] = [
    point({ elapsed_sec: 0, distance_m: 0, speed_ms: 3.3 }),
    point({ elapsed_sec: 10, distance_m: 33, speed_ms: 3.3 }),
    point({ elapsed_sec: 20, distance_m: 53, speed_ms: 2.0 }),
    point({ elapsed_sec: 30, distance_m: 73, speed_ms: 2.0 }),
    point({ elapsed_sec: 40, distance_m: 93, speed_ms: 2.0 }),
    point({ elapsed_sec: 50, distance_m: 113, speed_ms: 2.0 }),
    point({ elapsed_sec: 60, distance_m: 146, speed_ms: 3.3 }),
    point({ elapsed_sec: 70, distance_m: 179, speed_ms: 3.3 }),
  ];
  const result = buildWorkoutReport(baseInputs({
    current: d,
    associations: [{ activity_id: 42, status: "automatic" }],
    activities: [activityInput({ activity_id: 42 })],
    trackPointsByActivity: new Map([[42, track]]),
  }));
  assert.equal(result.pauses?.pauseCount, 0);
  assert.equal(result.pauses?.details.length, 0);
});

test("pauses: no track data at all is a distinct 'no track data' state, never zero-pauses-as-a-fact", () => {
  const d = day({ workout_id: "w1", date: "2026-09-10" });
  const result = buildWorkoutReport(baseInputs({
    current: d,
    associations: [{ activity_id: 42, status: "automatic" }],
    activities: [activityInput({ activity_id: 42 })],
    trackPointsByActivity: new Map([[42, []]]),
  }));
  assert.equal(result.pauses?.hasTrackData, false);
  assert.equal(result.pauses?.pauseCount, 0);
});
