/**
 * repositories/activity-types.repo.ts
 * Data access for the activity_types reference lookup (Training, Race 5km, ...).
 * The ONLY layer that runs SQL for this domain (rest-api-standards §11).
 */
import type { DatabaseSync } from "node:sqlite";
import { prepareLive as prepareLiveGlobal } from "../db.ts";
import type { ActivityTypeRow } from "../db.ts";

export function createActivityTypesRepo(db: DatabaseSync) {
  // Bound to this repo's own `db` — see activities.repo.ts's own comment /
  // db.ts's prepareLive() for the full reasoning (test-db isolation fix).
  const prepareLive = (sql: string) => prepareLiveGlobal(sql, db);
  const listAll  = prepareLive("SELECT id, name, min_distance_m FROM activity_types ORDER BY min_distance_m ASC");
  const findById = prepareLive("SELECT id, name, min_distance_m FROM activity_types WHERE id = ?");

  return {
    list: (): ActivityTypeRow[] => listAll.all() as unknown as ActivityTypeRow[],
    byId: (id: number): ActivityTypeRow | undefined => findById.get(id) as unknown as ActivityTypeRow | undefined,
  };
}

export type ActivityTypesRepo = ReturnType<typeof createActivityTypesRepo>;
