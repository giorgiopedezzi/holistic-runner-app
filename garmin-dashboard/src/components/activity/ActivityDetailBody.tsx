import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "@/api/client";
import { useSettings } from "@/hooks/useSettings";
import { Stat, StatGrid, ErrorBanner, LoadingSpinner, Badge } from "@/components/ui";
import { ClassificationCard } from "../ClassificationCard";
import { ActivityTypePicker } from "./ActivityTypePicker";
import { SPORT_COLOR, type Activity, type TrackPoint } from "@/types/api";
import { fmtDuration, fmtKm, fmtElevation, fmtDate } from "@/utils/fmt";
import { computeOutlierMask, computeMinSpeedMask } from "@/domain/outliers";
import { detectPauses, computeHrRecovery } from "@/domain/pauses";
import {
  axisDomainCentered, buildChartData,
  type MetricKey, type OptionalMetricKey, type SpeedMode, type XMode,
} from "@/domain/activity-chart";
import { SpeedPaceStat } from "./SpeedPaceStat";
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
  const [activity, setActivity] = useState<Activity | null>(null);
  const [track,    setTrack]    = useState<TrackPoint[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [xMode, setXMode] = useState<XMode>("distance");
  // Heart rate starts active by default (the rest are opt-in).
  const [activeMetrics, setActiveMetrics] = useState<OptionalMetricKey[]>(["heart_rate"]);
  const [speedMode, setSpeedMode] = useState<SpeedMode>("speed");
  const [pauseThreshold, setPauseThreshold] = useState(30);
  const [removeOutliers, setRemoveOutliers] = useState(true);
  const { settings } = useSettings(); // outlier thresholds; no-ops until it loads
  // Speed/Pace's axis is mandatory — always visible, no toggle (see
  // ActivityChartSection) — so this only ever tracks the four optional
  // metrics.
  // Defaults mirror activeMetrics/showCard: heart_rate starts on, the rest
  // off — an axis for a metric whose line isn't even drawn yet is pointless,
  // and heart_rate's line/card both start active so its axis must too (an
  // earlier version of this default left heart_rate false here while the
  // other two started true, so HR's line rendered with no axis on first load).
  const [axisVisible, setAxisVisible] = useState<Record<OptionalMetricKey, boolean>>({
    heart_rate: true, altitude_m: false, cadence: false, power: false,
  });
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
      setError(e instanceof Error ? e.message : "Delete failed");
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
  function toggleAxis(key: OptionalMetricKey) {
    setAxisVisible(s => ({ ...s, [key]: !s[key] }));
  }
  function toggleCard(key: MetricKey) {
    setShowCard(s => ({ ...s, [key]: !s[key] }));
  }

  return (
    <>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          {activity && (
            <Badge label={activity.sport ?? "other"} color={SPORT_COLOR[activity.sport ?? "other"] ?? "#888"} />
          )}
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{activity && fmtDate(activity.date_only)}</span>
          {activity?.source && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>via {activity.source}</span>
          )}
          <div style={{ flex: 1 }} />
          {activity && <ActivityTypePicker activity={activity} onUpdate={setActivity} />}
          {!confirmDelete ? (
            <button
              className="hra-btn"
              data-variant="cta"
              style={{ "--btn-color": "var(--accent-red)" } as CSSProperties}
              onClick={() => setConfirmDelete(true)}
              title="Moves this activity to the local database's trash (Data & Sync tab) — it's not touched on your Garmin device, Strava, or Withings account, and you can restore it later. A resync won't bring it back on its own."
            >
              Delete activity (locally)
            </button>
          ) : (
            <div className="hra-row" style={{ gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--accent-red)" }}>Move to trash?</span>
              <button
                className="hra-btn" data-variant="cta"
                style={{ "--btn-color": "var(--accent-red)" } as CSSProperties}
                onClick={handleDelete} disabled={deleting}
              >
                {deleting ? "…" : "Yes, delete"}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                style={{ fontSize: 12, border: "1px solid var(--border-strong)", borderRadius: 6, padding: "4px 12px", background: "none", color: "var(--text-secondary)", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          )}
          {onClose && (
            <button onClick={onClose}
              style={{ fontSize: 18, border: "none", background: "none", color: "var(--text-muted)", cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>
              ×
            </button>
          )}
        </div>

        {loading && <LoadingSpinner />}
        {error   && <ErrorBanner message={error} />}

        {activity && !loading && (
          <>
            {activity.sport === "running" && <ClassificationCard activity={activity} onUpdate={setActivity} />}

            <StatGrid>
              <Stat label="Distance"    value={fmtKm(activity.distance_m)} accent="var(--accent-green)" />
              {activity.moving_time_sec != null && <Stat label="Moving time" value={fmtDuration(activity.moving_time_sec)} />}
              <Stat label="Duration"    value={fmtDuration(activity.duration_sec)} />
              {activity.calories != null && <Stat label="Calories" value={`${activity.calories} kcal`} />}
              {(activity.avg_pace_minkm != null || activity.avg_speed_ms != null) &&
                <SpeedPaceStat avgSpeedMs={activity.avg_speed_ms} avgPaceMinKm={activity.avg_pace_minkm} />}
              {activity.avg_cadence != null && <Stat label="Cadence" value={`${activity.avg_cadence} spm`} />}
              {activity.avg_hr != null      && <Stat label="Avg HR"  value={`${activity.avg_hr} bpm`} accent="var(--accent-red)" />}
              {activity.max_hr != null      && <Stat label="Max HR"  value={`${activity.max_hr} bpm`} />}
              {activity.ascent_m != null    && <Stat label="Ascent"  value={fmtElevation(activity.ascent_m)} />}
              {activity.descent_m != null   && <Stat label="Descent" value={fmtElevation(activity.descent_m)} />}
            </StatGrid>

            {track.length > 5 && (
              <ActivityChartSection
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
                axisVisible={axisVisible}
                showCard={showCard}
                toggleMetric={toggleMetric}
                toggleAxis={toggleAxis}
                toggleCard={toggleCard}
              />
            )}
          </>
        )}
    </>
  );
}
