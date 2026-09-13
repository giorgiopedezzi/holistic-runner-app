// ── Structured quality-workout evidence alignment (HRA-342) ─────────────────
// Pure, no I/O. Aligns a canonical work/recovery structure (quality-workout.ts)
// against the approved reliable-evidence hierarchy:
//   1. executed workout steps (structured FIT evidence)
//   2. deterministic activity laps
//   3. runner-confirmed manual alignment
//   4. unavailable
// Tiers 1/2 are real, typed inputs a future ingestion Story can populate
// (garmin-stats currently persists neither executed workout steps nor laps —
// see docs/ingestion.md / db.ts: only track_points exist today), but this
// resolver is already correct and tested against them via synthetic fixtures.
// Tier 3 (manual alignment) is the one reliable source this Story actually
// wires to real persistence (workout_segment_alignments — see
// repositories/workout-segment-alignments.repo.ts). Absence of evidence for a
// segment is a supported "unavailable" state, never invented from sample-level
// pace fluctuation (this Story's own explicit boundary).
import { aggregatePaceSecPerKm, type DistanceTimeRecord } from "./metrics.ts";
import type { CanonicalQualityStructure, CanonicalWorkSegment, QualityWorkoutKind } from "./quality-workout.ts";

export type SegmentEvidenceProvenance = "executed_step" | "lap" | "manual" | "unavailable";

export interface ExecutedStepEvidence { segmentIndex: number; distanceM: number | null; durationSec: number | null }
export interface LapEvidence { segmentIndex: number; distanceM: number | null; durationSec: number | null }
export interface ManualSegmentAlignment { segmentIndex: number; activityId: number; distanceM: number | null; durationSec: number | null }

export interface QualityEvidenceInputs {
  executedSteps?: ExecutedStepEvidence[];
  laps?: LapEvidence[];
  manual?: ManualSegmentAlignment[];
}

export interface AlignedActual {
  provenance: SegmentEvidenceProvenance;
  activityId: number | null;
  distanceM: number | null;
  durationSec: number | null;
  paceSecPerKm: number | null;
}

export interface AlignedWorkSegment {
  segment: CanonicalWorkSegment;
  actual: AlignedActual;
}

export interface StructuredQualityTotals {
  plannedWorkDistanceM: number;
  plannedWorkDurationSec: number;
  actualWorkDistanceM: number; // sum over reliably aligned WORK segments only (AC13)
  actualWorkDurationSec: number;
  weightedActualPaceSecPerKm: number | null; // distance-total / time-total over aligned work segments, never an average of per-rep paces
  paceSpreadSecPerKm: { fastest: number; slowest: number } | null; // "repetition" kind only, 2+ aligned work reps
  progressivelyFaster: boolean | null; // "progressive" kind only, 2+ aligned phases; null when fewer
  coverage: { totalWorkSegments: number; alignedWorkSegments: number };
}

export interface StructuredQualityComparison {
  kind: QualityWorkoutKind;
  available: boolean; // true iff at least one work segment has reliable (non-"unavailable") actual evidence
  segments: AlignedWorkSegment[];
  totals: StructuredQualityTotals;
  // Whole-session average pace, carried through as CONTEXT only — never
  // compared against a work-segment target or treated as adherence (AC6).
  wholeSessionPaceSecPerKm: number | null;
}

function paceOf(distanceM: number | null, durationSec: number | null): number | null {
  return distanceM != null && distanceM > 0 && durationSec != null && durationSec > 0 ? durationSec / (distanceM / 1000) : null;
}

function resolveSegment(segmentIndex: number, inputs: QualityEvidenceInputs): AlignedActual {
  const step = inputs.executedSteps?.find(e => e.segmentIndex === segmentIndex);
  if (step) return { provenance: "executed_step", activityId: null, distanceM: step.distanceM, durationSec: step.durationSec, paceSecPerKm: paceOf(step.distanceM, step.durationSec) };

  const lap = inputs.laps?.find(l => l.segmentIndex === segmentIndex);
  if (lap) return { provenance: "lap", activityId: null, distanceM: lap.distanceM, durationSec: lap.durationSec, paceSecPerKm: paceOf(lap.distanceM, lap.durationSec) };

  const manual = inputs.manual?.find(m => m.segmentIndex === segmentIndex);
  if (manual) return { provenance: "manual", activityId: manual.activityId, distanceM: manual.distanceM, durationSec: manual.durationSec, paceSecPerKm: paceOf(manual.distanceM, manual.durationSec) };

  return { provenance: "unavailable", activityId: null, distanceM: null, durationSec: null, paceSecPerKm: null };
}

export function buildStructuredQualityComparison(
  structure: CanonicalQualityStructure, inputs: QualityEvidenceInputs, wholeSessionPaceSecPerKm: number | null,
): StructuredQualityComparison {
  const segments: AlignedWorkSegment[] = structure.segments.map(segment => ({ segment, actual: resolveSegment(segment.index, inputs) }));

  const workSegments = segments.filter(s => s.segment.role === "work");
  const alignedWork = workSegments.filter(s => s.actual.provenance !== "unavailable");

  const plannedWorkDistanceM = workSegments.reduce((sum, s) => sum + (s.segment.targetDistanceM ?? 0), 0);
  const plannedWorkDurationSec = workSegments.reduce((sum, s) => sum + (s.segment.targetDurationSec ?? 0), 0);
  const actualWorkDistanceM = alignedWork.reduce((sum, s) => sum + (s.actual.distanceM ?? 0), 0);
  const actualWorkDurationSec = alignedWork.reduce((sum, s) => sum + (s.actual.durationSec ?? 0), 0);

  const records: DistanceTimeRecord[] = alignedWork.map(s => ({ distanceM: s.actual.distanceM, timeSec: s.actual.durationSec }));
  const weightedActualPaceSecPerKm = aggregatePaceSecPerKm(records);

  const alignedPaces = alignedWork.map(s => s.actual.paceSecPerKm).filter((p): p is number => p != null);
  const paceSpreadSecPerKm = structure.kind === "repetition" && alignedPaces.length >= 2
    ? { fastest: Math.min(...alignedPaces), slowest: Math.max(...alignedPaces) }
    : null;

  let progressivelyFaster: boolean | null = null;
  if (structure.kind === "progressive" && alignedWork.length >= 2) {
    progressivelyFaster = true;
    for (let i = 1; i < alignedWork.length; i++) {
      const prev = alignedWork[i - 1].actual.paceSecPerKm;
      const curr = alignedWork[i].actual.paceSecPerKm;
      if (prev == null || curr == null || curr >= prev) { progressivelyFaster = false; break; }
    }
  }

  return {
    kind: structure.kind,
    available: alignedWork.length > 0,
    segments,
    totals: {
      plannedWorkDistanceM, plannedWorkDurationSec, actualWorkDistanceM, actualWorkDurationSec,
      weightedActualPaceSecPerKm, paceSpreadSecPerKm, progressivelyFaster,
      coverage: { totalWorkSegments: workSegments.length, alignedWorkSegments: alignedWork.length },
    },
    wholeSessionPaceSecPerKm,
  };
}
