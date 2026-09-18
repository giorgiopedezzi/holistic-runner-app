import type { Queryable } from "../db/query.ts";

type Values = readonly unknown[];
const FIELDS = "outlier_speed_delta_per_sec, outlier_cadence_delta_per_sec, outlier_min_speed_kmh, theme, background_kind, background_value, unit_system, timezone, min_trend_group_size, activity_detail_view, accent_color, date_format, language, palette";

export function createOwnedSettingsRepo(db: Queryable, userId: string) {
  const update = (columnSql: string, values: Values) => db.run(`UPDATE user_settings SET ${columnSql},updated_at=now() WHERE user_id=$1`, [userId, ...values]);
  return {
    get: () => db.get(`SELECT ${FIELDS} FROM user_settings WHERE user_id=$1`, [userId]),
    updateOutliers: (p: Record<string, unknown>) => update("outlier_speed_delta_per_sec=$2,outlier_cadence_delta_per_sec=$3,outlier_min_speed_kmh=$4", [p.$outlier_speed_delta_per_sec,p.$outlier_cadence_delta_per_sec,p.$outlier_min_speed_kmh]),
    updateThresholds: (p: Record<string, unknown>) => update("min_trend_group_size=$2", [p.$min_trend_group_size]),
    updateTheme: (p: Record<string, unknown>) => update("theme=$2", [p.$theme]),
    // HRA-385 AC2: theme + palette (+ its paired accent) written in one
    // UPDATE — the Graphite→Light normalization must be atomic, never two
    // separate calls that could leave a real invalid intermediate row.
    updateThemeAndPalette: (p: Record<string, unknown>) => update("theme=$2,palette=$3,accent_color=$4", [p.$theme,p.$palette,p.$accent_color]),
    updateBackground: (p: Record<string, unknown>) => update("background_kind=$2,background_value=$3", [p.$background_kind,p.$background_value]),
    updateUnits: (p: Record<string, unknown>) => update("unit_system=$2", [p.$unit_system]),
    updateTimezone: (p: Record<string, unknown>) => update("timezone=$2", [p.$timezone]),
    updateDetailView: (p: Record<string, unknown>) => update("activity_detail_view=$2", [p.$activity_detail_view]),
    updateAccent: (p: Record<string, unknown>) => update("accent_color=$2", [p.$accent_color]),
    updateDateFormat: (p: Record<string, unknown>) => update("date_format=$2", [p.$date_format]),
    updateLanguage: (p: Record<string, unknown>) => update("language=$2", [p.$language]),
    updatePalette: (p: Record<string, unknown>) => update("palette=$2,accent_color=$3", [p.$palette,p.$accent_color]),
  };
}
