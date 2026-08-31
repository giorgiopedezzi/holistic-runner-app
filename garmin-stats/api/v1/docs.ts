/**
 * api/v1/docs.ts
 * Vercel serverless entry point for GET /api/v1/docs. Reuses docs.controller's
 * `ui` handler as-is — it renders a static, dependency-free HTML page and never
 * touches AppContext, so no db/repos/services wiring is needed here.
 */
import type { IncomingMessage, ServerResponse } from "http";
import { createDocsController } from "../../src/controllers/docs.controller.ts";
import type { AppContext } from "../../src/http/context.ts";

const { ui } = createDocsController({} as AppContext);

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return ui(req, res, new URL(req.url ?? "/", "http://localhost"));
}
