/**
 * controllers/trends.controller.ts
 * HTTP boundary for the per-sport aggregate views (summary / weekly / monthly),
 * which read from the activities repository. No SQL, no business rules.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { dateRange } from "../http/request.ts";
import { wholePage } from "../http/envelope.ts";
import { requestDataOwnerId } from "../http/auth-context.ts";
import { founderPublicResponse } from "../http/founder-public-response.ts";
import { createOwnedActivitiesRepo } from "../repositories/owned-activities.repo.ts";

export function createTrendsController(ctx: AppContext) {
  const owned = (req: import("http").IncomingMessage) => createOwnedActivitiesRepo(ctx.db, requestDataOwnerId(req));

  // Aggregates are bounded (one row per sport / week / month), so they're
  // wrapped whole in the list envelope for shape consistency (HRA-38) — there's
  // nothing to page through.
  const summary: Handler = async (req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, founderPublicResponse(req, wholePage(await owned(req).summary(from, to) as unknown[])));
  };

  const weekly: Handler = async (req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, founderPublicResponse(req, wholePage(await owned(req).weekly(from, to) as unknown[])));
  };

  const monthly: Handler = async (req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, founderPublicResponse(req, wholePage(await owned(req).monthly(from, to) as unknown[])));
  };

  return { summary, weekly, monthly };
}
