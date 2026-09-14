/**
 * controllers/body.controller.ts
 * HTTP boundary for Withings body measurements + the km/weight correlation.
 * parse/validate input, call the repository (reads) or service (writes + the
 * correlation threshold), shape the response + status. No SQL, no business rules.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { dateRange, parsePageParams, readJsonBody } from "../http/request.ts";
import { paginated, wholePage } from "../http/envelope.ts";
import { unprocessable } from "../http/problem.ts";

export function createBodyController(ctx: AppContext) {
  const repo = ctx.repos.body;
  const service = ctx.services.body;

  const range: Handler = async (_req, res) => send(res, await repo.dateRange());

  const list: Handler = async (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    const { limit, offset } = parsePageParams(url.searchParams);
    const total = (await repo.countInRange(from, to))?.count ?? 0;
    return send(res, paginated(await repo.listPage(from, to, limit, offset), total, limit, offset));
  };

  const count: Handler = async (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, await repo.countInRange(from, to));
  };

  const monthly: Handler = async (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, wholePage(await repo.monthly(from, to)));
  };

  const trash: Handler = async (_req, res, url) => {
    const { limit, offset } = parsePageParams(url.searchParams);
    const total = (await repo.trashCount())?.count ?? 0;
    return send(res, paginated(await repo.trashPage(limit, offset), total, limit, offset));
  };

  const correlation: Handler = async (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    // HRA-32: an empty correlation is a normal 200 with [] — not a 204. "No
    // overlapping data" is data (an empty set), and a collection endpoint should
    // return the same list shape whether or not it's empty.
    const { rows } = await service.correlation(from, to);
    return send(res, wholePage(rows));
  };

  const deleteRange: Handler = async (_req, res, url) => {
    const { from, to } = dateRange(url.searchParams);
    return send(res, await service.softDeleteRange(from, to));
  };

  // POST /api/body-measurements/restore | /api/body-measurements/purge — body { ids: number[] }.
  const restorePurge: Handler = async (req, res, url) => {
    const body = await readJsonBody<{ ids?: unknown }>(req);
    const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => Number.isInteger(n)) : [];
    if (ids.length === 0) throw unprocessable("ids must be a non-empty array of integers.");
    const purge = url.pathname.endsWith("/purge");
    return send(res, purge ? await service.purge(ids) : await service.restore(ids));
  };

  return { range, list, count, monthly, trash, correlation, deleteRange, restorePurge };
}
