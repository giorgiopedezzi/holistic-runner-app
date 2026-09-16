import type { AppContext, Handler } from "../http/context.ts";
import { requestIdentity } from "../http/auth-context.ts";
import { send } from "../http/respond.ts";
import { forbidden } from "../http/problem.ts";
import { PublicationForbiddenError } from "../services/publication-lifecycle.service.ts";
import { gatherFounderProjectionInput } from "../services/publication-source.service.ts";

// Every founder-only publication route collapses the same domain rejection to
// the same 403 — the Story's own uniform non-disclosure requirement: an
// ordinary authenticated user gets no signal, from any of these five routes,
// that founder-only publication controls exist at all.
async function guardForbidden<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof PublicationForbiddenError) throw forbidden();
    throw e;
  }
}

export function createPublicationController(ctx: AppContext) {
  const status: Handler = async (req, res) => {
    const userId = requestIdentity(req).userId;
    send(res, await guardForbidden(() => ctx.services.publicationLifecycle.status(userId)));
  };

  const preview: Handler = async (req, res) => {
    const userId = requestIdentity(req).userId;
    send(res, await guardForbidden(async () => {
      const input = await gatherFounderProjectionInput(userId, ctx.repos.identity, ctx.repos.activities);
      return ctx.services.publicationLifecycle.preview(userId, input);
    }));
  };

  const publish: Handler = async (req, res) => {
    const userId = requestIdentity(req).userId;
    send(res, await guardForbidden(async () => {
      const input = await gatherFounderProjectionInput(userId, ctx.repos.identity, ctx.repos.activities);
      return ctx.services.publicationLifecycle.publish(userId, input);
    }));
  };

  const refresh: Handler = async (req, res) => {
    const userId = requestIdentity(req).userId;
    send(res, await guardForbidden(async () => {
      const input = await gatherFounderProjectionInput(userId, ctx.repos.identity, ctx.repos.activities);
      // refresh()'s own return value carries the private projection-source id
      // (never surfaced to a caller, see the Story's "no private resource
      // IDs" requirement) — re-reading status() gives the same uniform,
      // already-redacted shape every other route on this controller returns.
      await ctx.services.publicationLifecycle.refresh(userId, input);
      return ctx.services.publicationLifecycle.status(userId);
    }));
  };

  const suspend: Handler = async (req, res) => {
    const userId = requestIdentity(req).userId;
    send(res, await guardForbidden(() => ctx.services.publicationLifecycle.suspend(userId)));
  };

  return { status, preview, publish, refresh, suspend };
}
