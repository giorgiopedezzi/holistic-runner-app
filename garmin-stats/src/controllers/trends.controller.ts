/**
 * controllers/trends.controller.ts
 * HTTP boundary for the per-sport aggregate views (summary / weekly / monthly),
 * which read from the activities repository. No SQL, no business rules.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { dateRange } from "../http/request.ts";
import { wholePage } from "../http/envelope.ts";

export function createTrendsController(ctx: AppContext) {
  const repo = ctx.repos.activities;

  // Aggregates are bounded (one row per sport / week / month), so they're
  // wrapped whole in the list envelope for shape consistency (HRA-38) — there's
  // nothing to page through.
  const summary: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, wholePage(repo.summary(from, to) as unknown[]));
  };

  const weekly: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, wholePage(repo.weekly(from, to) as unknown[]));
  };

  const monthly: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, wholePage(repo.monthly(from, to) as unknown[]));
  };

  return { summary, weekly, monthly };
}
