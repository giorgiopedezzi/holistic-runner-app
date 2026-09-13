// ── Actual HR, stamina, and pause evidence (HRA-337) ─────────────────────────
// Pure, no I/O — reuses workout-metrics.ts's canonical detectPauseEvents (the
// same timestamp/heuristic pause detector countZeroPaceEvents already uses)
// rather than a second pause-detection algorithm (this Story's own
// out-of-scope: "New pause-detection algorithms"). HR/stamina/pause evidence
// is Actual-only by construction — every function here reads only activities/
// track_points, never a planned segment (AC1).
import { detectPauseEvents, type Pause, type WorkoutTrackPoint } from "../workout-metrics.ts";

// The pause-inspection default this backend mirrors — same as
// garmin-dashboard/src/components/activity/ActivityDetailBody.tsx's own
// `useState(30)` default for the "Pauses (N)" dialog, so a report's pause
// count/longest agree with what the runner sees when they open one activity
// directly. countZeroPaceEvents' own default (5s) is a different, classifier-
// tuned threshold and is deliberately not reused here.
export const DEFAULT_PAUSE_THRESHOLD_SEC = 30;

// ── HR evidence ──────────────────────────────────────────────────────────
// Cheap: reads only activities.avg_hr/max_hr, never track_points — so this is
// safe to compute even at an aggregate scope with many activities (AC2's own
// "supply aggregate ... without loading unnecessary raw streams").
export interface HrEvidenceActivityInput {
  avg_hr: number | null;
  max_hr: number | null;
  duration_sec: number | null;
}

export interface HrEvidence {
  avgHr: number | null;
  maxHr: number | null;
  coverage: { withHr: number; total: number };
}

export function computeHrEvidence(activities: HrEvidenceActivityInput[]): HrEvidence {
  let weightedSum = 0;
  let weight = 0;
  let maxHr: number | null = null;
  let withHr = 0;
  for (const a of activities) {
    if (a.avg_hr != null) {
      withHr++;
      const w = a.duration_sec != null && a.duration_sec > 0 ? a.duration_sec : 1;
      weightedSum += a.avg_hr * w;
      weight += w;
    }
    if (a.max_hr != null) maxHr = maxHr == null ? a.max_hr : Math.max(maxHr, a.max_hr);
  }
  return {
    avgHr: weight > 0 ? weightedSum / weight : null,
    maxHr,
    coverage: { withHr, total: activities.length },
  };
}

// ── Stamina evidence ─────────────────────────────────────────────────────
// "The one recorded stamina series" (AC3) — computed from ONE activity's own
// track_points.stamina column, never averaged across activities and never
// assuming a 100% starting value: `firstValid` is whatever the device's first
// non-null sample actually was.
export interface StaminaPointInput { stamina: number | null }

export interface StaminaEvidence {
  firstValid: number | null;
  finish: number | null;
  depletionPoints: number | null; // firstValid - finish, in percentage points; null unless both resolve
  minimum: number | null;
  coverage: { withStamina: number; total: number };
}

export function computeStaminaEvidence(points: StaminaPointInput[]): StaminaEvidence {
  let firstValid: number | null = null;
  let finish: number | null = null;
  let minimum: number | null = null;
  let withStamina = 0;
  for (const p of points) {
    if (p.stamina == null) continue;
    withStamina++;
    if (firstValid == null) firstValid = p.stamina;
    finish = p.stamina;
    minimum = minimum == null ? p.stamina : Math.min(minimum, p.stamina);
  }
  return {
    firstValid,
    finish,
    depletionPoints: firstValid != null && finish != null ? firstValid - finish : null,
    minimum,
    coverage: { withStamina, total: points.length },
  };
}

// ── Pause evidence ───────────────────────────────────────────────────────
// AC7: each detail carries elapsed position, distance, duration, HR before/
// after + recovery delta, and stamina context — everything the existing
// PauseInspectionDialog needs, reused as-is rather than reshaped client-side.
// AC8: `provenance` distinguishes a real recording gap ('recorded') from the
// near-zero-speed heuristic ('inferred') per pause, from Pause.recorded.
export interface PauseEvidencePointInput {
  elapsed_sec: number | null;
  timestamp_unix: number | null;
  distance_m: number | null;
  heart_rate: number | null;
  speed_ms: number | null;
  stamina: number | null;
}

export interface PauseDetail {
  index: number; // 1-based, chronological
  elapsedSec: number | null;
  distanceM: number | null;
  durationSec: number;
  hrBefore: number | null;
  hrAfter: number | null;
  hrRecoveryDelta: number | null; // before - after; a drop reads positive
  staminaBefore: number | null;
  staminaAfter: number | null;
  provenance: "recorded" | "inferred";
}

export interface PauseEvidence {
  pauseCount: number;
  longestPauseSec: number | null;
  totalPausedFromPausesSec: number | null; // sum of individually detected pause durations
  details: PauseDetail[];
  hasTrackData: boolean; // false when no track_points existed to run detection over at all
}

function nearestValue(
  points: PauseEvidencePointInput[], key: keyof PauseEvidencePointInput, startIdx: number, dir: 1 | -1,
): number | null {
  for (let i = startIdx; i >= 0 && i < points.length; i += dir) {
    const v = points[i][key];
    if (v != null) return v;
  }
  return null;
}

export function computePauseEvidence(
  points: PauseEvidencePointInput[], thresholdSec = DEFAULT_PAUSE_THRESHOLD_SEC,
): PauseEvidence {
  if (points.length === 0) {
    return { pauseCount: 0, longestPauseSec: null, totalPausedFromPausesSec: null, details: [], hasTrackData: false };
  }

  const pauses: Pause[] = detectPauseEvents(points as WorkoutTrackPoint[], thresholdSec);

  const details: PauseDetail[] = pauses.map((p, i) => {
    const hrBefore = nearestValue(points, "heart_rate", p.afterIndex, -1);
    const hrAfter = nearestValue(points, "heart_rate", p.afterIndex + 1, 1);
    const staminaBefore = nearestValue(points, "stamina", p.afterIndex, -1);
    const staminaAfter = nearestValue(points, "stamina", p.afterIndex + 1, 1);
    return {
      index: i + 1,
      elapsedSec: points[p.afterIndex].elapsed_sec,
      distanceM: nearestValue(points, "distance_m", p.afterIndex, -1),
      durationSec: p.durationSec,
      hrBefore,
      hrAfter,
      hrRecoveryDelta: hrBefore != null && hrAfter != null ? hrBefore - hrAfter : null,
      staminaBefore,
      staminaAfter,
      provenance: p.recorded ? "recorded" : "inferred",
    };
  });

  const longestPauseSec = pauses.length > 0 ? Math.max(...pauses.map(p => p.durationSec)) : null;
  const totalPausedFromPausesSec = pauses.length > 0 ? pauses.reduce((s, p) => s + p.durationSec, 0) : null;

  return { pauseCount: pauses.length, longestPauseSec, totalPausedFromPausesSec, details, hasTrackData: true };
}
