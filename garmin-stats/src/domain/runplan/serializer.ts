// ── RunPlan DSL v1 — segment-level serializer (HRA-234) ─────────────────────
// AST → DSL, the inverse of parser.ts's token parsers (parseTarget/
// parseIntensity/parseSegment) — didn't exist before this Story. Used by the
// structured field editors (HRA-229/230/232) to regenerate a segment's DSL
// text from an edited Target/Intensity/reps/RestSpec, so an edit updates the
// typed model first and lets this module render it back to text, rather than
// hand-splicing strings at each call site. Pure logic, no I/O — mirrors
// parser.ts's own convention. See docs/runplan-dsl.md.
//
// Textual identity with the original raw_dsl is NOT a goal (docs/runplan-dsl.md
// documents the grammar as accepting many equivalent spellings) — only that
// the output re-parses to a semantically equivalent value. Every format*
// function below picks one canonical, always-reparseable spelling.

import type { Intensity, OffsetUnit, RestSpec, Target, WorkoutSegment } from "./types.ts";

const KM_PER_MILE = 1.60934; // HRA-108 §11.3/§13 — pace/offset normalization, mirrors parser.ts

// distance_m -> the smallest-noise compact token DISTANCE_RE accepts: whole
// km when it divides evenly, otherwise plain meters (never a fractional km,
// which would print ugly trailing decimals for values like 1234m).
export function formatDistanceTarget(distance_m: number): string {
  return distance_m % 1000 === 0 ? `${distance_m / 1000}km` : `${distance_m}m`;
}

// duration_sec -> the largest whole unit DURATION_RE accepts (h > min > s) —
// mirrors formatDistanceTarget's "largest unit that divides evenly" choice.
export function formatDurationTarget(duration_sec: number): string {
  if (duration_sec % 3600 === 0) return `${duration_sec / 3600}h`;
  if (duration_sec % 60 === 0) return `${duration_sec / 60}min`;
  return `${duration_sec}s`;
}

export function serializeTarget(target: Target): string {
  if (target.kind === "unknown") return target.raw; // "?" or an unrecognized token — nothing to regenerate
  return target.kind === "distance" ? formatDistanceTarget(target.distance_m) : formatDurationTarget(target.duration_sec);
}

// pace_sec_per_km -> "M:SS/km" (ABS_PACE_RE). Always km, regardless of the
// plan's display unit — semantic equivalence, not textual identity, is the
// contract (docs/runplan-dsl.md), and pace_sec_per_km is already stored
// per-km internally, so this is the direct, lossless spelling.
export function formatAbsoluteIntensity(pace_sec_per_km: number): string {
  const totalSec = Math.round(pace_sec_per_km);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}/km`;
}

// AC3 (HRA-234): preserves the anchor name — only the numeric offset changes.
// No explicit unit suffix is emitted (OFFSET_RE's unit is optional, falling
// back to the parse context's own offset_unit) — correct as long as the
// caller always serializes with the SAME offsetUnit the day will be
// re-parsed under (plan.metadata.offset_unit), which every call site here
// does.
export function formatOffsetIntensity(anchor: string, offset_sec_per_km: number, offsetUnit: OffsetUnit): string {
  const amountInUnit = offsetUnit === "s/km" ? offset_sec_per_km : offset_sec_per_km * KM_PER_MILE;
  const sign = amountInUnit < 0 ? "-" : "+";
  const magnitude = Math.round(Math.abs(amountInUnit) * 100) / 100;
  return `${anchor}${sign}${magnitude}`;
}

export function formatAnchorIntensity(anchor: string): string {
  return anchor;
}

export function serializeIntensity(intensity: Intensity, offsetUnit: OffsetUnit): string {
  switch (intensity.kind) {
    case "unknown": return intensity.raw; // "?" or an unrecognized token
    case "anchor": return formatAnchorIntensity(intensity.anchor);
    case "offset": return formatOffsetIntensity(intensity.anchor, intensity.offset_sec_per_km, offsetUnit);
    case "absolute": return formatAbsoluteIntensity(intensity.pace_sec_per_km);
  }
}

function serializeRestSpec(rest: RestSpec, offsetUnit: OffsetUnit): string {
  const targetPart = serializeTarget(rest.target);
  const intensityPart = rest.intensity ? ` @ ${serializeIntensity(rest.intensity, offsetUnit)}` : "";
  const restTypePart = rest.rest_type ? ` ${rest.rest_type}` : "";
  return `r:${targetPart}${intensityPart}${restTypePart}`;
}

// Inverts parseSegment's four shapes (parser.ts). offsetUnit must be the
// owning day's effective PACE offset unit (plan.metadata.offset_unit) — the
// same value parseIntensity/parseDayEntry use as their own fallback, so an
// offset intensity serialized here reparses to the identical offset_sec_per_km.
export function serializeSegment(segment: WorkoutSegment, offsetUnit: OffsetUnit): string {
  switch (segment.type) {
    case "continuous":
      return `${serializeTarget(segment.target)} @ ${serializeIntensity(segment.intensity, offsetUnit)}`;
    case "interval": {
      const reps = segment.reps == null ? "?" : String(segment.reps);
      const restPart = segment.rest ? ` ${serializeRestSpec(segment.rest, offsetUnit)}` : "";
      return `${reps}x${serializeTarget(segment.work_target)} @ ${serializeIntensity(segment.work_intensity, offsetUnit)}${restPart}`;
    }
    case "progression":
      return `${serializeTarget(segment.target)} PROG ${serializeIntensity(segment.start_intensity, offsetUnit)} -> ${serializeIntensity(segment.end_intensity, offsetUnit)}`;
    case "rest_block":
      return `REST ${serializeTarget(segment.target)}${segment.rest_type ? ` ${segment.rest_type}` : ""}`;
  }
}

// A whole day's `;`-joined segment list (the DAY_RE workout-text body, before
// any trailing "# note") — mirrors parser.ts's own `workoutText.split(";")`
// on the way back out.
export function serializeDayBody(segments: WorkoutSegment[], offsetUnit: OffsetUnit): string {
  return segments.map(seg => serializeSegment(seg, offsetUnit)).join(" ; ");
}
