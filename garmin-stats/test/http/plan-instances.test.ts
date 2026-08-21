/**
 * test/http/plan-instances.test.ts (HRA-118)
 * GET /api/v1/plan-instances — added this Story so the frontend's instance
 * card can list instances at all (no prior endpoint returned more than one).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer } from "../helpers/server.ts";

const DSL = `PLAN
NAME Smoke Plan
PACE RG=5:00/km
SECTION "Base" WEEKS 1
WEEK 1 START 2026-09-01
D1: 5km @ RG
`;

test("GET /api/v1/plan-instances lists all instances, optionally filtered by template_id", async () => {
  const server = await startTestServer();
  try {
    const t1 = await server.api("/api/v1/plan-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Template A", dsl_source: DSL }),
    });
    const t2 = await server.api("/api/v1/plan-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Template B", dsl_source: DSL }),
    });
    const templateA = (t1.json as any).id;
    const templateB = (t2.json as any).id;

    async function instantiate(templateId: number, name: string) {
      const res = await server.api(`/api/v1/plan-templates/${templateId}/instantiate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, start_date: "2026-09-01" }),
      });
      assert.equal(res.status, 201, JSON.stringify(res.json));
      return (res.json as any).id as number;
    }

    const instA1 = await instantiate(templateA, "A instance 1");
    await instantiate(templateA, "A instance 2");
    await instantiate(templateB, "B instance 1");

    const all = await server.api("/api/v1/plan-instances");
    assert.equal(all.status, 200);
    assert.equal((all.json as any).page.total, 3);
    assert.equal((all.json as any).data.length, 3);

    const onlyA = await server.api(`/api/v1/plan-instances?template_id=${templateA}`);
    assert.equal(onlyA.status, 200);
    assert.equal((onlyA.json as any).page.total, 2);
    assert.ok((onlyA.json as any).data.every((i: any) => i.template_id === templateA));

    const onlyB = await server.api(`/api/v1/plan-instances?template_id=${templateB}`);
    assert.equal((onlyB.json as any).page.total, 1);

    const badTemplate = await server.api(`/api/v1/plan-instances?template_id=999999`);
    assert.equal(badTemplate.status, 404);

    const badId = await server.api(`/api/v1/plan-instances?template_id=notanumber`);
    assert.equal(badId.status, 400);

    // Sanity: one of the returned rows really is the instance we created.
    const ids = (all.json as any).data.map((i: any) => i.id);
    assert.ok(ids.includes(instA1));
  } finally {
    await server.close();
  }
});
