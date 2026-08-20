/**
 * controllers/planned-workouts.controller.ts
 * HTTP boundary for planned sessions within a training plan (HRA-109). Collection
 * routes (list/create) are nested under the owning plan (/training-plans/:id/workouts,
 * rest-api §1's 2-level nesting); single-item routes live at top level
 * (/planned-workouts/:id) rather than a 3rd nested level. No service — validation is
 * the only logic here, same pattern as date-ranges/training-plans controllers.
 */
import type { AppContext, Handler } from "../http/context.ts";
import type { PlannedWorkoutRow, PlannedWorkoutStep } from "../db.ts";
import { WORKOUT_CLASSIFICATIONS } from "../integrations/ollama.ts";
import { send, sendNoContent } from "../http/respond.ts";
import { parsePageParams, readJsonBody } from "../http/request.ts";
import { paginated } from "../http/envelope.ts";
import { badRequest, notFound, unprocessable } from "../http/problem.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// The classifier's six running categories (see integrations/ollama.ts) plus the two
// non-running-classifier session kinds a plan also needs — reusing that vocabulary
// (rather than a parallel one) is what lets a future planned-vs-actual comparison
// cross-reference the classifier's own output directly.
const WORKOUT_TYPES = [...WORKOUT_CLASSIFICATIONS, "Rest", "Race"] as const;

function parseId(pathname: string): number {
  return Number(pathname.split("/").pop());
}

// /api/v1/training-plans/:id/workouts — the plan id is the 2nd-to-last segment.
function parsePlanId(pathname: string): number {
  const parts = pathname.split("/");
  return Number(parts[parts.length - 2]);
}

type StepInput = Partial<Record<"repeatCount" | "distanceM" | "durationSec" | "targetPaceMinKm", unknown>>;
type Body = Partial<{
  date: string; workout_type: string; distance_m: number | null; duration_sec: number | null;
  target_pace_minkm: number | null; steps: StepInput[] | null;
}>;

// A single-level (non-recursive) repeat-block array — see PlannedWorkoutStep in
// db.ts. Each step needs at least a distance or duration target to mean anything.
function validateSteps(steps: StepInput[] | null | undefined): PlannedWorkoutStep[] | null {
  if (steps == null) return null;
  if (!Array.isArray(steps)) throw unprocessable("steps must be an array.");
  return steps.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) throw unprocessable(`steps[${i}] must be an object.`);
    const step: PlannedWorkoutStep = {};
    if (raw.repeatCount != null) {
      const n = Number(raw.repeatCount);
      if (!Number.isInteger(n) || n < 1) throw unprocessable(`steps[${i}].repeatCount must be a positive integer.`);
      step.repeatCount = n;
    }
    if (raw.distanceM != null) {
      const n = Number(raw.distanceM);
      if (!Number.isFinite(n) || n <= 0) throw unprocessable(`steps[${i}].distanceM must be a positive number.`);
      step.distanceM = n;
    }
    if (raw.durationSec != null) {
      const n = Number(raw.durationSec);
      if (!Number.isFinite(n) || n <= 0) throw unprocessable(`steps[${i}].durationSec must be a positive number.`);
      step.durationSec = n;
    }
    if (raw.targetPaceMinKm != null) {
      const n = Number(raw.targetPaceMinKm);
      if (!Number.isFinite(n) || n <= 0) throw unprocessable(`steps[${i}].targetPaceMinKm must be a positive number.`);
      step.targetPaceMinKm = n;
    }
    if (step.distanceM == null && step.durationSec == null) {
      throw unprocessable(`steps[${i}] must set distanceM or durationSec.`);
    }
    return step;
  });
}

function optionalPositiveNumber(value: unknown, field: string): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw unprocessable(`${field} must be a positive number.`);
  return n;
}

export function createPlannedWorkoutsController(ctx: AppContext) {
  const repo = ctx.repos.plannedWorkouts;
  const plansRepo = ctx.repos.trainingPlans;

  const list: Handler = (_req, res, url) => {
    const planId = parsePlanId(url.pathname);
    if (!Number.isInteger(planId)) throw badRequest("Invalid training plan id.");
    if (!plansRepo.byId(planId)) throw notFound(`No training plan with id ${planId}.`);
    const { limit, offset } = parsePageParams(url.searchParams);
    const total = repo.countByPlan(planId).count;
    return send(res, paginated(repo.listPageByPlan(planId, limit, offset), total, limit, offset));
  };

  const getById: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid planned workout id.");
    const row = repo.byId(id);
    if (!row) throw notFound(`No planned workout with id ${id}.`);
    return send(res, row);
  };

  // Shared by create/update.
  function validate(body: Body): Omit<PlannedWorkoutRow, "id" | "plan_id" | "created_at"> {
    if (!body.date || !ISO_DATE.test(body.date)) throw unprocessable("date is required in YYYY-MM-DD format.");
    if (!body.workout_type || !(WORKOUT_TYPES as readonly string[]).includes(body.workout_type)) {
      throw unprocessable(`workout_type must be one of: ${WORKOUT_TYPES.join(", ")}`);
    }
    const distanceM = optionalPositiveNumber(body.distance_m, "distance_m");
    const durationSec = optionalPositiveNumber(body.duration_sec, "duration_sec");
    const targetPaceMinKm = optionalPositiveNumber(body.target_pace_minkm, "target_pace_minkm");
    const steps = validateSteps(body.steps);
    return {
      date: body.date, workout_type: body.workout_type,
      distance_m: distanceM, duration_sec: durationSec, target_pace_minkm: targetPaceMinKm,
      steps: steps ? JSON.stringify(steps) : null,
    };
  }

  const create: Handler = async (req, res, url) => {
    const planId = parsePlanId(url.pathname);
    if (!Number.isInteger(planId)) throw badRequest("Invalid training plan id.");
    if (!plansRepo.byId(planId)) throw notFound(`No training plan with id ${planId}.`);
    const body = await readJsonBody<Body>(req);
    const fields = validate(body);
    const row = repo.create({ plan_id: planId, ...fields });
    res.setHeader("Location", `/api/v1/planned-workouts/${row.id}`);
    return send(res, row, 201);
  };

  // PUT /api/v1/planned-workouts/:id — full replacement (rest-api §2). plan_id is
  // immutable, not part of the replaceable representation (see the repo's update()).
  const update: Handler = async (req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid planned workout id.");
    if (!repo.byId(id)) throw notFound(`No planned workout with id ${id}.`);
    const body = await readJsonBody<Body>(req);
    const fields = validate(body);
    return send(res, repo.update(id, fields));
  };

  const remove: Handler = (_req, res, url) => {
    const id = parseId(url.pathname);
    if (!Number.isInteger(id)) throw badRequest("Invalid planned workout id.");
    if (!repo.byId(id)) throw notFound(`No planned workout with id ${id}.`);
    repo.remove(id);
    return sendNoContent(res);
  };

  return { list, getById, create, update, remove };
}
