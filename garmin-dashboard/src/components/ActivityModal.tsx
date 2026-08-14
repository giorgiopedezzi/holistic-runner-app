/**
 * ActivityModal.tsx
 * Full detail view for a single activity — shown when user clicks on an activity row.
 * Displays all fields + a multi-metric track chart (Speed/Pace pinned, plus optional
 * HR/altitude/cadence/power, overlaid with pause detection) + delete button.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { api } from "@/api/client";
import { Card, Stat, StatGrid, ErrorBanner, LoadingSpinner, Badge } from "@/components/ui";
import {
  SPORT_COLOR, type Activity, type TrackPoint, type Settings,
  WORKOUT_CLASSIFICATIONS, CORRECTION_REASONS, classificationStatus,
  type WorkoutClassification, type CorrectionReason, type ClassificationMethod,
} from "@/types/api";
import { fmtPace, fmtDuration, fmtKm, fmtElevation, fmtSpeed } from "@/utils/fmt";
import { speedUnitLabel, paceUnitLabel } from "@/utils/units";
import { computeOutlierMask, computeMinSpeedMask } from "@/domain/outliers";
import { detectPauses, fmtPauseDuration, computeHrRecovery } from "@/domain/pauses";
import {
  metricUnit, fmtMetricValue, axisDomainCentered, axisDomainMinMax, magnitudeColor,
  buildChartData, xTickFormatter, fmtElapsedClock,
  type MetricKey, type OptionalMetricKey, type SpeedMode, type XMode, type ChartRow,
} from "@/domain/activity-chart";

// Re-exported so the Phase 0 outlier tests (activity-outliers.test.ts, HRA-63)
// keep importing them from here unchanged after the move to domain/outliers.ts.
export { computeOutlierMask, computeMinSpeedMask } from "@/domain/outliers";

interface Props {
  activityId: number;
  onClose: () => void;
  onDelete: (id: number) => void;
}

// onClose omitted entirely (not just a no-op) for the accordion/inline use
// case (ActivitiesTab, "accordion" detail-view setting) — the × close
// button and the fixed backdrop-overlay chrome only make sense for the
// popup variant, and their absence is what distinguishes the two.
interface DetailBodyProps {
  activityId: number;
  onDelete: (id: number) => void;
  onClose?: () => void;
}

const axisStyle = { fill: "var(--text-muted)", fontSize: 10 };
const gridStyle = { stroke: "var(--border)", strokeDasharray: "3 3" };
const ttStyle   = { contentStyle: { background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 } };

// ── Metric definitions ───────────────────────────────────────────────────
// Colors are the same validated-for-this-dark-surface set used in BodyTab.tsx
// (heart_rate/altitude reuse the exact accents established there; speed/
// cadence use the darker green/orange variants that clear the dark-mode
// lightness band). Power is new; the full 5-color set was re-validated
// together (validate_palette.js) before use.

// Speed's line/UI stays this app's reference green (#15965f — chosen to
// clear the dark-mode lightness band as a stroke/fill), but that same shade
// measures only ~4.15:1 against --bg-card as 9px axis tick TEXT, borderline
// for comfortable legibility. A distinct, lighter green used ONLY for the
// axis tick labels (not the line, not any other UI) fixes that without
// touching the established reference color itself.
const SPEED_AXIS_TEXT_COLOR = "#20c17b"; // ~6.7:1 vs --bg-card

const METRIC_DEFS: Record<MetricKey, { label: string; color: string }> = {
  speed:      { label: "Speed",      color: "#15965f" },
  heart_rate: { label: "Heart rate", color: "#e24b4a" },
  altitude_m: { label: "Altitude",   color: "#3a8ef5" },
  cadence:    { label: "Cadence",    color: "#d97706" },
  power:      { label: "Power",      color: "#a855f7" },
};
const OPTIONAL_METRIC_ORDER: OptionalMetricKey[] = ["heart_rate", "altitude_m", "cadence", "power"];

// Speed/Pace (the one mandatory metric) is ALONE on the left — every
// optional metric (heart_rate, altitude_m, cadence, power) goes right, no
// exceptions. Earlier versions only isolated Speed from whichever single
// metric was being compared against at the time (first from all optional
// metrics generically, then just from HR once HR moved right) — but leaving
// any other optional metric sharing Speed's side meant toggling *that* one
// on could reintroduce the same "Speed shares a side with a
// dynamically-appearing axis" situation that caused it to go missing
// before. Giving Speed sole, unconditional ownership of the left side
// removes that risk under every toggle combination, not just the default
// one, while still keeping Speed and HR (the two axes visible by default)
// on opposite sides as asked.
const AXIS_SIDE: Record<MetricKey, "left" | "right"> = {
  speed: "left", heart_rate: "right", altitude_m: "right", cadence: "right", power: "right",
};


// Standard Recharts pattern for a custom marker at a data coordinate — much
// more reliable than a ReferenceLine's custom `label` render prop (which,
// in practice, silently failed to render at all here).
function PauseFlagShape(props: unknown): React.ReactElement | null {
  const p = props as { cx?: number; cy?: number; payload?: { pauseDurationSec?: number } };
  if (p.cx == null || p.cy == null || p.payload?.pauseDurationSec == null) return null;
  const color = magnitudeColor(p.payload.pauseDurationSec, 300);
  const text = fmtPauseDuration(p.payload.pauseDurationSec);
  const w = Math.max(28, text.length * 6 + 10);
  return (
    <g transform={`translate(${p.cx - w / 2}, ${p.cy - 7})`}>
      <rect width={w} height={14} rx={7} fill={color} />
      <text x={w / 2} y={10.5} textAnchor="middle" fontSize={9} fill="#1a1a1a">{text}</text>
    </g>
  );
}


// Same yellow gradient/cap-based scheme as pause flags — a drop (recovery)
// and a rise share one gradient keyed on magnitude only (direction shown by
// the +/− in the label, not by color), with the biggest drop rendering
// darkest, same "how much" visual language as pause duration.
const HR_RECOVERY_COLOR_CAP = 60; // bpm — observed real deltas run ~8-55bpm

function HrRecoveryFlagShape(props: unknown): React.ReactElement | null {
  const p = props as { cx?: number; cy?: number; payload?: { hrRecoveryDelta?: number } };
  if (p.cx == null || p.cy == null || p.payload?.hrRecoveryDelta == null) return null;
  const delta = p.payload.hrRecoveryDelta;
  const text = `${delta > 0 ? "−" : delta < 0 ? "+" : "±"}${Math.abs(Math.round(delta))} bpm`;
  const color = magnitudeColor(Math.abs(delta), HR_RECOVERY_COLOR_CAP);
  const w = Math.max(36, text.length * 6 + 10);
  return (
    <g transform={`translate(${p.cx - w / 2}, ${p.cy - 7})`}>
      <rect width={w} height={14} rx={7} fill={color} />
      <text x={w / 2} y={10.5} textAnchor="middle" fontSize={9} fill="#1a1a1a">{text}</text>
    </g>
  );
}

function TrackTooltip({ active, payload, xMode, metrics, speedMode }: {
  active?: boolean; payload?: Array<{ payload: ChartRow }>;
  xMode: XMode; metrics: MetricKey[]; speedMode: SpeedMode;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  if (row.pauseDurationSec != null) {
    return (
      <div style={ttStyle.contentStyle}>
        <div style={{ padding: "6px 10px" }}>⏸ Paused {fmtPauseDuration(row.pauseDurationSec)}</div>
      </div>
    );
  }
  if (row.realX == null) return null;

  return (
    <div style={ttStyle.contentStyle}>
      <div style={{ padding: "6px 10px" }}>
        <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>
          {xMode === "time" ? fmtElapsedClock(row.realX) : fmtKm(row.realX)}
        </div>
        {metrics.map(key => {
          const v = row[key];
          if (typeof v !== "number") return null;
          return (
            <div key={key} style={{ color: METRIC_DEFS[key].color }}>
              {key === "speed" ? (speedMode === "speed" ? "Speed" : "Pace") : METRIC_DEFS[key].label}: {fmtMetricValue(key, v, speedMode)} {metricUnit(key, speedMode)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Per-metric row: pill (toggles it on/off) + axis switch + card switch.
// Used for the four optional metrics only — Speed/Pace is always active and
// has its own inline layout (unit switch instead of an on/off pill).
function MetricRow({ mKey, label, active, available, axisOn, cardOn, onToggleActive, onToggleAxis, onToggleCard }: {
  mKey: MetricKey; label: string; active: boolean; available: boolean;
  axisOn: boolean; cardOn: boolean;
  onToggleActive: () => void; onToggleAxis: () => void; onToggleCard: () => void;
}) {
  const color = METRIC_DEFS[mKey].color;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", flexWrap: "wrap" }}>
      <button
        onClick={onToggleActive}
        disabled={!available}
        title={available ? undefined : "No data for this metric"}
        style={{
          fontSize: 11, padding: "4px 10px", borderRadius: 999, textAlign: "left",
          cursor: available ? "pointer" : "not-allowed",
          opacity: available ? 1 : 0.4,
          border: `1px solid ${active ? color : "var(--border-strong)"}`,
          background: active ? `${color}22` : "transparent",
          color: active ? color : "var(--text-secondary)",
        }}
      >
        {label}
      </button>
      {active && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={axisOn} onChange={onToggleAxis} /> Axis
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={cardOn} onChange={onToggleCard} /> Card
          </label>
        </>
      )}
    </div>
  );
}

// Avg speed and avg pace are the same underlying measurement shown two
// ways, so they share one card instead of two, side by side in one row —
// each value uses the exact same size/weight as a normal single-value Stat
// (ui.tsx's Stat was reduced from 22px to 18px specifically so two of these
// values fit comfortably side by side without this card needing its own,
// inconsistent smaller size).
function SpeedPaceStat({ avgSpeedMs, avgPaceMinKm }: { avgSpeedMs: number | null; avgPaceMinKm: number | null }) {
  return (
    <Card>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Avg speed / pace
      </div>
      <div style={{ display: "flex", gap: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.2 }}>{avgPaceMinKm != null ? fmtPace(avgPaceMinKm) : "—"}</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{paceUnitLabel()}</div>
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.2 }}>{fmtSpeed(avgSpeedMs)}</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{speedUnitLabel()}</div>
        </div>
      </div>
    </Card>
  );
}

// ── AI workout classifier card ────────────────────────────────────────────
// Scoped to sport === 'running' by the caller — the six categories (Fartlek,
// Progressive Run, Repeats/Intervals...) are running-specific terminology.
// Classification is always on-demand (never triggered by sync — see
// CLAUDE.md's "AI workout classifier" notes) and reclassifying is always
// allowed, even on an already-confirmed activity, resetting it back to
// pending review. Custom border-only pill styling throughout (not ui.tsx's
// Badge) — Badge's `${color}22` alpha-suffix trick only works with literal
// hex colors, not this file's `var(--accent-*)` CSS variables.
function statusColor(status: ReturnType<typeof classificationStatus>): string {
  if (status === "confirmed") return "var(--accent-green)";
  if (status === "pending") return "var(--accent-orange)";
  return "var(--text-muted)";
}

function methodLabel(m: ClassificationMethod): string { return m === "ai" ? "AI" : "Statistical"; }

// One method's independent classify/result/thumbs — two of these sit side
// by side (see ClassificationCard below) so AI and Statistical can each be
// run and reviewed on their own schedule (AI takes ~15-25s on CPU,
// Statistical is instant), without one blocking or overwriting the other's
// stored result. There's still only one shared verdict per activity
// (activity.user_feedback/final_classification) — thumbs up/down here
// always acts on *this* card's classification as the source of that verdict
// (api.garmin.feedback's `source` field), so approving one card doesn't
// touch the other card's own stored classification, only which one "wins"
// as the activity's confirmed answer.
function MethodResultCard({
  activity, method, splitMeters, onUpdate,
}: { activity: Activity; method: ClassificationMethod; splitMeters: number; onUpdate: (a: Activity) => void }) {
  const [classifying, setClassifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCorrection, setShowCorrection] = useState(false);
  const [reason, setReason] = useState<CorrectionReason | "">("");
  const [corrected, setCorrected] = useState<WorkoutClassification | "">("");
  const [submitting, setSubmitting] = useState(false);
  // Live "how long has this been running" counter (mainly for AI, ~15-25s on
  // CPU with no other progress signal) plus the last completed run's
  // duration, kept visible until the next classify.
  const [elapsedSec, setElapsedSec] = useState(0);
  const [lastDurationSec, setLastDurationSec] = useState<number | null>(null);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!classifying) return;
    const id = setInterval(() => {
      if (startedAtRef.current != null) setElapsedSec((Date.now() - startedAtRef.current) / 1000);
    }, 100);
    return () => clearInterval(id);
  }, [classifying]);

  const classification = method === "ai" ? activity.ai_classification : activity.statistical_classification;
  const explanation = method === "ai" ? activity.ai_explanation : activity.statistical_explanation;
  // Whether the activity's one shared verdict currently points at this card
  // — only meaningful once there's an actual confirmed verdict; a NULL
  // user_feedback means nothing's been approved/rejected yet, regardless of
  // what classification_method happens to hold (e.g. stale pre-migration
  // data — see db.ts's one-time backfill for the ai_/statistical_ column
  // split).
  const isVerdictSource = activity.user_feedback != null && activity.classification_method === method;

  async function handleClassify() {
    setClassifying(true);
    setError(null);
    setElapsedSec(0);
    startedAtRef.current = Date.now();
    try {
      onUpdate(await api.garmin.classify(activity.id, splitMeters, method));
      setShowCorrection(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Classification failed");
    } finally {
      if (startedAtRef.current != null) setLastDurationSec((Date.now() - startedAtRef.current) / 1000);
      setClassifying(false);
    }
  }

  async function handleApprove() {
    setError(null);
    try {
      onUpdate(await api.garmin.feedback(activity.id, { feedback: "approved", source: method }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save feedback");
    }
  }

  async function handleReject() {
    if (!reason || !corrected) return;
    setSubmitting(true);
    setError(null);
    try {
      onUpdate(await api.garmin.feedback(activity.id, { feedback: "rejected", source: method, correctionReason: reason, finalClassification: corrected }));
      setShowCorrection(false);
      setReason("");
      setCorrected("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save feedback");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ flex: "1 1 240px", minWidth: 220, border: "1px solid var(--border)", borderRadius: 8, padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {methodLabel(method)}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleClassify}
          disabled={classifying}
          title={method === "ai"
            ? "Runs a local Ollama model against this activity's pace/HR pattern (takes ~15-25s on CPU). Always available, even if already classified — reclassifying resets the activity's shared review verdict back to pending."
            : "Applies deterministic rules to this activity's pace variance, splits, and pauses — instant, no Ollama needed. Always available, even if already classified — reclassifying resets the activity's shared review verdict back to pending."}
          style={{
            fontSize: 12, border: "1px solid var(--accent-blue)", borderRadius: 6, padding: "4px 12px",
            background: "none", color: "var(--accent-blue)",
            cursor: classifying ? "not-allowed" : "pointer", opacity: classifying ? 0.6 : 1,
          }}
        >
          {classifying ? `Classifying… ${elapsedSec.toFixed(1)}s` : classification ? "Reclassify" : "Classify"}
        </button>
      </div>
      {!classifying && lastDurationSec != null && (
        <div style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "right", marginTop: 2 }}>
          took {lastDurationSec.toFixed(1)}s
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        {classification ? (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 20,
            border: `1px solid ${isVerdictSource ? "var(--accent-green)" : "var(--border-strong)"}`,
            color: isVerdictSource ? "var(--accent-green)" : "var(--text-primary)",
            letterSpacing: "0.04em", textTransform: "uppercase",
          }}>
            {classification}
            {isVerdictSource && <span title="This card's result is the activity's confirmed classification">✓</span>}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Not yet classified</span>
        )}
      </div>

      {explanation && <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>{explanation}</div>}

      {classification && !showCorrection && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <button onClick={handleApprove} title="Confirm this card's classification as the activity's answer"
            style={{
              fontSize: 14, lineHeight: 1, borderRadius: 6, padding: "4px 10px", background: "none", cursor: "pointer",
              border: `1px solid ${isVerdictSource && activity.user_feedback === "approved" ? "var(--accent-green)" : "var(--border-strong)"}`,
              color: isVerdictSource && activity.user_feedback === "approved" ? "var(--accent-green)" : "var(--text-secondary)",
            }}>
            👍
          </button>
          <button onClick={() => setShowCorrection(true)} title="This card's classification is wrong"
            style={{
              fontSize: 14, lineHeight: 1, borderRadius: 6, padding: "4px 10px", background: "none", cursor: "pointer",
              border: `1px solid ${isVerdictSource && activity.user_feedback === "rejected" ? "var(--accent-red)" : "var(--border-strong)"}`,
              color: isVerdictSource && activity.user_feedback === "rejected" ? "var(--accent-red)" : "var(--text-secondary)",
            }}>
            👎
          </button>
        </div>
      )}
      {isVerdictSource && activity.user_feedback === "rejected" && activity.final_classification && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
          Corrected to: {activity.final_classification}{activity.user_correction_reason ? ` (${activity.user_correction_reason})` : ""}
        </div>
      )}

      {showCorrection && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
          <select value={reason} onChange={e => setReason(e.target.value as CorrectionReason)} style={{ fontSize: 12 }}>
            <option value="">Why was this wrong?</option>
            {CORRECTION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={corrected} onChange={e => setCorrected(e.target.value as WorkoutClassification)} style={{ fontSize: 12 }}>
            <option value="">What was it actually?</option>
            {WORKOUT_CLASSIFICATIONS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={handleReject} disabled={!reason || !corrected || submitting}
            style={{
              fontSize: 12, border: "none", borderRadius: 6, padding: "4px 12px", background: "var(--accent-red)", color: "#fff",
              cursor: (!reason || !corrected || submitting) ? "not-allowed" : "pointer", opacity: (!reason || !corrected) ? 0.5 : 1,
            }}>
            {submitting ? "…" : "Submit"}
          </button>
          <button onClick={() => setShowCorrection(false)}
            style={{ fontSize: 12, border: "1px solid var(--border-strong)", borderRadius: 6, padding: "4px 12px", background: "none", color: "var(--text-secondary)", cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      )}

      {error && <div style={{ marginTop: 8 }}><ErrorBanner message={error} /></div>}
    </div>
  );
}

// Overall status line (derived from the activity's one shared verdict) plus
// the two independent MethodResultCards. Split-size is one shared control
// here — it applies to whichever card's Classify button gets clicked next,
// not a per-card setting, since it's a single "how granular" preference the
// user sets once before running either.
function ClassificationCard({ activity, onUpdate }: { activity: Activity; onUpdate: (a: Activity) => void }) {
  const [splitMeters, setSplitMeters] = useState(1000);
  const status = classificationStatus(activity);
  const color = statusColor(status);

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        {status === "confirmed" && activity.final_classification ? (
          <span style={{
            display: "inline-block", fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 20,
            border: `1px solid ${color}`, color, letterSpacing: "0.04em", textTransform: "uppercase",
          }}>
            Confirmed: {activity.final_classification}
          </span>
        ) : (
          <span style={{ fontSize: 12, color, fontWeight: status === "pending" ? 600 : 400 }}>
            {status === "pending" ? "Pending review" : "Not yet classified"}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", borderRadius: 999, overflow: "hidden", border: "1px solid var(--border-strong)" }}
          title="Split granularity used to (re)classify — finer splits can surface short interval structure a coarser split smooths out">
          {([1000, 500] as const).map(m => (
            <button key={m} onClick={() => setSplitMeters(m)}
              style={{
                fontSize: 10, padding: "3px 8px", border: "none", cursor: "pointer",
                background: splitMeters === m ? "var(--bg-card)" : "transparent",
                color: splitMeters === m ? "var(--text-primary)" : "var(--text-muted)",
              }}>
              {m === 1000 ? "1km" : "0.5km"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <MethodResultCard activity={activity} method="ai" splitMeters={splitMeters} onUpdate={onUpdate} />
        <MethodResultCard activity={activity} method="statistical" splitMeters={splitMeters} onUpdate={onUpdate} />
      </div>
    </Card>
  );
}

// Everything an activity's detail view actually shows — used both inside
// the popup (ActivityModal, below) and inline in ActivitiesTab's accordion
// row (the "accordion" activity_detail_view setting). onClose being
// undefined is what makes this render as a plain content block instead of a
// popup with an × button.
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
  const [settings, setSettings] = useState<Settings | null>(null);
  // Speed/Pace's axis is mandatory — always visible, no toggle (see below) —
  // so this only ever tracks the four optional metrics.
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

  useEffect(() => {
    api.settings.get().then(setSettings).catch(() => {}); // outlier removal just no-ops without settings
  }, []);

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
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{activity?.date_only}</span>
          {activity?.source && (
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>via {activity.source}</span>
          )}
          <div style={{ flex: 1 }} />
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              title="Moves this activity to the local database's trash (Data & Sync tab) — it's not touched on your Garmin device, Strava, or Withings account, and you can restore it later. A resync won't bring it back on its own."
              style={{ fontSize: 12, border: "1px solid var(--accent-red)", borderRadius: 6, padding: "4px 12px", background: "none", color: "var(--accent-red)", cursor: "pointer" }}
            >
              Delete activity (locally)
            </button>
          ) : (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--accent-red)" }}>Move to trash?</span>
              <button onClick={handleDelete} disabled={deleting}
                style={{ fontSize: 12, border: "none", borderRadius: 6, padding: "4px 12px", background: "var(--accent-red)", color: "#fff", cursor: "pointer" }}>
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
              <div style={{ marginTop: 24 }}>
                <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {(["distance", "time"] as XMode[]).map(m => (
                      <button key={m} onClick={() => setXMode(m)}
                        style={{
                          fontSize: 11, padding: "3px 10px", borderRadius: 999, cursor: "pointer",
                          border: `1px solid ${xMode === m ? "var(--border-strong)" : "transparent"}`,
                          background: xMode === m ? "var(--bg-card)" : "transparent",
                          color: xMode === m ? "var(--text-primary)" : "var(--text-muted)",
                        }}>
                        {m === "distance" ? "Distance" : "Time"}
                      </button>
                    ))}
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
                    Highlight pauses ≥
                    <input type="number" min={5} step={5} value={pauseThreshold}
                      onChange={e => setPauseThreshold(Math.max(0, Number(e.target.value)))}
                      style={{ width: 56, fontSize: 11, padding: "2px 6px" }} />
                    sec
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", cursor: "pointer" }}
                    title="Drops isolated bad samples (GPS/sensor noise) from Speed/Pace and Cadence, plus any Speed/Pace sample slower than walking pace — thresholds adjustable in Settings">
                    <input type="checkbox" checked={removeOutliers} onChange={e => setRemoveOutliers(e.target.checked)} />
                    Remove outliers
                  </label>
                </div>

                <div style={{ marginBottom: 12 }}>
                  {/* Speed/Pace: one column, always active, axis always
                      visible (mandatory metric — no on/off toggle, unlike
                      the optional metrics below). One pill, split into two
                      clickable halves (not a separate label + switch) — the
                      selected half reads brighter/lighter, the other dims. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <div style={{
                      display: "inline-flex", borderRadius: 999, overflow: "hidden",
                      border: `1px solid ${METRIC_DEFS.speed.color}`,
                    }}>
                      {(["speed", "pace"] as SpeedMode[]).map(m => (
                        <button key={m} onClick={() => setSpeedMode(m)}
                          style={{
                            fontSize: 11, padding: "4px 12px", border: "none", cursor: "pointer",
                            background: speedMode === m ? `${METRIC_DEFS.speed.color}33` : "transparent",
                            color: speedMode === m ? METRIC_DEFS.speed.color : "var(--text-secondary)",
                            fontWeight: speedMode === m ? 600 : 400,
                          }}>
                          {m === "speed" ? `Speed (${speedUnitLabel()})` : "Pace (mm:ss)"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Other metrics: three columns, three per row */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", columnGap: 12 }}>
                    {OPTIONAL_METRIC_ORDER.map(key => (
                      <MetricRow
                        key={key}
                        mKey={key}
                        label={METRIC_DEFS[key].label}
                        active={activeMetrics.includes(key)}
                        available={availableMetrics[key]}
                        axisOn={axisVisible[key]}
                        cardOn={showCard[key]}
                        onToggleActive={() => toggleMetric(key)}
                        onToggleAxis={() => toggleAxis(key)}
                        onToggleCard={() => toggleCard(key)}
                      />
                    ))}
                  </div>
                </div>

                <ResponsiveContainer width="100%" height={220}>
                  {/* top:16 gives the pause-flag pill (a 14px-tall shape
                      centered exactly on the y=1 point at the very top of
                      its own [0,1] axis) room to render fully — Recharts'
                      default ~5px top margin put half the pill above the
                      SVG's own top edge, silently clipping it. */}
                  <ComposedChart data={chartData} margin={{ top: 16, right: 5, bottom: 5, left: 5 }}>
                    <CartesianGrid vertical={false} {...gridStyle} />
                    <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]}
                      tickFormatter={xTickFormatter(chartData, xMode)} tick={axisStyle} tickLine={false} axisLine={false} />
                    {/* Speed/Pace's axis is never conditionally
                        hidden/zero-width — it's the one mandatory metric, so
                        it must never depend on any toggle state (a previous
                        version tied its width to a checkbox's state; that
                        checkbox is gone now). It renders on the LEFT, alone —
                        every optional metric is on the right (see AXIS_SIDE's
                        comment) so Speed never shares a side with anything,
                        under any toggle combination. Reversed for pace: lower
                        (faster) reads toward the top, matching Speed's own
                        "up = faster" feel — on a normal ascending axis,
                        pace's inverted units (lower number = faster) would
                        make "up" mean speeding up for Speed but slowing down
                        for Pace. */}
                    <YAxis yAxisId="speed" hide={false} orientation={AXIS_SIDE.speed}
                      domain={speedDomain} reversed={speedMode === "pace"}
                      tick={{ fill: SPEED_AXIS_TEXT_COLOR, fontSize: 9 }}
                      tickFormatter={(v: number) => fmtMetricValue("speed", v, speedMode)}
                      width={42} />
                    {/* Optional metrics' axes, each independently toggleable
                        — all on the right (AXIS_SIDE), never sharing Speed's
                        side on the left. */}
                    {activeMetrics.map(key => (
                      <YAxis key={key} yAxisId={key} hide={!axisVisible[key]} orientation={AXIS_SIDE[key]}
                        domain={axisDomainCentered(displayTrack, key, speedMode)}
                        tick={{ fill: METRIC_DEFS[key].color, fontSize: 9 }}
                        tickFormatter={(v: number) => fmtMetricValue(key, v, speedMode)}
                        width={axisVisible[key] ? 42 : 0} />
                    ))}
                    <Tooltip content={<TrackTooltip xMode={xMode} metrics={effectiveActive} speedMode={speedMode} />} />
                    {effectiveActive.map(key => (
                      <Line key={key} yAxisId={key} dataKey={key} stroke={METRIC_DEFS[key].color}
                        strokeWidth={1.5} dot={false} isAnimationActive={false} name={METRIC_DEFS[key].label} />
                    ))}
                    {/* Pause flags get their own fixed, never-reversed,
                        hidden [0,1] axis instead of piggybacking on Speed's
                        (mean-centered, sometimes-reversed-for-pace) axis —
                        an earlier version tried to derive the flags' Y
                        position from Speed's domain (domain[1] normally,
                        domain[0] when pace's axis is reversed), but that
                        still rendered them mid-chart in practice. Plotting
                        at a fixed y=1 on a dedicated [0,1] domain removes
                        every dependency on Speed's scale/reversal, so the
                        flags are guaranteed to sit at the exact top
                        regardless of speed/pace mode. Pulls straight off the
                        shared chart-level `data` (a dataKey accessor, no
                        separate `data` override) so it shares the exact same
                        index space as the Line series — a Scatter with its
                        own shorter `data` array risked mismatched
                        hover/tooltip lookups against them. `width={0}` is
                        required despite `hide` — Recharts' YAxis defaults to
                        orientation="left"/width=60 when unset, and a hidden
                        axis still reserves that width in the left-side axis
                        stack, which was silently pushing Speed's real axis
                        60px further left than the plot's own left margin —
                        off the edge of the container, so it never appeared
                        on screen even though it was rendering in the DOM. */}
                    <YAxis yAxisId="pauseFlag" domain={[0, 1]} hide width={0} />
                    <Scatter
                      yAxisId="pauseFlag"
                      dataKey={(row: ChartRow) => (row.pauseDurationSec != null ? 1 : null)}
                      shape={PauseFlagShape}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>

                {effectiveActive.filter(key => showCard[key]).map(key => {
                  const domain = axisDomainMinMax(displayTrack, key, speedMode);
                  // Pause flags render only on the main overlay chart above —
                  // repeating them on every standalone card was noise. The
                  // one exception is Heart rate, which gets its own
                  // recovery-delta flag instead (a different signal: HR drop
                  // across the pause, not the pause's duration).
                  const cardData = key === "heart_rate" ? hrRecoveryChartData : chartData;
                  return (
                    <div key={key} style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                        {key === "speed" ? (speedMode === "speed" ? "Speed" : "Pace") : METRIC_DEFS[key].label}
                        {key === "heart_rate" && <span style={{ marginLeft: 8, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>flags show HR recovery across each pause</span>}
                      </div>
                      <ResponsiveContainer width="100%" height={110}>
                        {/* Same top-margin fix as the main overlay chart —
                            the HR recovery flag plots at the axis's own max
                            value, which sits at the very top pixel row
                            regardless of the domain's data-space padding. */}
                        <ComposedChart data={cardData} margin={{ top: 16, right: 5, bottom: 5, left: 5 }}>
                          <CartesianGrid vertical={false} {...gridStyle} />
                          <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]}
                            tickFormatter={xTickFormatter(chartData, xMode)} tick={axisStyle} tickLine={false} axisLine={false} />
                          <YAxis yAxisId="main" domain={domain} tick={axisStyle} tickLine={false} axisLine={false} width={42}
                            tickFormatter={(v: number) => fmtMetricValue(key, v, speedMode)} />
                          <Tooltip content={<TrackTooltip xMode={xMode} metrics={[key]} speedMode={speedMode} />} />
                          <Line yAxisId="main" dataKey={key} stroke={METRIC_DEFS[key].color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                          {key === "heart_rate" && (
                            <Scatter
                              yAxisId="main"
                              dataKey={(row: ChartRow & { hrRecoveryDelta?: number }) => (row.hrRecoveryDelta != null ? domain[1] : null)}
                              shape={HrRecoveryFlagShape}
                              isAnimationActive={false}
                            />
                          )}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
    </>
  );
}

// Popup variant — a fixed backdrop overlay wrapping ActivityDetailBody, with
// an × close button (see the modal-vs-accordion setting in CLAUDE.md).
export function ActivityModal({ activityId, onClose, onDelete }: Props) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100, padding: "24px",
      }}
    >
      <div style={{
        background: "var(--bg-surface)", border: "1px solid var(--border)",
        borderRadius: 16, width: "100%", maxWidth: 680,
        maxHeight: "90vh", overflowY: "auto",
        padding: "24px",
      }}>
        <ActivityDetailBody activityId={activityId} onDelete={onDelete} onClose={onClose} />
      </div>
    </div>
  );
}
