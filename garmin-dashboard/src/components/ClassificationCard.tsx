import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { ErrorBanner } from "@/components/ui";
import { useAppMode } from "@/hooks/useAppMode";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useSettings } from "@/hooks/useSettings";
import {
  type Activity,
  type WorkoutClassification,
  WORKOUT_CLASSIFICATIONS,
  WORKOUT_CLASSIFICATION_KEY,
  effectiveClassification,
} from "@/types/api";

export function ClassificationCard({ activity, onUpdate, splitMeters: splitMetersProp, onSplitMetersChange }: {
  activity: Activity;
  onUpdate: (activity: Activity) => void;
  splitMeters?: number;
  onSplitMetersChange?: (meters: number) => void;
}) {
  const { t } = useTranslation();
  const { canPersist } = useAppMode();
  const demoMode = useDemoMode();
  const { settings } = useSettings();
  const persistBlocked = demoMode || !canPersist;
  const persistBlockedTitle = !canPersist
    ? t("guest.persistence.signInHint", "Sign in to save this to your account.")
    : t("common.demoModeHint", "Not available for demo");
  const [splitMetersState, setSplitMetersState] = useState(1000);
  const splitMeters = splitMetersProp ?? splitMetersState;
  const setSplitMeters = onSplitMetersChange ?? setSplitMetersState;
  const [showReclassify, setShowReclassify] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [override, setOverride] = useState<WorkoutClassification | "">(
    (activity.manual_classification as WorkoutClassification | null) ?? "",
  );
  const [savingOverride, setSavingOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effective = effectiveClassification(activity);
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

  const classificationLabel = (value: string) =>
    t(WORKOUT_CLASSIFICATION_KEY[value as WorkoutClassification] ?? "unknown", value);

  async function reclassify() {
    setClassifying(true);
    setError(null);
    try {
      onUpdate(await api.garmin.classify(activity.id, splitMeters));
      setShowReclassify(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("activity.classify.classifyFailed", "Classification failed"));
    } finally {
      setClassifying(false);
    }
  }

  async function saveOverride() {
    if (!override) return;
    setSavingOverride(true);
    setError(null);
    try {
      onUpdate(await api.garmin.overrideClassification(activity.id, override));
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
      const updated = await api.garmin.restoreSystemClassification(activity.id);
      onUpdate(updated);
      setOverride("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("activity.classify.restoreFailed", "Failed to restore system classification"));
    } finally {
      setSavingOverride(false);
    }
  }

  return (
    <div className="mb-4">
      <div className="hra-control-row gap-2.5 mb-2.5">
        {effective ? (
          <div>
            <span className="hra-classification-pill hra-dyn-border hra-dyn-color inline-block text-meta font-semibold uppercase" data-tone={activity.manual_classification ? "confirmed" : "pending"}>
              {classificationLabel(effective)}
            </span>
            <div className="hra-text-secondary text-meta mt-1">
              {activity.manual_classification
                ? t("activity.classify.provenanceUser", "Classified by you")
                : t("activity.classify.provenanceSystem", "Classified by Runs Free")}
            </div>
          </div>
        ) : (
          <span className="hra-text-muted text-meta">{t("activity.classify.notYetClassified", "Not yet classified")}</span>
        )}
        <div className="flex-1" />
        <div className="hra-segment inline-flex rounded-full overflow-hidden" title={t("activity.classify.splitTooltip", "Split granularity used to (re)classify") }>
          {([1000, 500] as const).map(meters => (
            <button key={meters} onClick={() => setSplitMeters(meters)} className="hra-segment-item hra-classification-segment-item text-meta border-0 cursor-pointer" data-active={splitMeters === meters}>
              {meters === 1000 ? t("activity.classify.split1km", "1km") : t("activity.classify.split05km", "0.5km")}
            </button>
          ))}
        </div>
      </div>

      {activity.system_explanation && <div className="hra-text-secondary text-meta mb-2.5">{activity.system_explanation}</div>}

      <div className="hra-row-wrap gap-2.5">
        <button className="hra-btn" data-variant="cta" disabled={classifying || persistBlocked} title={persistBlocked ? persistBlockedTitle : undefined} onClick={() => setShowReclassify(true)}>
          {classifying
            ? t("activity.classify.classifying", "Classifying…")
            : effective ? t("activity.classify.reclassify", "Reclassify") : t("activity.classify.classify", "Classify")}
        </button>
        <select value={override} onChange={event => setOverride(event.target.value as WorkoutClassification | "")} className="text-meta" disabled={persistBlocked} title={persistBlocked ? persistBlockedTitle : undefined} aria-label={t("activity.classify.overrideChoice", "Classification override") }>
          <option value="">{t("activity.classify.chooseOverride", "Choose a category")}</option>
          {WORKOUT_CLASSIFICATIONS.map(category => <option key={category} value={category}>{classificationLabel(category)}</option>)}
        </select>
        <button className="hra-btn" data-variant="cta" onClick={saveOverride} disabled={!override || savingOverride || persistBlocked} title={persistBlocked ? persistBlockedTitle : undefined}>
          {t("activity.classify.overrideAction", "Override classification")}
        </button>
        {activity.manual_classification && (
          <button className="hra-btn" onClick={restoreSystem} disabled={savingOverride || persistBlocked} title={persistBlocked ? persistBlockedTitle : undefined}>
            {t("activity.classify.restoreSystem", "Restore system classification")}
          </button>
        )}
      </div>

      {showReclassify && (
        <div className="hra-border-top mt-3 pt-3">
          <div className="hra-text-secondary text-meta">
            {t("activity.classify.currentMetricsWarning", "Reclassification uses your current training metrics, not the metrics you may have had when this workout was recorded.")}
          </div>
          {canPersist && missingMetrics.length > 0 && (
            <div className="hra-text-secondary text-meta mt-2">
              {t("activity.classify.incompleteProfile", `Classification profile incomplete: ${missingMetrics.join(", ")}. Runs Free will use its existing fallback behavior for the missing values.`, { fields: missingMetrics.join(", ") })}{" "}
              <a className="hra-link" href="?tab=settings">{t("activity.classify.openSettings", "Open Settings")}</a>
            </div>
          )}
          <div className="hra-row gap-2 mt-2">
            <button className="hra-btn" data-variant="cta" onClick={reclassify} disabled={classifying}>{t("activity.classify.confirmReclassify", "Run classification")}</button>
            <button className="hra-btn" onClick={() => setShowReclassify(false)} disabled={classifying}>{t("common.cancel", "Cancel")}</button>
          </div>
        </div>
      )}

      {error && <div className="mt-2"><ErrorBanner message={error} /></div>}
    </div>
  );
}
