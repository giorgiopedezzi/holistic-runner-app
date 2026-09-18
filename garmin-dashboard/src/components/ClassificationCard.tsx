import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { ErrorBanner } from "@/components/ui";
import { ClassificationPicker } from "@/components/activity/ClassificationPicker";
import { useAppMode } from "@/hooks/useAppMode";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useSettings } from "@/hooks/useSettings";
import {
  type Activity,
  type ActualRunningClassification,
  effectiveClassification,
} from "@/types/api";

// HRA-394: replaces the old heavyweight Classify/Reclassify workflow (native
// <select> override + separate Override button + sampling controls). The
// compact ClassificationPicker is now the normal control — selecting an
// option persists immediately via the override PUT. Explicit automatic
// recalculation remains only as a secondary action.
export function ClassificationCard({ activity, onUpdate }: {
  activity: Activity;
  onUpdate: (activity: Activity) => void;
}) {
  const { t } = useTranslation();
  const { canPersist } = useAppMode();
  const demoMode = useDemoMode();
  const { settings } = useSettings();
  const persistBlocked = demoMode || !canPersist;
  const persistBlockedTitle = !canPersist
    ? t("guest.persistence.signInHint", "Sign in to save this to your account.")
    : t("common.demoModeHint", "Not available for demo");
  const [classifying, setClassifying] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effective = effectiveClassification(activity) as ActualRunningClassification | null;
  const missingMetrics = settings ? [
    settings.current_easy_pace_sec_per_km == null
      ? t("settings.trainingMetrics.easyPace", "Current easy pace")
      : null,
    settings.current_race_pace_sec_per_km == null
      ? t("settings.trainingMetrics.racePace", "Current race pace")
      : null,
    settings.current_long_run_target_m == null
      ? t("settings.trainingMetrics.longRunTarget", "Current long-run target")
      : null,
  ].filter((value): value is string => value != null) : [];

  async function reclassify() {
    setClassifying(true);
    setError(null);
    try {
      onUpdate(await api.garmin.classify(activity.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("activity.classify.classifyFailed", "Classification failed"));
    } finally {
      setClassifying(false);
    }
  }

  async function selectOverride(classification: ActualRunningClassification) {
    setSavingOverride(true);
    setError(null);
    try {
      onUpdate(await api.garmin.overrideClassification(activity.id, classification));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("activity.classify.overrideFailed", "Failed to save classification override"));
    } finally {
      setSavingOverride(false);
    }
  }

  async function restoreSystem() {
    setSavingOverride(true);
    setError(null);
    try {
      onUpdate(await api.garmin.restoreSystemClassification(activity.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("activity.classify.restoreFailed", "Failed to restore system classification"));
    } finally {
      setSavingOverride(false);
    }
  }

  return (
    <div className="mb-4">
      <div className="hra-control-row gap-2.5 mb-2.5">
        <ClassificationPicker
          value={effective}
          onValueChange={selectOverride}
          disabled={persistBlocked || savingOverride}
          title={persistBlocked ? persistBlockedTitle : undefined}
        />
        <span className="hra-text-secondary text-meta">
          {activity.manual_classification
            ? t("activity.classify.provenanceUser", "Classified by you")
            : effective
              ? t("activity.classify.provenanceSystem", "Classified by Runs Free")
              : t("activity.classify.notYetClassified", "Not yet classified")}
        </span>
        {activity.manual_classification && (
          <button className="hra-btn" onClick={restoreSystem} disabled={savingOverride || persistBlocked} title={persistBlocked ? persistBlockedTitle : undefined}>
            {t("activity.classify.useAutomatic", "Use automatic classification")}
          </button>
        )}
      </div>

      {activity.system_explanation && <div className="hra-text-secondary text-meta mb-2.5">{activity.system_explanation}</div>}

      <div className="hra-row-wrap gap-2.5">
        <button className="hra-btn" disabled={classifying || persistBlocked} title={persistBlocked ? persistBlockedTitle : t("activity.classify.recalculateTooltip", "Recomputes the automatic classification using your current training settings.")} onClick={reclassify}>
          {classifying
            ? t("activity.classify.classifying", "Classifying…")
            : t("activity.classify.recalculate", "Recalculate automatic classification")}
        </button>
      </div>

      {canPersist && missingMetrics.length > 0 && (
        <div className="hra-text-secondary text-meta mt-2">
          {t("activity.classify.incompleteProfile", `Classification profile incomplete: ${missingMetrics.join(", ")}. Runs Free will use its existing fallback behavior for the missing values.`, { fields: missingMetrics.join(", ") })}{" "}
          <a className="hra-link" href="?tab=settings">{t("activity.classify.openSettings", "Open Settings")}</a>
        </div>
      )}

      {error && <div className="mt-2"><ErrorBanner message={error} /></div>}
    </div>
  );
}
