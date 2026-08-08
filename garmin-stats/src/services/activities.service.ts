
/**
 * services/activities.service.ts
 * Business logic for activity lifecycle: soft-delete, restore, purge, and bulk
 * confirm. Owns the DB transactions (which span multiple repository calls, so
 * they belong above the repo layer). Calls the activities repository; no http.
 * Moved out of the inline handlers in http/router.ts (HRA-30).
 */
import type { DatabaseSync } from "node:sqlite";
import type { ActivitiesRepo } from "../repositories/activities.repo.ts";

export function createActivitiesService(db: DatabaseSync, activities: ActivitiesRepo) {
  function softDeleteRange(from: string, to: string) {
    const count = (activities.countInRange(from, to) as { count: number }).count;
    db.exec("BEGIN");
    try {
      activities.softDeleteRange(from, to);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    return { deleted: count, from, to };
  }

  function softDeleteById(id: number) {
    activities.softDeleteById(id);
    return { deleted: id };
  }

  function restore(ids: number[]) {
    db.exec("BEGIN");
    try {
      for (const id of ids) activities.restoreById(id);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    return { restored: ids.length };
  }

  function purge(ids: number[]) {
    db.exec("BEGIN");
    try {
      for (const id of ids) { activities.deleteTrackPoints(id); activities.purgeById(id); }
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    return { purged: ids.length };
  }

  function confirm(ids: number[], method: "ai" | "statistical") {
    db.exec("BEGIN");
    try {
      for (const id of ids) activities.confirmById({ $id: id, $source: method });
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    return { confirmed: ids.length };
  }

  return { softDeleteRange, softDeleteById, restore, purge, confirm };
}

export type ActivitiesService = ReturnType<typeof createActivitiesService>;
