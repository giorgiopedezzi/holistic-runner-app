// ── Structured quality-workout canonical structure (HRA-342) ────────────────
// Pure, no I/O. Translates a resolved planned-workout day (the SAME
// ResolvedSegment[] instantiate.ts already produces — never a second parse of
// the DSL, never a reparse of display labels/day prefixes like "D1:") into a
// canonical, workout-type-specific work/recovery structure suitable for
// reporting. This module owns classification + structure only; aligning
// actual evidence against this structure lives in quality-evidence.ts.
import type { ResolvedSegment } from "../runplan/instantiate.ts";
import type { RestType, Target } from "../runplan/types.ts";
import { distanceFromTarget, durationFromTarget } from "./planned-metrics.ts";

export type QualityWorkoutKind = "repetition" | "threshold" | "tempo" | "progressive";

export interface CanonicalWorkSegment {
  index: number; // 0-based, stable within THIS day's own canonical structure
  role: "work" | "recovery";
  targetDistanceM: number | null;
  targetDurationSec: number | null;
  targetPaceSecPerKm: number | null; // start pace for a progressive phase; the only pace for everything else
  targetPaceSecPerKmEnd: number | null; // progressive phases only — equals targetPaceSecPerKm for every other kind
  restType?: RestType; // recovery segments only
}

export interface CanonicalQualityStructure {
  kind: QualityWorkoutKind;
  segments: CanonicalWorkSegment[];
}

export interface QualityWorkoutDayInput {
  category?: string;
  segments: ResolvedSegment[];
}

const THRESHOLD_CATEGORY_RE = /threshold|cruise/i;
const REPETITION_CATEGORY_RE = /repetition|repeats?|interval/i;
const PROGRESSIVE_CATEGORY_RE = /progress/i;

// AC2: classification comes ONLY from the day's own structured DSL data (its
// resolved segment shapes, plus the optional `[tag]` category the grammar
// already carries) — never from re-parsing `notes`/day-number display labels,
// and never from actual-execution pace samples (this Story's own explicit
// "no heuristic repetition detection" boundary).
export function classifyQualityWorkout(day: QualityWorkoutDayInput): QualityWorkoutKind | null {
  const intervalSegments = day.segments.filter((s): s is Extract<ResolvedSegment, { type: "interval" }> => s.type === "interval");
  if (intervalSegments.length > 0) {
    return day.category && THRESHOLD_CATEGORY_RE.test(day.category) ? "threshold" : "repetition";
  }

  const progressionSegments = day.segments.filter((s): s is Extract<ResolvedSegment, { type: "progression" }> => s.type === "progression");
  const continuousSegments = day.segments.filter((s): s is Extract<ResolvedSegment, { type: "continuous" }> => s.type === "continuous");

  if (progressionSegments.length === 1 && continuousSegments.length === 0) return "progressive";

  // A day authored as several increasingly-faster continuous legs (no single
  // `PROG` segment) is only read as "progressive" when the day's own category
  // says so — an untagged multi-leg day (e.g. warmup + main + cooldown) never
  // gets a progressive claim invented for it.
  if (continuousSegments.length >= 2 && day.category && PROGRESSIVE_CATEGORY_RE.test(day.category)) return "progressive";

  if (continuousSegments.length === 1 && progressionSegments.length === 0) return "tempo";

  return null;
}

function workEntry(
  index: number, target: Target, paceStart: number | null, paceEnd = paceStart,
): CanonicalWorkSegment {
  const distance = distanceFromTarget(target, paceStart);
  return {
    index, role: "work",
    targetDistanceM: distance?.meters ?? null,
    targetDurationSec: durationFromTarget(target, paceStart),
    targetPaceSecPerKm: paceStart, targetPaceSecPerKmEnd: paceEnd,
  };
}

function recoveryEntry(index: number, rest: Extract<ResolvedSegment, { type: "interval" }>["rest"]): CanonicalWorkSegment | null {
  if (!rest) return null;
  const distance = distanceFromTarget(rest.target, rest.resolved_pace_sec_per_km);
  return {
    index, role: "recovery",
    targetDistanceM: distance?.meters ?? null,
    targetDurationSec: durationFromTarget(rest.target, rest.resolved_pace_sec_per_km),
    targetPaceSecPerKm: rest.resolved_pace_sec_per_km, targetPaceSecPerKmEnd: rest.resolved_pace_sec_per_km,
    restType: rest.rest_type,
  };
}

// Builds the canonical work/recovery segment list for a day already
// classified by classifyQualityWorkout (returns null for an unclassified
// day — callers should check classifyQualityWorkout first). Repetition/
// threshold interval segments are expanded to one work(+recovery) entry PER
// REPETITION (never one row for the whole interval block) so a runner sees
// each rep individually, matching the Story's own "per-repetition pace" AC.
export function buildCanonicalQualityStructure(day: QualityWorkoutDayInput): CanonicalQualityStructure | null {
  const kind = classifyQualityWorkout(day);
  if (!kind) return null;

  const segments: CanonicalWorkSegment[] = [];
  let index = 0;

  if (kind === "repetition" || kind === "threshold") {
    for (const seg of day.segments) {
      if (seg.type !== "interval" || seg.reps == null || seg.reps <= 0) continue;
      for (let rep = 0; rep < seg.reps; rep++) {
        segments.push(workEntry(index++, seg.work_target, seg.work_resolved_pace_sec_per_km));
        const recovery = recoveryEntry(index, seg.rest);
        if (recovery) { segments.push(recovery); index++; }
      }
    }
    return { kind, segments };
  }

  if (kind === "tempo") {
    const seg = day.segments.find((s): s is Extract<ResolvedSegment, { type: "continuous" }> => s.type === "continuous");
    if (seg) segments.push(workEntry(index++, seg.target, seg.resolved_pace_sec_per_km));
    return { kind, segments };
  }

  // progressive: either one PROG segment (a single ramping phase, start/end
  // pace both carried on the same entry) or several continuous legs (one
  // phase per leg, each its own flat-pace entry) — never both at once, per
  // classifyQualityWorkout's own mutually-exclusive rules above.
  const progression = day.segments.find((s): s is Extract<ResolvedSegment, { type: "progression" }> => s.type === "progression");
  if (progression) {
    segments.push(workEntry(index++, progression.target, progression.start_resolved_pace_sec_per_km, progression.end_resolved_pace_sec_per_km));
    return { kind, segments };
  }
  for (const seg of day.segments) {
    if (seg.type !== "continuous") continue;
    segments.push(workEntry(index++, seg.target, seg.resolved_pace_sec_per_km));
  }
  return { kind, segments };
}
