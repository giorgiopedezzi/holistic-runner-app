/**
 * services/sync-lock.ts
 * Owner-scoped sync run locking (HRA-352 AC7/AC8). `sync_runs` carries a
 * partial unique index on (user_id, provider) WHERE status='running' — the
 * lock IS that index: a second sync for the same owner+provider while one is
 * still running hits a unique violation instead of racing the first. No
 * separate queue/broker is introduced; this is the minimal real lock the
 * existing "spawn a script per sync request" model needed to be owner-safe.
 */
import type { Queryable } from "../db/query.ts";

export type SyncProvider = "garmin" | "withings" | "strava";

const UNIQUE_VIOLATION = "23505";

export class SyncAlreadyRunningError extends Error {
  constructor(provider: SyncProvider) {
    super(`A ${provider} sync is already running for this account.`);
    this.name = "SyncAlreadyRunningError";
  }
}

export async function acquireSyncLock(db: Queryable, userId: string, provider: SyncProvider): Promise<number> {
  try {
    const row = await db.get<{ id: number }>(
      "INSERT INTO sync_runs (user_id, provider, status) VALUES ($1, $2, 'running') RETURNING id",
      [userId, provider],
    );
    if (!row) throw new Error("sync-lock: insert did not return an id");
    return row.id;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new SyncAlreadyRunningError(provider);
    }
    throw error;
  }
}

export async function releaseSyncLock(db: Queryable, runId: number, outcome: { status: "succeeded" | "failed"; imported?: number; skipped?: number; errors?: number; errorMessage?: string }): Promise<void> {
  await db.run(
    "UPDATE sync_runs SET status=$1, finished_at=now(), imported=$2, skipped=$3, errors=$4, error_message=$5 WHERE id=$6",
    [outcome.status, outcome.imported ?? null, outcome.skipped ?? null, outcome.errors ?? null, outcome.errorMessage ?? null, runId],
  );
}
