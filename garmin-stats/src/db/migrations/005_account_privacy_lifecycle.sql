-- HRA-354: owner-scoped personal-data exports and durable deletion requests.
-- Export payloads are snapshots captured at request time; provider credentials,
-- sessions, and external identity metadata are deliberately never copied here.
CREATE TABLE account_exports (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  download_secret_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  downloaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_account_exports_owner_expiry ON account_exports(user_id, expires_at);

-- A row is the durable queue entry. Keeping the account in deletion_pending
-- until a worker completes it makes retries observable without restoring access.
CREATE TABLE account_deletion_requests (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'failed')) DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
