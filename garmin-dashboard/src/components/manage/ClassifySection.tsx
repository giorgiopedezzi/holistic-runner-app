import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { Card, ErrorBanner, LoadingSpinner, ProgressBar, Checkbox, DatePicker } from "@/components/ui";
import type { Activity, ActualRunningClassification } from "@/types/api";
import { effectiveClassification, ACTUAL_RUNNING_CLASSIFICATION_KEY } from "@/types/api";
import { fmtKm, fmtDate } from "@/utils/fmt";
import { isoToday, isoAgo } from "@/utils/date";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useSettings } from "@/hooks/useSettings";

export function ClassifySection() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const demoMode = useDemoMode();
  const { settings } = useSettings();
  const [from, setFrom] = useState(isoAgo(30));
  const [to, setTo] = useState(isoToday());
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [splitMeters, setSplitMeters] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    api.garmin.activities(from, to)
      .then(all => setActivities(all.filter(activity => activity.sport === "running")))
      .catch(caught => setLoadError(caught instanceof Error ? caught.message : tRef.current("manage.classify.loadFailed", "Failed to load activities")))
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => setSelected(new Set()), [activities]);

  const missingMetrics = settings ? [
    settings.current_easy_pace_sec_per_km == null ? t("settings.trainingMetrics.easyPace", "Current easy pace") : null,
    settings.current_race_pace_sec_per_km == null ? t("settings.trainingMetrics.racePace", "Current race pace") : null,
    settings.current_long_run_target_m == null ? t("settings.trainingMetrics.longRunTarget", "Current long-run target") : null,
  ].filter((value): value is string => value != null) : [];

  function toggle(id: number) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(current => activities && current.size === activities.length
      ? new Set()
      : new Set(activities?.map(activity => activity.id) ?? []));
  }

  async function classifySelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    setActionError(null);
    setProgress({ current: 0, total: ids.length });
    const errors: string[] = [];
    for (let index = 0; index < ids.length; index++) {
      try {
        const updated = await api.garmin.classify(ids[index], splitMeters);
        setActivities(current => current?.map(activity => activity.id === ids[index] ? updated : activity) ?? current);
      } catch (caught) {
        errors.push(`#${ids[index]}: ${caught instanceof Error ? caught.message : t("manage.classify.itemFailed", "failed")}`);
      }
      setProgress({ current: index + 1, total: ids.length });
    }
    if (errors.length > 0) {
      const extra = errors.length > 3 ? t("manage.classify.moreErrors", ` (+${errors.length - 3} more)`, { count: errors.length - 3 }) : "";
      setActionError(errors.slice(0, 3).join("; ") + extra);
    }
    setProgress(null);
    setBusy(false);
  }

  const classificationLabel = (value: string) => {
    const pair = ACTUAL_RUNNING_CLASSIFICATION_KEY[value as ActualRunningClassification] as [string, string] | undefined;
    return pair ? t(pair[0], pair[1]) : t("unknown", value);
  };

  return (
    <Card>
      <div className="hra-block-title mb-1">{t("manage.classify.title", "Identify workout types")}</div>
      <div className="hra-text-secondary text-meta mb-3">
        {t("manage.classify.description", "Runs Free classifies running activities with deterministic rules and your current training metrics, not the metrics from each activity date. Reclassification is explicit and never runs merely because Settings changed.")}
      </div>

      {missingMetrics.length > 0 && (
        <div className="hra-text-secondary text-meta mb-3">
          {t("activity.classify.incompleteProfile", `Classification profile incomplete: ${missingMetrics.join(", ")}. Runs Free will use its existing fallback behavior for the missing values.`, { fields: missingMetrics.join(", ") })}{" "}
          <a className="hra-link" href="?tab=settings">{t("activity.classify.openSettings", "Open Settings")}</a>
        </div>
      )}

      <div className="hra-date-pair mb-3">
        <DatePicker value={from} onChange={setFrom} max={to} />
        <span className="hra-text-muted text-meta">→</span>
        <DatePicker value={to} onChange={setTo} min={from} />
      </div>

      {loading && <LoadingSpinner label={t("manage.classify.loading", "Loading activities…")} />}
      {loadError && <ErrorBanner message={loadError} />}

      {!loading && !loadError && activities && (
        <>
          {activities.length === 0 ? (
            <div className="hra-text-muted text-meta mb-3">{t("manage.classify.noActivities", "No running activities in this range.")}</div>
          ) : (
            <div className="hra-border max-h-60 overflow-auto rounded-md p-2 mb-2.5">
              <label className="hra-list-row hra-text-muted hra-border-bottom flex items-center gap-1.5 text-meta cursor-pointer mb-1.5 pb-1.5">
                <Checkbox checked={selected.size === activities.length} onCheckedChange={toggleAll} />
                {t("manage.classify.selectAll", `Select all (${activities.length})`, { count: activities.length })}
              </label>
              {activities.map(activity => {
                const effective = effectiveClassification(activity);
                return (
                  <label key={activity.id} className="hra-classify-row hra-text-secondary flex items-center gap-2 text-meta cursor-pointer">
                    <Checkbox checked={selected.has(activity.id)} onCheckedChange={() => toggle(activity.id)} />
                    <span className="hra-classify-date">{fmtDate(activity.date_only)}</span>
                    <span className="min-w-15">{fmtKm(activity.distance_m)}</span>
                    {effective ? (
                      <span className="hra-classification-pill hra-classification-pill-compact hra-dyn-border hra-dyn-color text-meta font-semibold uppercase" data-tone={activity.manual_classification ? "confirmed" : "pending"}>
                        {classificationLabel(effective)} · {activity.manual_classification
                          ? t("activity.classify.provenanceUser", "Classified by you")
                          : t("activity.classify.provenanceSystem", "Classified by Runs Free")}
                      </span>
                    ) : <span className="hra-text-muted text-meta">{t("manage.classify.unclassified", "unclassified")}</span>}
                  </label>
                );
              })}
            </div>
          )}

          <div className="hra-row-wrap">
            <div className="hra-segment inline-flex rounded-full overflow-hidden" title={t("activity.classify.splitTooltip", "Split granularity used to (re)classify") }>
              {([1000, 500] as const).map(meters => (
                <button key={meters} onClick={() => setSplitMeters(meters)} className="hra-segment-item hra-classification-segment-item text-meta border-0 cursor-pointer" data-active={splitMeters === meters}>
                  {meters === 1000 ? t("activity.classify.split1km", "1km") : t("activity.classify.split05km", "0.5km")}
                </button>
              ))}
            </div>
            <button className="hra-btn" data-variant="cta" onClick={classifySelected} disabled={selected.size === 0 || busy || demoMode} title={demoMode ? t("common.demoModeHint", "Not available for demo") : undefined}>
              {t("manage.classify.classifySelected", "Classify / Reclassify selected")}
            </button>
          </div>

          {progress && <div className="mt-2.5"><ProgressBar label={t("manage.classify.classifyingProgress", `Classifying ${progress.current}/${progress.total}…`, { current: progress.current, total: progress.total })} current={progress.current} total={progress.total} accent="var(--accent)" /></div>}
          {actionError && <div className="mt-2.5"><ErrorBanner message={actionError} /></div>}
        </>
      )}
    </Card>
  );
}
