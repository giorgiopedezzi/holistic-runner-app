import type { ResolvedSegment, RestType, Target } from "@/types/runplan";
import { getUnitSystem, kmhToMph, paceKmToMi } from "@/utils/units";
import type { SpeedMode } from "./activity-chart";

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
  // Only ever set for an interval/rest_block rest leg — a plain unpaced
  // continuous/progression leg's gap carries neither. restDurationSec is
  // only populated for a "stand" rest given as a duration target — a
  // standing rest has no pace to convert duration -> distance with, so this
  // gap is real (zero-width): distance must stay exact, never inflated to
  // make room for a marker. The chart places the "stand" flag AT this point
  // rather than reserving space for it.
  restType?: RestType;
  restDurationSec?: number;
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
    restType?: RestType,
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
      const restDurationSec = restType === "stand" && target.kind === "duration" ? target.duration_sec : undefined;
      pieces.push({ kind: "gap", startDistanceM, endDistanceM, restType, restDurationSec });
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
          if (segment.rest) {
            appendLeg(
              segment.rest.target, segment.rest.resolved_pace_sec_per_km,
              segment.rest.resolved_pace_sec_per_km, undefined, segment.rest.rest_type,
            );
          }
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
        appendLeg(segment.target, null, null, undefined, segment.rest_type);
        break;
    }
  }

  return { pieces, totalDistanceM: distanceM };
}

// HRA-207: converts each band's +/-2% pace bounds into the same display unit
// the main activity chart's Speed/Pace axis already uses (`activity-chart.ts`'s
// `metricValue` for key "speed"), so the overlay Area can share that axis
// with the real speed/pace Line without a second, independent conversion
// path. One two-point array per band (own `data` prop on each <Area>, same
// pattern PlannedPaceTargetChart.tsx's bandPoints() already uses) rather than
// one flat array, so a rest-leg gap between bands never draws a connecting
// line across it.
export interface PlannedOverlayBand {
  points: { x: number; range: [number, number] }[];
}

function paceSecPerKmToDisplay(paceSecPerKm: number, speedMode: SpeedMode, imperial: boolean): number {
  if (speedMode === "speed") {
    const kmh = 3600 / paceSecPerKm;
    return imperial ? kmhToMph(kmh) : kmh;
  }
  const paceMinKm = paceSecPerKm / 60;
  return imperial ? paceKmToMi(paceMinKm) : paceMinKm;
}

export function buildPlannedOverlayBands(model: PaceTargetBandModel, speedMode: SpeedMode): PlannedOverlayBand[] {
  const imperial = getUnitSystem() === "imperial";
  const toDisplay = (paceSecPerKm: number) => paceSecPerKmToDisplay(paceSecPerKm, speedMode, imperial);
  const range = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);
  const bands = model.pieces.filter((piece): piece is PaceTargetBand => piece.kind === "band");
  return bands.map(band => ({
    points: [
      { x: band.startDistanceM, range: range(toDisplay(band.startPaceLowerSecPerKm), toDisplay(band.startPaceUpperSecPerKm)) },
      { x: band.endDistanceM, range: range(toDisplay(band.endPaceLowerSecPerKm), toDisplay(band.endPaceUpperSecPerKm)) },
    ],
  }));
}
