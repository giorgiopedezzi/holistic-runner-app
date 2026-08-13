/**
 * src/test/api-stub.ts  (HRA-67)
 * A URL-routed fetch stub for the characterization test net. It keeps the
 * REAL api/client.ts in the loop (per the epic's convention — see
 * api/client.test.ts's `vi.stubGlobal("fetch", …)`), only substituting the
 * network boundary. Handlers are keyed by "METHOD /pathname"; the value is
 * either a plain JSON body (→ 200) or a function returning a Response.
 *
 * An unmatched request returns a 404 problem+json rather than hanging or
 * throwing, so a component that fetches an endpoint a test didn't stub simply
 * renders its own error state (visible, isolated) instead of crashing the
 * whole render — every section in ManageTab, for instance, handles its own
 * failure independently.
 */
import { vi } from "vitest";
import type { Paginated } from "@/types/api";

export interface StubRequest {
  url: URL;
  method: string;
  body: unknown;
}
export type RouteHandler = (req: StubRequest) => Response | Promise<Response>;
export type Routes = Record<string, RouteHandler | unknown>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function problem(status: number, detail: string): Response {
  return new Response(JSON.stringify({ type: "about:blank", title: "Error", status, detail }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

// Wraps rows in the offset-paginated envelope every collection endpoint
// returns (types/api.ts's Paginated). `total` defaults to the row count.
export function paginated<T>(data: T[], total = data.length): Paginated<T> {
  return { data, page: { limit: Math.max(data.length, 1), offset: 0, total } };
}

/**
 * Installs the routed fetch and returns the underlying vi mock so a test can
 * assert on calls (e.g. that a save hit the right PUT endpoint). Call inside
 * a test/beforeEach; client.test.ts's afterEach(vi.unstubAllGlobals) pattern
 * is handled globally by callers.
 */
export function installFetch(routes: Routes) {
  const mock = vi.fn(async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${url.pathname}`;
    const route = routes[key];
    if (route === undefined) return problem(404, `no stub for ${key}`);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    if (typeof route === "function") return (route as RouteHandler)({ url, method, body });
    // A ready-made Response (from json()/problem() used directly as a value) is
    // returned as-is — cloned, since a Response body can only be read once and
    // the same route may be hit by more than one call. Anything else is treated
    // as a JSON body → 200.
    if (route instanceof Response) return route.clone();
    return json(route);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
