import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

function databaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) throw new Error("PostgreSQL tests require TEST_DATABASE_URL or DATABASE_URL");
  return value;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

test("009 backfills system results and manual overrides without losing existing classifications", async () => {
  const schema = `hra_test_${randomUUID().replaceAll("-", "")}`;
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    await client.query(`SET search_path TO ${quoteIdentifier(schema)}`);
    await client.query(`CREATE TABLE activities (
      id INTEGER PRIMARY KEY,
      ai_classification TEXT,
      ai_explanation TEXT,
      statistical_classification TEXT,
      statistical_explanation TEXT,
      user_feedback TEXT,
      final_classification TEXT,
      classification_method TEXT
    )`);
    await client.query(`INSERT INTO activities VALUES
      (1, 'Long Session', 'ai long', 'Recovery Run', 'stats recovery', 'approved', 'Long Session', 'ai'),
      (2, 'Long Session', 'ai long', 'Recovery Run', 'stats recovery', 'rejected', 'Fartlek', 'statistical'),
      (3, 'Long Session', 'ai long', 'Progressive Run', 'stats progressive', NULL, NULL, NULL)`);

    const migration = await fs.readFile(fileURLToPath(new URL("../../src/db/migrations/009_system_classification_override.sql", import.meta.url)), "utf8");
    await client.query(migration);
    const rows = (await client.query<{
      id: number;
      system_classification: string | null;
      system_explanation: string | null;
      manual_classification: string | null;
    }>("SELECT id,system_classification,system_explanation,manual_classification FROM activities ORDER BY id")).rows;

    assert.deepEqual(rows, [
      { id: 1, system_classification: "Long Session", system_explanation: "ai long", manual_classification: null },
      { id: 2, system_classification: "Recovery Run", system_explanation: "stats recovery", manual_classification: "Fartlek" },
      { id: 3, system_classification: "Progressive Run", system_explanation: "stats progressive", manual_classification: null },
    ]);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await client.end();
  }
});
