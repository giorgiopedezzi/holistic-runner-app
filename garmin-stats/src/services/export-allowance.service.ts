/**
 * services/export-allowance.service.ts
 * HRA-391: the registered-user FIT export allowance policy — a rolling
 * window of credits spent by the single-workout and week export actions.
 * The founder (db/founder.ts's FOUNDER_USER_ID) is exempt from enforcement
 * and consumption entirely: status() reports it as unlimited, consume() is a
 * true no-op (no usage row is ever written for it).
 *
 * Concurrency (Story AC): consume() locks the owner's own `users` row (see
 * export-allowance.repo.ts's lockOwner) inside a real transaction before
 * re-reading the rolling-window sum, so two parallel requests for the SAME
 * owner never both observe the same "before" balance — the second waits for
 * the first's commit and then sees its usage row. Different owners never
 * contend with each other (isolated per owner by construction: the query is
 * always scoped to that owner's own rows).
 */
import type { PostgresDatabase } from "../db/postgres.ts";
import { clientQueryable } from "../db/query.ts";
import { createExportAllowanceRepo, type ExportAction } from "../repositories/export-allowance.repo.ts";
import { FOUNDER_USER_ID } from "../db/founder.ts";
import type { Config } from "../config.ts";

export type { ExportAction } from "../repositories/export-allowance.repo.ts";

export interface ExportAllowanceStatus {
  unlimited: boolean;
  limit?: number;
  remaining?: number;
  next_credit_at: string | null;
  // Always present, even when unlimited — the frontend's week-export control
  // needs this to make the 7-credit cost clear before execution without
  // hardcoding a copy of the backend's own policy/configuration (Story AC).
  costs: { single: number; week: number };
}

export class ExportAllowanceExceededError extends Error {
  readonly remaining: number;
  readonly required: number;
  readonly nextCreditAt: string | null;
  constructor(remaining: number, required: number, nextCreditAt: string | null) {
    super(`Export allowance exceeded: ${required} credit(s) required, ${remaining} remaining.`);
    this.name = "ExportAllowanceExceededError";
    this.remaining = remaining;
    this.required = required;
    this.nextCreditAt = nextCreditAt;
  }
}

function nextCreditAtFrom(oldest: { created_at: string } | undefined, windowDays: number): string | null {
  if (!oldest) return null;
  return new Date(new Date(oldest.created_at).getTime() + windowDays * 24 * 60 * 60 * 1000).toISOString();
}

export function createExportAllowanceService(db: PostgresDatabase, policy: Config["exportAllowance"]) {
  const repo = createExportAllowanceRepo(db);

  return {
    async status(userId: string): Promise<ExportAllowanceStatus> {
      const costs = { single: policy.costSingle, week: policy.costWeek };
      if (userId === FOUNDER_USER_ID) return { unlimited: true, next_credit_at: null, costs };
      const used = await repo.usedCredits(userId, policy.windowDays);
      const remaining = Math.max(0, policy.limit - used);
      const oldest = await repo.oldestInWindow(userId, policy.windowDays);
      return { unlimited: false, limit: policy.limit, remaining, next_credit_at: nextCreditAtFrom(oldest, policy.windowDays), costs };
    },

    // Read-only early-exit check, used to reject a request BEFORE running FIT
    // generation when it's already known to be futile (Story AC: "a week
    // export with fewer than 7 available credits is rejected before
    // generation"). Deliberately not the enforcement boundary itself — a
    // race between this call and consume() below is harmless, since consume()
    // re-checks atomically and is what actually decides.
    async precheck(userId: string, credits: number): Promise<void> {
      if (userId === FOUNDER_USER_ID) return;
      const status = await this.status(userId);
      if (credits > (status.remaining ?? 0)) throw new ExportAllowanceExceededError(status.remaining ?? 0, credits, status.next_credit_at);
    },

    // The authoritative check-then-consume, run AFTER generation succeeds so
    // a generation failure (validation, FIT/ZIP-building) never spends a
    // credit. Founder: true no-op, no transaction, no usage row.
    async consume(userId: string, action: ExportAction, credits: number): Promise<void> {
      if (userId === FOUNDER_USER_ID) return;
      await db.transaction(async client => {
        const txRepo = repo.withDb(clientQueryable(client));
        await txRepo.lockOwner(userId);
        const used = await txRepo.usedCredits(userId, policy.windowDays);
        const remaining = policy.limit - used;
        if (credits > remaining) {
          const oldest = await txRepo.oldestInWindow(userId, policy.windowDays);
          throw new ExportAllowanceExceededError(Math.max(0, remaining), credits, nextCreditAtFrom(oldest, policy.windowDays));
        }
        await txRepo.recordUsage(userId, action, credits);
      });
    },
  };
}

export type ExportAllowanceService = ReturnType<typeof createExportAllowanceService>;
