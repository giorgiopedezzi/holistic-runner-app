import type { Queryable } from "../db/query.ts";
type Values = readonly unknown[];
const FIELDS = "outlier_speed_delta_per_sec, outlier_cadence_delta_per_sec, outlier_min_speed_kmh, theme, background_kind, background_value, unit_system, timezone, min_trend_group_size, activity_detail_view, accent_color, date_format, language, palette, current_easy_pace_sec_per_km, current_race_pace_sec_per_km, current_long_run_target_m";
export function createSettingsRepo(db: Queryable) {
  const update = (columnSql: string, values: Values) => db.run(`UPDATE user_settings SET ${columnSql}, updated_at = now() WHERE user_id = (SELECT id FROM users ORDER BY created_at LIMIT 1)`, values);
  return {
    get: () => db.get(`SELECT ${FIELDS} FROM user_settings WHERE user_id = (SELECT id FROM users ORDER BY created_at LIMIT 1)`),
    updateOutliers: (p: Record<string, unknown>) => update("outlier_speed_delta_per_sec=$1, outlier_cadence_delta_per_sec=$2, outlier_min_speed_kmh=$3", [p.$outlier_speed_delta_per_sec, p.$outlier_cadence_delta_per_sec, p.$outlier_min_speed_kmh]),
    updateThresholds: (p: Record<string, unknown>) => update("min_trend_group_size=$1", [p.$min_trend_group_size]),
    updateTheme: (p: Record<string, unknown>) => update("theme=$1", [p.$theme]),
    updateBackground: (p: Record<string, unknown>) => update("background_kind=$1, background_value=$2", [p.$background_kind, p.$background_value]),
    updateUnits: (p: Record<string, unknown>) => update("unit_system=$1", [p.$unit_system]),
    updateAthleteMetrics: (p: Record<string, unknown>) => update("current_easy_pace_sec_per_km=$1, current_race_pace_sec_per_km=$2, current_long_run_target_m=$3", [p.$current_easy_pace_sec_per_km, p.$current_race_pace_sec_per_km, p.$current_long_run_target_m]),
    updateTimezone: (p: Record<string, unknown>) => update("timezone=$1", [p.$timezone]),
    updateDetailView: (p: Record<string, unknown>) => update("activity_detail_view=$1", [p.$activity_detail_view]),
    updateAccent: (p: Record<string, unknown>) => update("accent_color=$1", [p.$accent_color]),
    updateDateFormat: (p: Record<string, unknown>) => update("date_format=$1", [p.$date_format]),
    updateLanguage: (p: Record<string, unknown>) => update("language=$1", [p.$language]),
    updatePalette: (p: Record<string, unknown>) => update("palette=$1, accent_color=$2", [p.$palette, p.$accent_color]),
  };
}
export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
