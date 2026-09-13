// ── Shared reporting domain — actual metrics + trust arithmetic (HRA-335) ───
// Pure, no I/O. AC8/AC9/AC10: active/elapsed/paused stay distinct, aggregate
// pace is always distance-total ÷ time-total (never an average of per-record
// pace labels), and a percentage is never produced without an explicit valid
// denominator.

// AC8: active, elapsed, and paused time remain distinct. `activities.
// duration_sec` is elapsed (includes pauses); `moving_time_sec` is active
// (nullable — pre-migration rows, see docs/schema.md). Paused is only ever
// derived when both are present and active doesn't exceed elapsed — a
// negative/inconsistent pair leaves paused unavailable (null) rather than a
// misleading value (AC10's "missing or ambiguous data remains unavailable").
export interface ActivityTimeBreakdown {
  elapsedSec: number | null;
  activeSec: number | null;
  pausedSec: number | null;
}

export function activityTimeBreakdown(a: { duration_sec: number | null; moving_time_sec: number | null }): ActivityTimeBreakdown {
  const elapsedSec = a.duration_sec;
  const activeSec = a.moving_time_sec;
  const pausedSec = elapsedSec != null && activeSec != null && activeSec <= elapsedSec ? elapsedSec - activeSec : null;
  return { elapsedSec, activeSec, pausedSec };
}

// AC8: race comparison uses elapsed time — documented as code (not just
// prose) so a future caller can't quietly substitute active/moving time for
// a race-context comparison.
export function raceComparisonTimeSec(a: { duration_sec: number | null }): number | null {
  return a.duration_sec;
}

// AC9: aggregate pace is distance-total ÷ time-total, computed once over
// every compatible (distance>0 AND time>0) record — never by averaging each
// record's own displayed pace. A record missing either half is dropped from
// BOTH totals rather than contributing a 0, so one bad record can't skew the
// aggregate toward an artificially fast or slow pace.
export interface DistanceTimeRecord { distanceM: number | null; timeSec: number | null }

export function aggregatePaceSecPerKm(records: DistanceTimeRecord[]): number | null {
  let distanceM = 0;
  let timeSec = 0;
  for (const r of records) {
    if (r.distanceM != null && r.distanceM > 0 && r.timeSec != null && r.timeSec > 0) {
      distanceM += r.distanceM;
      timeSec += r.timeSec;
    }
  }
  return distanceM > 0 ? timeSec / (distanceM / 1000) : null;
}

// AC10: percentages require an explicit valid denominator — a zero/absent
// denominator returns null, never 0% or 100% (a valid-looking zero value AC14
// separately rules out).
export function safePercentage(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}
