import test from "node:test";
import assert from "node:assert/strict";
import { consumeAuthTransaction, createAuthTransaction } from "../../src/http/auth-transaction.ts";
import { authConnection } from "../../src/controllers/auth.controller.ts";
import { createTestDb } from "../helpers/db.ts";

test("an authorization transaction requires the browser-bound pre-auth cookie and consumes once", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const transaction = await createAuthTransaction(db);
    assert.equal(await consumeAuthTransaction(db, transaction.state, "wrong-browser"), null);
    assert.deepEqual(await consumeAuthTransaction(db, transaction.state, transaction.preauth), { nonce: transaction.nonce });
    assert.equal(await consumeAuthTransaction(db, transaction.state, transaction.preauth), null);
  } finally { await cleanup(); }
});

test("expired authorization state fails without disclosing whether it existed", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const transaction = await createAuthTransaction(db);
    await db.run("UPDATE auth_transactions SET expires_at = now() - interval '1 minute'");
    assert.equal(await consumeAuthTransaction(db, transaction.state, transaction.preauth), null);
  } finally { await cleanup(); }
});

test("an omitted method defers provider selection to Auth0 Universal Login", () => {
  assert.equal(authConnection(null), undefined);
});

test("explicit Auth0 connections remain server-controlled and allowlisted", () => {
  assert.equal(authConnection("google"), "google-oauth2");
  assert.equal(authConnection("email"), "email");
  assert.throws(() => authConnection("Username-Password-Authentication"), { message: "Unsupported sign-in method." });
});
