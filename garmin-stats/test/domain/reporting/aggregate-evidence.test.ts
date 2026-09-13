/**
 * test/domain/reporting/aggregate-evidence.test.ts (HRA-338)
 * Pure evidence aggregation at week/plan (multi-workout) scope: pause
 * aggregation across many activities, and the "at most one comparable
 * session" stamina-candidate selection that deliberately never blends
 * stamina across a scope's whole population.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregatePauseEvidence, selectComparableStaminaCandidate } from "../../../src/domain/reporting/aggregate-evidence.ts";
import type { PauseEvidencePointInput } from "../../../src/domain/reporting/evidence.ts";
import type { AcceptedEvidence } from "../../../src/domain/reporting/types.ts";

function accepted(overrides: Partial<AcceptedEvidence> & { activity_id: number; workout_id: string }): AcceptedEvidence {
  return { status: "automatic", local_date: "2026-09-10", ...overrides };
}

function point(overrides: Partial<PauseEvidencePointInput>): PauseEvidencePointInput {
  return { elapsed_sec: null, timestamp_unix: null, distance_m: null, heart_rate: null, speed_ms: null, stamina: null, ...overrides };
}

// A real Garmin auto-pause fixture (mirrors workout-report.test.ts's own
// "recording gap" fixture): elapsed_sec freezes while timestamp_unix keeps
// advancing, giving exactly ONE detected pause per activity — so aggregating
// two of these should read pauseCount: 2.
function trackWithOnePause(): PauseEvidencePointInput[] {
  return [
    point({ elapsed_sec: 0, timestamp_unix: 1_000, distance_m: 0, heart_rate: 160 }),
    point({ elapsed_sec: 1, timestamp_unix: 1_001, distance_m: 200, heart_rate: 158 }),
    point({ elapsed_sec: 2, timestamp_unix: 1_046, distance_m: 200, heart_rate: 130 }),
    point({ elapsed_sec: 3, timestamp_unix: 1_047, distance_m: 400, heart_rate: 145 }),
  ];
}

test("aggregatePauseEvidence: sums pause counts/totals and takes the max longest pause across every activity in scope", () => {
  const trackPointsByActivity = new Map<number, PauseEvidencePointInput[]>([
    [1, trackWithOnePause()],
    [2, trackWithOnePause()],
  ]);
  const result = aggregatePauseEvidence([1, 2], trackPointsByActivity);
  assert.equal(result.pauseCount, 2);
  assert.equal(result.hasTrackData, true);
  assert.equal(result.details.length, 2);
});

test("aggregatePauseEvidence: an activity with no loaded track data is skipped, not treated as zero pauses with track data", () => {
  const trackPointsByActivity = new Map<number, PauseEvidencePointInput[]>([[1, trackWithOnePause()]]);
  const result = aggregatePauseEvidence([1, 2], trackPointsByActivity);
  assert.equal(result.pauseCount, 1);
  assert.equal(result.hasTrackData, true); // activity 1 DID have track data
});

test("aggregatePauseEvidence: no activities in scope at all reports hasTrackData=false, never a fabricated zero-with-data", () => {
  const result = aggregatePauseEvidence([], new Map());
  assert.deepEqual(result, { pauseCount: 0, longestPauseSec: null, totalPausedFromPausesSec: null, details: [], hasTrackData: false });
});

test("selectComparableStaminaCandidate: a race day in scope always wins, even over a longer non-race run", () => {
  const accepted1 = accepted({ activity_id: 1, workout_id: "w1" });
  const accepted2 = accepted({ activity_id: 2, workout_id: "w2" });
  const activitiesById = new Map([
    [1, { activity_id: 1, distance_m: 5000 }],
    [2, { activity_id: 2, distance_m: 42195 }], // the longer run, but not the race day
  ]);
  const currentDateByWorkoutId = new Map([["w1", "2026-09-10"], ["w2", "2026-09-17"]]);
  const candidate = selectComparableStaminaCandidate([accepted1, accepted2], activitiesById, currentDateByWorkoutId, "2026-09-10");
  assert.deepEqual(candidate, { workout_id: "w1", activity_id: 1, reason: "race" });
});

test("selectComparableStaminaCandidate: with no race in scope, the strict-max-distance completed run wins", () => {
  const accepted1 = accepted({ activity_id: 1, workout_id: "w1" });
  const accepted2 = accepted({ activity_id: 2, workout_id: "w2" });
  const activitiesById = new Map([
    [1, { activity_id: 1, distance_m: 5000 }],
    [2, { activity_id: 2, distance_m: 21000 }],
  ]);
  const candidate = selectComparableStaminaCandidate([accepted1, accepted2], activitiesById, new Map(), null);
  assert.deepEqual(candidate, { workout_id: "w2", activity_id: 2, reason: "longest_run" });
});

test("selectComparableStaminaCandidate: a tied longest distance selects no comparable session rather than guessing", () => {
  const accepted1 = accepted({ activity_id: 1, workout_id: "w1" });
  const accepted2 = accepted({ activity_id: 2, workout_id: "w2" });
  const activitiesById = new Map([
    [1, { activity_id: 1, distance_m: 10000 }],
    [2, { activity_id: 2, distance_m: 10000 }],
  ]);
  const candidate = selectComparableStaminaCandidate([accepted1, accepted2], activitiesById, new Map(), null);
  assert.equal(candidate, null);
});

test("selectComparableStaminaCandidate: nothing accepted in scope selects no comparable session", () => {
  const candidate = selectComparableStaminaCandidate([], new Map(), new Map(), null);
  assert.equal(candidate, null);
});
