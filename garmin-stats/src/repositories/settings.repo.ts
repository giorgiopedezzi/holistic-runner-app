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
  const settingsGet    = db.prepare("SELECT outlier_speed_delta_per_sec, outlier_cadence_delta_per_sec, outlier_min_speed_kmh, theme, background_kind, background_value, unit_system, min_trend_group_size, activity_detail_view, accent_color, date_format FROM settings WHERE id = 1");
  // Two dedicated writes, one per Settings card (HRA-40): the Outlier-detection
  // card (three values) and the Overview & Trends card (min_trend_group_size).
  // Each replaces only its own sub-resource — no combined write.
  const outliersUpdate   = db.prepare("UPDATE settings SET outlier_speed_delta_per_sec = $outlier_speed_delta_per_sec, outlier_cadence_delta_per_sec = $outlier_cadence_delta_per_sec, outlier_min_speed_kmh = $outlier_min_speed_kmh, updated_at = datetime('now') WHERE id = 1");
  const thresholdsUpdate = db.prepare("UPDATE settings SET min_trend_group_size = $min_trend_group_size, updated_at = datetime('now') WHERE id = 1");
  const themeUpdate      = db.prepare("UPDATE settings SET theme = $theme, updated_at = datetime('now') WHERE id = 1");
  const backgroundUpdate = db.prepare("UPDATE settings SET background_kind = $background_kind, background_value = $background_value, updated_at = datetime('now') WHERE id = 1");
  const unitsUpdate      = db.prepare("UPDATE settings SET unit_system = $unit_system, updated_at = datetime('now') WHERE id = 1");
  const detailViewUpdate = db.prepare("UPDATE settings SET activity_detail_view = $activity_detail_view, updated_at = datetime('now') WHERE id = 1");
  const accentUpdate     = db.prepare("UPDATE settings SET accent_color = $accent_color, updated_at = datetime('now') WHERE id = 1");
  const dateFormatUpdate = db.prepare("UPDATE settings SET date_format = $date_format, updated_at = datetime('now') WHERE id = 1");

  return {
    get:              () => settingsGet.get(),
    updateOutliers:   (p: NamedParams) => outliersUpdate.run(p),
    updateThresholds: (p: NamedParams) => thresholdsUpdate.run(p),
    updateTheme:      (p: NamedParams) => themeUpdate.run(p),
    updateBackground: (p: NamedParams) => backgroundUpdate.run(p),
    updateUnits:      (p: NamedParams) => unitsUpdate.run(p),
    updateDetailView: (p: NamedParams) => detailViewUpdate.run(p),
    updateAccent:     (p: NamedParams) => accentUpdate.run(p),
    updateDateFormat: (p: NamedParams) => dateFormatUpdate.run(p),
  };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;
