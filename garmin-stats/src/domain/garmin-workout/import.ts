// ── Garmin Workout FIT import — pure transform ──────────────────────────────
// HRA-185: flat GarminWorkoutStep[] -> ResolvedSegment[] preview, the inverse
// of export.ts's resolvedDayToGarminSteps(). Pure logic, no @garmin/fitsdk
// import — see integrations/garmin-workout.ts for the SDK boundary that
// decodes wire bytes into the same GarminWorkoutStep shape the exporter
// produces, so both directions share one step model.
//
// Deliberately narrower than the ADR's original design (docs/architecture/
// FIT-TRANSLATION-LAYER-ADR.md §4.3, §5.1): this Story's scope excludes
// arbitrary/nested Garmin structures and any "raw Garmin segment" fallback —
// anything that doesn't reduce to a supported shape makes the whole preview
// non-applicable (canApply: false) rather than being partially represented.
//
// A repeat marker's body always precedes the marker itself (lower
// messageIndex), so this walks the step list in two passes: first resolve
// every repeat marker's body against the full, unconsumed index space (a
// nested marker or an out-of-range back-reference is detected here, against
// the raw structure, not against however far a single forward pass has
// gotten); then walk forward once to emit segments in messageIndex order,
// jumping over a resolved body straight to its marker's position.
import type { ResolvedSegment } from "../runplan/instantiate.ts";
import type { Target } from "../runplan/types.ts";
import type { GarminImportWarning, GarminImportWarningCode, GarminWorkoutImportPreview, GarminWorkoutStep } from "./types.ts";
import { parseProgressionMarkerName } from "./types.ts";

const PROGRESSION_GROUP_SIZE = 5;

function targetFor(step: GarminWorkoutStep): Target {
  if (step.durationType === "distance" && step.durationMeters != null) {
    return { kind: "distance", distance_m: step.durationMeters, raw: "" };
  }
  if (step.durationType === "time" && step.durationSeconds != null) {
    return { kind: "duration", duration_sec: step.durationSeconds, raw: "" };
  }
  return { kind: "unknown", raw: "" };
}

// AC: "A custom speed band maps back to the arithmetic midpoint of its fast
// and slow pace boundaries" — each speed bound is converted to a pace first,
// then the two paces are averaged (not the speeds).
function paceFor(step: GarminWorkoutStep): number | null {
  if (step.targetType !== "speed") return null;
  const { targetLowSpeedMps: low, targetHighSpeedMps: high } = step;
  if (low == null || high == null) return null;
  if (low <= 0 || high <= 0) return null;
  if (low >= high) return null; // reversed bounds
  const paceFromHighSpeed = 1000 / high; // faster bound -> lower pace
  const paceFromLowSpeed = 1000 / low; // slower bound -> higher pace
  return (paceFromHighSpeed + paceFromLowSpeed) / 2;
}

function isOpenRestStep(step: GarminWorkoutStep): boolean {
  return step.intensity === "rest" && step.durationType === "open" && step.targetType === "open";
}

function pushWarning(
  warnings: GarminImportWarning[],
  stepIndex: number | null,
  code: GarminImportWarningCode,
  message: string,
): void {
  warnings.push({ stepIndex, code, message });
}

interface ResolvedRepeat { from: number; markerIndex: number; workStep: GarminWorkoutStep; restStep?: GarminWorkoutStep }

// Structurally validates every repeatUntilStepsCmplt marker's back-reference
// and body, independent of walk order. `markerIndexSet` is precomputed over
// the whole step list, so a body that contains another marker's row is
// caught as NESTED_REPEAT here regardless of which marker happens to get
// validated first.
function resolveRepeatMarkers(
  steps: GarminWorkoutStep[],
  byIndex: Map<number, GarminWorkoutStep>,
  markerIndexSet: Set<number>,
  warnings: GarminImportWarning[],
): { byBodyStart: Map<number, ResolvedRepeat>; anyInvalid: boolean } {
  const byBodyStart = new Map<number, ResolvedRepeat>();
  let anyInvalid = false;

  for (const marker of steps) {
    if (marker.durationType !== "repeatUntilStepsCmplt") continue;

    const from = marker.repeatFromMessageIndex;
    const count = marker.repeatCount;
    if (from == null || count == null || count <= 0 || from >= marker.messageIndex) {
      pushWarning(warnings, marker.messageIndex, "INVALID_REPEAT_REFERENCE", "Repeat marker has an invalid or missing back-reference.");
      anyInvalid = true;
      continue;
    }

    const bodySize = marker.messageIndex - from;
    if (bodySize > 2) {
      pushWarning(warnings, marker.messageIndex, "UNSUPPORTED_REPEAT_BODY_SIZE", `Repeat body of ${bodySize} steps is not supported (max 2).`);
      anyInvalid = true;
      continue;
    }

    const bodyIndices = Array.from({ length: bodySize }, (_, i) => from + i);
    if (bodyIndices.some(idx => markerIndexSet.has(idx))) {
      pushWarning(warnings, marker.messageIndex, "NESTED_REPEAT", "A repeat body cannot contain another repeat marker.");
      anyInvalid = true;
      continue;
    }

    const bodySteps = bodyIndices.map(idx => byIndex.get(idx));
    if (bodySteps.some(s => s == null)) {
      pushWarning(warnings, marker.messageIndex, "INVALID_REPEAT_REFERENCE", "Repeat body references a step that does not exist.");
      anyInvalid = true;
      continue;
    }

    byBodyStart.set(from, {
      from, markerIndex: marker.messageIndex,
      workStep: bodySteps[0] as GarminWorkoutStep,
      restStep: bodySize === 2 ? (bodySteps[1] as GarminWorkoutStep) : undefined,
    });
  }

  return { byBodyStart, anyInvalid };
}

// Detects a complete, correctly-ordered PROGRESSION_GROUP_SIZE run of
// exporter-marked stages starting at `start`. Returns the run's steps and the
// resolved ResolvedSegment, or null if the marker set is absent/partial —
// callers fall back to treating each step as its own continuous segment,
// never guessing that an unmarked run was originally one progression.
function tryResolveProgressionGroup(
  steps: GarminWorkoutStep[],
  start: number,
): { consumedCount: number; segment: ResolvedSegment } | null {
  const first = parseProgressionMarkerName(steps[start]?.name);
  if (first == null || first.stageIndex !== 0 || first.stageCount !== PROGRESSION_GROUP_SIZE) return null;
  if (start + PROGRESSION_GROUP_SIZE > steps.length) return null;

  const group = steps.slice(start, start + PROGRESSION_GROUP_SIZE);
  for (const [i, step] of group.entries()) {
    const marker = parseProgressionMarkerName(step.name);
    if (marker == null || marker.groupId !== first.groupId || marker.stageIndex !== i || marker.stageCount !== PROGRESSION_GROUP_SIZE) {
      return null;
    }
  }

  const startPace = paceFor(group[0]);
  const endPace = paceFor(group[group.length - 1]);
  if (startPace == null || endPace == null) return null;

  const target: Target = group[0].durationType === "distance"
    ? { kind: "distance", distance_m: group.reduce((sum, s) => sum + (s.durationMeters ?? 0), 0), raw: "" }
    : group[0].durationType === "time"
      ? { kind: "duration", duration_sec: group.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0), raw: "" }
      : { kind: "unknown", raw: "" };

  return {
    consumedCount: PROGRESSION_GROUP_SIZE,
    segment: {
      type: "progression",
      target,
      start_resolved_pace_sec_per_km: startPace,
      end_resolved_pace_sec_per_km: endPace,
      raw: "",
    },
  };
}

export function garminStepsToImportPreview(rawSteps: GarminWorkoutStep[]): GarminWorkoutImportPreview {
  const warnings: GarminImportWarning[] = [];

  if (rawSteps.length === 0) {
    return { canApply: false, segments: [], warnings: [{ stepIndex: null, code: "MISSING_STEP_INDEX", message: "Workout has no steps." }] };
  }

  // ── messageIndex integrity ────────────────────────────────────────────
  const seen = new Set<number>();
  for (const step of rawSteps) {
    if (seen.has(step.messageIndex)) {
      pushWarning(warnings, step.messageIndex, "DUPLICATE_STEP_INDEX", `messageIndex ${step.messageIndex} is duplicated.`);
    }
    seen.add(step.messageIndex);
  }
  for (let i = 0; i < rawSteps.length; i++) {
    if (!seen.has(i)) pushWarning(warnings, null, "MISSING_STEP_INDEX", `messageIndex ${i} is missing.`);
  }
  if (warnings.length > 0) return { canApply: false, segments: [], warnings };

  const steps = [...rawSteps].sort((a, b) => a.messageIndex - b.messageIndex);
  const byIndex = new Map(steps.map(s => [s.messageIndex, s]));
  const markerIndexSet = new Set(steps.filter(s => s.durationType === "repeatUntilStepsCmplt").map(s => s.messageIndex));

  const { byBodyStart, anyInvalid } = resolveRepeatMarkers(steps, byIndex, markerIndexSet, warnings);
  let canApply = !anyInvalid;

  const segments: ResolvedSegment[] = [];

  for (let i = 0; i < steps.length; ) {
    const step = steps[i];

    const repeat = byBodyStart.get(step.messageIndex);
    if (repeat != null) {
      const workPace = paceFor(repeat.workStep);
      if (workPace == null) {
        pushWarning(warnings, repeat.markerIndex, "UNRESOLVABLE_CUSTOM_SPEED_BOUNDS", "Interval work step has no resolvable pace.");
        canApply = false;
      } else {
        const markerStep = byIndex.get(repeat.markerIndex);
        segments.push({
          type: "interval",
          reps: markerStep?.repeatCount ?? null,
          work_target: targetFor(repeat.workStep),
          work_resolved_pace_sec_per_km: workPace,
          raw: "",
          ...(repeat.restStep != null
            ? { rest: { target: targetFor(repeat.restStep), resolved_pace_sec_per_km: paceFor(repeat.restStep), raw: "" } }
            : {}),
        });
      }
      // Advance past the whole body + the marker row itself, in messageIndex
      // order — both are consumed by this one interval segment.
      const nextIndex = repeat.markerIndex + 1;
      i = steps.findIndex(s => s.messageIndex >= nextIndex);
      if (i === -1) break;
      continue;
    }

    if (markerIndexSet.has(step.messageIndex)) {
      // A marker row whose own back-reference failed validation — already
      // warned above; skip the row itself rather than misclassifying it.
      i++;
      continue;
    }

    const progressionGroup = tryResolveProgressionGroup(steps, i);
    if (progressionGroup != null) {
      segments.push(progressionGroup.segment);
      pushWarning(warnings, step.messageIndex, "IMPORTED_PROGRESSION_FROM_STAIRCASE", "Reconstructed a progression from 5 exporter-marked staircase steps; the original continuous ramp is approximate.");
      i += progressionGroup.consumedCount;
      continue;
    }

    if (isOpenRestStep(step)) {
      segments.push({ type: "rest_block", target: { kind: "unknown", raw: "" }, raw: "" });
      i++;
      continue;
    }

    if (step.targetType === "speed") {
      const pace = paceFor(step);
      if (pace == null) {
        pushWarning(warnings, step.messageIndex, "UNRESOLVABLE_CUSTOM_SPEED_BOUNDS", "Step has a missing, non-positive, or reversed custom speed band.");
        canApply = false;
      } else {
        segments.push({ type: "continuous", target: targetFor(step), resolved_pace_sec_per_km: pace, raw: "" });
      }
      i++;
      continue;
    }

    pushWarning(warnings, step.messageIndex, "UNRECOGNIZED_STEP_SHAPE", `Step ${step.messageIndex} does not match any supported shape.`);
    canApply = false;
    i++;
  }

  return { canApply, segments: canApply ? segments : [], warnings };
}
