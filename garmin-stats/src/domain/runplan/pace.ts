// ── RunPlan DSL v1 — pace resolution ────────────────────────────────────────
// Scoped pace inheritance (Plan → Section → Week) and anchor/offset resolution.
// Kept separate from parsing (pace.ts has no knowledge of DSL syntax) so a
// future "edit one day" UI flow can re-resolve pace without re-parsing anything.

import type { Intensity, PacePolicy, RunPlan, Section, Week } from "./types.ts";

export type PaceResolutionResult =
  | { ok: true; pace_sec_per_km: number }
  | { ok: false; error: string; deliberatelyUnbound?: boolean };

// Shallow merge by anchor name — child scopes override parent scopes.
export function getEffectivePacePolicy(plan: RunPlan, section: Section, week: Week): PacePolicy {
  return {
    ...plan.metadata.pace_policy,
    ...section.pace_policy,
    ...week.pace_policy,
  };
}

// Resolves a single anchor name to a concrete pace, following offset chains
// (e.g. FL = RG+45s/km, RG = 4:16/km) and detecting circular references.
// Shared by resolveIntensityToPace's anchor/offset branches and by the
// parser's proactive per-scope circularity check (detectCircularPaceRefs).
function resolveAnchor(anchor: string, policy: PacePolicy, visited: Set<string>): PaceResolutionResult {
  if (visited.has(anchor)) {
    return { ok: false, error: `Circular pace reference detected: ${[...visited, anchor].join(" -> ")}` };
  }
  const value = policy[anchor];
  if (!value) {
    return { ok: false, error: `Unknown pace anchor: ${anchor}` };
  }
  if (value.kind === "absolute") {
    return { ok: true, pace_sec_per_km: value.pace_sec_per_km };
  }
  if (value.kind === "unbound") {
    return {
      ok: false, deliberatelyUnbound: true,
      error: `Pace anchor "${anchor}" is marked TBD — provide a value when instantiating.`,
    };
  }
  const base = resolveAnchor(value.anchor, policy, new Set(visited).add(anchor));
  if (!base.ok) return base;
  return { ok: true, pace_sec_per_km: base.pace_sec_per_km + value.offset_sec_per_km };
}

export function resolveIntensityToPace(intensity: Intensity, policy: PacePolicy): PaceResolutionResult {
  if (intensity.kind === "absolute") {
    return { ok: true, pace_sec_per_km: intensity.pace_sec_per_km };
  }
  if (intensity.kind === "unknown") {
    return { ok: false, error: "Intensity is unspecified." };
  }
  const base = resolveAnchor(intensity.anchor, policy, new Set());
  if (intensity.kind === "anchor") {
    return base;
  }
  // offset
  if (!base.ok) return base;
  return { ok: true, pace_sec_per_km: base.pace_sec_per_km + intensity.offset_sec_per_km };
}

// Proactive check, run by the parser whenever a scope's own pace_policy is
// finalized (HRA-108 §5.6): every anchor DEFINED at this scope must resolve
// without a cycle against the scope's own effective (already-merged) policy,
// even if no day ever references it — a cycle is a validation error on its
// own, not something that should wait to be discovered lazily.
export function detectCircularPaceRefs(policy: PacePolicy): string[] {
  const circular: string[] = [];
  for (const anchor of Object.keys(policy)) {
    const result = resolveAnchor(anchor, policy, new Set());
    if (!result.ok && result.error.startsWith("Circular")) {
      circular.push(anchor);
    }
  }
  return circular;
}
