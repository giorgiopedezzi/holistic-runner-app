/**
 * controllers/reporting.controller.ts
 * HTTP boundary for the single-workout/race report (HRA-336). Owns only
 * request parsing/shaping — the actual read boundary + calculation live in
 * services/reporting.service.ts + domain/reporting/workout-report.ts.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { badRequest, notFound } from "../http/problem.ts";

// /api/v1/plan-instances/:id/reports/workouts/:workoutId
function parseInstanceIdAndWorkoutId(pathname: string): { instanceId: number; workoutId: string } {
  const parts = pathname.split("/");
  return { instanceId: Number(parts[4]), workoutId: decodeURIComponent(parts[7]) };
}

export function createReportingController(ctx: AppContext) {
  const { reporting } = ctx.services;

  const getWorkoutReport: Handler = (_req, res, url) => {
    const { instanceId, workoutId } = parseInstanceIdAndWorkoutId(url.pathname);
    if (!Number.isInteger(instanceId)) throw badRequest("Invalid plan instance id.");
    if (!workoutId) throw badRequest("Invalid workout id.");

    // asOf: an explicit request override for the report's own future/missed
    // cutoff — the same optional-instant convention report.ts's ReportRequest
    // already uses, exposed here as a query param since this is a GET.
    const asOfParam = url.searchParams.get("as_of");
    let asOf: Date | undefined;
    if (asOfParam) {
      asOf = new Date(asOfParam);
      if (Number.isNaN(asOf.getTime())) throw badRequest("as_of must be a valid ISO instant.");
    }

    const report = reporting.getWorkoutReport(instanceId, workoutId, asOf);
    if (!report) throw notFound(`No workout ${workoutId} found on plan instance ${instanceId}.`);
    return send(res, report);
  };

  return { getWorkoutReport };
}
