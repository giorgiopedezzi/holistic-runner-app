/**
 * ClassificationCard.tsx  (HRA-86)
 * The AI/statistical workout-classification UI, extracted verbatim from
 * ActivityModal.tsx (separation of concerns, epic HRA-65). Fully decoupled from
 * the chart — its entire interface to the parent is { activity, onUpdate }. See
 * CLAUDE.md's "AI workout classifier" notes / docs/classifier.md for the methods.
 */
import { useState, useEffect, useRef } from "react";
import { api } from "@/api/client";
import { Card, ErrorBanner } from "@/components/ui";
import {
  type Activity, type ClassificationMethod, type CorrectionReason, type WorkoutClassification,
  CORRECTION_REASONS, WORKOUT_CLASSIFICATIONS, classificationStatus,
} from "@/types/api";

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
            fontSize: 12, border: "1px solid var(--accent)", borderRadius: 6, padding: "4px 12px",
            background: "none", color: "var(--accent)",
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
export function ClassificationCard({ activity, onUpdate }: { activity: Activity; onUpdate: (a: Activity) => void }) {
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
