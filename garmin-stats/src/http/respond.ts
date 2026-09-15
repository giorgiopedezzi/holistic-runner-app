/**
 * http/respond.ts
 * The single place that writes an API response: JSON body + status + the CORS
 * headers every route shares. Moved verbatim out of server.ts (S1 refactor) —
 * behavior is byte-identical.
 */
import http from "http";
import type { Problem } from "./problem.ts";

interface CorsResponse extends http.ServerResponse { runsFreeCors?: Record<string, string> }
export function configureCors(res: http.ServerResponse, headers: Record<string, string>): void {
  (res as CorsResponse).runsFreeCors = headers;
}
function cors(res: http.ServerResponse): Record<string, string> {
  return (res as CorsResponse).runsFreeCors ?? {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  };
}

// HRA-356: the router calls configureCors() on every request when
// AUTH_ENABLED + AUTH_ALLOWED_ORIGINS are set, before any route dispatches —
// so by the time a handler runs, res already carries the correct
// origin-echoed-with-credentials (or Vary-only) headers, or nothing when
// auth is off (dev fallback: cors() below returns the permissive default).
// Handlers that bypass send()/sendProblem()/sendNoContent() because they
// stream a binary/NDJSON body (FIT/zip export, background image, sync
// progress) must still use this — not a hardcoded "*" — so they carry the
// SAME fixed CORS policy as every JSON route instead of a silently
// permissive hole that also breaks credentialed cross-origin fetch (Vercel
// frontend + Railway backend) once auth is enabled, since browsers refuse
// to expose a credentialed response whose Allow-Origin is "*".
export function corsHeaders(res: http.ServerResponse): Record<string, string> {
  return cors(res);
}

export function send(res: http.ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...cors(res),
  });
  res.end(body);
}

// RFC 7807 error response (HRA-37). Same CORS headers as send() so the browser
// can read the error body cross-origin; content type is application/problem+json.
export function sendProblem(res: http.ServerResponse, problem: Problem): void {
  const body = JSON.stringify(problem);
  res.writeHead(problem.status, {
    "Content-Type": "application/problem+json",
    ...cors(res),
  });
  res.end(body);
}

export function sendNoContent(res: http.ServerResponse): void {
  res.writeHead(204, {
    ...cors(res),
  });
  res.end();
}
