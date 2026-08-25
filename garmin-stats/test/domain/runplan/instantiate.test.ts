/**
 * test/domain/runplan/instantiate.test.ts  (HRA-122)
 * Covers instantiatePlan()'s per-day date derivation. Before this Story every
 * day within a week was persisted with the identical week-baseline date — a
 * multi-day week must now produce a distinct, correctly-offset date per day
 * (D1 = week baseline, D7 = baseline + 6 days).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRunPlanDSL } from "../../../src/domain/runplan/parser.ts";
import { instantiatePlan } from "../../../src/domain/runplan/instantiate.ts";
import type { RunPlan } from "../../../src/domain/runplan/types.ts";

function mustParse(input: string): RunPlan {
  const result = parseRunPlanDSL(input);
  assert.equal(result.ok, true, "expected ok:true");
  if (!result.ok) throw new Error("unreachable");
  return result.plan;
}

const TWO_WEEK_PLAN = `
PLAN
NAME Instantiate Date Test
EVENT marathon
GOAL 03:00:00
UNIT mi
OFFSET_UNIT s/mi
DEFAULT_REST jog
PACE RG=6:55/mi
PACE EASY=7:53/mi
PACE AEROBIC=7:25/mi

SECTION "Base" WEEKS 1-2

WEEK 1
D1: REST
D2 [interval]: 4x1mi @ RG r:400m @ EASY
D3 [base]: 6mi @ AEROBIC
D4: REST
D5 [easy]: 4mi @ EASY
D6 [long]: 12mi @ AEROBIC
D7: REST

WEEK 2
D3 [base]: 7mi @ AEROBIC
`;

test("instantiatePlan: each day in a multi-day week gets its own offset date (D1..D7)", () => {
  const plan = mustParse(TWO_WEEK_PLAN);
  const days = instantiatePlan(plan, { startDate: "2026-09-07" }); // a Monday

  const week1 = days.filter(d => d.week_number === 1).sort((a, b) => a.day - b.day);
  assert.deepEqual(
    week1.map(d => [d.day, d.date]),
    [
      [1, "2026-09-07"],
      [2, "2026-09-08"],
      [3, "2026-09-09"],
      [4, "2026-09-10"],
      [5, "2026-09-11"],
      [6, "2026-09-12"],
      [7, "2026-09-13"],
    ],
  );

  // All 7 dates must be distinct — the HRA-122 bug produced 7 identical dates.
  assert.equal(new Set(week1.map(d => d.date)).size, 7);
});

test("instantiatePlan: week N baseline still offsets by 7 days, day offset composes on top", () => {
  const plan = mustParse(TWO_WEEK_PLAN);
  const days = instantiatePlan(plan, { startDate: "2026-09-07" });

  const week2Day3 = days.find(d => d.week_number === 2 && d.day === 3);
  assert.ok(week2Day3);
  // week2 baseline = 2026-09-07 + 7 = 2026-09-14; D3 = baseline + 2 = 2026-09-16
  assert.equal(week2Day3!.date, "2026-09-16");
});

test("instantiatePlan: explicit WEEK ... START still wins as the week baseline for day offsets", () => {
  const plan = mustParse(`
PLAN
NAME Explicit Start Test
EVENT marathon
GOAL 03:00:00
UNIT mi
OFFSET_UNIT s/mi
DEFAULT_REST jog
PACE EASY=7:53/mi

SECTION "Base" WEEKS 1

WEEK 1 START 2026-10-05
D1: REST
D2 [easy]: 4mi @ EASY
`);
  const days = instantiatePlan(plan, { startDate: "2026-09-07" });
  const day1 = days.find(d => d.day === 1);
  const day2 = days.find(d => d.day === 2);
  assert.equal(day1!.date, "2026-10-05");
  assert.equal(day2!.date, "2026-10-06");
});

// ── HRA-124: K0 week-1 anchoring + rest-day auto-fill ──────────────────────

const K0_THREE_PLAN = `
PLAN
NAME K0 Anchor Test
EVENT marathon
GOAL 03:00:00
UNIT km
OFFSET_UNIT s/km
DEFAULT_REST walk
PACE RG=4:16/km

SECTION "Base" WEEKS 1-2

WEEK 1
D3 [base]: 6km @ RG
D5 [easy]: 4km @ RG
D6a: REST
D6b: REST

WEEK 2
D3 [base]: 7km @ RG
`;

test("instantiatePlan: K0 = lowest declared D-number in week 1 — start_date is K0's date, earlier days fill backward", () => {
  const plan = mustParse(K0_THREE_PLAN);
  // K0 = 3 (D3 is the first declared day). start_date given as a Wednesday
  // (2026-09-09) means trueMonday = 2026-09-07, so D1/D2 land on Mon/Tue.
  const days = instantiatePlan(plan, { startDate: "2026-09-09" });
  const week1 = days.filter(d => d.week_number === 1).sort((a, b) => a.day - b.day);
  assert.deepEqual(
    week1.map(d => [d.day, d.date, d.workout_type]),
    [
      [1, "2026-09-07", "rest"],
      [2, "2026-09-08", "rest"],
      [3, "2026-09-09", "run"],
      [4, "2026-09-10", "rest"],
      [5, "2026-09-11", "run"],
      [6, "2026-09-12", "rest"], // D6a — declared
      [6, "2026-09-12", "rest"], // D6b — declared, no extra synthetic fill for day 6
      [7, "2026-09-13", "rest"],
    ],
  );
  assert.equal(week1.length, 8, "D6a + D6b both declared, no duplicate synthetic day 6");
});

test("instantiatePlan: week N baseline derives from trueMonday, not raw start_date, once K0 > 1", () => {
  const plan = mustParse(K0_THREE_PLAN);
  const days = instantiatePlan(plan, { startDate: "2026-09-09" }); // K0=3, trueMonday=2026-09-07
  const week2Day3 = days.find(d => d.week_number === 2 && d.day === 3);
  // week2 baseline = trueMonday + 7 = 2026-09-14; D3 = baseline + 2 = 2026-09-16
  assert.equal(week2Day3!.date, "2026-09-16");
});

test("instantiatePlan: auto-filled rest days carry the template's DEFAULT_REST rest_type and the caller's rest_day_label as notes", () => {
  const plan = mustParse(K0_THREE_PLAN);
  const days = instantiatePlan(plan, { startDate: "2026-09-09", restDayLabel: "Easy jog" });
  const day1 = days.find(d => d.week_number === 1 && d.day === 1)!;
  assert.equal(day1.workout_type, "rest");
  assert.equal(day1.notes, "Easy jog");
  assert.deepEqual(day1.segments, [{ type: "rest_block", target: { kind: "unknown", raw: "" }, rest_type: "walk", raw: "REST" }]);
});

test("instantiatePlan: auto-filled rest days default to jog when the template has no DEFAULT_REST line, and omit notes when no rest_day_label is given", () => {
  const plan = mustParse(`
PLAN
NAME No Default Rest Test
EVENT marathon
GOAL 03:00:00
UNIT km
OFFSET_UNIT s/km
PACE RG=4:16/km

SECTION "Base" WEEKS 1

WEEK 1
D1 [base]: 6km @ RG
`);
  const days = instantiatePlan(plan, { startDate: "2026-09-07" });
  const day2 = days.find(d => d.day === 2)!;
  assert.equal(day2.workout_type, "rest");
  assert.equal(day2.notes, undefined);
  assert.equal((day2.segments[0] as { rest_type?: string }).rest_type, "jog");
});
