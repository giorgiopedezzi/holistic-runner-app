import { createHash, randomBytes } from "node:crypto";
import type { Queryable } from "../db/query.ts";

const TTL_MINUTES = 10;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export interface AuthTransaction { state: string; nonce: string; preauth: string }

export async function createAuthTransaction(db: Queryable): Promise<AuthTransaction> {
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const preauth = randomBytes(32).toString("base64url");
  await db.run(
    "INSERT INTO auth_transactions (state_hash, nonce, preauth_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))",
    [hash(state), nonce, hash(preauth), TTL_MINUTES],
  );
  return { state, nonce, preauth };
}

// Atomic consume makes both authorization-code and callback-state replay fail
// before an application session can be created.
export async function consumeAuthTransaction(db: Queryable, state: string, preauth: string): Promise<{ nonce: string } | null> {
  const row = await db.get<{ nonce: string }>(
    `UPDATE auth_transactions SET consumed_at = now()
     WHERE state_hash = $1 AND preauth_hash = $2 AND consumed_at IS NULL AND expires_at > now()
     RETURNING nonce`,
    [hash(state), hash(preauth)],
  );
  return row ?? null;
}
