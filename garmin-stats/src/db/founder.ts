import type { Client } from "pg";

// Deliberately stable and not derived from an email or provider identifier.
export const FOUNDER_USER_ID = "00000000-0000-4000-8000-000000000001";

export async function ensureFounder(client: Pick<Client, "query">): Promise<void> {
  await client.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [FOUNDER_USER_ID]);
  await client.query("INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [FOUNDER_USER_ID]);
}
