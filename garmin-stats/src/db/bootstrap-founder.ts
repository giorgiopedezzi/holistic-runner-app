import { Client } from "pg";
import { ensureFounder } from "./founder.ts";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing required environment variable: DATABASE_URL");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    await ensureFounder(client);
    await client.query("COMMIT");
    console.log("Founder user and settings are ready.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

void main();
