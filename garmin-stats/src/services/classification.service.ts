import type { ActivitiesRepo } from "../repositories/activities.repo.ts";
import type { PostgresDatabase } from "../db/postgres.ts";
import { createOwnedActivitiesRepo } from "../repositories/owned-activities.repo.ts";
import { createOwnedSettingsRepo } from "../repositories/owned-settings.repo.ts";
import { summarizeWorkout, type WorkoutTrackPoint } from "../domain/workout-metrics.ts";
import { classifyByStatistics } from "../domain/stats-classifier.ts";

interface AthleteMetricRow {
  current_easy_pace_sec_per_km: number | null;
  current_race_pace_sec_per_km: number | null;
  current_long_run_target_m: number | null;
}

export function createClassificationService(db: PostgresDatabase, _activities: ActivitiesRepo) {
  async function classify(userId: string, id: number, splitMeters: number) {
    const owned = createOwnedActivitiesRepo(db, userId);
    const activity = await owned.byId(id) as {
      sport: string | null;
      distance_m: number | null;
      duration_sec: number | null;
      avg_hr: number | null;
    } | undefined;
    if (!activity) throw new Error(`Activity ${id} not found`);

    const settings = await createOwnedSettingsRepo(db, userId).get() as AthleteMetricRow | undefined;
    const summary = summarizeWorkout(
      activity,
      await owned.track(id) as WorkoutTrackPoint[],
      { splitMeters },
    );
    const result = classifyByStatistics(summary, {
      currentEasyPaceSecPerKm: settings?.current_easy_pace_sec_per_km ?? null,
      currentRacePaceSecPerKm: settings?.current_race_pace_sec_per_km ?? null,
      currentLongRunTargetM: settings?.current_long_run_target_m ?? null,
    });
    await owned.updateSystemClassification({
      $id: id,
      $classification: result.classification,
      $explanation: result.explanation,
    });
  }

  return { classify };
}

export type ClassificationService = ReturnType<typeof createClassificationService>;
