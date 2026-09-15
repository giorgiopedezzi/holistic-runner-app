import type http from "node:http";
import type { URL } from "node:url";
import type { AppContext } from "../http/context.ts";
import { notFound } from "../http/problem.ts";
import { send } from "../http/respond.ts";

const UNAVAILABLE = "Public resource is unavailable.";

function unavailable() {
  return notFound(UNAVAILABLE, { instance: "/api/v1/public" });
}

function publicSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw unavailable();
  }
}

export function createGuestPublicationController(ctx: AppContext) {
  const reply = (res: http.ServerResponse, data: unknown) => {
    res.setHeader("Cache-Control", "no-store");
    if (data === null) throw unavailable();
    send(res, data);
  };

  return {
    profile: async (_req: http.IncomingMessage, res: http.ServerResponse, _url: URL, slug: string) =>
      reply(res, await ctx.services.guestPublication.profile(publicSegment(slug))),
    collection: async (_req: http.IncomingMessage, res: http.ServerResponse, _url: URL, slug: string, kind: "activities" | "plans" | "reports") =>
      reply(res, await ctx.services.guestPublication.collection(publicSegment(slug), kind)),
    resource: async (_req: http.IncomingMessage, res: http.ServerResponse, _url: URL, slug: string, kind: "activities" | "plans" | "reports", publicId: string) =>
      reply(res, await ctx.services.guestPublication.resource(publicSegment(slug), kind, publicSegment(publicId))),
  };
}
