/**
 * controllers/date-ranges.controller.ts
 * HTTP boundary for named date ranges — save/list/delete a {name, from, to} preset
 * for later recall (e.g. re-loading a "Compare to" window). Owns input validation;
 * persists via the repo directly (no service — validation is the only logic here,
 * same pattern as settings.controller.ts).
 */
import type { AppContext, Handler } from "../http/context.ts";
import type { DateRangeRow } from "../db.ts";
import { send, sendNoContent } from "../http/respond.ts";
import { parsePageParams, readJsonBody } from "../http/request.ts";
import { paginated } from "../http/envelope.ts";
import { badRequest, conflict, notFound, unprocessable } from "../http/problem.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseId(pathname: string): number {
  return Number(pathname.split("/").pop());
}

export function createDateRangesController(ctx: AppContext) {
  const repo = ctx.repos.dateRanges;

  const list: Handler = (_req, res, url) => {
    const { limit, offset } = parsePageParams(url.searchParams);
    const total = repo.count().count;
    return send(res, paginated(repo.listPage(limit, offset), total, limit, offset));
  };

  const create: Handler = async (req, res) => {
    const body = await readJsonBody<Partial<{ name: string; from: string; to: string }>>(req);
    const name = body.name?.trim();
    if (!name) throw unprocessable("name is required.");
    if (!body.from || !ISO_DATE.test(body.from) || !body.to || !ISO_DATE.test(body.to)) {
      throw unprocessable("from and to are required dates in YYYY-MM-DD format.");
    }
    if (body.from > body.to) throw unprocessable("from must not be after to.");
    if (repo.byName(name)) throw conflict(`A date range named "${name}" already exists.`);

    const row: DateRangeRow = repo.create(name, body.from, body.to);
    res.setHeader("Location", `/api/v1/date-ranges/${row.id}`);
    return send(res, row, 201);
  };

  const remove: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid date range id.");
    if (!repo.byId(id)) throw notFound(`No date range with id ${id}.`);
    repo.remove(id);
    return sendNoContent(res);
  };

  return { list, create, remove };
}
