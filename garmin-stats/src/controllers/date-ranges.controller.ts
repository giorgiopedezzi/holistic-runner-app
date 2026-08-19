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

type Body = Partial<{ name: string; from: string; to: string; activity_id: number | null }>;

export function createDateRangesController(ctx: AppContext) {
  const repo = ctx.repos.dateRanges;
  const activitiesRepo = ctx.repos.activities;

  const list: Handler = (_req, res, url) => {
    const { limit, offset } = parsePageParams(url.searchParams);
    const total = repo.count().count;
    return send(res, paginated(repo.listPage(limit, offset), total, limit, offset));
  };

  // Shared by create/update: name/from/to shape + the "link a race" rule
  // (race-typed, dated strictly after `to` — rest-api §1: the constraint
  // lives in the same write that sets activity_id, not a separate route).
  // excludeId lets update's duplicate-name check ignore the row being edited.
  function validate(body: Body, excludeId: number | null): { name: string; activityId: number | null } {
    const name = body.name?.trim();
    if (!name) throw unprocessable("name is required.");
    if (!body.from || !ISO_DATE.test(body.from) || !body.to || !ISO_DATE.test(body.to)) {
      throw unprocessable("from and to are required dates in YYYY-MM-DD format.");
    }
    if (body.from > body.to) throw unprocessable("from must not be after to.");
    const existing = repo.byName(name);
    if (existing && existing.id !== excludeId) throw conflict(`A date range named "${name}" already exists.`);

    let activityId: number | null = null;
    if (body.activity_id != null) {
      activityId = Number(body.activity_id);
      if (!Number.isInteger(activityId)) throw unprocessable("activity_id must be an integer.");
      const activity = activitiesRepo.byId(activityId) as unknown as
        { activity_type_id: number; date_only: string } | undefined;
      if (!activity) throw unprocessable(`Unknown activity_id ${activityId}.`);
      if (activity.activity_type_id === 1) throw unprocessable("Only race-type activities (not Training) can be linked.");
      if (activity.date_only <= body.to) throw unprocessable("The linked race must take place after the range's end date.");
    }
    return { name, activityId };
  }

  const create: Handler = async (req, res) => {
    const body = await readJsonBody<Body>(req);
    const { name, activityId } = validate(body, null);
    const row: DateRangeRow = repo.create(name, body.from!, body.to!, activityId);
    res.setHeader("Location", `/api/v1/date-ranges/${row.id}`);
    return send(res, row, 201);
  };

  // PUT /api/v1/date-ranges/:id — full replacement of {name, from, to,
  // activity_id}, incl. renaming (rest-api §2: whole-resource replace → PUT).
  const update: Handler = async (req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid date range id.");
    if (!repo.byId(id)) throw notFound(`No date range with id ${id}.`);
    const body = await readJsonBody<Body>(req);
    const { name, activityId } = validate(body, id);
    return send(res, repo.update(id, name, body.from!, body.to!, activityId));
  };

  const remove: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid date range id.");
    if (!repo.byId(id)) throw notFound(`No date range with id ${id}.`);
    repo.remove(id);
    return sendNoContent(res);
  };

  return { list, create, update, remove };
}
