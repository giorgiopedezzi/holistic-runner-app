/**
 * http/problem.ts
 * RFC 7807 `application/problem+json` error model (HRA-37). Controllers throw an
 * ApiProblem instead of hand-writing `{ error }` bodies + status codes; the
 * router catches it and renders it via sendProblem (http/respond.ts).
 *
 * `type` is "about:blank" (RFC 7807's sentinel for "no more info than the HTTP
 * status conveys") — we don't host a docs site per error type; `title` +
 * `detail` carry the meaning. `errors[]` is optional field-level validation.
 */
// One approved instance whose resolved date range overlaps the candidate
// being activated (HRA-249) — carried on a 409 from POST
// .../plan-instances/:id/approve so the frontend can name every conflict
// without a second round trip.
export interface PlanInstanceOverlap {
  id: number;
  name: string | null;
  start_date: string;
  end_date: string;
  overlap_start: string;
  overlap_end: string;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: { field: string; message: string }[];
  overlaps?: {
    candidate: { id: number; name: string | null; start_date: string; end_date: string };
    conflicts: PlanInstanceOverlap[];
  };
}

export class ApiProblem extends Error {
  // NB: an explicit field + assignment, not a `public readonly` parameter
  // property — Node's strip-only .ts runtime rejects parameter properties.
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(problem.detail ?? problem.title);
    this.name = "ApiProblem";
    this.problem = problem;
  }
}

function make(status: number, title: string, detail?: string, extra?: Partial<Problem>): ApiProblem {
  return new ApiProblem({ type: "about:blank", title, status, ...(detail ? { detail } : {}), ...extra });
}

// 400 — the request itself is malformed (unparseable body, bad path param).
export const badRequest      = (detail?: string, extra?: Partial<Problem>) => make(400, "Bad Request", detail, extra);
// 403 — the request is understood but rejected on policy grounds (DEMO_MODE).
export const forbidden       = (detail?: string, extra?: Partial<Problem>) => make(403, "Forbidden", detail, extra);
// 404 — the resource doesn't exist (or the caller may not know it exists).
export const notFound        = (detail?: string, extra?: Partial<Problem>) => make(404, "Not Found", detail, extra);
// 409 — a conflict (duplicate, version clash).
export const conflict        = (detail?: string, extra?: Partial<Problem>) => make(409, "Conflict", detail, extra);
// 413 — the body is larger than allowed.
export const payloadTooLarge = (detail?: string, extra?: Partial<Problem>) => make(413, "Payload Too Large", detail, extra);
// 422 — the request parsed fine but breaks a validation rule.
export const unprocessable   = (detail?: string, extra?: Partial<Problem>) => make(422, "Unprocessable Entity", detail, extra);
// 500 — an unexpected server error; detail is deliberately generic (never leaks internals).
export const internal        = (detail = "An unexpected error occurred.") => make(500, "Internal Server Error", detail);
