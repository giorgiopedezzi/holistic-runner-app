import { Client } from "pg";
import { assertOwnershipIntegrity, ownershipIntegrityChecks } from "./ownership.ts";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing required environment variable: DATABASE_URL");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const checks = await ownershipIntegrityChecks(client);
    assertOwnershipIntegrity(checks);
    for (const check of checks) console.log(`${check.name}: 0`);
  } finally {
    await client.end();
  }
}

void main();
