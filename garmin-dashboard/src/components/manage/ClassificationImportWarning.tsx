import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { missingAthleteMetricLabels } from "@/utils/athleteMetrics";

// HRA-395: a non-blocking heads-up shown before a user-triggered import that
// can create newly classified running activities (Garmin sync, FIT ZIP
// upload, Strava sync) — never mandatory, never shown once every relevant
// Free Training parameter is configured.
export function ClassificationImportWarning() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const missing = missingAthleteMetricLabels(settings, t);
  if (missing.length === 0) return null;

  return (
    <div className="hra-text-secondary text-meta mb-3" role="status">
      {t("manage.import.classificationParamsWarning",
        `New running activities may fall back to Tapasciata / Light Maintenance until you configure: ${missing.join(", ")}.`,
        { fields: missing.join(", ") })}{" "}
      <a className="hra-link" href="?tab=settings">{t("activity.classify.openSettings", "Open Settings")}</a>
    </div>
  );
}
