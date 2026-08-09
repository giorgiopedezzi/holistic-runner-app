/**
 * services/classification.service.ts
 * Business logic for the on-demand workout classifier. Framework-agnostic (no
 * http, no node:sqlite) — it calls the activities repository and the two
 * classifier engines. Moved out of server.ts's `classifyActivity` (HRA-30).
 *
 * Two independent methods: 'ai' (ollama-service.ts, a local LLM) and
 * 'statistical' (stats-classifier.ts, deterministic rules — instant, works even
 * if Ollama isn't running). Never called from a sync script — strictly on-demand.
 */
import type { ActivitiesRepo } from "../repositories/activities.repo.ts";
import { summarizeWorkout, type WorkoutTrackPoint } from "../domain/workout-metrics.ts";
import { classifyWorkout } from "../ollama-service.ts";
import { classifyByStatistics } from "../domain/stats-classifier.ts";

export type ClassificationMethod = "ai" | "statistical";

interface ActivityForClassify {
  sport: string | null;
  distance_m: number | null;
  duration_sec: number | null;
  avg_hr: number | null;
}

export function createClassificationService(activities: ActivitiesRepo) {
  async function classify(id: number, splitMeters: number, method: ClassificationMethod): Promise<void> {
    const activity = activities.byId(id) as unknown as ActivityForClassify | undefined;
    if (!activity) throw new Error(`Activity ${id} not found`);
    const points = activities.track(id) as unknown as WorkoutTrackPoint[];
    const summary = summarizeWorkout(activity, points, { splitMeters });
    if (method === "statistical") {
      const result = classifyByStatistics(summary);
      activities.updateStatisticalClassification({ $id: id, $classification: result.classification, $explanation: result.explanation });
    } else {
      const result = await classifyWorkout(summary);
      activities.updateAiClassification({ $id: id, $classification: result.classification, $explanation: result.explanation });
    }
  }

  return { classify };
}

export type ClassificationService = ReturnType<typeof createClassificationService>;
