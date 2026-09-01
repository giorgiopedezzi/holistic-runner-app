/**
 * http/demo-guard.ts
 * Wraps a write-route Handler so it's rejected with 403 whenever DEMO_MODE is
 * on (HRA-220) — the backend is the enforcement boundary; a frontend-disabled
 * control alone would still leave the endpoint directly callable.
 */
import type { AppContext, Handler } from "./context.ts";
import { forbidden } from "./problem.ts";

export function demoGuarded(ctx: AppContext, handler: Handler): Handler {
  return async (req, res, url) => {
    if (ctx.config.demoMode) {
      throw forbidden("This action is disabled in the demo (DEMO_MODE is enabled).");
    }
    return handler(req, res, url);
  };
}
