import type { Queryable } from "../db/query.ts";
import type { ActivityTypeRow } from "../db.ts";

export function createActivityTypesRepo(db: Queryable) {
  return {
    list: () => db.all<ActivityTypeRow>("SELECT id, name, min_distance_m FROM activity_types ORDER BY min_distance_m ASC"),
    byId: (id: number) => db.get<ActivityTypeRow>("SELECT id, name, min_distance_m FROM activity_types WHERE id = $1", [id]),
  };
}
export type ActivityTypesRepo = ReturnType<typeof createActivityTypesRepo>;
