// ── Actual HR, stamina, and pause evidence at week/plan scope (HRA-338) ─────
// Pure, no I/O — extends HRA-337's evidence.ts rules to a report spanning
// MANY accepted activities instead of one workout. HR and pauses are safe to
// blend across activities: HR is already duration-weighted per
// computeHrEvidence, and pause count/longest/total are simple sums/max, not
// averages, so aggregating them across a week or plan never manufactures a
// misleading composite. Stamina is deliberately NOT blended — a depletion
// curve from a 20-minute easy day and a 2-hour long run aren't comparable
// quantities, so this module never averages stamina across a scope's whole
// population (the Story's own "stamina focuses on comparable long runs/races
// instead of indiscriminate averaging"). Design choice, with the rejected
// alternative: a duration-weighted stamina blend (mirroring computeHrEvidence)
// was considered and rejected — HR is a single instantaneous-ish quantity
// that meaningfully averages across sessions of different lengths, but a
// stamina depletion curve's SHAPE is what's meaningful, and blending curves
// of very different session lengths produces a number with no real-world
// referent. Instead this module selects AT MOST ONE comparable session per
// scope (the race, if one falls in scope, else the scope's own strict-max-
// actual-distance completed run — no unique winner means no comparable
// session, never a guess) and the caller reads that ONE session's own
// single-activity stamina series (evidence.ts's computeStaminaEvidence),
// tagged with which workout/activity it came from and why it was chosen.
import { computePauseEvidence, type PauseEvidence, type PauseEvidencePointInput } from "./evidence.ts";
import type { AcceptedEvidence } from "./types.ts";

// ── pause aggregation ────────────────────────────────────────────────────

export function aggregatePauseEvidence(
  activityIds: number[],
  trackPointsByActivity: Map<number, PauseEvidencePointInput[]>,
): PauseEvidence {
  let pauseCount = 0;
  let longestPauseSec: number | null = null;
  let totalPausedFromPausesSec: number | null = null;
  const details: PauseEvidence["details"] = [];
  let hasTrackData = false;
  for (const activityId of activityIds) {
    const track = trackPointsByActivity.get(activityId);
    if (!track) continue;
    const result = computePauseEvidence(track);
    if (result.hasTrackData) hasTrackData = true;
    pauseCount += result.pauseCount;
    if (result.longestPauseSec != null) {
      longestPauseSec = longestPauseSec == null ? result.longestPauseSec : Math.max(longestPauseSec, result.longestPauseSec);
    }
    if (result.totalPausedFromPausesSec != null) totalPausedFromPausesSec = (totalPausedFromPausesSec ?? 0) + result.totalPausedFromPausesSec;
    details.push(...result.details);
  }
  return { pauseCount, longestPauseSec, totalPausedFromPausesSec, details, hasTrackData };
}

// ── comparable-stamina-session selection ────────────────────────────────

export type ComparableStaminaReason = "race" | "longest_run";

export interface ComparableStaminaCandidate {
  workout_id: string;
  activity_id: number;
  reason: ComparableStaminaReason;
}

export interface StaminaCandidateActivityInput {
  activity_id: number;
  distance_m: number | null;
}

// `currentDateByWorkoutId` supplies each candidate's own Current placement
// date (the only side a race day is ever judged against — a race is always
// scheduled on Current, never inferred from Original) so a race match never
// needs a second lookup pass. Ties (no unique longest run) return null
// rather than guessing, same "no unique outlier, no overlay" convention
// garmin-dashboard's own weekLongRunDay heuristic already uses.
export function selectComparableStaminaCandidate(
  accepted: AcceptedEvidence[],
  activitiesById: Map<number, StaminaCandidateActivityInput>,
  currentDateByWorkoutId: Map<string, string>,
  raceDate: string | null,
): ComparableStaminaCandidate | null {
  if (raceDate != null) {
    const raceEntry = accepted.find(e => currentDateByWorkoutId.get(e.workout_id) === raceDate);
    if (raceEntry) return { workout_id: raceEntry.workout_id, activity_id: raceEntry.activity_id, reason: "race" };
  }

  let best: AcceptedEvidence | null = null;
  let bestDistance = -Infinity;
  let tie = false;
  for (const e of accepted) {
    const distance = activitiesById.get(e.activity_id)?.distance_m;
    if (distance == null) continue;
    if (distance > bestDistance) { best = e; bestDistance = distance; tie = false; }
    else if (distance === bestDistance) tie = true;
  }
  return best && !tie && bestDistance > 0 ? { workout_id: best.workout_id, activity_id: best.activity_id, reason: "longest_run" } : null;
}
