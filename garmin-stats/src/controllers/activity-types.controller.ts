/**
 * controllers/activity-types.controller.ts
 * HTTP boundary for the activity_types reference lookup. Read-only — the set of
 * types is fixed data, not user-editable.
 */
import type { AppContext, Handler } from "../http/context.ts";
import { send } from "../http/respond.ts";
import { wholePage } from "../http/envelope.ts";

export function createActivityTypesController(ctx: AppContext) {
  const repo = ctx.repos.activityTypes;

  // Small, fixed reference set — wrapped whole for shape consistency with
  // every other collection endpoint (envelope.ts), not offset-paginated.
  const list: Handler = (_req, res) => send(res, wholePage(repo.list()));

  return { list };
}
