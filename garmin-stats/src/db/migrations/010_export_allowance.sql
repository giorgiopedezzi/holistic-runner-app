-- HRA-391: rolling-window FIT export allowance. One row per successful
-- metered export action; the rolling balance is always DERIVED by summing
-- credits within the configured window (see EXPORT_ALLOWANCE_* env vars),
-- never stored as a mutable counter — that's what lets used capacity "return"
-- automatically as old rows age out of the window, with no decay job needed.
CREATE TABLE export_allowance_usage (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('single', 'week', 'section')),
  credits INTEGER NOT NULL CHECK (credits > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX export_allowance_usage_user_window_idx ON export_allowance_usage (user_id, created_at);
