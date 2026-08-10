/**
 * http/request.ts
 * Request-side helpers: date-range query parsing + body readers. Moved verbatim
 * out of server.ts (S1 refactor) — behavior is byte-identical.
 */
import http from "http";
import { badRequest } from "./problem.ts";

export interface DateRange { from: string; to: string; }

// Default range = last 30 days (unchanged from the original server.ts).
export function dateRange(params: URLSearchParams): DateRange {
  const today = new Date().toISOString().slice(0, 10);
  const ago30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  return { from: params.get("from") ?? ago30, to: params.get("to") ?? today };
}

export function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => resolve(body));
  });
}

// Read + JSON-parse a request body. An empty body is treated as {} (matches the
// old `JSON.parse(raw || "{}")` idiom); a non-empty body that isn't valid JSON
// throws a 400 problem instead of surfacing as an uncaught 500 (HRA-33/HRA-37).
export async function readJsonBody<T = unknown>(req: http.IncomingMessage): Promise<T> {
  const raw = await readBody(req);
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw badRequest("Request body is not valid JSON.");
  }
}

// For raw binary uploads (the background-image upload) — collecting Buffer
// chunks instead of concatenating as a string avoids corrupting binary data.
export function readBodyBuffer(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
