import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("Missing required environment variable: DATABASE_URL");
  return value;
}

async function migrationFiles(): Promise<string[]> {
  return (await fs.readdir(migrationsDir)).filter(file => file.endsWith(".sql")).sort();
}

async function main(): Promise<void> {
  const statusOnly = process.argv.includes("--status");
  const client = new Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const applied = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map(row => row.name));
    const files = await migrationFiles();
    if (statusOnly) {
      for (const file of files) console.log(`${applied.has(file) ? "applied" : "pending"}  ${file}`);
      return;
    }
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`applied  ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

void main();
