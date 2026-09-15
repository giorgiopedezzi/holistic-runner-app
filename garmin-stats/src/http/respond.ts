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
