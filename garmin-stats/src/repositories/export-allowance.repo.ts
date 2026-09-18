/**
 * repositories/export-allowance.repo.ts
 * HRA-391: durable, owner-scoped usage log backing the rolling-window FIT
 * export allowance — see services/export-allowance.service.ts for the
 * check-then-consume logic built on top of these primitives.
 */
import type { Queryable } from "../db/query.ts";

export type ExportAction = "single" | "week" | "section";

export function createExportAllowanceRepo(db: Queryable) {
  return {
    // Every authenticated owner already has a `users` row (identity.service.ts
    // resolves a session to one before a session ever exists) — locking it is
    // the same FOR UPDATE idiom owned-plan-instances.repo.ts's lockDaysForSwap
    // already uses to serialize a read-then-write sequence, without needing a
    // second table whose only purpose would be to hold a lockable row: a
    // rolling window has no natural "balance" row of its own to lock, since
    // the balance is always derived from the usage log below, never stored.
    lockOwner: (userId: string) => db.get<{ id: string }>("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]),
    usedCredits: async (userId: string, windowDays: number): Promise<number> => {
      const row = await db.get<{ used: number }>(
        "SELECT COALESCE(SUM(credits),0)::int AS used FROM export_allowance_usage WHERE user_id=$1 AND created_at > now() - ($2 || ' days')::interval",
        [userId, windowDays],
      );
      return row?.used ?? 0;
    },
    oldestInWindow: (userId: string, windowDays: number) => db.get<{ created_at: string }>(
      "SELECT created_at FROM export_allowance_usage WHERE user_id=$1 AND created_at > now() - ($2 || ' days')::interval ORDER BY created_at ASC LIMIT 1",
      [userId, windowDays],
    ),
    recordUsage: (userId: string, action: ExportAction, credits: number) => db.run(
      "INSERT INTO export_allowance_usage (user_id, action, credits) VALUES ($1,$2,$3)",
      [userId, action, credits],
    ),
    withDb: (query: Queryable) => createExportAllowanceRepo(query),
  };
}

export type ExportAllowanceRepo = ReturnType<typeof createExportAllowanceRepo>;
