// ── RunPlan DSL v1 — structured field editing (HRA-234) ─────────────────────
// Frontend mirror of garmin-stats/src/domain/runplan/serializer.ts (the new
// AST -> DSL segment serializer) plus a minimal mirror of parser.ts's own
// parseTarget/parseIntensity token parsers — this project has no shared
// client-type layer yet (Epic HRA-36), so pure domain logic that both sides
// need is hand-duplicated, same convention as runplan-aggregate.ts/
// runplan-patch.ts already establish for this exact module. Lets the
// Pace/Distance/Duration/Repetitions/Recovery structured fields (HRA-229/
// HRA-230/HRA-232) become editable without a round trip to the backend for
// every keystroke: parse the user's typed token locally, build the updated
// WorkoutSegment, serialize just that segment back to DSL text, and reparse
// it locally to verify semantic equivalence (docs/runplan-dsl.md's "textual
// identity is not required" contract) before it's ever applied to day.dsl.
import type { Intensity, OffsetUnit, RestSpec, Target, WorkoutSegment } from "@/types/runplan";

const KM_PER_MILE = 1.60934; // mirrors garmin-stats/src/domain/runplan/parser.ts's KM_PER_MILE
const SEC_PER_MIN = 60;
const SEC_PER_HOUR = 3600;

// ── serialize (mirrors serializer.ts) ───────────────────────────────────────

export function formatDistanceTarget(distance_m: number): string {
  return distance_m % 1000 === 0 ? `${distance_m / 1000}km` : `${distance_m}m`;
}

export function formatDurationTarget(duration_sec: number): string {
  if (duration_sec % 3600 === 0) return `${duration_sec / 3600}h`;
  if (duration_sec % 60 === 0) return `${duration_sec / 60}min`;
  return `${duration_sec}s`;
}

// Always the ORIGINAL token text (a Target's `raw`, set once by
// parseTargetToken and never touched again), never recomputed from
// distance_m/duration_sec — makeFieldCommit re-serializes a segment's WHOLE
// target on every field edit, including edits to a different field
// entirely (e.g. Pace), so recomputing here would silently rewrite an
// untouched distance's own unit (a mi-authored day's target turning into km
// the moment its pace was edited) or a duration's (min -> s). formatDistanceTarget/
// formatDurationTarget above stay exported only to keep this file's mirror
// of garmin-stats/src/domain/runplan/serializer.ts structurally 1:1.
export function serializeTarget(target: Target): string {
  return target.raw;
}

export function formatAbsoluteIntensity(pace_sec_per_km: number): string {
  const totalSec = Math.round(pace_sec_per_km);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}/km`;
}

// AC3 (HRA-234): the anchor name is preserved — only the numeric offset
// changes. No explicit unit suffix is emitted, same reasoning as the backend
// twin — every caller here always reparses with this same offsetUnit.
export function formatOffsetIntensity(anchor: string, offset_sec_per_km: number, offsetUnit: OffsetUnit): string {
  const amountInUnit = offsetUnit === "s/km" ? offset_sec_per_km : offset_sec_per_km * KM_PER_MILE;
  const sign = amountInUnit < 0 ? "-" : "+";
  const magnitude = Math.round(Math.abs(amountInUnit) * 100) / 100;
  return `${anchor}${sign}${magnitude}`;
}

export function serializeIntensity(intensity: Intensity, offsetUnit: OffsetUnit): string {
  switch (intensity.kind) {
    case "unknown": return intensity.raw;
    case "anchor": return intensity.anchor;
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

// ── parse (minimal mirror of parser.ts's parseTarget/parseIntensity) ───────
// Only what a structured field edit needs to turn typed text back into a
// value — not the whole day-line grammar (SECTION/WEEK/D<n>: parsing stays
// backend-only, reached via the existing /plan-templates/generate preview).

const DISTANCE_RE = /^(\d+(?:\.\d+)?)(m|km|mi)$/;
const DURATION_RE = /^(\d+(?:\.\d+)?)(s|sec|min|h)$/;
const APOSTROPHE_MIN_RE = /^(\d+(?:\.\d+)?)'$/;
const ABS_PACE_RE = /^(\d+):(\d{2})\/(km|mi)$/;
const OFFSET_RE = /^([A-Za-z0-9_]+)([+-])(\d+(?:\.\d+)?)(s\/km|s\/mi)?$/;
const ANCHOR_RE = /^[A-Za-z0-9_]+$/;
const M_PER_MILE = 1609.34;

// Strips ALL whitespace, not just leading/trailing — the structured fields'
// own display formatting (runplan-aggregate.ts's formatDistanceOrDurationValue)
// inserts a space before the unit ("10 km", "30 min") for readability, which
// the DSL grammar's own compact tokens never contain; edit fields are seeded
// from that same display string, so this parser must tolerate it back out.
function normalizeToken(token: string): string {
  return token.replace(/\s+/g, "");
}

export function parseTargetToken(token: string): Target {
  const trimmed = normalizeToken(token);
  let m = DISTANCE_RE.exec(trimmed);
  if (m) {
    const n = parseFloat(m[1]);
    const unit = m[2];
    const distance_m = unit === "m" ? n : unit === "km" ? n * 1000 : n * M_PER_MILE;
    return { kind: "distance", distance_m, raw: trimmed };
  }
  m = DURATION_RE.exec(trimmed);
  if (m) {
    const n = parseFloat(m[1]);
    const unit = m[2];
    const duration_sec = unit === "s" || unit === "sec" ? n : unit === "min" ? n * SEC_PER_MIN : n * SEC_PER_HOUR;
    return { kind: "duration", duration_sec, raw: trimmed };
  }
  m = APOSTROPHE_MIN_RE.exec(trimmed);
  if (m) return { kind: "duration", duration_sec: parseFloat(m[1]) * SEC_PER_MIN, raw: trimmed };
  return { kind: "unknown", raw: trimmed };
}

export function parseIntensityToken(token: string, offsetUnit: OffsetUnit): Intensity {
  const trimmed = normalizeToken(token);
  let m = ABS_PACE_RE.exec(trimmed);
  if (m) {
    const totalSec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    const pace_sec_per_km = m[3] === "km" ? totalSec : totalSec / KM_PER_MILE;
    return { kind: "absolute", pace_sec_per_km, raw: trimmed };
  }
  m = OFFSET_RE.exec(trimmed);
  if (m) {
    const anchor = m[1];
    const sign = m[2] === "+" ? 1 : -1;
    const amount = parseFloat(m[3]);
    const unit = (m[4] as OffsetUnit | undefined) ?? offsetUnit;
    const offset_sec_per_km = unit === "s/km" ? sign * amount : (sign * amount) / KM_PER_MILE;
    return { kind: "offset", anchor, offset_sec_per_km, raw: trimmed };
  }
  if (ANCHOR_RE.test(trimmed)) return { kind: "anchor", anchor: trimmed, raw: trimmed };
  return { kind: "unknown", raw: trimmed };
}

// AC6: an edit that would produce invalid/unrepresentable DSL is rejected —
// "invalid" here means the typed token can't be parsed back into a real
// Target/Intensity at all (kind "unknown"), OR round-tripping the freshly
// serialized value through this same parser doesn't reproduce an equivalent
// semantic value (belt-and-braces against a serializer/parser mismatch).
export function reparseTargetOk(target: Target): boolean {
  if (target.kind === "unknown") return false;
  const reparsed = parseTargetToken(serializeTarget(target));
  if (reparsed.kind !== target.kind) return false;
  return target.kind === "distance"
    ? reparsed.kind === "distance" && reparsed.distance_m === target.distance_m
    : reparsed.kind === "duration" && reparsed.duration_sec === (target as { duration_sec: number }).duration_sec;
}

export function reparseIntensityOk(intensity: Intensity, offsetUnit: OffsetUnit): boolean {
  if (intensity.kind === "unknown") return false;
  const reparsed = parseIntensityToken(serializeIntensity(intensity, offsetUnit), offsetUnit);
  if (reparsed.kind !== intensity.kind) return false;
  if (reparsed.kind === "anchor") return reparsed.anchor === (intensity as { anchor: string }).anchor;
  if (reparsed.kind === "offset") {
    const original = intensity as { anchor: string; offset_sec_per_km: number };
    return reparsed.anchor === original.anchor && Math.abs(reparsed.offset_sec_per_km - original.offset_sec_per_km) < 0.01;
  }
  const original = intensity as { pace_sec_per_km: number };
  return Math.abs((reparsed as { pace_sec_per_km: number }).pace_sec_per_km - original.pace_sec_per_km) < 1;
}

// ── structured field edits (HRA-234) ────────────────────────────────────────
// One function per editable field, each returning the WHOLE updated segment
// (never a partial patch) or null on an edit that doesn't round-trip (AC6 —
// TrainingPlanAccordion.tsx never applies a null result, so the prior valid
// segment/day.dsl is simply left in place). Scoped to continuous/interval
// segments only, per this Story's scope — progression/rest_block fields stay
// DSL-text-only (HRA-231's existing "unsupported in Structured view" marker).

export function applyDistanceOrDurationEdit(segment: WorkoutSegment, raw: string): WorkoutSegment | null {
  const target = parseTargetToken(raw);
  if (!reparseTargetOk(target)) return null;
  if (segment.type === "continuous") return { ...segment, target };
  if (segment.type === "interval") return { ...segment, work_target: target };
  return null;
}

export function applyPaceEdit(segment: WorkoutSegment, raw: string, offsetUnit: OffsetUnit): WorkoutSegment | null {
  const intensity = parseIntensityToken(raw, offsetUnit);
  if (!reparseIntensityOk(intensity, offsetUnit)) return null;
  if (segment.type === "continuous") return { ...segment, intensity };
  if (segment.type === "interval") return { ...segment, work_intensity: intensity };
  return null;
}

export function applyRepetitionsEdit(segment: WorkoutSegment, raw: string): WorkoutSegment | null {
  if (segment.type !== "interval") return null;
  const trimmed = raw.trim();
  if (trimmed === "?") return { ...segment, reps: null };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0) return null;
  return { ...segment, reps: n };
}

export function applyRecoveryTargetEdit(segment: WorkoutSegment, raw: string): WorkoutSegment | null {
  if (segment.type !== "interval" || !segment.rest) return null;
  const target = parseTargetToken(raw);
  if (!reparseTargetOk(target)) return null;
  return { ...segment, rest: { ...segment.rest, target } };
}

export function applyRecoveryPaceEdit(segment: WorkoutSegment, raw: string, offsetUnit: OffsetUnit): WorkoutSegment | null {
  if (segment.type !== "interval" || !segment.rest) return null;
  const intensity = parseIntensityToken(raw, offsetUnit);
  if (!reparseIntensityOk(intensity, offsetUnit)) return null;
  return { ...segment, rest: { ...segment.rest, intensity } };
}

// ── HRA-235: field-level rejection messages ─────────────────────────────────
// One human-readable explanation per field kind, for the caller (
// TrainingPlanAccordion.tsx's makeFieldCommit) to attach to a ParseWarning
// alongside the field's current DSL content when an apply*Edit above returns
// null. Untranslated, like every other ParseWarning.message already rendered
// in this file's caller (day.warnings) — these are diagnostic strings
// mirroring backend-parser output, not app chrome copy, so the frontend-i18n
// exemption for "backend/user-provided free text" applies the same way here.
export function describeTargetRejectionMessage(raw: string): string {
  const trimmed = raw.trim();
  const target = parseTargetToken(raw);
  return target.kind === "unknown"
    ? `"${trimmed}" is not a recognized distance or duration (e.g. "10km", "45min").`
    : `"${trimmed}" did not round-trip to an equivalent value — rejected to avoid silently changing the plan.`;
}

export function describeIntensityRejectionMessage(raw: string, offsetUnit: OffsetUnit): string {
  const trimmed = raw.trim();
  const intensity = parseIntensityToken(raw, offsetUnit);
  return intensity.kind === "unknown"
    ? `"${trimmed}" is not a recognized pace (e.g. "4:30/km", "RG+20", "RG").`
    : `"${trimmed}" did not round-trip to an equivalent value — rejected to avoid silently changing the plan.`;
}

export function describeRepetitionsRejectionMessage(raw: string): string {
  const trimmed = raw.trim();
  return trimmed === ""
    ? `Repetitions cannot be empty — use a whole number or "?".`
    : `"${trimmed}" is not a whole number of repetitions (or "?").`;
}
