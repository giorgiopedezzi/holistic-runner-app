/**
 * services/body.service.ts
 * Business logic for body-measurement lifecycle (soft-delete/restore/purge, owning
 * their DB transactions) and the km/weight correlation "worth showing" threshold.
 * Calls the body repository; no http. Moved out of http/router.ts (HRA-30).
 */
import type { DatabaseSync } from "node:sqlite";
import type { BodyRepo } from "../repositories/body.repo.ts";

export function createBodyService(db: DatabaseSync, body: BodyRepo) {
  function softDeleteRange(from: string, to: string) {
    const count = (body.countInRange(from, to) as { count: number }).count;
    db.exec("BEGIN");
    try {
      body.softDeleteRange(from, to);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    return { deleted: count, from, to };
  }

  function restore(ids: number[]) {
    db.exec("BEGIN");
    try {
      for (const id of ids) body.restoreById(id);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    return { restored: ids.length };
  }

  function purge(ids: number[]) {
    db.exec("BEGIN");
    try {
      for (const id of ids) body.purgeById(id);
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    return { purged: ids.length };
  }

  // The chart is only worth showing with more than one week AND at least one of
  // those weeks having a body-measurement match. Returns the rows plus that
  // decision; the HTTP layer maps `!hasData` to 204 No Content.
  function correlation(from: string, to: string) {
    const rows = body.correlation(from, to) as { avg_weight: number | null }[];
    const hasData = rows.length > 1 && rows.some(r => r.avg_weight != null);
    return { hasData, rows };
  }

  return { softDeleteRange, restore, purge, correlation };
}

export type BodyService = ReturnType<typeof createBodyService>;
