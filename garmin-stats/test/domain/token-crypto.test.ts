import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encryptToken, decryptToken, TokenCryptoConfigError } from "../../src/domain/token-crypto.ts";

const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");

test("encryptToken/decryptToken round-trips a plaintext token", () => {
  const plaintext = "a-very-real-refresh-token-value";
  const encrypted = encryptToken(plaintext, KEY);
  assert.notEqual(encrypted, plaintext);
  assert.equal(decryptToken(encrypted, KEY), plaintext);
});

test("the same plaintext encrypts to a different ciphertext each time (random IV)", () => {
  const a = encryptToken("same-value", KEY);
  const b = encryptToken("same-value", KEY);
  assert.notEqual(a, b);
});

test("decrypting with the wrong key fails closed instead of returning garbage", () => {
  const encrypted = encryptToken("secret", KEY);
  assert.throws(() => decryptToken(encrypted, OTHER_KEY));
});

test("a tampered ciphertext fails the GCM auth tag check", () => {
  const encrypted = encryptToken("secret", KEY);
  const [iv, tag, data] = encrypted.split(".");
  const tamperedByte = Buffer.from(data, "base64");
  tamperedByte[0] = tamperedByte[0] ^ 0xff;
  const tampered = `${iv}.${tag}.${tamperedByte.toString("base64")}`;
  assert.throws(() => decryptToken(tampered, KEY));
});

test("a key that doesn't decode to exactly 32 bytes is a configuration error", () => {
  const shortKey = Buffer.from("too-short").toString("base64");
  assert.throws(() => encryptToken("secret", shortKey), TokenCryptoConfigError);
});
