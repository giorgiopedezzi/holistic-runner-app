import type { ResolvedSegment, Target } from "@/types/runplan";

export interface PaceTargetBand {
  kind: "band";
  startDistanceM: number;
  endDistanceM: number;
  startTargetPaceSecPerKm: number;
  endTargetPaceSecPerKm: number;
  startPaceLowerSecPerKm: number;
  startPaceUpperSecPerKm: number;
  endPaceLowerSecPerKm: number;
  endPaceUpperSecPerKm: number;
}

export interface PaceTargetGap {
  kind: "gap";
  startDistanceM: number;
  endDistanceM: number;
}

export type PaceTargetPiece = PaceTargetBand | PaceTargetGap;

export interface PaceTargetBandModel {
  pieces: PaceTargetPiece[];
  totalDistanceM: number;
}

export interface PaceTargetStats {
  fastestPaceSecPerKm: number;
  meanPaceSecPerKm: number;
  slowestPaceSecPerKm: number;
}

const M_PER_KM = 1000;
const LOWER_PACE_FACTOR = 0.98;
const UPPER_PACE_FACTOR = 1.02;

function validPace(paceSecPerKm: number | null | undefined): paceSecPerKm is number {
  return paceSecPerKm != null && Number.isFinite(paceSecPerKm) && paceSecPerKm > 0;
}

function distanceFor(target: Target, paceSecPerKm: number | null | undefined): number | null {
  if (target.kind === "distance") return Number.isFinite(target.distance_m) && target.distance_m >= 0 ? target.distance_m : null;
  if (target.kind !== "duration" || !validPace(paceSecPerKm)) return null;
  if (!Number.isFinite(target.duration_sec) || target.duration_sec < 0) return null;
  return (target.duration_sec / paceSecPerKm) * M_PER_KM;
}

export function computePaceTargetStats(bands: PaceTargetBand[]): PaceTargetStats | null {
  if (bands.length === 0) return null;
  let weightedPace = 0;
  let totalDistanceM = 0;
  let fastestPaceSecPerKm = Infinity;
  let slowestPaceSecPerKm = -Infinity;

  for (const band of bands) {
    const distanceM = band.endDistanceM - band.startDistanceM;
    const meanBandPace = (band.startTargetPaceSecPerKm + band.endTargetPaceSecPerKm) / 2;
    weightedPace += meanBandPace * distanceM;
    totalDistanceM += distanceM;
    fastestPaceSecPerKm = Math.min(fastestPaceSecPerKm, band.startTargetPaceSecPerKm, band.endTargetPaceSecPerKm);
    slowestPaceSecPerKm = Math.max(slowestPaceSecPerKm, band.startTargetPaceSecPerKm, band.endTargetPaceSecPerKm);
  }

  return {
    fastestPaceSecPerKm,
    meanPaceSecPerKm: weightedPace / totalDistanceM,
    slowestPaceSecPerKm,
  };
}

export function buildPaceTargetBandModel(segments: ResolvedSegment[]): PaceTargetBandModel {
  const pieces: PaceTargetPiece[] = [];
  let distanceM = 0;

  const appendLeg = (
    target: Target,
    startPaceSecPerKm: number | null | undefined,
    endPaceSecPerKm = startPaceSecPerKm,
    distanceOverride?: number | null,
  ) => {
    const rawLegDistanceM = distanceOverride === undefined
      ? distanceFor(target, startPaceSecPerKm)
      : distanceOverride;
    const legDistanceM = rawLegDistanceM != null && Number.isFinite(rawLegDistanceM) && rawLegDistanceM >= 0
      ? rawLegDistanceM
      : null;
    const startDistanceM = distanceM;
    const endDistanceM = legDistanceM == null ? distanceM : distanceM + legDistanceM;

    if (legDistanceM != null && legDistanceM > 0 && validPace(startPaceSecPerKm) && validPace(endPaceSecPerKm)) {
      pieces.push({
        kind: "band",
        startDistanceM,
        endDistanceM,
        startTargetPaceSecPerKm: startPaceSecPerKm,
        endTargetPaceSecPerKm: endPaceSecPerKm,
        startPaceLowerSecPerKm: startPaceSecPerKm * LOWER_PACE_FACTOR,
        startPaceUpperSecPerKm: startPaceSecPerKm * UPPER_PACE_FACTOR,
        endPaceLowerSecPerKm: endPaceSecPerKm * LOWER_PACE_FACTOR,
        endPaceUpperSecPerKm: endPaceSecPerKm * UPPER_PACE_FACTOR,
      });
    } else {
      pieces.push({ kind: "gap", startDistanceM, endDistanceM });
    }
    distanceM = endDistanceM;
  };

  for (const segment of segments) {
    switch (segment.type) {
      case "continuous":
        appendLeg(segment.target, segment.resolved_pace_sec_per_km);
        break;
      case "interval":
        if (segment.reps == null || segment.reps <= 0) {
          pieces.push({ kind: "gap", startDistanceM: distanceM, endDistanceM: distanceM });
          break;
        }
        for (let repetition = 0; repetition < segment.reps; repetition++) {
          appendLeg(segment.work_target, segment.work_resolved_pace_sec_per_km);
          if (segment.rest) appendLeg(segment.rest.target, segment.rest.resolved_pace_sec_per_km);
        }
        break;
      case "progression": {
        // A duration plus two changing endpoint paces has no single resolved
        // pace with which to convert time to distance without inventing an
        // interpolation rule. Only its prescribed distance is deterministic.
        const progressionDistanceM = segment.target.kind === "distance" ? segment.target.distance_m : null;
        appendLeg(
          segment.target,
          segment.start_resolved_pace_sec_per_km,
          segment.end_resolved_pace_sec_per_km,
          progressionDistanceM,
        );
        break;
      }
      case "rest_block":
        appendLeg(segment.target, null);
        break;
    }
  }

  return { pieces, totalDistanceM: distanceM };
}
