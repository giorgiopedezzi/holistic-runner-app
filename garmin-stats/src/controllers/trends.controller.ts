/**
 * controllers/trends.controller.ts
 * HTTP boundary for the per-sport aggregate views (summary / weekly / monthly),
 * which read from the activities repository. No SQL, no business rules.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { dateRange } from "../http/request.ts";

export function createTrendsController(ctx: AppContext) {
  const repo = ctx.repos.activities;

  const summary: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, repo.summary(from, to));
  };

  const weekly: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, repo.weekly(from, to));
  };

  const monthly: Handler = (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, repo.monthly(from, to));
  };

  return { summary, weekly, monthly };
}
