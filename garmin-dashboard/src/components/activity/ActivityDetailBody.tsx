import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Timer, Clock, Flame, Footprints, HeartPulse, Mountain } from "lucide-react";
import { api } from "@/api/client";
import { useSettings } from "@/hooks/useSettings";
import { Stat, StatGrid, ErrorBanner, LoadingSpinner, Badge, AccordionCard, Empty } from "@/components/ui";
import { ClassificationCard, statusColor } from "../ClassificationCard";
import { ActivityTypePicker } from "./ActivityTypePicker";
import { SPORT_COLOR, classificationStatus, WORKOUT_CLASSIFICATION_KEY, type Activity, type TrackPoint, type WorkoutClassification } from "@/types/api";
import { getResolvedTheme } from "@/utils/theme";
import { fmtDuration, fmtElevation, fmtDate } from "@/utils/fmt";
import { computeOutlierMask, computeMinSpeedMask } from "@/domain/outliers";
import { detectPauses, computeHrRecovery } from "@/domain/pauses";
import {
  axisDomainCentered, buildChartData,
  type MetricKey, type OptionalMetricKey, type SpeedMode, type XMode,
} from "@/domain/activity-chart";
import { hrRunnerColor } from "./shared";
import { ActivityChartSection } from "./ActivityChartSection";

// onClose omitted entirely (not just a no-op) for the accordion/inline use
// case (ActivitiesTab, "accordion" detail-view setting) — the × close
// button and the fixed backdrop-overlay chrome only make sense for the
// popup variant, and their absence is what distinguishes the two.
interface DetailBodyProps {
  activityId: number;
  onDelete: (id: number) => void;
  onClose?: () => void;
}

// Everything an activity's detail view actually shows — used both inside
// the popup (ActivityModal) and inline in ActivitiesTab's accordion row
// (the "accordion" activity_detail_view setting). onClose being undefined
// is what makes this render as a plain content block instead of a popup
// with an × button.
export function ActivityDetailBody({ activityId, onDelete, onClose }: DetailBodyProps) {
  const { t } = useTranslation();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [track,    setTrack]    = useState<TrackPoint[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Classification accordion (dashboard design-system rework, "reorganize
  // activity layout") — collapsed by default; splitMeters is lifted out of
  // ClassificationCard (which still falls back to its own local state when
  // not given these) purely so the collapsed header can show the current
  // sampling granularity without expanding the section.
  const [classificationExpanded, setClassificationExpanded] = useState(false);
  const [splitMeters, setSplitMeters] = useState(1000);

  const [xMode, setXMode] = useState<XMode>("distance");
  // Heart rate starts active by default (the rest are opt-in).
  const [activeMetrics, setActiveMetrics] = useState<OptionalMetricKey[]>(["heart_rate"]);
  const [speedMode, setSpeedMode] = useState<SpeedMode>("speed");
  const [pauseThreshold, setPauseThreshold] = useState(30);
  const [removeOutliers, setRemoveOutliers] = useState(true);
  const { settings } = useSettings(); // outlier thresholds; no-ops until it loads
  // Speed/Pace never gets a standalone card — the overlay chart already
  // shows it (it's always active), a second single-metric copy is redundant.
  // Heart rate's card starts open to match it starting active by default.
  const [showCard, setShowCard] = useState<Record<MetricKey, boolean>>({
    speed: false, heart_rate: true, altitude_m: false, cadence: false, power: false,
  });

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.garmin.activity(activityId),
      api.garmin.track(activityId),
    ]).then(([act, trk]) => {
      setActivity(act);
      setTrack(trk);
    }).catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [activityId]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.garmin.deleteOne(activityId);
      onDelete(activityId);
      onClose?.(); // popup variant only — accordion has nothing to "close"
    } catch (e) {
      setError(e instanceof Error ? e.message : t("activity.detail.deleteFailed", "Delete failed"));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const availableMetrics = useMemo((): Record<MetricKey, boolean> => ({
    speed:      track.some(p => p.speed_ms != null),
    heart_rate: track.some(p => p.heart_rate != null),
    altitude_m: track.some(p => p.altitude_m != null),
    cadence:    track.some(p => p.cadence != null),
    power:      track.some(p => p.power != null),
  }), [track]);

  // Speed/Pace is always active — the mandatory first metric.
  const effectiveActive = useMemo((): MetricKey[] => ["speed", ...activeMetrics], [activeMetrics]);

  // Outlier filtering only ever touches speed_ms/cadence — every other field
  // (position, timestamps, heart_rate...) passes through unchanged, so pause
  // detection and HR recovery below stay on the raw `track`, not this.
  // Speed combines two independent rules: the isolated-spike delta filter,
  // and an absolute "too slow to be running" floor (see computeMinSpeedMask).
  const speedOutlierMask = useMemo(() => {
    if (!removeOutliers || !settings) return track.map(() => false);
    const deltaMask = computeOutlierMask(track, p => p.speed_ms, settings.outlier_speed_delta_per_sec);
    const minSpeedMask = computeMinSpeedMask(track, settings.outlier_min_speed_kmh);
    return track.map((_, i) => deltaMask[i] || minSpeedMask[i]);
  }, [track, removeOutliers, settings]);
  const cadenceOutlierMask = useMemo(
    () => (removeOutliers && settings) ? computeOutlierMask(track, p => p.cadence, settings.outlier_cadence_delta_per_sec) : track.map(() => false),
    [track, removeOutliers, settings],
  );
  const displayTrack = useMemo(
    () => track.map((p, i) => (speedOutlierMask[i] || cadenceOutlierMask[i])
      ? { ...p, speed_ms: speedOutlierMask[i] ? null : p.speed_ms, cadence: cadenceOutlierMask[i] ? null : p.cadence }
      : p),
    [track, speedOutlierMask, cadenceOutlierMask],
  );

  const speedDomain = useMemo(() => {
    const d = axisDomainCentered(displayTrack, "speed", speedMode);
    // Pace can't physically be negative — belt-and-suspenders on top of
    // outlier removal already keeping this in check in practice.
    return speedMode === "pace" ? ([Math.max(0, d[0]), d[1]] as [number, number]) : d;
  }, [displayTrack, speedMode]);

  const pauses = useMemo(() => detectPauses(track, pauseThreshold), [track, pauseThreshold]);
  const chartData = useMemo(
    () => buildChartData(displayTrack, pauses, xMode, effectiveActive, speedMode, speedOutlierMask),
    [displayTrack, pauses, xMode, effectiveActive, speedMode, speedOutlierMask],
  );
  const hrRecovery = useMemo(() => computeHrRecovery(track, pauses), [track, pauses]);
  // Aligned 1:1 with `pauses` (both in afterIndex order) — chartData produces
  // exactly one break row per pause, so zipping by index is safe here.
  const hrRecoveryByAfterIndex = useMemo(() => {
    const m = new Map<number, number>();
    for (const f of hrRecovery) m.set(f.afterIndex, f.delta);
    return m;
  }, [hrRecovery]);
  const hrRecoveryChartData = useMemo(
    () => chartData.map(row => ({
      ...row,
      hrRecoveryDelta: row.pauseAfterIndex != null ? hrRecoveryByAfterIndex.get(row.pauseAfterIndex) : undefined,
    })),
    [chartData, hrRecoveryByAfterIndex],
  );

  function toggleMetric(key: OptionalMetricKey) {
    setActiveMetrics(a => {
      if (a.includes(key)) return a.filter(k => k !== key);
      setShowCard(s => ({ ...s, [key]: true })); // default: show its card once added to the overlay
      return [...a, key];
    });
  }
  function toggleCard(key: MetricKey) {
    setShowCard(s => ({ ...s, [key]: !s[key] }));
  }

  return (
    <>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          {activity && (
            <Badge label={activity.sport ?? "other"} color={SPORT_COLOR[getResolvedTheme()][activity.sport ?? "other"] ?? "#888"} />
          )}
          <span className="hra-text-secondary" style={{ fontSize: 13 }}>{activity && fmtDate(activity.date_only)}</span>
          {activity?.source && (
            <span className="hra-text-muted" style={{ fontSize: 11 }}>{t("activity.detail.viaSource", `via ${activity.source}`, { source: activity.source })}</span>
          )}
          <div style={{ flex: 1 }} />
          {activity && <ActivityTypePicker activity={activity} onUpdate={setActivity} />}
          {!confirmDelete ? (
            <button
              className="hra-btn"
              data-variant="cta"
              style={{ "--btn-color": "var(--accent-red)" } as CSSProperties}
              onClick={() => setConfirmDelete(true)}
              title={t("activity.detail.deleteTooltip", "Moves this activity to the local database's trash (Data & Sync tab) — it's not touched on your Garmin device, Strava, or Withings account, and you can restore it later. A resync won't bring it back on its own.")}
            >
              {t("activity.detail.deleteButton", "Delete activity (locally)")}
            </button>
          ) : (
            <div className="hra-row" style={{ gap: 6 }}>
              <span className="hra-text-danger" style={{ fontSize: 12 }}>{t("activity.detail.moveToTrash", "Move to trash?")}</span>
              <button
                className="hra-btn" data-variant="cta"
                style={{ "--btn-color": "var(--accent-red)" } as CSSProperties}
                onClick={handleDelete} disabled={deleting}
              >
                {deleting ? "…" : t("common.yesDelete", "Yes, delete")}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="hra-border-strong hra-text-secondary"
                style={{ fontSize: 12, borderRadius: 6, padding: "4px 12px", background: "none", cursor: "pointer" }}>
                {t("common.cancel", "Cancel")}
              </button>
            </div>
          )}
          {onClose && (
            <button onClick={onClose}
              className="hra-text-muted"
              style={{ fontSize: 18, border: "none", background: "none", cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>
              ×
            </button>
          )}
        </div>

        {loading && <LoadingSpinner />}
        {error   && <ErrorBanner message={error} />}

        {activity && !loading && (
          <>
            {/* Wrapping up, top to bottom (dashboard design-system rework,
                "reorganize activity layout"): 1. classification accordion,
                2. one row of badges, 3/4. the chart section's own selector
                rows, 5. the graph(s). */}
            {activity.sport === "running" && (() => {
              const status = classificationStatus(activity);
              const classificationLabel = (c: string | null) =>
                c ? t(WORKOUT_CLASSIFICATION_KEY[c as WorkoutClassification] ?? "unknown", c) : t("activity.classify.notYetClassified", "Not yet classified");
              const statusLabel = status === "confirmed"
                ? t("activity.classify.confirmedShort", "Confirmed")
                : status === "pending" ? t("activity.classify.pendingReview", "Pending review")
                : t("activity.classify.notYetClassified", "Not yet classified");
              return (
                <AccordionCard
                  expanded={classificationExpanded}
                  onToggle={() => setClassificationExpanded(e => !e)}
                  title={
                    <div className="hra-row-wrap" style={{ gap: 14 }}>
                      <span>{t("activity.classify.title", "Classification")}</span>
                      {/* Collapsed summary — sized/weighted as meta text
                          (secondary info), not a competing headline. */}
                      <span className="hra-text-secondary" style={{ fontSize: "var(--fs-meta)", fontWeight: "var(--fw-meta)" } as CSSProperties}>
                        {t("activity.classify.summaryAi", `AI: ${classificationLabel(activity.ai_classification)}`, { classification: classificationLabel(activity.ai_classification) })}
                        {" · "}
                        {t("activity.classify.summaryStatistical", `Statistical: ${classificationLabel(activity.statistical_classification)}`, { classification: classificationLabel(activity.statistical_classification) })}
                        {" · "}
                        {t("activity.classify.summarySampling", `Sampling: ${splitMeters === 1000 ? "1km" : "0.5km"}`, { sampling: splitMeters === 1000 ? "1km" : "0.5km" })}
                        {" · "}
                        <span className="hra-dyn-color" style={{ "--dyn-color": statusColor(status), fontWeight: 600 } as CSSProperties}>
                          {statusLabel}
                        </span>
                      </span>
                    </div>
                  }
                >
                  <ClassificationCard activity={activity} onUpdate={setActivity} splitMeters={splitMeters} onSplitMetersChange={setSplitMeters} />
                </AccordionCard>
              );
            })()}

            {/* One row of badges (dashboard design-system rework, "harmonize
                badges" / "reorganize activity layout") — Distance, the
                currently-selected Speed/Pace value, and Avg HR all moved
                INSIDE the graph itself (as in Overview's GraphKpiCard, see
                ActivityChartSection.tsx's controlsRow); Ascent/Descent
                merged into one Elevation badge here. Same icon size (18)
                and coloring convention as Overview's Stat icons
                (docs/frontend.md's "Icon coloring" rule): heart matches its
                own interpolated HR color, flame is the one filled
                dark-orange exception, everything else is the plain accent
                token. */}
            <StatGrid>
              {activity.moving_time_sec != null && <Stat icon={<Timer size={18} color="var(--accent)" />} label={t("activity.stat.movingTime", "Moving time")} value={fmtDuration(activity.moving_time_sec)} />}
              <Stat icon={<Clock size={18} color="var(--accent)" />} label={t("activity.stat.duration", "Duration")} value={fmtDuration(activity.duration_sec)} />
              {activity.calories != null && <Stat icon={<Flame size={18} color="color-mix(in srgb, var(--accent-orange) 65%, black)" fill="color-mix(in srgb, var(--accent-orange) 65%, black)" />} label={t("activity.stat.calories", "Calories")} value={`${activity.calories} kcal`} />}
              {activity.avg_cadence != null && <Stat icon={<Footprints size={18} color="var(--accent)" />} label={t("activity.stat.cadence", "Cadence")} value={`${activity.avg_cadence} spm`} />}
              {(activity.ascent_m != null || activity.descent_m != null) && (
                <Stat icon={<Mountain size={18} color="var(--accent)" />} label={t("activity.stat.elevation", "Elevation")}
                  value={[
                    activity.ascent_m  != null ? `↑${fmtElevation(activity.ascent_m)}`  : null,
                    activity.descent_m != null ? `↓${fmtElevation(activity.descent_m)}` : null,
                  ].filter(Boolean).join("  ")} />
              )}
              {activity.max_hr != null && <Stat icon={<HeartPulse size={18} color={hrRunnerColor(activity.max_hr)} />} label={t("activity.stat.maxHr", "Max HR")} value={`${activity.max_hr} bpm`} accent={hrRunnerColor(activity.max_hr)} />}
            </StatGrid>

            {track.length <= 5 && (
              // Distance/Speed-Pace moved inside the graph (see above) —
              // when the track's too short to plot at all, that's also the
              // only place they'd show, so surface an explicit message
              // instead of silently showing neither a chart nor a number.
              <Empty message={t("activity.chart.notEnoughData", "Not enough track data to plot a chart.")} />
            )}

            {track.length > 5 && (
              <ActivityChartSection
                distanceM={activity.distance_m}
                avgSpeedMs={activity.avg_speed_ms}
                avgPaceMinKm={activity.avg_pace_minkm}
                avgHr={activity.avg_hr}
                displayTrack={displayTrack}
                chartData={chartData}
                hrRecoveryChartData={hrRecoveryChartData}
                xMode={xMode} setXMode={setXMode}
                pauseThreshold={pauseThreshold} setPauseThreshold={setPauseThreshold}
                removeOutliers={removeOutliers} setRemoveOutliers={setRemoveOutliers}
                speedMode={speedMode} setSpeedMode={setSpeedMode}
                speedDomain={speedDomain}
                activeMetrics={activeMetrics}
                effectiveActive={effectiveActive}
                availableMetrics={availableMetrics}
                showCard={showCard}
                toggleMetric={toggleMetric}
                toggleCard={toggleCard}
              />
            )}
          </>
        )}
    </>
  );
}
