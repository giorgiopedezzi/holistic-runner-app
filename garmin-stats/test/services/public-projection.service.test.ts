import assert from "node:assert/strict";
import { test } from "node:test";
import { FOUNDER_USER_ID } from "../../src/db/founder.ts";
import type { ProjectionResourceInput } from "../../src/domain/publication/public-projection.ts";
import { createPublishedProjectionRepo } from "../../src/repositories/published-projection.repo.ts";
import { createPublicProjectionRepo } from "../../src/repositories/public-projection.repo.ts";
import { createPublicProjectionService } from "../../src/services/public-projection.service.ts";
import { createTestDb } from "../helpers/db.ts";

function authoritativeResources(distanceM = 12_345): ProjectionResourceInput[] {
  return [
    {
      kind: "profile" as const,
      sourceId: FOUNDER_USER_ID,
      fields: {
        displayName: "Founder Runner", locale: "en-GB", email: "private@example.com",
        providerSubject: "auth0|founder", unapprovedField: "drop me",
      },
    },
    {
      kind: "activity" as const,
      sourceId: "42",
      fields: {
        title: "Sunday long run", date: "2026-09-13", sport: "running", distanceM,
        filename: "secret.fit", ownerUserId: FOUNDER_USER_ID,
        track: [
          { elapsedSec: 0, distanceM: 0, heartRate: 120, lat: 45.123, lon: 9.456 },
          { elapsedSec: 60, distanceM: 180, heartRate: 142, startLocation: "home" },
        ],
      },
    },
    {
      kind: "plan" as const,
      sourceId: "84",
      fields: {
        name: "Boston build", event: "marathon", raceDate: "2028-04-17",
        workouts: [{ workoutId: "private-workout-7", date: "2026-09-13", workoutType: "run", notes: "private note" }],
      },
    },
    {
      kind: "report" as const,
      sourceId: "90",
      fields: {
        kind: "plan", range: "plan_to_date", generatedAt: "2026-09-15T12:00:00.000Z",
        datasets: { actual: { distanceM: 4_321, paceSecPerKm: null, valid: true } },
        coverage: { trustedActivities: 3, activityIds: [42] },
        rawPayload: { accessToken: "never" },
      },
    },
  ];
}

test("public projection is allowlisted, redacted, opaque, and publication-gated", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const repo = createPublicProjectionRepo(db);
    const reader = createPublishedProjectionRepo(db);
    const service = createPublicProjectionService(db, repo);
    const refreshed = await service.refresh({
      sourceUserId: FOUNDER_USER_ID,
      slug: "founder-journey",
      sourceVersion: "private:activity=42;plan=84;revision=7",
      resources: authoritativeResources(),
      now: new Date("2026-09-15T12:30:00.000Z"),
    });
    assert.equal(refreshed.status, "updated");
    assert.match(refreshed.sourceVersion, /^[a-f0-9]{64}$/);
    assert.equal(await reader.getBySlug("founder-journey").then(result => result.status), "unavailable");

    await repo.setPublicationState(refreshed.sourceId, "published");
    const published = await reader.getBySlug("founder-journey");
    assert.equal(published.status, "available");
    if (published.status !== "available") return;

    assert.equal(published.snapshot.profile?.fields.displayName, "Founder Runner");
    assert.equal(published.snapshot.profile?.fields.email, undefined);
    assert.equal(published.snapshot.activities[0]?.fields.distanceM, 12_345);
    assert.deepEqual(published.snapshot.activities[0]?.fields.track, [
      { elapsedSec: 0, distanceM: 0, heartRate: 120 },
      { elapsedSec: 60, distanceM: 180, heartRate: 142 },
    ]);
    assert.deepEqual(published.snapshot.plans[0]?.fields.workouts, [{ date: "2026-09-13", workoutType: "run" }]);
    assert.deepEqual(published.snapshot.reports[0]?.fields.datasets, { actual: { distanceM: 4_321, paceSecPerKm: null, valid: true } });

    const serialized = JSON.stringify(published.snapshot);
    for (const privateValue of [FOUNDER_USER_ID, "private-workout-7", "secret.fit", "private note", "private:activity=42"]) {
      assert.equal(serialized.includes(privateValue), false, `snapshot leaked ${privateValue}`);
    }
    const publicIds = [
      published.snapshot.profile?.publicId,
      published.snapshot.activities[0]?.publicId,
      published.snapshot.plans[0]?.publicId,
      published.snapshot.reports[0]?.publicId,
    ];
    assert.equal(new Set(publicIds).size, 4);
    for (const id of publicIds) assert.match(id ?? "", /^[0-9a-f-]{36}$/);

    const viewColumns = (await db.all<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'published_public_projections' ORDER BY ordinal_position",
    )).map(row => row.column_name);
    assert.deepEqual(viewColumns, ["public_slug", "source_version", "payload", "projected_at"]);
  } finally {
    await cleanup();
  }
});

test("refresh is idempotent and a failed retry preserves the last safe snapshot", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const repo = createPublicProjectionRepo(db);
    const reader = createPublishedProjectionRepo(db);
    const service = createPublicProjectionService(db, repo);
    const first = await service.refresh({
      sourceUserId: FOUNDER_USER_ID, slug: "founder-journey", sourceVersion: "revision-1",
      resources: authoritativeResources(), now: new Date("2026-09-15T12:30:00.000Z"),
    });
    await repo.setPublicationState(first.sourceId, "published");
    const before = await reader.getBySlug("founder-journey");
    assert.equal(before.status, "available");
    if (before.status !== "available") return;

    const unchanged = await service.refresh({
      sourceUserId: FOUNDER_USER_ID, slug: "founder-journey", sourceVersion: "revision-1",
      resources: authoritativeResources(99_999), now: new Date("2026-09-15T13:00:00.000Z"),
    });
    assert.equal(unchanged.status, "unchanged");
    assert.deepEqual(await reader.getBySlug("founder-journey"), before);

    await assert.rejects(() => service.refresh({
      sourceUserId: FOUNDER_USER_ID, slug: "retargeted-journey", sourceVersion: "revision-2",
      resources: authoritativeResources(),
    }), /slug is immutable/);
    assert.deepEqual(await reader.getBySlug("retargeted-journey"), { status: "unavailable" });
    assert.deepEqual(await reader.getBySlug("founder-journey"), before);

    const invalid = authoritativeResources();
    invalid[1]!.fields = { ...invalid[1]!.fields, distanceM: 12_345n };
    await assert.rejects(() => service.refresh({
      sourceUserId: FOUNDER_USER_ID, slug: "founder-journey", sourceVersion: "revision-2",
      resources: invalid, now: new Date("2026-09-15T13:30:00.000Z"),
    }), /JSON-compatible/);
    assert.deepEqual(await reader.getBySlug("founder-journey"), before);
    const stored = await repo.getSnapshot(first.sourceId);
    assert.equal(stored?.last_error, "projection_refresh_failed");

    const retried = await service.refresh({
      sourceUserId: FOUNDER_USER_ID, slug: "founder-journey", sourceVersion: "revision-2",
      resources: authoritativeResources(22_222), now: new Date("2026-09-15T14:00:00.000Z"),
    });
    assert.equal(retried.status, "updated");
    const afterRetry = await reader.getBySlug("founder-journey");
    assert.equal(afterRetry.status, "available");
    if (afterRetry.status !== "available") return;
    assert.equal(afterRetry.snapshot.activities[0]?.fields.distanceM, 22_222);
    assert.deepEqual(
      afterRetry.snapshot.activities.map(resource => resource.publicId),
      before.snapshot.activities.map(resource => resource.publicId),
    );
    assert.equal((await repo.getSnapshot(first.sourceId))?.last_error, null);

    await repo.setPublicationState(first.sourceId, "suspended");
    assert.deepEqual(await reader.getBySlug("founder-journey"), { status: "unavailable" });
  } finally {
    await cleanup();
  }
});
