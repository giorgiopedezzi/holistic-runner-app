import test from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

test("GET /api/v1/auth/login rejects an unsupported client-selected Auth0 connection before discovery", async () => {
  const server = await startTestServer();
  try {
    const response = await server.api("/api/v1/auth/login?method=Username-Password-Authentication");
    assert.equal(response.status, 400);
    assert.deepEqual(response.json, {
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      detail: "Unsupported sign-in method.",
      instance: "/api/v1/auth/login",
    });
  } finally {
    await server.close();
  }
});
