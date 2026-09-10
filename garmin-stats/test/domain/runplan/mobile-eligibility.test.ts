/**
 * test/domain/runplan/mobile-eligibility.test.ts (HRA-302)
 * computeMobileEligibility classifies a template's own pace-policy structure
 * without ever depending on the numeric value it's tested with — see the
 * module comment on why a placeholder pace is as conclusive as a real one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRunPlanDSL } from "../../../src/domain/runplan/parser.ts";
import { computeMobileEligibility, resolveAllAnchors } from "../../../src/domain/runplan/mobile-eligibility.ts";
import type { RunPlan } from "../../../src/domain/runplan/types.ts";

function mustParse(input: string): RunPlan {
  const result = parseRunPlanDSL(input);
  assert.equal(result.ok, true, "expected ok:true");
  if (!result.ok) throw new Error("unreachable");
  return result.plan;
}

test("computeMobileEligibility: exactly one TBD anchor -> eligible with that anchor", () => {
  const plan = mustParse(`PACE RG=TBD
PACE FL=RG+45s/km
SECTION "Base" WEEKS 1
WEEK 1
D1: 5km @ RG
D2 [easy]: 5km @ FL
`);
  const result = computeMobileEligibility(plan);
  assert.deepEqual(result, { eligible: true, racePaceAnchor: "RG" });
});

test("computeMobileEligibility: every anchor already absolute -> eligible, no anchor needed", () => {
  const plan = mustParse(`PACE RG=4:30/km
SECTION "Base" WEEKS 1
WEEK 1
D1: 5km @ RG
`);
  const result = computeMobileEligibility(plan);
  assert.deepEqual(result, { eligible: true, racePaceAnchor: null, reason: "already-resolved" });
});

test("computeMobileEligibility: two distinct unbound anchors -> ambiguous, not eligible", () => {
  const plan = mustParse(`PACE RG=TBD
PACE FM=TBD
SECTION "Base" WEEKS 1
WEEK 1
D1: 5km @ RG
D2 [easy]: 5km @ FM
`);
  const result = computeMobileEligibility(plan);
  assert.deepEqual(result, { eligible: false, racePaceAnchor: null, reason: "ambiguous-anchors" });
});

test("computeMobileEligibility: an anchor referenced but never declared behaves like TBD", () => {
  const plan = mustParse(`SECTION "Base" WEEKS 1
WEEK 1
D1: 5km @ RG
`);
  const result = computeMobileEligibility(plan);
  assert.equal(result.eligible, true);
  assert.equal(result.racePaceAnchor, "RG");
});

test("resolveAllAnchors: resolves every anchor in a policy, including offset chains", () => {
  const resolved = resolveAllAnchors({
    RG: { kind: "absolute", pace_sec_per_km: 300 },
    FL: { kind: "offset", anchor: "RG", offset_sec_per_km: 45 },
  });
  assert.deepEqual(resolved, { RG: 300, FL: 345 });
});
