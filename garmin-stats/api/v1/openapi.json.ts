/**
 * api/v1/openapi.json.ts
 * Vercel serverless entry point for GET /api/v1/openapi.json. Imports the spec
 * as a JSON module (bundled at build time) instead of reading it off disk at
 * request time, since a serverless function gets no guaranteed access to the
 * repo's file layout the way the local server does.
 */
import type { IncomingMessage, ServerResponse } from "http";
import spec from "../../openapi.json" with { type: "json" };

export default function handler(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(spec));
}
