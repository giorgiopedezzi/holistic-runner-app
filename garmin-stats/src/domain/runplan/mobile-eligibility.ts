// ── RunPlan DSL v1 — mobile simplified-creation eligibility (HRA-302) ───────
// Determines, from the template's own domain data, whether the mobile
// simplified race-plan creation flow can safely offer this template: does it
// leave exactly one pace anchor symbolic (unbound/never declared) anywhere
// it's referenced, and does supplying that single anchor make every day
// resolve with no needs_review left? Reuses pace.ts/instantiate.ts's own
// resolver rather than re-deriving anchor/offset math — this module only
// classifies the *result* of that resolver, never repeats its logic.
import type { Intensity, PacePolicy, RunPlan, WorkoutSegment } from "./types.ts";
import { getEffectivePacePolicy, resolveIntensityToPace } from "./pace.ts";
import { instantiatePlan } from "./instantiate.ts";

export interface MobileEligibility {
  eligible: boolean;
  racePaceAnchor: string | null;
  reason?: "already-resolved" | "ambiguous-anchors" | "unresolvable";
}

// A pace's ok/fail resolution outcome never depends on the numeric value
// behind an absolute anchor, only on whether every anchor referenced,
// directly or through an offset chain, eventually reaches one. So a
// placeholder value is exactly as conclusive as a real goal time for this
// structural check (HRA-302's own "evaluate structurally where possible").
const PLACEHOLDER_PACE_SEC_PER_KM = 300;

// Every Intensity a day's segments can carry — mirrors instantiate.ts's own
// resolveSegment switch (which fields hold an Intensity), without repeating
// any resolution math: the actual resolve call below is the same
// resolveIntensityToPace instantiate.ts/pace.ts already export.
function collectIntensities(segment: WorkoutSegment): Intensity[] {
  switch (segment.type) {
    case "continuous": return [segment.intensity];
    case "interval": return [segment.work_intensity, ...(segment.rest?.intensity ? [segment.rest.intensity] : [])];
    case "progression": return [segment.start_intensity, segment.end_intensity];
    case "rest_block": return [];
  }
}

// Every distinct anchor name that actually fails to resolve somewhere in the
// plan, against each day's own effective (section/week-merged) policy — not
// just anchors declared at plan level. Catches both an explicit `PACE X=TBD`
// and an anchor some day references that no PACE line at any scope ever
// declared (types.ts's UnboundPace doc comment: template parsing treats both
// identically as "supply a value at instantiation").
function findUnresolvedAnchors(plan: RunPlan): Set<string> {
  const unresolved = new Set<string>();
  for (const section of plan.sections) {
    for (const week of section.weeks) {
      const policy = getEffectivePacePolicy(plan, section, week);
      for (const day of week.days) {
        for (const segment of day.segments) {
          for (const intensity of collectIntensities(segment)) {
            const result = resolveIntensityToPace(intensity, policy);
            if (!result.ok && result.anchor) unresolved.add(result.anchor);
          }
        }
      }
    }
  }
  return unresolved;
}

export function computeMobileEligibility(plan: RunPlan): MobileEligibility {
  const unresolved = [...findUnresolvedAnchors(plan)];

  if (unresolved.length === 0) {
    // No unresolved anchor found — confirm via instantiatePlan too, since a
    // day can still have needs_review true for a non-pace reason (e.g. a
    // parser warning carried on the DayEntry itself).
    const days = instantiatePlan(plan, { startDate: "2000-01-01" });
    return days.every(d => !d.needs_review)
      ? { eligible: true, racePaceAnchor: null, reason: "already-resolved" }
      : { eligible: false, racePaceAnchor: null, reason: "unresolvable" };
  }

  if (unresolved.length > 1) {
    return { eligible: false, racePaceAnchor: null, reason: "ambiguous-anchors" };
  }

  const [racePaceAnchor] = unresolved;
  const paceOverrides: PacePolicy = { [racePaceAnchor]: { kind: "absolute", pace_sec_per_km: PLACEHOLDER_PACE_SEC_PER_KM } };
  const days = instantiatePlan(plan, { startDate: "2000-01-01", paceOverrides });
  return days.every(d => !d.needs_review)
    ? { eligible: true, racePaceAnchor }
    : { eligible: false, racePaceAnchor: null, reason: "unresolvable" };
}

// Every anchor declared at plan level, resolved to a concrete pace under the
// given (already-overridden) policy — used by the mobile review step to show
// "every resolved pace required by the plan" (HRA-302 AC3) the same way
// HRA-294's race-plan summary already displays them (`RG 5:16/km · FL …`).
export function resolveAllAnchors(policy: PacePolicy): Record<string, number> {
  const resolved: Record<string, number> = {};
  for (const anchor of Object.keys(policy)) {
    const result = resolveIntensityToPace({ kind: "anchor", anchor, raw: anchor }, policy);
    if (result.ok) resolved[anchor] = result.pace_sec_per_km;
  }
  return resolved;
}
