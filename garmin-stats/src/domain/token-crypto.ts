// ── Integration credential encryption at rest (HRA-352 AC2) ────────────────
// AES-256-GCM over a single string field (a provider access/refresh token).
// Pure with respect to I/O (the key is handed in, never read from process.env
// here — that's config.ts's requireIntegrationEncryptionConfig's job) so this
// stays independently testable like the rest of domain/.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM's recommended nonce size
const TAG_BYTES = 16; // GCM's default auth tag length
const KEY_BYTES = 32; // AES-256

export class TokenCryptoConfigError extends Error {}

function parseKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new TokenCryptoConfigError(
      `INTEGRATION_TOKEN_ENCRYPTION_KEY must decode (base64) to exactly ${KEY_BYTES} bytes; got ${key.length}.`,
    );
  }
  return key;
}

// Encoded as iv.tag.ciphertext, each base64 — kept as one opaque TEXT value
// so the token columns' shape never has to change again if the scheme does.
export function encryptToken(plaintext: string, keyB64: string): string {
  const key = parseKey(keyB64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`;
}

export function decryptToken(encoded: string, keyB64: string): string {
  const key = parseKey(keyB64);
  const parts = encoded.split(".");
  if (parts.length !== 3) throw new Error("Malformed encrypted token value.");
  const [ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}

function isBase64(value: string): boolean {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]*=*$/.test(value);
}

// Distinguishes this module's own iv.tag.ciphertext encoding from a raw
// plaintext token by checking the first two segments decode to exactly the
// IV/tag byte lengths this module always produces — not just "3 dot-joined
// base64-looking parts", since an opaque provider token is vanishingly
// unlikely to coincidentally match on byte length too.
export function looksEncrypted(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 3 || !parts.every(isBase64)) return false;
  const [ivB64, tagB64] = parts;
  return Buffer.from(ivB64, "base64").length === IV_BYTES && Buffer.from(tagB64, "base64").length === TAG_BYTES;
}

// Migration tolerance (HRA-352 follow-up): a token row written before this
// module existed stores a raw plaintext value, not this encoding. Rather
// than a separate one-off migration script (which would need the key at
// migration time, outside the app's normal request path), every read
// tolerates that shape and passes it through unchanged — encryptToken()'s
// own output can never collide with a real plaintext OAuth token, and the
// row is naturally upgraded to encrypted the next time saveToken() writes it
// (e.g. on the token's next refresh, which always encrypts on write).
export function safeDecryptToken(value: string, keyB64: string): string {
  return looksEncrypted(value) ? decryptToken(value, keyB64) : value;
}
