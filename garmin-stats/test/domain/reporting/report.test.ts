/**
 * test/domain/reporting/report.test.ts (HRA-335)
 * buildReport — the shared reporting boundary. Pure, no I/O: every case here
 * is reproduced purely from its own explicit inputs (Original snapshot,
 * Current revision, accepted associations, asOf, timezone, scope membership
 * — AC13), covering AC1-AC7 and AC14's explicit empty/partial/actual-only/
 * planned-only/future-only/moved-boundary/incompatible-data cases.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, type ReportActivityInput, type ReportInputs, type ReportInstanceInput } from "../../../src/domain/reporting/report.ts";
import type { ResolvedSegment } from "../../../src/domain/runplan/instantiate.ts";
import type { PlanInstanceDayRow } from "../../../src/db.ts";
import type { OriginalDaySnapshot } from "../../../src/domain/runplan/lineage.ts";
import type { ReportRequest } from "../../../src/domain/reporting/types.ts";

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

function instance(overrides: Partial<ReportInstanceInput> = {}): ReportInstanceInput {
  return { id: 1, schedule_timezone: ROME, original_start_date: "2026-09-01", original_days_snapshot: "[]", ...overrides };
}

function activity(overrides: Partial<ReportActivityInput> & { activity_id: number; activity_date: string }): ReportActivityInput {
  return { distance_m: 10000, duration_sec: 3000, ...overrides };
}

const ALL_DIMENSIONS: ReportRequest["dimensions"] = ["adaptation", "execution", "outcome"];
const ALL_METRICS: ReportRequest["metrics"] = ["distance", "duration", "pace"];

// Defaults granularity/metrics so each test states only what it's actually
// exercising (range/dimensions/asOf) — same "explicit inputs, minimal noise"
// reasoning as baseInputs() below.
function req(overrides: Partial<ReportRequest> & Pick<ReportRequest, "dimensions">): ReportRequest {
  return { instanceId: 1, range: "full_plan", granularity: "plan", metrics: ALL_METRICS, ...overrides };
}

function baseInputs(overrides: Partial<ReportInputs> = {}): ReportInputs {
  return { instance: instance(), currentDays: [], associations: [], activities: [], now: NOW, ...overrides };
}

test("empty plan: no Original, no Current, no activities produces empty datasets/coverage rather than fabricated zeros hiding an error", () => {
  const result = buildReport(req({ dimensions: ALL_DIMENSIONS }), baseInputs());
  assert.deepEqual(result.scope, []);
  assert.deepEqual(result.comparisons.execution, []);
  assert.deepEqual(result.comparisons.outcome, []);
  assert.equal(result.datasets.original.distanceM, 0);
  assert.equal(result.datasets.original.paceSecPerKm, null); // null, never 0 or NaN
  assert.equal(result.coverage.totalActivitiesInScope, 0);
});

test("planned-only: Current days exist with zero activities — execution shows every past-due day missed, none completed", () => {
  const currentDays = [day({ workout_id: "w1", date: "2026-09-10" }), day({ workout_id: "w2", date: "2026-09-15" })];
  const result = buildReport(req({ dimensions: ["execution"] }), baseInputs({ currentDays }));
  assert.equal(result.comparisons.execution!.length, 2);
  assert.ok(result.comparisons.execution!.every(e => e.state === "missed"));
  assert.equal(result.denominators.execution!.completed, 0);
  assert.equal(result.denominators.execution!.missed, 2);
});

test("actual-only: activities exist with no accepted plan link — all land in the extra population, not silently absorbed into trusted totals", () => {
  const activities = [activity({ activity_id: 1, activity_date: "2026-09-10T07:00:00Z" })];
  const result = buildReport(req({ dimensions: [] }), baseInputs({ activities }));
  assert.equal(result.coverage.extraActivities, 1);
  assert.equal(result.coverage.trustedActivities, 0);
  assert.equal(result.datasets.actual.distanceM, 0); // extra activities never enter the trusted Actual dataset total
});

test("future-only under plan_to_date: every day is beyond asOf and is excluded from execution entirely (AC4)", () => {
  const currentDays = [day({ workout_id: "w1", date: "2026-09-25" })]; // after NOW (09-19)
  const result = buildReport(req({ range: "plan_to_date", dimensions: ["execution"] }), baseInputs({ currentDays }));
  assert.deepEqual(result.comparisons.execution, []);
  assert.equal(result.denominators.execution!.total, 0);
});

test("future-only under full_plan: the same day is kept as upcoming context with no denominator/compliance delta (AC4)", () => {
  const currentDays = [day({ workout_id: "w1", date: "2026-09-25" })];
  const result = buildReport(req({ dimensions: ["execution"] }), baseInputs({ currentDays }));
  assert.equal(result.comparisons.execution!.length, 1);
  assert.equal(result.comparisons.execution![0].state, "upcoming");
  assert.equal(result.comparisons.execution![0].includedInDenominator, false);
  assert.equal(result.denominators.execution!.total, 0); // upcoming never counts toward the trusted denominator
  assert.equal(result.denominators.execution!.upcoming, 1);
});

test("moved-boundary: a workout crossing the plan_to_date cutoff is flagged moved_out/moved_in relative to that exact boundary (AC6)", () => {
  const originalDays = [original({ workout_id: "w1", date: "2026-09-10", week_number: 1 })]; // before asOf
  const currentDays = [day({ workout_id: "w1", date: "2026-09-25", week_number: 2 })]; // after asOf — pushed out, and structurally moved
  const result = buildReport(
    req({ range: "plan_to_date", dimensions: ["adaptation"] }),
    baseInputs({ instance: instance({ original_days_snapshot: JSON.stringify(originalDays) }), currentDays }),
  );
  const [entry] = result.comparisons.adaptation!;
  assert.equal(entry.lineage, "moved");
  assert.equal(entry.boundaryMovement, "moved_out");
});

test("incompatible-data: accepted evidence whose activity is missing distance keeps Actual pace unavailable, not zero", () => {
  const currentDays = [day({ workout_id: "w1", date: "2026-09-10" })];
  const associations = [{ activity_id: 1, workout_id: "w1", status: "automatic" as const }];
  const activities = [activity({ activity_id: 1, activity_date: "2026-09-10T07:00:00Z", distance_m: null })];
  const result = buildReport(req({ dimensions: ["execution"] }), baseInputs({ currentDays, associations, activities }));
  assert.equal(result.datasets.actual.paceSecPerKm, null);
  assert.equal(result.comparisons.execution![0].state, "completed"); // evidence still counts as completed regardless of metric completeness
});

test("adaptation/execution/outcome never substitute for one another (AC5): a moved-and-completed workout reports differently under each dimension", () => {
  const originalDays = [original({ workout_id: "w1", date: "2026-09-05", week_number: 1 })];
  const currentDays = [day({ workout_id: "w1", date: "2026-09-10", week_number: 2 })];
  const associations = [{ activity_id: 1, workout_id: "w1", status: "manual_confirmed" as const }];
  const activities = [activity({ activity_id: 1, activity_date: "2026-09-10T07:00:00Z" })];
  const result = buildReport(
    req({ dimensions: ALL_DIMENSIONS }),
    baseInputs({ instance: instance({ original_days_snapshot: JSON.stringify(originalDays) }), currentDays, associations, activities }),
  );
  assert.equal(result.comparisons.adaptation![0].lineage, "moved"); // Original vs Current: structural move
  assert.equal(result.comparisons.execution![0].scheduled_date, "2026-09-10"); // Current vs Actual: judged at Current's own date
  assert.equal(result.comparisons.outcome![0].original_date, "2026-09-05"); // Original vs Actual: judged at Original's own date, never Current's
  assert.equal(result.comparisons.execution![0].state, "completed");
  assert.equal(result.comparisons.outcome![0].state, "completed");
});

test("requesting a subset of dimensions never computes the others (AC1/AC5)", () => {
  const result = buildReport(req({ dimensions: ["execution"] }), baseInputs());
  assert.equal(result.comparisons.adaptation, undefined);
  assert.equal(result.comparisons.outcome, undefined);
  assert.notEqual(result.comparisons.execution, undefined);
});

test("requesting a subset of metrics omits the rest of the dataset fields entirely, never as a present zero (AC1/AC14)", () => {
  const currentDays = [day({ workout_id: "w1", date: "2026-09-01" })];
  const result = buildReport(req({ dimensions: [], metrics: ["distance"] }), baseInputs({ currentDays }));
  assert.equal(result.datasets.current.distanceM, 10000);
  assert.equal(result.datasets.current.durationSec, undefined);
  assert.equal(result.datasets.current.paceSecPerKm, undefined);
});

test("requesting zero metrics returns entirely empty dataset objects", () => {
  const currentDays = [day({ workout_id: "w1", date: "2026-09-01" })];
  const result = buildReport(req({ dimensions: [], metrics: [] }), baseInputs({ currentDays }));
  assert.deepEqual(result.datasets.current, {});
});

test("an explicit asOf is honored over the injected now (AC1's 'explicit or server-resolved asOf')", () => {
  const currentDays = [day({ workout_id: "w1", date: "2026-09-25" })];
  const result = buildReport(
    req({ range: "plan_to_date", dimensions: ["execution"], asOf: new Date("2026-09-30T00:00:00Z") }),
    baseInputs({ currentDays }),
  );
  // With asOf pushed to 09-30, the 09-25 day is now in the past relative to
  // asOf even though NOW (injected "now") is still 09-19.
  assert.equal(result.comparisons.execution!.length, 1);
  assert.equal(result.comparisons.execution![0].state, "missed");
  assert.equal(result.provenance.asOf, new Date("2026-09-30T00:00:00Z").toISOString());
  assert.equal(result.provenance.generatedAt, NOW.toISOString()); // generatedAt is always real "now", independent of asOf
});

test("structuredQualityEvidence is always the explicit not-yet-available slot for HRA-342 (never fabricated data)", () => {
  const result = buildReport(req({ dimensions: [] }), baseInputs());
  assert.deepEqual(result.structuredQualityEvidence, { available: false, reason: "not_implemented" });
});

test("drill-down carries workout/activity identifiers only — never raw track-point data (AC12 by construction)", () => {
  const currentDays = [day({ workout_id: "w1", date: "2026-09-10" })];
  const associations = [{ activity_id: 1, workout_id: "w1", status: "automatic" as const }];
  const activities = [activity({ activity_id: 1, activity_date: "2026-09-10T07:00:00Z" }), activity({ activity_id: 2, activity_date: "2026-09-11T07:00:00Z" })];
  const result = buildReport(req({ dimensions: [] }), baseInputs({ currentDays, associations, activities }));
  assert.deepEqual(result.drillDown.workoutIds, ["w1"]);
  assert.deepEqual(result.drillDown.activityIds.sort(), [1, 2]);
});

// ── week granularity (HRA-338) ──────────────────────────────────────────

test("week granularity: execution/outcome/datasets are confined to the requested week's own days, never the whole plan (AC: week reports group by workout)", () => {
  const currentDays = [
    day({ workout_id: "w1", date: "2026-09-10", week_number: 1 }),
    day({ workout_id: "w2", date: "2026-09-17", week_number: 2 }),
  ];
  const result = buildReport(
    req({ granularity: "week", week: { section_name: "Base", week_number: 1 }, dimensions: ["execution", "outcome"] }),
    baseInputs({ currentDays }),
  );
  assert.equal(result.comparisons.execution!.length, 1);
  assert.equal(result.comparisons.execution![0].workout_id, "w1");
  assert.equal(result.datasets.current.distanceM, 10000, "only week 1's own day, never week 2's");
});

test("week granularity: a workout moved OUT of the requested week still surfaces there as moved_out, not silently dropped (AC6)", () => {
  const originalDays = [original({ workout_id: "w1", date: "2026-09-10", week_number: 1 })];
  const currentDays = [day({ workout_id: "w1", date: "2026-09-17", week_number: 2 })];
  const result = buildReport(
    req({ granularity: "week", week: { section_name: "Base", week_number: 1 }, dimensions: ["adaptation"] }),
    baseInputs({ instance: instance({ original_days_snapshot: JSON.stringify(originalDays) }), currentDays }),
  );
  const [entry] = result.comparisons.adaptation!;
  assert.equal(entry.lineage, "moved");
  assert.equal(entry.boundaryMovement, "moved_out");
});

test("week granularity: a workout moved OUT of week 1 does not also appear in week 1's own execution entries (it has no Current placement there)", () => {
  const originalDays = [original({ workout_id: "w1", date: "2026-09-10", week_number: 1 })];
  const currentDays = [day({ workout_id: "w1", date: "2026-09-17", week_number: 2 })];
  const result = buildReport(
    req({ granularity: "week", week: { section_name: "Base", week_number: 1 }, dimensions: ["execution"] }),
    baseInputs({ instance: instance({ original_days_snapshot: JSON.stringify(originalDays) }), currentDays }),
  );
  assert.deepEqual(result.comparisons.execution, []);
});

test("week granularity: drill-down workout ids exclude workouts entirely unrelated to the requested week", () => {
  const currentDays = [
    day({ workout_id: "w1", date: "2026-09-10", week_number: 1 }),
    day({ workout_id: "w2", date: "2026-09-17", week_number: 2 }),
  ];
  const result = buildReport(
    req({ granularity: "week", week: { section_name: "Base", week_number: 1 }, dimensions: ["adaptation"] }),
    baseInputs({ currentDays }),
  );
  assert.deepEqual(result.drillDown.workoutIds, ["w1"]);
});

test("plan granularity's drill-down is unaffected by the week machinery (pre-existing behavior preserved)", () => {
  const currentDays = [
    day({ workout_id: "w1", date: "2026-09-10", week_number: 1 }),
    day({ workout_id: "w2", date: "2026-09-17", week_number: 2 }),
  ];
  const result = buildReport(req({ dimensions: ["adaptation"] }), baseInputs({ currentDays }));
  assert.deepEqual(result.drillDown.workoutIds.sort(), ["w1", "w2"]);
});
