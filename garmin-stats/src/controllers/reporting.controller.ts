/**
 * controllers/reporting.controller.ts
 * HTTP boundary for the single-workout/race report (HRA-336) and the week /
 * entire-plan reports (HRA-338). Owns only request parsing/shaping — the
 * actual read boundary + calculation live in services/reporting.service.ts +
 * domain/reporting/{workout-report,report,plan-report}.ts.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { badRequest, notFound, unprocessable } from "../http/problem.ts";
import { readJsonBody } from "../http/request.ts";
import type { ReportRangeMode } from "../domain/reporting/types.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// /api/v1/plan-instances/:id/reports/workouts/:workoutId
function parseInstanceIdAndWorkoutId(pathname: string): { instanceId: number; workoutId: string } {
  const parts = pathname.split("/");
  return { instanceId: Number(parts[4]), workoutId: decodeURIComponent(parts[7]) };
}

// /api/v1/plan-instances/:id/reports/workouts/:workoutId/quality-alignment/:segmentIndex
function parseQualityAlignmentPath(pathname: string): { instanceId: number; workoutId: string; segmentIndex: number } {
  const parts = pathname.split("/");
  return { instanceId: Number(parts[4]), workoutId: decodeURIComponent(parts[7]), segmentIndex: Number(parts[9]) };
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

  // PUT /api/v1/plan-instances/:id/reports/workouts/:workoutId/quality-alignment/:segmentIndex
  // Body { activity_id, distance_m?, duration_sec? } — confirms/corrects/
  // replaces this segment's manual alignment (HRA-342 AC12). activity_id
  // must already be accepted evidence for this workout — never an arbitrary
  // activity — so a manual value always traces to real, already-trusted
  // evidence for the session it describes.
  const setQualityAlignment: Handler = async (req, res, url) => {
    const { workoutId, segmentIndex } = parseQualityAlignmentPath(url.pathname);
    if (!workoutId) throw badRequest("Invalid workout id.");
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0) throw badRequest("segmentIndex must be a non-negative integer.");

    const body = await readJsonBody<{ activity_id?: unknown; distance_m?: unknown; duration_sec?: unknown }>(req);
    if (!Number.isInteger(body.activity_id)) throw unprocessable("activity_id must be an integer.");
    const distanceM = body.distance_m == null ? null : Number(body.distance_m);
    const durationSec = body.duration_sec == null ? null : Number(body.duration_sec);
    if (distanceM != null && !Number.isFinite(distanceM)) throw unprocessable("distance_m must be a finite number or null.");
    if (durationSec != null && !Number.isFinite(durationSec)) throw unprocessable("duration_sec must be a finite number or null.");

    const result = reporting.setQualityAlignment(workoutId, segmentIndex, body.activity_id as number, distanceM, durationSec);
    if (!result.ok) throw unprocessable(`Activity ${body.activity_id} is not accepted evidence for workout ${workoutId}.`);
    return send(res, { workout_id: workoutId, segment_index: segmentIndex, activity_id: body.activity_id, distance_m: distanceM, duration_sec: durationSec });
  };

  // DELETE /api/v1/plan-instances/:id/reports/workouts/:workoutId/quality-alignment/:segmentIndex
  // Removes a manual alignment (the segment reverts to "unavailable") without
  // ever touching the underlying activity/track_points rows (AC12).
  const removeQualityAlignment: Handler = (_req, res, url) => {
    const { workoutId, segmentIndex } = parseQualityAlignmentPath(url.pathname);
    if (!workoutId) throw badRequest("Invalid workout id.");
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0) throw badRequest("segmentIndex must be a non-negative integer.");
    reporting.removeQualityAlignment(workoutId, segmentIndex);
    return send(res, { workout_id: workoutId, segment_index: segmentIndex, removed: true });
  };

  // GET /api/v1/reports/range?from=&to=&range=&as_of= (HRA-341)
  // The date-range/race-range report — cross-plan, never scoped to one
  // instance (unlike every report above). `from`/`to` are the SAME
  // YYYY-MM-DD shape POST /api/v1/date-ranges already validates; a
  // race-range is just a saved date_ranges row's own {from,to} resolved by
  // the caller before this call — no separate race-range endpoint exists,
  // since the window is the only thing this report actually needs.
  const getRangeReport: Handler = (_req, res, url) => {
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !ISO_DATE.test(from) || !to || !ISO_DATE.test(to)) throw badRequest("from and to are required dates in YYYY-MM-DD format.");
    if (from > to) throw badRequest("from must not be after to.");

    const range = parseRange(url);
    const asOf = parseAsOf(url);

    return send(res, reporting.getRangeReport(from, to, range, asOf));
  };

  return { getWorkoutReport, getWeekReport, getPlanReport, setQualityAlignment, removeQualityAlignment, getRangeReport };
}
