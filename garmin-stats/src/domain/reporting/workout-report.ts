// ── Single-workout and race report (HRA-336) ─────────────────────────────────
// Pure, no I/O — reuses HRA-333's lineage classifier and HRA-335's shared
// metrics primitives (metrics.ts/planned-metrics.ts) rather than a second
// calculation engine; this module only re-shapes their output at the
// granularity of ONE planned workout instead of a whole plan. All raw rows
// arrive already loaded by the caller (services/reporting.service.ts) — same
// "caller loads, domain classifies" division of labor as report.ts.
import type { AssociationStatus, PlanInstanceDayRow } from "../../db.ts";
import { classifyWorkoutLineage, type OriginalDaySnapshot, type WorkoutLineageStatus } from "../runplan/lineage.ts";
import type { ResolvedSegment } from "../runplan/instantiate.ts";
import { computeWorkoutDayStatus } from "../workout-association.ts";
import { SCHEDULE_TIMEZONE_BACKFILL_FALLBACK } from "../plan-timezone.ts";
import { ACCEPTED_STATUSES } from "./scope.ts";
import { activityTimeBreakdown, aggregatePaceSecPerKm, raceComparisonTimeSec, type DistanceTimeRecord } from "./metrics.ts";
import { computePlannedDayDistance, computePlannedDayDurationSec } from "./planned-metrics.ts";
import {
  computeHrEvidence, computePauseEvidence, computeStaminaEvidence,
  type HrEvidence, type PauseEvidence, type PauseEvidencePointInput, type StaminaEvidence,
} from "./evidence.ts";
import type { WorkoutEvidenceState } from "./types.ts";

export interface WorkoutReportInstanceInput {
  id: number;
  name: string | null;
  schedule_timezone: string | null;
  // HRA-336: the consistent read boundary's own revision pair — see
  // services/reporting.service.ts for how these are captured atomically.
  current_revision: number;
  original_revision: number;
  original_start_date: string | null;
  // The instance's own designated race day (HRA-121, free text elsewhere) —
  // the ONE existing signal this Story reuses to decide whether a given
  // workout is "the race" rather than inventing a new persisted marker: a
  // workout counts as the race when its own placement date equals this.
  race_date: string | null;
}

export interface WorkoutReportAssociationInput {
  activity_id: number;
  status: AssociationStatus;
}

export interface WorkoutReportActivityInput {
  activity_id: number;
  activity_date: string;
  distance_m: number | null;
  duration_sec: number | null;
  moving_time_sec: number | null;
  avg_hr: number | null;
  max_hr: number | null;
}

export interface WorkoutReportInputs {
  instance: WorkoutReportInstanceInput;
  workoutId: string;
  // Both nullable: a workout can exist in only one of Original/Current
  // (added post-freeze, or removed since freeze) — never both null when the
  // caller has already confirmed this workout_id exists somewhere in this
  // instance (services/reporting.service.ts 404s before calling this).
  original: OriginalDaySnapshot | null;
  current: PlanInstanceDayRow | null;
  // Every workout_associations row for this workout_id (HRA-334) —
  // 'unresolved' rows are included (AC11: visible, never trusted).
  associations: WorkoutReportAssociationInput[];
  // The activities referenced by `associations`, for evidence metrics only.
  activities: WorkoutReportActivityInput[];
  // HRA-337: track_points for the ACCEPTED evidence activities only, keyed by
  // activity_id — the caller (services/reporting.service.ts) loads these,
  // this module never queries the DB. "The one recorded stamina series"
  // (AC3) and pause detail/count/longest (AC5/AC7) both come from here;
  // never loaded for Original/Current or for non-accepted activities.
  trackPointsByActivity?: Map<number, PauseEvidencePointInput[]>;
  now?: Date;
  asOf?: Date;
}

export interface WorkoutDatasetMetrics {
  distanceM: number;
  approximate: boolean;
  durationSec: number;
  paceSecPerKm: number | null;
}

export interface WorkoutActualEvidence {
  activityId: number;
  status: Extract<AssociationStatus, "automatic" | "manual_confirmed" | "manual_changed">;
  elapsedSec: number | null;
  activeSec: number | null;
  pausedSec: number | null;
}

export interface RaceReport {
  isRace: true;
  targetDistanceM: number | null;
  targetDurationSec: number | null; // target finish time, elapsed-clock semantics (AC8)
  targetPaceSecPerKm: number | null;
  // AC8: the race clock never stops — actual comparison uses elapsed
  // (duration_sec) time, never moving/active time. actualElapsedSec is the
  // SUM of every accepted activity's elapsed time (normally exactly one).
  actualElapsedSec: number | null;
  actualMovingSec: number | null; // supporting context only — never a substitute for actualElapsedSec
  // No official-result data source exists anywhere in this codebase yet
  // (checked: no table, no integration) — every race in this Story's slice
  // is reported from the associated activity's own elapsed time, with the
  // source always explicit rather than silently assumed. A future Story that
  // introduces real official-result persistence can add 'official_result'
  // as a second value here without reshaping anything else in this report.
  actualSource: "activity" | "none";
}

export interface WorkoutReportResult {
  provenance: {
    planInstanceId: number;
    planInstanceName: string | null;
    workoutId: string;
    originalRevision: number;
    currentRevision: number;
    scheduleTimezone: string;
    hasOriginalBaseline: boolean;
    generatedAt: string;
    asOf: string;
  };
  identity: {
    sectionName: string | null;
    weekNumber: number | null;
    day: number | null;
    workoutType: string | null;
    originalDate: string | null;
    currentDate: string | null;
  };
  lineage: WorkoutLineageStatus;
  // AC2's single-workout equivalent: "when Original equals Current, present
  // one Planned column" — true only for lineage "unchanged" (both present,
  // neither moved nor modified).
  originalEqualsCurrent: boolean;
  state: WorkoutEvidenceState;
  planned: { original: WorkoutDatasetMetrics | null; current: WorkoutDatasetMetrics | null };
  actual: { metrics: WorkoutDatasetMetrics | null; evidence: WorkoutActualEvidence[]; hasAmbiguousEvidence: boolean };
  race: RaceReport | { isRace: false };
  // HRA-337: Actual-only HR/stamina/pause evidence — null whenever there is
  // no accepted activity to read it from (never a fabricated zero, AC1/AC13).
  hr: HrEvidence | null;
  // "The one recorded stamina series" (AC3) — from the FIRST accepted
  // activity's own track_points only; never averaged across activities.
  stamina: StaminaEvidence | null;
  pauses: PauseEvidence | null;
  structuredQualityEvidence: { available: false; reason: "not_implemented" };
}

function plannedMetricsForDay(day: { workout_type: string; segments: string } | null): WorkoutDatasetMetrics | null {
  if (!day) return null;
  const segments = JSON.parse(day.segments) as ResolvedSegment[];
  const distance = computePlannedDayDistance(day.workout_type, segments);
  const durationSec = computePlannedDayDurationSec(day.workout_type, segments);
  return {
    distanceM: distance.meters,
    approximate: distance.approximate,
    durationSec,
    paceSecPerKm: aggregatePaceSecPerKm([{ distanceM: distance.meters, timeSec: durationSec }]),
  };
}

function toEvidenceState(status: "pending" | "missed" | "completed"): WorkoutEvidenceState {
  return status === "pending" ? "upcoming" : status;
}

export function buildWorkoutReport(inputs: WorkoutReportInputs): WorkoutReportResult {
  const { instance, workoutId, original, current, associations, activities, trackPointsByActivity } = inputs;
  const timeZone = instance.schedule_timezone ?? SCHEDULE_TIMEZONE_BACKFILL_FALLBACK;
  const now = inputs.now ?? new Date();
  const asOf = inputs.asOf ?? now;

  // AC: "loads the selected Original and Current workout through stable
  // HRA-333 lineage" — reuses the SAME classifier the plan-level report
  // already uses (domain/runplan/lineage.ts), just fed exactly one workout's
  // Original/Current pair instead of a whole instance's day sets.
  const lineageEntries = classifyWorkoutLineage(original ? [original] : [], current ? [current] : []);
  const lineageEntry = lineageEntries.find(e => e.workout_id === workoutId) ?? {
    workout_id: workoutId, status: "added" as WorkoutLineageStatus, original, current,
  };

  const activitiesById = new Map(activities.map(a => [a.activity_id, a]));
  const accepted = associations.filter((a): a is WorkoutReportAssociationInput & { status: WorkoutActualEvidence["status"] } =>
    ACCEPTED_STATUSES.includes(a.status));
  const hasAmbiguousEvidence = associations.some(a => !ACCEPTED_STATUSES.includes(a.status));

  const acceptedActivities = accepted
    .map(a => activitiesById.get(a.activity_id))
    .filter((a): a is WorkoutReportActivityInput => a != null);

  const actualMetrics: WorkoutDatasetMetrics | null = acceptedActivities.length === 0 ? null : (() => {
    let meters = 0;
    let durationSec = 0;
    const records: DistanceTimeRecord[] = [];
    for (const a of acceptedActivities) {
      if (a.distance_m != null) meters += a.distance_m;
      if (a.duration_sec != null) durationSec += a.duration_sec;
      records.push({ distanceM: a.distance_m, timeSec: a.duration_sec });
    }
    return { distanceM: meters, approximate: false, durationSec, paceSecPerKm: aggregatePaceSecPerKm(records) };
  })();

  const evidence: WorkoutActualEvidence[] = accepted.map(a => {
    const activity = activitiesById.get(a.activity_id);
    const breakdown = activity ? activityTimeBreakdown(activity) : { elapsedSec: null, activeSec: null, pausedSec: null };
    return { activityId: a.activity_id, status: a.status, ...breakdown };
  });

  // HRA-337: HR is cheap (activities.avg_hr/max_hr only) — computed over
  // every accepted activity. Stamina/pauses need track_points, only ever
  // loaded by the caller for accepted activities (never Original/Current,
  // never non-accepted ones) — see WorkoutReportInputs.trackPointsByActivity.
  const hr = acceptedActivities.length === 0 ? null : computeHrEvidence(acceptedActivities);

  const firstAcceptedTrack = acceptedActivities.length > 0 && trackPointsByActivity
    ? trackPointsByActivity.get(acceptedActivities[0].activity_id)
    : undefined;
  const stamina = firstAcceptedTrack ? computeStaminaEvidence(firstAcceptedTrack) : null;

  // Pauses: aggregate detection across every accepted activity's own track
  // (normally exactly one — a split run across two device files is the only
  // case with more than one).
  const pauses: PauseEvidence | null = (() => {
    if (acceptedActivities.length === 0 || !trackPointsByActivity) return null;
    let pauseCount = 0;
    let longestPauseSec: number | null = null;
    let totalPausedFromPausesSec: number | null = null;
    const details: PauseEvidence["details"] = [];
    let hasTrackData = false;
    for (const a of acceptedActivities) {
      const track = trackPointsByActivity.get(a.activity_id);
      if (!track) continue;
      const result = computePauseEvidence(track);
      if (result.hasTrackData) hasTrackData = true;
      pauseCount += result.pauseCount;
      if (result.longestPauseSec != null) longestPauseSec = longestPauseSec == null ? result.longestPauseSec : Math.max(longestPauseSec, result.longestPauseSec);
      if (result.totalPausedFromPausesSec != null) totalPausedFromPausesSec = (totalPausedFromPausesSec ?? 0) + result.totalPausedFromPausesSec;
      details.push(...result.details);
    }
    return { pauseCount, longestPauseSec, totalPausedFromPausesSec, details, hasTrackData };
  })();

  const referenceDate = current?.date ?? original?.date ?? null;
  const state: WorkoutEvidenceState = referenceDate == null
    ? "upcoming"
    : toEvidenceState(computeWorkoutDayStatus(referenceDate, timeZone, acceptedActivities.length > 0, asOf));

  const plannedCurrent = plannedMetricsForDay(current);
  const plannedOriginal = plannedMetricsForDay(original);

  // AC: race reporting exposes target distance/pace/finish time "when
  // supported by the planned race workout" — a day counts as the race when
  // its own placement date matches the instance's own race_date (the one
  // existing per-instance race-day signal, HRA-121).
  const isRace = instance.race_date != null && (current?.date === instance.race_date || (!current && original?.date === instance.race_date));
  const targetMetrics = plannedCurrent ?? plannedOriginal;
  const race: WorkoutReportResult["race"] = !isRace ? { isRace: false } : {
    isRace: true,
    targetDistanceM: targetMetrics?.distanceM ?? null,
    targetDurationSec: targetMetrics?.durationSec ?? null,
    targetPaceSecPerKm: targetMetrics?.paceSecPerKm ?? null,
    // AC8: elapsed time, never active/moving — raceComparisonTimeSec makes
    // that substitution structurally impossible rather than just documented.
    actualElapsedSec: acceptedActivities.length === 0 ? null
      : acceptedActivities.reduce((sum, a) => sum + (raceComparisonTimeSec(a) ?? 0), 0),
    actualMovingSec: acceptedActivities.length === 0 ? null
      : acceptedActivities.reduce((sum, a) => sum + (a.moving_time_sec ?? 0), 0),
    actualSource: acceptedActivities.length > 0 ? "activity" : "none",
  };

  return {
    provenance: {
      planInstanceId: instance.id,
      planInstanceName: instance.name,
      workoutId,
      originalRevision: instance.original_revision,
      currentRevision: instance.current_revision,
      scheduleTimezone: timeZone,
      hasOriginalBaseline: instance.original_start_date != null,
      generatedAt: now.toISOString(),
      asOf: asOf.toISOString(),
    },
    identity: {
      sectionName: current?.section_name ?? original?.section_name ?? null,
      weekNumber: current?.week_number ?? original?.week_number ?? null,
      day: current?.day ?? original?.day ?? null,
      workoutType: current?.workout_type ?? original?.workout_type ?? null,
      originalDate: original?.date ?? null,
      currentDate: current?.date ?? null,
    },
    lineage: lineageEntry.status,
    originalEqualsCurrent: lineageEntry.status === "unchanged",
    state,
    planned: { original: plannedOriginal, current: plannedCurrent },
    actual: { metrics: actualMetrics, evidence, hasAmbiguousEvidence },
    race,
    hr,
    stamina,
    pauses,
    structuredQualityEvidence: { available: false, reason: "not_implemented" },
  };
}
