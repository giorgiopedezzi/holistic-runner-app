import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Timer, Clock, Flame, Footprints, HeartPulse, Mountain } from "lucide-react";
import { api } from "@/api/client";
import { useSettings } from "@/hooks/useSettings";
import { Stat, StatGrid, ErrorBanner, LoadingSpinner, Badge, AccordionCard, Empty, Select } from "@/components/ui";
import { ClassificationCard } from "../ClassificationCard";
import { ActivityTypePicker } from "./ActivityTypePicker";
import { PlannedPaceTargetChart } from "../PlannedPaceTargetChart";
import { buildPaceTargetBandModel } from "@/domain/planned-workout";
import type { ResolvedSegment } from "@/types/runplan";
import { SPORT_COLOR, classificationStatus, WORKOUT_CLASSIFICATION_KEY, type Activity, type PlanInstanceDayWithInstance, type TrackPoint, type WorkoutClassification } from "@/types/api";
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
  // Same-day scheduled workout(s), HRA-206: looked up once the activity
  // itself has loaded and is a running activity. 0 matches -> no UI change,
  // 1 -> the chart renders automatically, >=2 -> a picker (see the render
  // below). selectedPlannedDayId defaults to the first match returned by the
  // backend (newest instance first, see plan-instances.repo.ts) — the Story
  // leaves the default order unspecified beyond "deterministic".
  const [plannedDays, setPlannedDays] = useState<PlanInstanceDayWithInstance[]>([]);
  const [selectedPlannedDayId, setSelectedPlannedDayId] = useState<number | null>(null);
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

  // `ignore` guards against a stale response landing after a newer request
  // already started (e.g. activityId changing again before the first fetch
  // resolves). It does NOT stop React 19 StrictMode's dev-only double-invoke
  // of this effect (mount → cleanup → mount again, specifically to surface
  // effects that aren't idempotent) — that's why activityId/id/track show up
  // twice in the Network tab in development; it's intentional, app-wide
  // (every data-fetching effect in this app does it, not just this one), and
  // stripped entirely in a production build. This guard is still worth
  // having on its own merits: without it, the FIRST (soon-to-be-discarded)
  // call's response can still land after the second and overwrite it with
  // stale data.
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    Promise.all([
      api.garmin.activity(activityId),
      api.garmin.track(activityId),
    ]).then(([act, trk]) => {
      if (ignore) return;
      setActivity(act);
      setTrack(trk);
    }).catch(e => { if (!ignore) setError(e.message); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [activityId]);

  // HRA-206: non-running activities never show this UI, even if a same-day
  // running plan day exists — gated on activity.sport, not just presence of
  // an activity row. Runs once the activity itself is loaded (sport/date_only
  // are on `activity`, not known from activityId alone).
  useEffect(() => {
    if (!activity || activity.sport !== "running") {
      setPlannedDays([]);
      setSelectedPlannedDayId(null);
      return;
    }
    let ignore = false;
    api.planInstances.byDate(activity.date_only).then(days => {
      if (ignore) return;
      setPlannedDays(days);
      setSelectedPlannedDayId(days[0]?.id ?? null);
    }).catch(() => { if (!ignore) { setPlannedDays([]); setSelectedPlannedDayId(null); } });
    return () => { ignore = true; };
    // Deliberately keyed on sport/date_only, not the whole `activity` object
    // reference — a re-fetch of the same activity (e.g. after ActivityTypePicker's
    // onUpdate) must not re-trigger this lookup unless one of those two fields
    // actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.sport, activity?.date_only]);

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

  // HRA-206: the selected same-day scheduled day's segments, parsed into the
  // shared PaceTargetBandModel that PlannedPaceTargetChart already renders
  // unmodified for the plan-instance editor's own preview — same JSON.parse
  // pattern planInstanceEditor.mappers.ts uses for this same column.
  const selectedPlannedDay = plannedDays.find(d => d.id === selectedPlannedDayId) ?? null;
  const plannedPaceModel = useMemo(() => {
    if (!selectedPlannedDay) return null;
    try {
      return buildPaceTargetBandModel(JSON.parse(selectedPlannedDay.segments) as ResolvedSegment[]);
    } catch {
      return null;
    }
  }, [selectedPlannedDay]);

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
        {/* header — popup (ActivityModal) variant ONLY. The accordion variant
            (onClose undefined) has no header here at all any more: all of
            this — sport/date/via, the ActivityTypePicker, Delete — now lives
            on ActivityRow's own row instead (dashboard design-system rework:
            "keep every information at accordion wrap-up level" — opening an
            accordion row used to repeat almost everything its own collapsed
            summary already showed). Left untouched for the popup, which has
            no ActivityRow wrapping it to show this instead. */}
        {onClose && (
        <div className="flex items-center gap-3 mb-5">
          {activity && (
            <Badge label={activity.sport ?? "other"} color={SPORT_COLOR[getResolvedTheme()][activity.sport ?? "other"] ?? "#888"} />
          )}
          <span className="hra-text-secondary text-label">{activity && fmtDate(activity.date_only)}</span>
          {activity?.source && (
            <span className="hra-text-muted text-meta">{t("activity.detail.viaSource", `via ${activity.source}`, { source: activity.source })}</span>
          )}
          <div className="flex-1" />
          {activity && <ActivityTypePicker activity={activity} onUpdate={setActivity} />}
          {!confirmDelete ? (
            <button
              className="hra-btn"
              data-variant="cta"
              data-tone="red"
              onClick={() => setConfirmDelete(true)}
              title={t("activity.detail.deleteTooltip", "Moves this activity to the local database's trash (Data & Sync tab) — it's not touched on your Garmin device, Strava, or Withings account, and you can restore it later. A resync won't bring it back on its own.")}
            >
              {t("activity.detail.deleteButton", "Remove activity")}
            </button>
          ) : (
            <div className="hra-row gap-1.5">
              <span className="hra-text-danger text-meta">{t("activity.detail.moveToTrash", "Move to trash?")}</span>
              <button
                className="hra-btn" data-variant="cta"
                data-tone="red"
                onClick={handleDelete} disabled={deleting}
              >
                {deleting ? "…" : t("common.yesDelete", "Yes, delete")}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="hra-border-strong hra-text-secondary text-meta rounded-md py-1 px-3 bg-transparent cursor-pointer">
                {t("common.cancel", "Cancel")}
              </button>
            </div>
          )}
          <button onClick={onClose}
            className="hra-text-muted text-heading border-0 bg-transparent cursor-pointer leading-none px-1">
            ×
          </button>
        </div>
        )}

        {loading && <LoadingSpinner label={t("activity.detail.loading", "Loading activity…")} />}
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
                    <div className="hra-row-wrap gap-3.5">
                      <span>{t("activity.classify.title", "Classification")}</span>
                      {/* Collapsed summary — sized/weighted as meta text
                          (secondary info), not a competing headline. */}
                      <span className="hra-text-secondary text-meta">
                        {t("activity.classify.summaryAi", `AI: ${classificationLabel(activity.ai_classification)}`, { classification: classificationLabel(activity.ai_classification) })}
                        {" · "}
                        {t("activity.classify.summaryStatistical", `Statistical: ${classificationLabel(activity.statistical_classification)}`, { classification: classificationLabel(activity.statistical_classification) })}
                        {" · "}
                        {t("activity.classify.summarySampling", `Sampling: ${splitMeters === 1000 ? "1km" : "0.5km"}`, { sampling: splitMeters === 1000 ? "1km" : "0.5km" })}
                        {" · "}
                        <span className="hra-classification-status hra-dyn-color font-semibold" data-status={status}>
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
                token. Full width, matching the Classification accordion
                above it (dashboard design-system rework: this row and the
                chart section's own selector row both match Classification's
                width — only the row INSIDE the graph card itself narrows in
                to the chart's actual plot width, see
                ActivityChartSection.tsx's CHART_HEADER_EXTRA_LEFT/RIGHT). */}
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

            {/* HRA-206: same-day scheduled workout(s) — 0 matches means no UI
                change (plannedDays stays empty), 1 renders the chart
                automatically, >=2 shows a picker (labeled by instance name)
                above it. Placed below the main graph, matching the Story's
                own insertion point. */}
            {plannedDays.length >= 2 && (
              <div className="hra-row gap-2 mt-2.5">
                <span className="hra-text-secondary text-label">{t("activity.plannedWorkout.pickerLabel", "Compare to plan")}</span>
                <Select
                  value={String(selectedPlannedDayId)}
                  onValueChange={v => setSelectedPlannedDayId(Number(v))}
                  options={plannedDays.map(d => ({
                    value: String(d.id),
                    label: d.instance_name ?? t("activity.plannedWorkout.unnamedInstance", "Unnamed plan"),
                  }))}
                />
              </div>
            )}
            {plannedPaceModel && <PlannedPaceTargetChart model={plannedPaceModel} />}
          </>
        )}
    </>
  );
}
