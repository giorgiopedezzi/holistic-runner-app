-- HRA-353: short-lived, single-use Authorization Code transactions.  The
-- browser holds only the random values; server persistence retains hashes.
CREATE TABLE auth_transactions (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  preauth_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_transactions_expiry ON auth_transactions(expires_at);
