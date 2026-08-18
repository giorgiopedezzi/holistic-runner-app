/**
 * repositories/activity-types.repo.ts
 * Data access for the activity_types reference lookup (Training, Race 5km, ...).
 * The ONLY layer that runs SQL for this domain (rest-api-standards §11).
 */
import type { DatabaseSync } from "node:sqlite";
import type { ActivityTypeRow } from "../db.ts";

export function createActivityTypesRepo(db: DatabaseSync) {
  const listAll  = db.prepare("SELECT id, name, min_distance_m FROM activity_types ORDER BY min_distance_m ASC");
  const findById = db.prepare("SELECT id, name, min_distance_m FROM activity_types WHERE id = ?");

  return {
    list: (): ActivityTypeRow[] => listAll.all() as unknown as ActivityTypeRow[],
    byId: (id: number): ActivityTypeRow | undefined => findById.get(id) as unknown as ActivityTypeRow | undefined,
  };
}

export type ActivityTypesRepo = ReturnType<typeof createActivityTypesRepo>;
