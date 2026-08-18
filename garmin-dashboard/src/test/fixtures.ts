/**
 * src/test/fixtures.ts  (HRA-67)
 * Minimal, typed fixtures for the characterization tests. Reference activity
 * id 200 is the anchor the manual chart-visual checklist (tests/FE-SMOKE.md)
 * also keys to, so the automated and manual nets describe the same object.
 */
import type {
  Activity, SportSummary, BodyMeasurement, CorrelationPoint,
  Settings, TrackPoint, WithingsStatus, StravaStatus, DeviceStatus, DateRange,
} from "@/types/api";

export const REFERENCE_ACTIVITY_ID = 200;

export const settings = (overrides: Partial<Settings> = {}): Settings => ({
  outlier_speed_delta_per_sec: 3,
  outlier_cadence_delta_per_sec: 20,
  outlier_min_speed_kmh: 6,
  theme: "dark",
  background_kind: "none",
  background_value: null,
  unit_system: "metric",
  min_trend_group_size: 5,
  activity_detail_view: "accordion",
  accent_color: "sky",
  ...overrides,
});

export const activity = (overrides: Partial<Activity> = {}): Activity => ({
  id: REFERENCE_ACTIVITY_ID,
  filename: "ACTIVITY_200.fit",
  activity_date: "2026-08-01T07:30:00Z",
  date_only: "2026-08-01",
  sport: "running",
  duration_sec: 3035,
  moving_time_sec: 2900,
  distance_m: 10000,
  avg_pace_minkm: 5,
  calories: 620,
  avg_hr: 152,
  max_hr: 171,
  avg_cadence: 170,
  ascent_m: 31,
  descent_m: 24,
  avg_speed_ms: 3.3,
  max_speed_ms: 4.6,
  source: "garmin",
  ai_classification: null,
  ai_explanation: null,
  statistical_classification: null,
  statistical_explanation: null,
  user_feedback: null,
  user_correction_reason: null,
  final_classification: null,
  classification_method: null,
  activity_type_id: 1,
  activity_name: null,
  ...overrides,
});

export const sportSummary = (overrides: Partial<SportSummary> = {}): SportSummary => ({
  sport: "running",
  total_activities: 12,
  total_km: 96.4,
  total_hours: 9.2,
  total_calories: 7200,
  avg_hr: 150,
  avg_pace: 5,
  total_ascent: 480,
  ...overrides,
});

export const bodyMeasurement = (overrides: Partial<BodyMeasurement> = {}): BodyMeasurement => ({
  measured_at: "2026-08-01T06:00:00Z",
  date_only: "2026-08-01",
  weight_kg: 72.4,
  fat_ratio: 14.2,
  fat_mass_kg: 10.3,
  muscle_mass_kg: 58.1,
  hydration_kg: 45.2,
  bone_mass_kg: 3.1,
  bmi: 22.4,
  heart_rate: 52,
  ...overrides,
});

export const correlationPoint = (overrides: Partial<CorrelationPoint> = {}): CorrelationPoint => ({
  week: "2026-W31",
  km: 42,
  avg_hr: 150,
  runs: 4,
  avg_weight: 72.4,
  avg_fat_ratio: 14.2,
  ...overrides,
});

// A short track (≤5 points) so ActivityDetailBody skips the >5-point chart —
// keeps that test on the stat grid, not Recharts.
export const shortTrack = (): TrackPoint[] =>
  [0, 1, 2].map((i) => ({
    elapsed_sec: i,
    timestamp_unix: 1_785_832_000 + i,
    distance_m: i * 3,
    heart_rate: 150 + i,
    speed_ms: 3.3,
    cadence: 170,
    altitude_m: 12,
    temperature: 20,
    power: null,
  }));

export const dateRange = (overrides: Partial<DateRange> = {}): DateRange => ({
  min_date: "2025-01-01",
  max_date: "2026-08-14",
  ...overrides,
});

export const withingsStatus = (overrides: Partial<WithingsStatus> = {}): WithingsStatus => ({
  present: false,
  valid: false,
  ...overrides,
});

export const stravaStatus = (overrides: Partial<StravaStatus> = {}): StravaStatus => ({
  present: false,
  valid: false,
  ...overrides,
});

export const deviceStatus = (overrides: Partial<DeviceStatus> = {}): DeviceStatus => ({
  connected: false,
  reason: "No Garmin device detected",
  ...overrides,
});
