/**
 * src/api/client.test.ts  (HRA-63)
 * Error handling in request()/buildApiError (HRA-43), exercised through the
 * public `api` surface with a mocked global fetch. This is a living-contract
 * test: it parses the CURRENT { error } body shape, so HRA-37's switch to
 * problem+json will localize its change here.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { api, ApiError } from "./client";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("api error handling", () => {
  it("maps a gateway status (502) to a friendly ApiError, without needing a body", async () => {
    stubFetch(() => new Response("", { status: 502 }));
    const err = await api.garmin.deviceStatus().then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).message).toMatch(/busy|restarting|try again/i);
  });

  it("surfaces the problem+json `detail` on a 4xx (HRA-37)", async () => {
    stubFetch(() => new Response(
      JSON.stringify({ type: "about:blank", title: "Not Found", status: 404, detail: "Activity 999 not found." }),
      { status: 404, headers: { "Content-Type": "application/problem+json" } },
    ));
    const err = await api.garmin.deviceStatus().then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe("Activity 999 not found.");
  });

  it("falls back to problem+json `title` when there's no detail (HRA-37)", async () => {
    stubFetch(() => new Response(
      JSON.stringify({ type: "about:blank", title: "Unprocessable Entity", status: 422 }),
      { status: 422, headers: { "Content-Type": "application/problem+json" } },
    ));
    const err = await api.garmin.deviceStatus().then(() => null, (e) => e);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).message).toBe("Unprocessable Entity");
  });

  it("turns a network failure (fetch rejects) into ApiError status 0", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const err = await api.garmin.deviceStatus().then(() => null, (e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).message).toMatch(/couldn't reach/i);
  });

  it("returns parsed JSON on success", async () => {
    stubFetch(() => new Response(JSON.stringify({ connected: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(api.garmin.deviceStatus()).resolves.toEqual({ connected: true });
  });
});
