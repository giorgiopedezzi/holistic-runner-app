/**
 * controllers/training-plans.controller.ts
 * HTTP boundary for training plans (HRA-109) — a named block of planned sessions
 * over a date range. Owns input validation; persists via the repo directly (no
 * service — validation is the only logic here, same pattern as
 * date-ranges.controller.ts, which this closely mirrors for target_activity_id).
 */
import type { AppContext, Handler } from "../http/context.ts";
import type { TrainingPlanRow } from "../db.ts";
import { send, sendNoContent } from "../http/respond.ts";
import { parsePageParams, readJsonBody } from "../http/request.ts";
import { paginated } from "../http/envelope.ts";
import { badRequest, notFound, unprocessable } from "../http/problem.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseId(pathname: string): number {
  return Number(pathname.split("/").pop());
}

type Body = Partial<{ name: string; sport: string; start_date: string; end_date: string; target_activity_id: number | null }>;

export function createTrainingPlansController(ctx: AppContext) {
  const repo = ctx.repos.trainingPlans;
  const activitiesRepo = ctx.repos.activities;

  const list: Handler = (_req, res, url) => {
    const { limit, offset } = parsePageParams(url.searchParams);
    const total = repo.count().count;
    return send(res, paginated(repo.listPage(limit, offset), total, limit, offset));
  };

  const getById: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid training plan id.");
    const row = repo.byId(id);
    if (!row) throw notFound(`No training plan with id ${id}.`);
    return send(res, row);
  };

  // Shared by create/update. target_activity_id reuses exactly the "link a race"
  // rule date-ranges.controller.ts's validate() applies: race-typed, dated
  // strictly after the plan's end_date — same relationship, same constraint.
  function validate(body: Body): { name: string; sport: string; startDate: string; endDate: string; targetActivityId: number | null } {
    const name = body.name?.trim();
    if (!name) throw unprocessable("name is required.");
    const sport = body.sport?.trim();
    if (!sport) throw unprocessable("sport is required.");
    if (!body.start_date || !ISO_DATE.test(body.start_date) || !body.end_date || !ISO_DATE.test(body.end_date)) {
      throw unprocessable("start_date and end_date are required dates in YYYY-MM-DD format.");
    }
    if (body.start_date > body.end_date) throw unprocessable("start_date must not be after end_date.");

    let targetActivityId: number | null = null;
    if (body.target_activity_id != null) {
      targetActivityId = Number(body.target_activity_id);
      if (!Number.isInteger(targetActivityId)) throw unprocessable("target_activity_id must be an integer.");
      const activity = activitiesRepo.byId(targetActivityId) as unknown as
        { activity_type_id: number; date_only: string } | undefined;
      if (!activity) throw unprocessable(`Unknown target_activity_id ${targetActivityId}.`);
      if (activity.activity_type_id === 1) throw unprocessable("Only race-type activities (not Training) can be linked.");
      if (activity.date_only <= body.end_date) throw unprocessable("The linked race must take place after the plan's end_date.");
    }
    return { name, sport, startDate: body.start_date, endDate: body.end_date, targetActivityId };
  }

  const create: Handler = async (req, res) => {
    const body = await readJsonBody<Body>(req);
    const { name, sport, startDate, endDate, targetActivityId } = validate(body);
    const row: TrainingPlanRow = repo.create({
      name, sport, start_date: startDate, end_date: endDate, target_activity_id: targetActivityId,
    });
    res.setHeader("Location", `/api/v1/training-plans/${row.id}`);
    return send(res, row, 201);
  };

  // PUT /api/v1/training-plans/:id — full replacement (rest-api §2).
  const update: Handler = async (req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid training plan id.");
    if (!repo.byId(id)) throw notFound(`No training plan with id ${id}.`);
    const body = await readJsonBody<Body>(req);
    const { name, sport, startDate, endDate, targetActivityId } = validate(body);
    return send(res, repo.update(id, {
      name, sport, start_date: startDate, end_date: endDate, target_activity_id: targetActivityId,
    }));
  };

  // DELETE cascades to the plan's planned_workouts (ON DELETE CASCADE, db.ts).
  const remove: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid training plan id.");
    if (!repo.byId(id)) throw notFound(`No training plan with id ${id}.`);
    repo.remove(id);
    return sendNoContent(res);
  };

  return { list, getById, create, update, remove };
}
