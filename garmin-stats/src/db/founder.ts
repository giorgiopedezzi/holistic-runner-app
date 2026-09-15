import type { Client } from "pg";

// Deliberately stable and not derived from an email or provider identifier.
export const FOUNDER_USER_ID = "00000000-0000-4000-8000-000000000001";
export const PUBLISH_PROFILE_ENTITLEMENT = "can_publish_profile";

type FounderClient = Pick<Client, "query">;

export async function ensureFounder(client: FounderClient): Promise<void> {
  await client.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [FOUNDER_USER_ID]);
  await client.query("INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [FOUNDER_USER_ID]);
  await client.query(
    "INSERT INTO user_entitlements (user_id, entitlement) VALUES ($1, $2) ON CONFLICT (user_id, entitlement) DO NOTHING",
    [FOUNDER_USER_ID, PUBLISH_PROFILE_ENTITLEMENT],
  );
}

// An external identity is deliberately bound by its immutable provider pair,
// never by mutable/non-authoritative email metadata. This is an operator-run
// bootstrap step until HRA-353 supplies the authenticated login flow.
export async function bindFounderIdentity(client: FounderClient, issuer: string, subject: string): Promise<"bound" | "already_bound"> {
  if (!issuer || !subject) throw new Error("Founder identity requires non-empty --issuer and --subject values.");
  await ensureFounder(client);
  const existing = await client.query<{ user_id: string }>(
    "SELECT user_id::text FROM external_identities WHERE issuer = $1 AND subject = $2",
    [issuer, subject],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].user_id !== FOUNDER_USER_ID) {
      throw new Error("The supplied issuer/subject pair is already bound to a different internal user.");
    }
    return "already_bound";
  }
  await client.query(
    "INSERT INTO external_identities (user_id, issuer, subject) VALUES ($1, $2, $3)",
    [FOUNDER_USER_ID, issuer, subject],
  );
  return "bound";
}
