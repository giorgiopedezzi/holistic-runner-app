import { Client } from "pg";
import { getArg } from "../config.ts";
import { bindFounderIdentity } from "./founder.ts";

function requiredArg(name: "--issuer" | "--subject"): string {
  const value = getArg(name);
  if (!value) throw new Error("Usage: npm run db:bind-founder-identity -- --issuer <issuer> --subject <subject>");
  return value;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing required environment variable: DATABASE_URL");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    const result = await bindFounderIdentity(client, requiredArg("--issuer"), requiredArg("--subject"));
    await client.query("COMMIT");
    console.log(`Founder identity ${result}.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

void main();
