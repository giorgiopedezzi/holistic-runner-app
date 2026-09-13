/**
 * controllers/reporting.controller.ts
 * HTTP boundary for the single-workout/race report (HRA-336) and the week /
 * entire-plan reports (HRA-338). Owns only request parsing/shaping — the
 * actual read boundary + calculation live in services/reporting.service.ts +
 * domain/reporting/{workout-report,report,plan-report}.ts.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { badRequest, notFound } from "../http/problem.ts";
import type { ReportRangeMode } from "../domain/reporting/types.ts";

// /api/v1/plan-instances/:id/reports/workouts/:workoutId
function parseInstanceIdAndWorkoutId(pathname: string): { instanceId: number; workoutId: string } {
  const parts = pathname.split("/");
  return { instanceId: Number(parts[4]), workoutId: decodeURIComponent(parts[7]) };
}

// /api/v1/plan-instances/:id/reports/weeks and .../reports/plan
function parseInstanceId(pathname: string): number {
  return Number(pathname.split("/")[4]);
}

// AC1: an explicit OR server-resolved `asOf` instant — the same optional-
// instant convention report.ts's ReportRequest already uses, exposed here as
// a query param since these are GETs.
function parseAsOf(url: URL): Date | undefined {
  const asOfParam = url.searchParams.get("as_of");
  if (!asOfParam) return undefined;
  const asOf = new Date(asOfParam);
  if (Number.isNaN(asOf.getTime())) throw badRequest("as_of must be a valid ISO instant.");
  return asOf;
}

// AC4: "plan-to-date is the default execution scope" — an explicit ?range=
// overrides it; anything else is a malformed request, not a silent fallback.
function parseRange(url: URL): ReportRangeMode {
  const raw = url.searchParams.get("range");
  if (raw == null) return "plan_to_date";
  if (raw === "plan_to_date" || raw === "full_plan") return raw;
  throw badRequest('range must be "plan_to_date" or "full_plan".');
}

export function createReportingController(ctx: AppContext) {
  const { reporting } = ctx.services;

  const getWorkoutReport: Handler = (_req, res, url) => {
    const { instanceId, workoutId } = parseInstanceIdAndWorkoutId(url.pathname);
    if (!Number.isInteger(instanceId)) throw badRequest("Invalid plan instance id.");
    if (!workoutId) throw badRequest("Invalid workout id.");

    const asOf = parseAsOf(url);
    const report = reporting.getWorkoutReport(instanceId, workoutId, asOf);
    if (!report) throw notFound(`No workout ${workoutId} found on plan instance ${instanceId}.`);
    return send(res, report);
  };

  // GET /api/v1/plan-instances/:id/reports/weeks?section_name=&week_number=&range=&as_of=
  const getWeekReport: Handler = (_req, res, url) => {
    const instanceId = parseInstanceId(url.pathname);
    if (!Number.isInteger(instanceId)) throw badRequest("Invalid plan instance id.");

    const sectionName = url.searchParams.get("section_name");
    if (!sectionName) throw badRequest("section_name is required.");
    const weekNumberParam = url.searchParams.get("week_number");
    const weekNumber = Number(weekNumberParam);
    if (!weekNumberParam || !Number.isInteger(weekNumber)) throw badRequest("week_number must be an integer.");

    const range = parseRange(url);
    const asOf = parseAsOf(url);

    const report = reporting.getWeekReport(instanceId, sectionName, weekNumber, range, asOf);
    if (!report) throw notFound(`No week "${sectionName}" #${weekNumber} found on plan instance ${instanceId}.`);
    return send(res, report);
  };

  // GET /api/v1/plan-instances/:id/reports/plan?range=&as_of=
  const getPlanReport: Handler = (_req, res, url) => {
    const instanceId = parseInstanceId(url.pathname);
    if (!Number.isInteger(instanceId)) throw badRequest("Invalid plan instance id.");

    const range = parseRange(url);
    const asOf = parseAsOf(url);

    const report = reporting.getPlanReport(instanceId, range, asOf);
    if (!report) throw notFound(`No plan instance ${instanceId} found.`);
    return send(res, report);
  };

  return { getWorkoutReport, getWeekReport, getPlanReport };
}
