/**
 * repositories/settings.repo.ts
 * Data access for the single-row `settings` table (outlier thresholds, appearance,
 * units, trend/detail preferences). The ONLY layer that runs SQL for this domain
 * (rest-api-standards §11). SQL moved verbatim out of server.ts's `q` object
 * (HRA-29) — behavior is identical.
 */
import type { DatabaseSync } from "node:sqlite";

type NamedParams = Record<string, string | number | null>;

export function createSettingsRepo(db: DatabaseSync) {
  const settingsGet    = db.prepare("SELECT outlier_speed_delta_per_sec, outlier_cadence_delta_per_sec, outlier_min_speed_kmh, theme, background_kind, background_value, unit_system, min_trend_group_size, activity_detail_view FROM settings WHERE id = 1");
  const settingsUpdate = db.prepare("UPDATE settings SET outlier_speed_delta_per_sec = $outlier_speed_delta_per_sec, outlier_cadence_delta_per_sec = $outlier_cadence_delta_per_sec, outlier_min_speed_kmh = $outlier_min_speed_kmh, min_trend_group_size = $min_trend_group_size, updated_at = datetime('now') WHERE id = 1");
  const themeUpdate      = db.prepare("UPDATE settings SET theme = $theme, updated_at = datetime('now') WHERE id = 1");
  const backgroundUpdate = db.prepare("UPDATE settings SET background_kind = $background_kind, background_value = $background_value, updated_at = datetime('now') WHERE id = 1");
  const unitsUpdate      = db.prepare("UPDATE settings SET unit_system = $unit_system, updated_at = datetime('now') WHERE id = 1");
  const detailViewUpdate = db.prepare("UPDATE settings SET activity_detail_view = $activity_detail_view, updated_at = datetime('now') WHERE id = 1");

  return {
    get:              () => settingsGet.get(),
    updateOutliers:   (p: NamedParams) => settingsUpdate.run(p),
    updateTheme:      (p: NamedParams) => themeUpdate.run(p),
    updateBackground: (p: NamedParams) => backgroundUpdate.run(p),
    updateUnits:      (p: NamedParams) => unitsUpdate.run(p),
    updateDetailView: (p: NamedParams) => detailViewUpdate.run(p),
  };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
