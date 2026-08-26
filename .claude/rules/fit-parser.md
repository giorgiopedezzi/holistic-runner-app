---
paths:
  - "garmin-stats/src/domain/fit-parser.ts"
  - "garmin-stats/src/**/*fit*.test.ts"
  - "garmin-stats/src/**/*fit*.spec.ts"
---

# FIT parser invariants — do not regress

Every item below reflects a previously observed real-data failure.

- Base type mask is **`0x1f`**, not `0x9f`.
- `sport` is session field **5**, not 2.
- Average/max speed: use enhanced fields **124/125** when legacy fields 14/15 are `0xFFFF`.
- Record `enhanced_speed` is field **73**, not 82.
- Per-record running cadence (field 4) is single-leg strides/min, same convention as Strava cadence. **Multiply by 2 for running** inside `fit-parser.ts` to obtain steps/min.
- Do not trust session fields 56/89 for activity-level average cadence. Compute `avg_cadence` as the mean of the already-scaled per-record cadence values.
- `total_ascent` / `total_descent` are session fields **22/23**.
- `activity_date` comes from session `start_time` field **2**.
- **Developer fields (`hasDev`) require skipping both halves:**
  1. each 3-byte developer-field descriptor in the definition message; and
  2. the developer-field payload bytes appended to the corresponding data message.
  Skipping only definitions loses byte alignment and can yield plausible summaries with zero track points.
- Filter invalid sentinels `0xFF`, `0xFFFF`, `0xFFFFFFFF` via `validNum()`.
- `moving_time_sec` uses session field **8** (`total_timer_time`, ms / 1000). `duration_sec` uses session field **7** (`total_elapsed_time`, ms / 1000). They are intentionally distinct.
- Per-record `timestamp_unix` (record field **253**, FIT-epoch uint32 seconds) is the trustworthy wall-clock source.
- Per-record `elapsed_sec` (field 29) is **not** a reliable moving/timer clock on real Garmin data. Do not infer pause duration or chart time axes from it.
- Detect Garmin auto-pauses from gaps in consecutive `timestamp_unix` values: the device stops recording during the pause. Keep `elapsed_sec` only as a last-resort fallback for sources lacking trustworthy timestamps.

For FIT ingestion/cross-validation context, read `docs/ingestion.md` before changing parser behavior.
