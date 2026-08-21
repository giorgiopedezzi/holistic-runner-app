/**
 * test/domain/runplan/parser.test.ts  (HRA-111)
 * Unit + golden-fixture tests for the RunPlan DSL v1 parser. The two full
 * 4-week plans (Boston-style/mi, Italian-style/km) are the acceptance-test
 * fixtures specified for this Story; every resolution below is asserted
 * exactly as documented there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRunPlanDSL, parseDayEntry } from "../../../src/domain/runplan/parser.ts";
import { getEffectivePacePolicy, resolveIntensityToPace } from "../../../src/domain/runplan/pace.ts";
import type {
  ContinuousSegment, DayParseContext, IntervalSegment, ProgressionSegment, RestBlockSegment, RunPlan, Section, Week,
} from "../../../src/domain/runplan/types.ts";

const KM_PER_MILE = 1.60934;
const sec = (mm: number, ss: number) => mm * 60 + ss;
const secPerMi = (secPerKm: number) => Math.round(secPerKm * KM_PER_MILE);
const round = (n: number) => Math.round(n);

function mustParse(input: string): RunPlan {
  const result = parseRunPlanDSL(input);
  assert.equal(result.ok, true, "expected ok:true");
  if (!result.ok) throw new Error("unreachable");
  return result.plan;
}

function findSection(plan: RunPlan, name: string): Section {
  const s = plan.sections.find(s => s.name === name);
  assert.ok(s, `section "${name}" not found`);
  return s!;
}
function findWeek(section: Section, number: number): Week {
  const w = section.weeks.find(w => w.number === number);
  assert.ok(w, `week ${number} not found`);
  return w!;
}
function resolvedSecPerKm(plan: RunPlan, section: Section, week: Week, anchorOrIntensity: string) {
  const policy = getEffectivePacePolicy(plan, section, week);
  const result = resolveIntensityToPace({ kind: "anchor", anchor: anchorOrIntensity, raw: anchorOrIntensity }, policy);
  assert.equal(result.ok, true, `expected ${anchorOrIntensity} to resolve`);
  return (result as { ok: true; pace_sec_per_km: number }).pace_sec_per_km;
}

// ── Fixture A — Boston-style (miles) ────────────────────────────────────────

const BOSTON = `
PLAN
NAME Boston Style 4-Week Test
EVENT marathon
GOAL 03:00:00
UNIT mi
OFFSET_UNIT s/mi
DEFAULT_REST jog
PACE RG=6:55/mi
PACE EASY=7:53/mi
PACE AEROBIC=7:25/mi
PACE HMP=6:38/mi
PACE 10K=6:18/mi
PACE 5K=6:00/mi
PACE LONG=RG+25s/mi

SECTION "Base" WEEKS 1-2

WEEK 1
D1: REST
D2 [interval]: 4x1mi @ 10K r:400m @ EASY
D3 [base]: 6mi @ AEROBIC
D4: REST
D5 [easy]: 4mi @ 7:53/mi
D6 [long]: 12mi @ LONG
D7: REST

WEEK 2
D1: REST
D2 [interval]: 6x1mi @ HMP r:400m @ EASY
D3 [base]: 7mi @ AEROBIC
D4 [easy]: 5mi @ EASY
D5: REST
D6 [long]: 14mi @ LONG
D7: REST

SECTION "Race Specific" WEEKS 3-4
PACE RG=6:50/mi

WEEK 3
D1: REST
D2 [interval]: 3x2mi @ RG-5s/mi r:1mi @ EASY
D3 [base]: 8mi @ AEROBIC
D4 [specific]: 10mi @ RG
D5: REST
D6 [long]: 16mi @ LONG ; 2mi @ RG
D7: REST

WEEK 4
PACE RG=6:48/mi
D1: REST
D2 [interval]: 2x1mi @ HMP r:400m @ EASY
D3 [easy]: 6mi @ EASY
D4 [specific]: 4mi @ RG
D5: REST
D6 [race]: 21.1km @ RG
D7: REST
`;

test("Boston fixture: structure — 2 sections, 4 weeks total, UNIT mi", () => {
  const plan = mustParse(BOSTON);
  assert.equal(plan.metadata.unit, "mi");
  assert.equal(plan.sections.length, 2);
  assert.equal(plan.sections.reduce((n, s) => n + s.weeks.length, 0), 4);
  for (const s of plan.sections) for (const w of s.weeks) assert.ok(w.days.length > 0);
});

test("Boston fixture: week 1 — RG=6:55/mi, LONG=RG+25s/mi resolves D6 to 7:20/mi", () => {
  const plan = mustParse(BOSTON);
  const section = findSection(plan, "Base");
  const week1 = findWeek(section, 1);
  assert.equal(round(resolvedSecPerKm(plan, section, week1, "RG") * KM_PER_MILE), sec(6, 55));
  const long = resolvedSecPerKm(plan, section, week1, "LONG");
  assert.equal(secPerMi(long), sec(7, 20));
  const d6 = week1.days.find(d => d.day === 6)!;
  const seg = d6.segments[0] as ContinuousSegment;
  assert.equal(seg.type, "continuous");
  assert.equal(seg.target.kind, "distance");
});

test("Boston fixture: week 3 — section override RG=6:50/mi, LONG=7:15/mi, offset intensity RG-5s/mi=6:45/mi, ; segments in order", () => {
  const plan = mustParse(BOSTON);
  const section = findSection(plan, "Race Specific");
  const week3 = findWeek(section, 3);
  assert.equal(secPerMi(resolvedSecPerKm(plan, section, week3, "RG")), sec(6, 50));
  assert.equal(secPerMi(resolvedSecPerKm(plan, section, week3, "LONG")), sec(7, 15));

  const d2 = week3.days.find(d => d.day === 2)!;
  const interval = d2.segments[0] as IntervalSegment;
  const policy = getEffectivePacePolicy(plan, section, week3);
  const workPace = resolveIntensityToPace(interval.work_intensity, policy);
  assert.equal(workPace.ok, true);
  assert.equal(secPerMi((workPace as { ok: true; pace_sec_per_km: number }).pace_sec_per_km), sec(6, 45));

  const d6 = week3.days.find(d => d.day === 6)!;
  assert.equal(d6.segments.length, 2, "D6 must parse as two ordered segments");
  const [seg1, seg2] = d6.segments as ContinuousSegment[];
  const p1 = resolveIntensityToPace(seg1.intensity, policy);
  const p2 = resolveIntensityToPace(seg2.intensity, policy);
  assert.equal(p1.ok && secPerMi(p1.pace_sec_per_km), sec(7, 15));
  assert.equal(p2.ok && secPerMi(p2.pace_sec_per_km), sec(6, 50));
});

test("Boston fixture: week 4 — week override RG=6:48/mi beats both plan and section values; explicit km unit inside a mi plan", () => {
  const plan = mustParse(BOSTON);
  const section = findSection(plan, "Race Specific");
  const week4 = findWeek(section, 4);
  assert.equal(secPerMi(resolvedSecPerKm(plan, section, week4, "RG")), sec(6, 48));

  const policy = getEffectivePacePolicy(plan, section, week4);
  const d4 = week4.days.find(d => d.day === 4)!;
  const d4seg = d4.segments[0] as ContinuousSegment;
  const d4pace = resolveIntensityToPace(d4seg.intensity, policy);
  assert.equal(d4pace.ok && secPerMi(d4pace.pace_sec_per_km), sec(6, 48));

  const d6 = week4.days.find(d => d.day === 6)!;
  const d6seg = d6.segments[0] as ContinuousSegment;
  assert.equal(d6seg.target.kind, "distance");
  assert.ok(d6seg.raw.includes("km"), "explicit km target inside a mi-unit plan");
  const d6pace = resolveIntensityToPace(d6seg.intensity, policy);
  assert.equal(d6pace.ok && secPerMi(d6pace.pace_sec_per_km), sec(6, 48));
});

test("Boston fixture: earlier weeks are unaffected by a later week's pace override", () => {
  const plan = mustParse(BOSTON);
  const section = findSection(plan, "Race Specific");
  const week3 = findWeek(section, 3);
  // Week 4 overrides RG to 6:48/mi — week 3 must still resolve to the section's 6:50/mi.
  assert.equal(secPerMi(resolvedSecPerKm(plan, section, week3, "RG")), sec(6, 50));
});

// ── Fixture B — Italian-style (km) ──────────────────────────────────────────

const ITALIAN = `
PLAN
NAME Italian Style 4-Week Test
EVENT marathon
GOAL 03:00:00
UNIT km
OFFSET_UNIT s/km
DEFAULT_REST jog
PACE RG=4:16/km
PACE FL=RG+45s/km
PACE FM=RG+20s/km
PACE STRIDE=RG-60s/km

SECTION "Preparazione" WEEKS 1-2

WEEK 1
D1 [easy]: 15km @ FL
D2 [progression]: 10km PROG FL->RG
D3 [interval]: 3x3000m @ RG-20 r:1km @ RG+10
D4 [progression]: 15km PROG FL->RG
D5 [easy]: 10km @ FL
D6 [race]: 21.1km @ RG
D7: REST

WEEK 2
D1 [easy]: 16km @ FL
D2 [progression]: 10km PROG FL->RG
D3 [interval]: 5000m @ RG-20 ; REST 4min stand ; 8x500m @ RG-40 r:90s stand
D4 [progression]: 18km PROG FL->RG
D5 [easy]: 10km @ FL
D6 [progression]: 24km PROG FL->RG
D7: TODO

SECTION "Specifico" WEEKS 3-4
PACE RG=4:14/km

WEEK 3
D1 [easy]: 15km @ FL
D2 [interval]: 4x3000m @ RG-20 r:1km @ RG+10
D3 [steady]: 10km @ FM
D4 [easy]: 14km @ FL
D5 [easy]: 30min @ FL ; 8x100m @ STRIDE r:1min walk
D6a [long]: 30km @ RG+10 ; 2km @ RG-15
D6b [easy]: 6km @ FL
D7: REST

WEEK 4
PACE RG=4:12/km
D1 [easy]: 10km @ FL
D2 [interval]: 5x2000m @ RG-10 r:2min stand
D3 [easy]: 10km @ FL
D4 [easy]: 30min @ FL ; 8x100m @ STRIDE r:1min walk
D5: REST
D6: REST
D7 [race]: 42.195km @ RG
`;

test("Italian fixture: structure — 2 sections, 4 weeks total, UNIT km", () => {
  const plan = mustParse(ITALIAN);
  assert.equal(plan.metadata.unit, "km");
  assert.equal(plan.sections.length, 2);
  assert.equal(plan.sections.reduce((n, s) => n + s.weeks.length, 0), 4);
});

test("Italian fixture: week 1 — RG=4:16/km, FL=5:01/km; interval work/rest resolve exactly", () => {
  const plan = mustParse(ITALIAN);
  const section = findSection(plan, "Preparazione");
  const week1 = findWeek(section, 1);
  assert.equal(round(resolvedSecPerKm(plan, section, week1, "RG")), sec(4, 16));
  assert.equal(round(resolvedSecPerKm(plan, section, week1, "FL")), sec(5, 1));

  const policy = getEffectivePacePolicy(plan, section, week1);
  const d1 = week1.days.find(d => d.day === 1)!;
  const d1seg = d1.segments[0] as ContinuousSegment;
  const d1pace = resolveIntensityToPace(d1seg.intensity, policy);
  assert.equal(d1pace.ok && round(d1pace.pace_sec_per_km), sec(5, 1));

  const d3 = week1.days.find(d => d.day === 3)!;
  const interval = d3.segments[0] as IntervalSegment;
  const workPace = resolveIntensityToPace(interval.work_intensity, policy);
  assert.equal(workPace.ok && round(workPace.pace_sec_per_km), sec(3, 56));
  assert.ok(interval.rest, "interval rest is required");
  const restPace = resolveIntensityToPace(interval.rest.intensity!, policy);
  assert.equal(restPace.ok && round(restPace.pace_sec_per_km), sec(4, 26));
});

test("Italian fixture: week 2 D3 — three ordered segments (continuous ; rest_block ; interval); D7 TODO -> needs_review", () => {
  const plan = mustParse(ITALIAN);
  const section = findSection(plan, "Preparazione");
  const week2 = findWeek(section, 2);
  const policy = getEffectivePacePolicy(plan, section, week2);

  const d3 = week2.days.find(d => d.day === 3)!;
  assert.equal(d3.segments.length, 3);
  const [seg1, seg2, seg3] = d3.segments;
  assert.equal(seg1.type, "continuous");
  const p1 = resolveIntensityToPace((seg1 as ContinuousSegment).intensity, policy);
  assert.equal(p1.ok && round(p1.pace_sec_per_km), sec(3, 56));

  assert.equal(seg2.type, "rest_block");
  const restBlock = seg2 as RestBlockSegment;
  assert.equal(restBlock.target.kind, "duration");
  assert.equal((restBlock.target as { duration_sec: number }).duration_sec, 240);
  assert.equal(restBlock.rest_type, "stand");

  assert.equal(seg3.type, "interval");
  const interval = seg3 as IntervalSegment;
  assert.equal(interval.reps, 8);
  const workPace = resolveIntensityToPace(interval.work_intensity, policy);
  assert.equal(workPace.ok && round(workPace.pace_sec_per_km), sec(3, 36));
  assert.equal(interval.rest?.rest_type, "stand");

  const d7 = week2.days.find(d => d.day === 7)!;
  assert.equal(d7.workout_type, "todo");
  assert.equal(d7.needs_review, true);
});

test("Italian fixture: week 3 — section override RG=4:14/km recalculates FL=4:59/km; D6a/D6b are two separate sessions", () => {
  const plan = mustParse(ITALIAN);
  const section = findSection(plan, "Specifico");
  const week3 = findWeek(section, 3);
  assert.equal(round(resolvedSecPerKm(plan, section, week3, "RG")), sec(4, 14));
  assert.equal(round(resolvedSecPerKm(plan, section, week3, "FL")), sec(4, 59));

  const policy = getEffectivePacePolicy(plan, section, week3);
  const d1 = week3.days.find(d => d.day === 1 && !d.suffix)!;
  const d1seg = d1.segments[0] as ContinuousSegment;
  const d1pace = resolveIntensityToPace(d1seg.intensity, policy);
  assert.equal(d1pace.ok && round(d1pace.pace_sec_per_km), sec(4, 59));

  const d2 = week3.days.find(d => d.day === 2)!;
  const interval = d2.segments[0] as IntervalSegment;
  const workPace = resolveIntensityToPace(interval.work_intensity, policy);
  assert.equal(workPace.ok && round(workPace.pace_sec_per_km), sec(3, 54));

  const d6Days = week3.days.filter(d => d.day === 6);
  assert.equal(d6Days.length, 2, "D6a and D6b must be two separate DayEntry objects");
  const d6a = d6Days.find(d => d.suffix === "a")!;
  const d6b = d6Days.find(d => d.suffix === "b")!;
  assert.ok(d6a && d6b);
  assert.equal(d6a.segments.length, 2);
  const [d6aSeg1, d6aSeg2] = d6a.segments as ContinuousSegment[];
  const d6aP1 = resolveIntensityToPace(d6aSeg1.intensity, policy);
  const d6aP2 = resolveIntensityToPace(d6aSeg2.intensity, policy);
  assert.equal(d6aP1.ok && round(d6aP1.pace_sec_per_km), sec(4, 24));
  assert.equal(d6aP2.ok && round(d6aP2.pace_sec_per_km), sec(3, 59));
});

test("Italian fixture: week 4 — week override RG=4:12/km -> FL=4:57/km, STRIDE=3:12/km; interval and race day resolve exactly", () => {
  const plan = mustParse(ITALIAN);
  const section = findSection(plan, "Specifico");
  const week4 = findWeek(section, 4);
  assert.equal(round(resolvedSecPerKm(plan, section, week4, "RG")), sec(4, 12));
  assert.equal(round(resolvedSecPerKm(plan, section, week4, "FL")), sec(4, 57));
  assert.equal(round(resolvedSecPerKm(plan, section, week4, "STRIDE")), sec(3, 12));

  const policy = getEffectivePacePolicy(plan, section, week4);
  const d2 = week4.days.find(d => d.day === 2)!;
  const interval = d2.segments[0] as IntervalSegment;
  const workPace = resolveIntensityToPace(interval.work_intensity, policy);
  assert.equal(workPace.ok && round(workPace.pace_sec_per_km), sec(4, 2));

  const d7 = week4.days.find(d => d.day === 7)!;
  const raceSeg = d7.segments[0] as ContinuousSegment;
  const racePace = resolveIntensityToPace(raceSeg.intensity, policy);
  assert.equal(racePace.ok && round(racePace.pace_sec_per_km), sec(4, 12));

  // D4 is the multi-segment day in week 4 (30min @ FL ; 8x100m @ STRIDE r:1min walk).
  const d4 = week4.days.find(d => d.day === 4)!;
  assert.equal(d4.segments.length, 2);
  const [d4seg1, d4seg2] = d4.segments;
  assert.equal(d4seg1.type, "continuous");
  assert.equal(d4seg2.type, "interval");
});

// ── Interval rest (HRA-113: optional again — a missing r: clause is a
//    warning, not a hard error; reverses HRA-111 amendment 1) ─────────────

const dayCtx: DayParseContext = {
  unit: "km", offset_unit: "s/km", default_rest: "jog", pacePolicy: { RG: { kind: "absolute", pace_sec_per_km: 256 } },
};

test("interval with distance rest + intensity parses", () => {
  const day = parseDayEntry("D3: 4x3000m @ RG-20 r:1km @ RG+10", dayCtx);
  assert.equal(day.needs_review, false);
  const seg = day.segments[0] as IntervalSegment;
  assert.equal(seg.type, "interval");
  assert.ok(seg.rest);
  assert.equal(seg.rest.target.kind, "distance");
  assert.ok(seg.rest.intensity);
});

test("interval with time rest + rest type parses", () => {
  const day = parseDayEntry("D3: 8x500m @ RG-40 r:90s stand", dayCtx);
  assert.equal(day.needs_review, false);
  const seg = day.segments[0] as IntervalSegment;
  assert.ok(seg.rest);
  assert.equal(seg.rest.target.kind, "duration");
  assert.equal(seg.rest.rest_type, "stand");
});

test("interval with time rest + jog parses", () => {
  const day = parseDayEntry("D3: 5x4min @ RG-10 r:2min jog", dayCtx);
  assert.equal(day.needs_review, false);
  const seg = day.segments[0] as IntervalSegment;
  assert.ok(seg.rest);
  assert.equal(seg.rest.rest_type, "jog");
});

test("interval with distance rest + anchor intensity parses", () => {
  // FL is intentionally not in dayCtx.pacePolicy — needs_review is expected
  // true here (the rest anchor can't resolve), the point of this test is the
  // segment's *shape*, not pace resolution.
  const day = parseDayEntry("D3: 4x2000m @ RG-20 r:1km @ FL", dayCtx);
  const seg = day.segments[0] as IntervalSegment;
  assert.equal(seg.rest?.intensity?.kind, "anchor");
});

test("interval WITHOUT rest produces a warning, not a hard error", () => {
  const day = parseDayEntry("D3: 4x3000m @ RG-20", dayCtx);
  assert.equal(day.needs_review, true);
  assert.equal(day.warnings.length, 1);
  assert.equal(day.warnings[0].message, "Interval segment has no rest specified between repetitions.");
  const seg = day.segments[0] as IntervalSegment;
  assert.equal(seg.rest, undefined);
});

for (const bad of ["D3: 10x1000m @ RG-25", "D2: 6x1mi @ HMP", "D4: 5x4min @ RG-10"]) {
  test(`interval without rest produces a warning, still parses: ${bad}`, () => {
    const day = parseDayEntry(bad, dayCtx);
    assert.equal(day.needs_review, true);
    assert.equal((day.segments[0] as IntervalSegment).rest, undefined);
  });
}

// ── Metadata ─────────────────────────────────────────────────────────────

test("metadata: PLAN header required — missing header returns ok:false", () => {
  const result = parseRunPlanDSL("NAME x\nWEEK 1\nD1: REST\n");
  assert.equal(result.ok, false);
});

test("metadata: empty input returns ok:false", () => {
  const result = parseRunPlanDSL("");
  assert.equal(result.ok, false);
});

test("metadata: NAME/EVENT/GOAL/DISTANCE/UNIT/OFFSET_UNIT/DEFAULT_REST parse", () => {
  const plan = mustParse(`PLAN
NAME Test Plan
EVENT marathon
DISTANCE 42.195km
GOAL 03:00:00
UNIT mi
OFFSET_UNIT s/mi
DEFAULT_REST stand
WEEK 1
D1: REST
`);
  assert.equal(plan.metadata.name, "Test Plan");
  assert.equal(plan.metadata.event, "marathon");
  assert.ok(Math.abs(plan.metadata.distance_m! - 42195) < 1);
  assert.equal(plan.metadata.goal_time_sec, 3 * 3600);
  assert.equal(plan.metadata.unit, "mi");
  assert.equal(plan.metadata.offset_unit, "s/mi");
  assert.equal(plan.metadata.default_rest, "stand");
});

test("metadata: missing fields fall back to documented defaults", () => {
  const plan = mustParse("PLAN\nWEEK 1\nD1: REST\n");
  assert.equal(plan.metadata.unit, "km");
  assert.equal(plan.metadata.offset_unit, "s/km");
  assert.equal(plan.metadata.default_rest, "jog");
  assert.deepEqual(plan.metadata.pace_policy, {});
});

test("metadata: unknown EVENT value stores 'custom' and warns", () => {
  const result = parseRunPlanDSL("PLAN\nEVENT triathlon\nWEEK 1\nD1: REST\n");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.plan.metadata.event, "custom");
  assert.ok(result.warnings.some(w => w.message.includes("triathlon")));
});

test("metadata: PACE absolute and relative parse at plan scope", () => {
  const plan = mustParse("PLAN\nPACE RG=4:16/km\nPACE FL=RG+45s/km\nWEEK 1\nD1: REST\n");
  assert.deepEqual(plan.metadata.pace_policy.RG, { kind: "absolute", pace_sec_per_km: 256 });
  assert.deepEqual(plan.metadata.pace_policy.FL, { kind: "offset", anchor: "RG", offset_sec_per_km: 45 });
});

// ── Sections ─────────────────────────────────────────────────────────────

test("section: quoted name, unquoted name, week spec, note", () => {
  const plan = mustParse(`PLAN
SECTION "Base Phase" WEEKS 1-6 # build up
WEEK 1
D1: REST
SECTION Specific WEEKS 7-12
WEEK 7
D1: REST
`);
  assert.equal(plan.sections[0].name, "Base Phase");
  assert.equal(plan.sections[0].week_spec, "1-6");
  assert.equal(plan.sections[0].notes, "build up");
  assert.equal(plan.sections[1].name, "Specific");
});

test("section: default section ('Plan', '*') created when no SECTION exists", () => {
  const plan = mustParse("PLAN\nWEEK 1\nD1: REST\n");
  assert.equal(plan.sections.length, 1);
  assert.equal(plan.sections[0].name, "Plan");
  assert.equal(plan.sections[0].week_spec, "*");
});

// ── Weeks ────────────────────────────────────────────────────────────────

test("week: number, START date, note, and week-scoped PACE stored on week.pace_policy", () => {
  const plan = mustParse(`PLAN
WEEK 8 START 2026-10-26 # taper begins
PACE RG=4:10/km
D1: REST
`);
  const week = plan.sections[0].weeks[0];
  assert.equal(week.number, 8);
  assert.equal(week.start_date, "2026-10-26");
  assert.equal(week.notes, "taper begins");
  assert.deepEqual(week.pace_policy.RG, { kind: "absolute", pace_sec_per_km: 250 });
});

// ── Days ─────────────────────────────────────────────────────────────────

test("day: D1-D7 parse, invalid day number produces a warning, raw_dsl preserved", () => {
  for (let d = 1; d <= 7; d++) {
    const day = parseDayEntry(`D${d}: REST`, dayCtx);
    assert.equal(day.day, d);
    assert.equal(day.needs_review, false);
  }
  const bad = parseDayEntry("D8: REST", dayCtx);
  assert.equal(bad.day, 8);
  assert.equal(bad.needs_review, true);
  const raw = "D3 [interval]: 3x3000m @ RG-20 r:1km @ RG+10";
  assert.equal(parseDayEntry(raw, dayCtx).raw_dsl, raw);
});

test("day: REST/TODO/CROSS/STRENGTH parse with the right workout_type", () => {
  assert.equal(parseDayEntry("D1: REST", dayCtx).workout_type, "rest");
  const todo = parseDayEntry("D1: TODO", dayCtx);
  assert.equal(todo.workout_type, "todo");
  assert.equal(todo.needs_review, true);
  const cross = parseDayEntry("D5: CROSS 45min bike", dayCtx);
  assert.equal(cross.workout_type, "cross");
  assert.equal(cross.activity_description, "bike");
  assert.equal(cross.activity_target?.kind, "duration");
  const strength = parseDayEntry("D5: STRENGTH 30min core", dayCtx);
  assert.equal(strength.workout_type, "strength");
  assert.equal(strength.activity_description, "core");
});

test("day: category tag and trailing note are captured", () => {
  const day = parseDayEntry("D3 [interval]: 3x3000m @ RG-20 r:1km @ RG+10 # first quality session", dayCtx);
  assert.equal(day.category, "interval");
  assert.equal(day.notes, "first quality session");
});

// ── Workout segments ─────────────────────────────────────────────────────

test("segments: continuous distance and duration parse", () => {
  const distDay = parseDayEntry("D1: 15km @ FL", { ...dayCtx, pacePolicy: { FL: { kind: "absolute", pace_sec_per_km: 300 } } });
  assert.equal((distDay.segments[0] as ContinuousSegment).target.kind, "distance");
  const durDay = parseDayEntry("D1: 60min @ RG", dayCtx);
  assert.equal((durDay.segments[0] as ContinuousSegment).target.kind, "duration");
});

test("segments: progression parses start/end intensity", () => {
  const day = parseDayEntry("D2: 10km PROG FL->RG", { ...dayCtx, pacePolicy: { ...dayCtx.pacePolicy, FL: { kind: "absolute", pace_sec_per_km: 300 } } });
  const seg = day.segments[0] as ProgressionSegment;
  assert.equal(seg.type, "progression");
  assert.equal(seg.start_intensity.kind, "anchor");
  assert.equal((seg.start_intensity as { anchor: string }).anchor, "FL");
  assert.equal((seg.end_intensity as { anchor: string }).anchor, "RG");
});

test("segments: rest_block parses duration and rest type", () => {
  const day = parseDayEntry("D3: 5000m @ RG-20 ; REST 4min stand", dayCtx);
  const seg = day.segments[1] as RestBlockSegment;
  assert.equal(seg.type, "rest_block");
  assert.equal(seg.target.kind, "duration");
  assert.equal(seg.rest_type, "stand");
});

test("segments: invalid workout syntax and missing units produce warnings, still parse", () => {
  const missingUnit = parseDayEntry("D3: 4x3 @ RG-20 r:1km @ RG+10", dayCtx);
  assert.equal(missingUnit.needs_review, true);
  const garbage = parseDayEntry("D3: not a real workout !!!", dayCtx);
  assert.equal(garbage.needs_review, true);
});

// ── Target normalization ────────────────────────────────────────────────

test("target: distance units normalize to meters (m/km/mi, decimal)", () => {
  const cases: [string, number][] = [["500m", 500], ["3km", 3000], ["1mi", 1609.34], ["21.1km", 21100]];
  for (const [raw, expectedM] of cases) {
    const day = parseDayEntry(`D1: ${raw} @ RG`, dayCtx);
    const seg = day.segments[0] as ContinuousSegment;
    assert.equal(seg.target.kind, "distance");
    assert.ok(Math.abs((seg.target as { distance_m: number }).distance_m - expectedM) < 0.5, raw);
  }
});

test("target: duration units normalize to seconds (s/sec/min/'/h)", () => {
  const cases: [string, number][] = [["30s", 30], ["90sec", 90], ["5min", 300], ["30'", 1800], ["2h", 7200]];
  for (const [raw, expectedS] of cases) {
    const day = parseDayEntry(`D1: ${raw} @ RG`, dayCtx);
    const seg = day.segments[0] as ContinuousSegment;
    assert.equal(seg.target.kind, "duration");
    assert.equal((seg.target as { duration_sec: number }).duration_sec, expectedS, raw);
  }
});

test("target: no unit produces a warning, falls back to unknown", () => {
  const day = parseDayEntry("D1: 15 @ RG", dayCtx);
  assert.equal(day.needs_review, true);
  const seg = day.segments[0] as ContinuousSegment;
  assert.equal(seg.target.kind, "unknown");
});

// ── Intensity ────────────────────────────────────────────────────────────

test("intensity: anchor, offset (default/explicit s/km/s/mi), absolute km/mi all parse", () => {
  const anchorDay = parseDayEntry("D1: 10km @ RG", dayCtx);
  assert.equal((anchorDay.segments[0] as ContinuousSegment).intensity.kind, "anchor");

  const offsetDefault = parseDayEntry("D1: 10km @ RG+10", dayCtx);
  const offInt = (offsetDefault.segments[0] as ContinuousSegment).intensity as { kind: string; offset_sec_per_km: number };
  assert.equal(offInt.kind, "offset");
  assert.equal(offInt.offset_sec_per_km, 10);

  const offsetKm = parseDayEntry("D1: 10km @ RG+10s/km", dayCtx);
  assert.equal(((offsetKm.segments[0] as ContinuousSegment).intensity as { offset_sec_per_km: number }).offset_sec_per_km, 10);

  const miCtx: DayParseContext = { ...dayCtx, offset_unit: "s/mi" };
  const offsetMi = parseDayEntry("D1: 10km @ RG-10s/mi", miCtx);
  const miOffset = ((offsetMi.segments[0] as ContinuousSegment).intensity as { offset_sec_per_km: number }).offset_sec_per_km;
  assert.ok(Math.abs(miOffset - -10 / KM_PER_MILE) < 0.01);

  const absKm = parseDayEntry("D1: 10km @ 4:16/km", dayCtx);
  assert.equal(((absKm.segments[0] as ContinuousSegment).intensity as { pace_sec_per_km: number }).pace_sec_per_km, 256);

  const absMi = parseDayEntry("D1: 10km @ 6:55/mi", dayCtx);
  const absMiPace = ((absMi.segments[0] as ContinuousSegment).intensity as { pace_sec_per_km: number }).pace_sec_per_km;
  assert.ok(Math.abs(absMiPace - 415 / KM_PER_MILE) < 0.01);
});

test("intensity: unknown anchor parses but marks the day needs_review with a day-level warning", () => {
  const result = parseRunPlanDSL("PLAN\nWEEK 1\nD1: 10km @ UNKNOWN_PACE\n");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  const day = result.plan.sections[0].weeks[0].days[0];
  assert.equal(day.needs_review, true);
  assert.ok(day.warnings.length > 0, "an unresolved anchor produces a day-level warning");
});

// ── Pace policy scoping / adjustment ────────────────────────────────────

test("pace policy: plan-level applies with no override; section overrides plan; week overrides section and plan directly", () => {
  const plan = mustParse(`PLAN
PACE RG=4:16/km
SECTION "S" WEEKS 1-2
PACE RG=4:12/km
WEEK 1
D1: REST
WEEK 2
PACE RG=4:08/km
D1: REST
`);
  const section = plan.sections[0];
  const week1 = section.weeks[0];
  const week2 = section.weeks[1];
  assert.equal(resolvedSecPerKm(plan, section, week1, "RG"), 252); // section override
  assert.equal(resolvedSecPerKm(plan, section, week2, "RG"), 248); // week overrides section+plan
});

test("pace policy: relative anchors recalculate when their base anchor changes; absolute anchors don't", () => {
  const plan = mustParse(`PLAN
PACE RG=4:16/km
PACE FL=RG+45s/km
PACE EASY=5:00/km
WEEK 1
D1: REST
WEEK 2
PACE RG=4:00/km
D1: REST
`);
  const section = plan.sections[0];
  const week1 = section.weeks[0];
  const week2 = section.weeks[1];
  assert.equal(resolvedSecPerKm(plan, section, week1, "FL"), 256 + 45);
  assert.equal(resolvedSecPerKm(plan, section, week2, "FL"), 240 + 45, "FL recalculates against week 2's RG");
  assert.equal(resolvedSecPerKm(plan, section, week1, "EASY"), 300);
  assert.equal(resolvedSecPerKm(plan, section, week2, "EASY"), 300, "an absolute anchor is unaffected by RG changing");
});

test("pace policy: missing anchor produces a resolution error", () => {
  const plan = mustParse("PLAN\nWEEK 1\nD1: REST\n");
  const policy = getEffectivePacePolicy(plan, plan.sections[0], plan.sections[0].weeks[0]);
  const result = resolveIntensityToPace({ kind: "anchor", anchor: "NOPE", raw: "NOPE" }, policy);
  assert.equal(result.ok, false);
});

test("pace policy: circular pace definitions are detected as plan-level warnings", () => {
  const result = parseRunPlanDSL(`PLAN
PACE RG=FL+10s/km
PACE FL=RG+10s/km
WEEK 1
D1: REST
`);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.ok(result.warnings.some(w => w.message.toLowerCase().includes("circular")));
});

// ── HRA-113: `?` placeholder, optional CROSS/STRENGTH target ──────────────

test("`?` placeholder is accepted for target/intensity, producing specific warnings (known rep-count)", () => {
  const day = parseDayEntry(
    "D1: 10km @ FL ; 8x? @ ?",
    { ...dayCtx, pacePolicy: { ...dayCtx.pacePolicy, FL: { kind: "absolute", pace_sec_per_km: 300 } } },
  );
  assert.equal(day.needs_review, true);
  const interval = day.segments[1] as IntervalSegment;
  assert.equal(interval.reps, 8);
  assert.equal(interval.work_target.kind, "unknown");
  assert.equal(interval.work_intensity.kind, "unknown");
  assert.ok(day.warnings.some(w => w.message.includes("Work target")));
  assert.ok(day.warnings.some(w => w.message.includes("Work intensity")));
});

test("`?` placeholder is accepted for interval rep-count", () => {
  const day = parseDayEntry("D1: ?x400m @ RG r:200m jog", dayCtx);
  const interval = day.segments[0] as IntervalSegment;
  assert.equal(interval.reps, null);
  assert.equal(interval.work_target.kind, "distance");
  assert.ok(day.warnings.some(w => w.message.includes("repetitions")));
});

test("CROSS/STRENGTH: description-only form (no target) parses with no warning", () => {
  const cross = parseDayEntry("D5: CROSS core", dayCtx);
  assert.equal(cross.workout_type, "cross");
  assert.equal(cross.activity_target, undefined);
  assert.equal(cross.activity_description, "core");
  assert.equal(cross.needs_review, false);

  const strength = parseDayEntry("D5: STRENGTH mobility work", dayCtx);
  assert.equal(strength.workout_type, "strength");
  assert.equal(strength.activity_target, undefined);
  assert.equal(strength.activity_description, "mobility work");
  assert.equal(strength.needs_review, false);
});
