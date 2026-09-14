import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seedSampleData, SAMPLE_ACTIVITIES } from "./helpers/db.ts";
import { bindFounderIdentity, FOUNDER_USER_ID } from "../src/db/founder.ts";
import { assertOwnershipIntegrity, ownershipIntegrityChecks } from "../src/db/ownership.ts";

test("fresh PostgreSQL schema has the runtime tables and founder settings", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const tables = (await db.all<{ name: string }>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name")).map(row => row.name);
    for (const table of ["activities", "track_points", "body_measurements", "user_settings"]) {
      assert.ok(tables.includes(table), `expected table ${table} to exist`);
    }
    const settings = await db.get<{ theme: string; unit_system: string; min_trend_group_size: number }>("SELECT theme, unit_system, min_trend_group_size FROM user_settings");
    assert.ok(settings, "founder settings should exist");
    assert.equal(settings.theme, "auto");
    assert.equal(settings.unit_system, "auto");
    assert.equal(settings.min_trend_group_size, 5);
  } finally {
    await cleanup();
  }
});

test("each PostgreSQL test schema is isolated", async () => {
  const a = await createTestDb();
  const b = await createTestDb();
  try {
    await seedSampleData(a.db);
    const aCount = (await a.db.get<{ c: number }>("SELECT COUNT(*)::int AS c FROM activities"))!.c;
    const bCount = (await b.db.get<{ c: number }>("SELECT COUNT(*)::int AS c FROM activities"))!.c;
    assert.equal(aCount, SAMPLE_ACTIVITIES.length);
    assert.equal(bCount, 0);
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});

test("seedSampleData inserts activities, track points and a body measurement", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const { activityIds } = await seedSampleData(db);
    assert.equal(activityIds.length, 2);
    const activities = await db.all<{ source: string }>("SELECT source FROM activities ORDER BY id");
    assert.deepEqual(activities.map(activity => activity.source), ["garmin", "strava"]);
    const trackPoints = (await db.get<{ c: number }>("SELECT COUNT(*)::int AS c FROM track_points WHERE activity_id = $1", [activityIds[0]]))!.c;
    assert.equal(trackPoints, 3);
    const body = (await db.get<{ c: number }>("SELECT COUNT(*)::int AS c FROM body_measurements"))!.c;
    assert.equal(body, 1);
  } finally {
    await cleanup();
  }
});

test("track points cascade-delete with their parent activity", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const { activityIds } = await seedSampleData(db);
    await db.run("DELETE FROM activities WHERE id = $1", [activityIds[0]]);
    const points = (await db.get<{ c: number }>("SELECT COUNT(*)::int AS c FROM track_points WHERE activity_id = $1", [activityIds[0]]))!.c;
    assert.equal(points, 0);
  } finally {
    await cleanup();
  }
});

test("founder identity binding is idempotent, pair-based, and never email-derived", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const issuer = "https://idp.example.com/";
    const subject = "founder-subject";
    const first = await db.transaction(client => bindFounderIdentity(client, issuer, subject));
    const second = await db.transaction(client => bindFounderIdentity(client, issuer, subject));
    assert.equal(first, "bound");
    assert.equal(second, "already_bound");
    const binding = await db.get<{ user_id: string; email_at_link_time: string | null }>("SELECT user_id::text, email_at_link_time FROM external_identities WHERE issuer = $1 AND subject = $2", [issuer, subject]);
    assert.deepEqual(binding, { user_id: FOUNDER_USER_ID, email_at_link_time: null });
    await db.run("INSERT INTO users (id) VALUES ($1)", ["00000000-0000-4000-8000-000000000099"]);
    await db.run("INSERT INTO external_identities (user_id, issuer, subject, email_at_link_time) VALUES ($1, $2, $3, $4)", ["00000000-0000-4000-8000-000000000099", "https://other-idp.example.com/", "other-subject", "founder@example.com"]);
    await assert.rejects(() => db.transaction(client => bindFounderIdentity(client, "https://other-idp.example.com/", "other-subject")), /different internal user/);
  } finally {
    await cleanup();
  }
});

test("ownership integrity verification passes the migrated schema and fails clearly for a reported violation", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    await seedSampleData(db);
    const checks = await db.transaction(client => ownershipIntegrityChecks(client));
    assertOwnershipIntegrity(checks);
    assert.throws(() => assertOwnershipIntegrity([{ name: "cross_owner_associations", violations: 1 }]), /cross_owner_associations=1/);
  } finally {
    await cleanup();
  }
});
