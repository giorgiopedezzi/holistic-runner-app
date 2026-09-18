// Mirrors user_settings' own column DEFAULTs
// (db/migrations/001_postgresql_foundation.sql) — the authoritative source
// for these three thresholds. Kept as one exported constant so the settings
// API response (and anything else that needs "what does a fresh row start
// at") reads it from here rather than re-deriving/duplicating the numbers,
// per HRA-385's "reuse the authoritative default source, don't duplicate
// magic values in UI code" acceptance criterion.
export const OUTLIER_DEFAULTS = {
  outlier_speed_delta_per_sec:   2.0,
  outlier_cadence_delta_per_sec: 60.0,
  outlier_min_speed_kmh:         6.0,
} as const;
