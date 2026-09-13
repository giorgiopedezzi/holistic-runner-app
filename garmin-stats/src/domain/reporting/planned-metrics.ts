// ── Shared reporting domain — planned distance/duration (HRA-335, AC8) ──────
// Pure, no I/O. Mirrors garmin-dashboard/src/domain/runplan-aggregate.ts's
// CURRENT distanceFromResolvedSegment/durationFromResolvedSegment behavior
// (not its own stale top-of-file comment — the interval REST leg is real
// ground/clock time actually covered between reps and IS included, per that
// file's own "Bug fix" note) so a plan's distance/duration total is never
// computed two different ways depending on which side of the stack asks.
// Backend and frontend are separate packages (no shared workspace import),
// so this is a deliberate port, not a re-export — same "mirrors X" convention
// workout-metrics.ts already uses for its own frontend-parity functions.
import type { ResolvedSegment } from "../runplan/instantiate.ts";
import type { Target } from "../runplan/types.ts";

export interface DistanceTotal { meters: number; approximate: boolean }

const M_PER_KM = 1000;

function distanceFromTarget(target: Target, resolvedPaceSecPerKm: number | null | undefined): DistanceTotal | null {
  if (target.kind === "unknown") return null;
  if (target.kind === "distance") return { meters: target.distance_m, approximate: false };
  if (resolvedPaceSecPerKm == null) return null;
  return { meters: (target.duration_sec / resolvedPaceSecPerKm) * M_PER_KM, approximate: true };
}

function durationFromTarget(target: Target, resolvedPaceSecPerKm: number | null | undefined): number | null {
  if (target.kind === "unknown") return null;
  if (target.kind === "duration") return target.duration_sec;
  if (resolvedPaceSecPerKm == null) return null;
  return (target.distance_m / M_PER_KM) * resolvedPaceSecPerKm;
}

function sumDistances(parts: (DistanceTotal | null)[]): DistanceTotal {
  let meters = 0;
  let approximate = false;
  for (const part of parts) {
    if (!part) continue;
    meters += part.meters;
    approximate = approximate || part.approximate;
  }
  return { meters, approximate };
}

export function distanceFromResolvedSegment(seg: ResolvedSegment): DistanceTotal | null {
  switch (seg.type) {
    case "continuous":
      return distanceFromTarget(seg.target, seg.resolved_pace_sec_per_km);
    case "interval": {
      if (seg.reps == null) return null;
      const work = distanceFromTarget(seg.work_target, seg.work_resolved_pace_sec_per_km);
      if (!work) return null;
      const rest = seg.rest ? distanceFromTarget(seg.rest.target, seg.rest.resolved_pace_sec_per_km) : null;
      return { meters: (work.meters + (rest?.meters ?? 0)) * seg.reps, approximate: work.approximate || (rest?.approximate ?? false) };
    }
    case "progression":
      return distanceFromTarget(seg.target, seg.start_resolved_pace_sec_per_km);
    case "rest_block":
      return distanceFromTarget(seg.target, null);
  }
}

export function durationFromResolvedSegment(seg: ResolvedSegment): number | null {
  switch (seg.type) {
    case "continuous":
      return durationFromTarget(seg.target, seg.resolved_pace_sec_per_km);
    case "interval": {
      if (seg.reps == null) return null;
      const workDur = durationFromTarget(seg.work_target, seg.work_resolved_pace_sec_per_km);
      if (workDur == null) return null;
      const restDur = seg.rest ? durationFromTarget(seg.rest.target, seg.rest.resolved_pace_sec_per_km) : null;
      return (workDur + (restDur ?? 0)) * seg.reps;
    }
    case "progression":
      return durationFromTarget(seg.target, seg.start_resolved_pace_sec_per_km);
    case "rest_block":
      return durationFromTarget(seg.target, null);
  }
}

// workout_type gate mirrors computeResolvedDayDistance's own dispatch —
// CROSS/STRENGTH/REST/TODO/OTHER never carry a resolvable run distance here;
// this Story's metric set is scoped to "run" workouts (the only type the
// Actual side can ever have evidence for — see workout-association.ts).
export function computePlannedDayDistance(workoutType: string, segments: ResolvedSegment[]): DistanceTotal {
  if (workoutType !== "run") return { meters: 0, approximate: false };
  return sumDistances(segments.map(distanceFromResolvedSegment));
}

export function computePlannedDayDurationSec(workoutType: string, segments: ResolvedSegment[]): number {
  if (workoutType !== "run") return 0;
  return segments.map(durationFromResolvedSegment).filter((d): d is number => d != null).reduce((a, b) => a + b, 0);
}
