/**
 * test/http/plan-instance-day-fit.test.ts (HRA-202, packaging amended
 * HRA-392)
 * GET /api/v1/plan-instances/:id/days/:dayId/fit — exports one resolved
 * plan_instance_days row as a zip bundling a Garmin Workout .fit and its
 * paired Schedules .fit (toGarminWorkoutFit/toGarminSchedulesFit,
 * integrations/garmin-workout.ts). Verifies the response bytes are a real
 * zip (via a real external unzip tool, not just this repo's own writer)
 * whose entries decode back to the expected FIT messages, not just that a
 * 200 was returned.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestServer } from "../helpers/server.ts";
import { decodeGarminWorkoutFit, fromGarminWorkoutFit } from "../../src/integrations/garmin-workout.ts";

function extractZip(zipBytes: Buffer): Record<string, Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "hra202-day-fit-"));
  try {
    writeFileSync(join(dir, "export.zip"), zipBytes);
    execFileSync("unzip", ["-o", "export.zip"], { cwd: dir });
    const names = readdirSync(dir).filter(f => f !== "export.zip");
    const files: Record<string, Buffer> = {};
    for (const name of names) {
      files[name] = execFileSync("unzip", ["-p", "export.zip", name], { cwd: dir });
    }
    return files;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DSL = `PLAN
NAME Smoke Plan
PACE RG=5:00/km
SECTION "Base" WEEKS 1
WEEK 1 START 2026-09-01
D1: 5km @ RG
D2: REST
`;

async function setUp(server: Awaited<ReturnType<typeof startTestServer>>, instanceName = "Fit Export Instance") {
  const t = await server.api("/api/v1/plan-templates", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Fit export fixture", event: "marathon", dsl_source: DSL }),
  });
  assert.equal(t.status, 201, JSON.stringify(t.json));

  const inst = await server.api(`/api/v1/plan-templates/${(t.json as any).id}/instantiate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: instanceName, start_date: "2026-09-01" }),
  });
  assert.equal(inst.status, 201, JSON.stringify(inst.json));
  const instanceId = (inst.json as any).id as number;
  const days = (inst.json as any).days as any[];
  const runDay = days.find(d => d.date === "2026-09-01");
  const restDay = days.find(d => d.date === "2026-09-02");
  return { instanceId, runDayId: runDay.id as number, restDayId: restDay.id as number };
}

test("GET .../days/:dayId/fit downloads a zip with a workout .fit and a paired schedule .fit", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, runDayId } = await setUp(server, "Fit Export Instance");
    const res = await fetch(`${server.baseUrl}/api/v1/plan-instances/${instanceId}/days/${runDayId}/fit`, {
      headers: { cookie: server.sessionCookie, origin: "http://test.invalid" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/zip");
    assert.equal(res.headers.get("content-disposition"), 'attachment; filename="Fit Export Instance_20260901.zip"');

    const files = extractZip(Buffer.from(await res.arrayBuffer()));
    assert.deepEqual(Object.keys(files).sort(), [
      "Fit Export Instance_20260901.fit",
      "Fit Export Instance_20260901.schedule.fit",
    ]);

    const decoded = fromGarminWorkoutFit(files["Fit Export Instance_20260901.fit"]);
    assert.equal(decoded.ok, true, JSON.stringify(decoded));
    if (!decoded.ok) throw new Error("unreachable");
    assert.equal(decoded.preview.canApply, true, JSON.stringify(decoded.preview.warnings));
    assert.equal(decoded.preview.segments[0].type, "continuous");

    // HRA-392: the paired file must be a File Id type "schedules" file
    // scheduling this same date, not a message embedded in the workout file.
    const { messages, errors } = decodeGarminWorkoutFit(files["Fit Export Instance_20260901.schedule.fit"]);
    assert.deepEqual(errors, []);
    const [fileId] = messages.fileIdMesgs as Array<{ type: string }>;
    assert.equal(fileId.type, "schedules");
    const scheduleMesgs = messages.scheduleMesgs as Array<{ type: string }>;
    assert.equal(scheduleMesgs.length, 1);
    assert.equal(scheduleMesgs[0].type, "workout");
  } finally {
    await server.close();
  }
});

test("GET .../days/:dayId/fit exports a rest day as a single rest_block", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, restDayId } = await setUp(server);
    const res = await fetch(`${server.baseUrl}/api/v1/plan-instances/${instanceId}/days/${restDayId}/fit`, {
      headers: { cookie: server.sessionCookie, origin: "http://test.invalid" },
    });
    assert.equal(res.status, 200);
    const files = extractZip(Buffer.from(await res.arrayBuffer()));
    const decoded = fromGarminWorkoutFit(files["Fit Export Instance_20260902.fit"]);
    assert.equal(decoded.ok, true);
    if (!decoded.ok) throw new Error("unreachable");
    assert.equal(decoded.preview.segments[0].type, "rest_block");
  } finally {
    await server.close();
  }
});

test("GET .../days/:dayId/fit 404s for an unknown instance", async () => {
  const server = await startTestServer();
  try {
    const { runDayId } = await setUp(server);
    const res = await server.api(`/api/v1/plan-instances/999999/days/${runDayId}/fit`);
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("GET .../days/:dayId/fit 404s for a day that belongs to a different instance", async () => {
  const server = await startTestServer();
  try {
    const { instanceId: instanceA } = await setUp(server);
    const { runDayId: dayFromB } = await setUp(server);
    const res = await server.api(`/api/v1/plan-instances/${instanceA}/days/${dayFromB}/fit`);
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});

test("GET .../days/:dayId/fit 422s a day flagged needs_review, downloading nothing", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, runDayId } = await setUp(server);
    // Force needs_review via the day PATCH's own dsl re-parse path, using an
    // anchor that never resolves (allowUnboundPace: false at instance scope).
    const patch = await server.api(`/api/v1/plan-instances/${instanceId}/days/${runDayId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "placeholder" }),
    });
    assert.equal(patch.status, 200, JSON.stringify(patch.json));

    // Directly flip needs_review at the DB layer — the PATCH endpoint itself
    // refuses to persist a still-needs-review day, so this test reaches for
    // the DB to set up the state under test rather than fighting that gate.
    await server.db.run("UPDATE plan_instance_workouts w SET needs_review = true FROM plan_instance_days d WHERE d.instance_id=w.instance_id AND d.workout_id=w.workout_id AND d.id=$1", [runDayId]);

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/days/${runDayId}/fit`);
    assert.equal(res.status, 422, JSON.stringify(res.json));
    assert.equal((res.json as any).errors[0].field, "NEEDS_REVIEW");
  } finally {
    await server.close();
  }
});

test("GET .../days/:dayId/fit 422s a day whose workout_type isn't run/rest", async () => {
  const server = await startTestServer();
  try {
    const { instanceId, runDayId } = await setUp(server);
    await server.db.run("UPDATE plan_instance_workouts w SET workout_type = 'cross' FROM plan_instance_days d WHERE d.instance_id=w.instance_id AND d.workout_id=w.workout_id AND d.id=$1", [runDayId]);

    const res = await server.api(`/api/v1/plan-instances/${instanceId}/days/${runDayId}/fit`);
    assert.equal(res.status, 422, JSON.stringify(res.json));
    assert.equal((res.json as any).errors[0].field, "UNSUPPORTED_WORKOUT_TYPE");
  } finally {
    await server.close();
  }
});
