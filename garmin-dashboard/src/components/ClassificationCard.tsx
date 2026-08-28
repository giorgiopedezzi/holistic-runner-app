/**
 * ClassificationCard.tsx  (HRA-86)
 * The AI/statistical workout-classification UI, extracted verbatim from
 * ActivityModal.tsx (separation of concerns, epic HRA-65). Fully decoupled from
 * the chart — its entire interface to the parent is { activity, onUpdate }. See
 * CLAUDE.md's "AI workout classifier" notes / docs/classifier.md for the methods.
 */
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api } from "@/api/client";
import { Card, ErrorBanner } from "@/components/ui";
import {
  type Activity, type ClassificationMethod, type CorrectionReason, type WorkoutClassification,
  CORRECTION_REASONS, WORKOUT_CLASSIFICATIONS, WORKOUT_CLASSIFICATION_KEY, classificationStatus,
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
export function statusColor(status: ReturnType<typeof classificationStatus>): string {
  if (status === "confirmed") return "var(--accent-green)";
  if (status === "pending") return "var(--accent-orange)";
  return "var(--text-muted)";
}

function methodLabel(m: ClassificationMethod, t: TFunction): string {
  return m === "ai" ? t("activity.classify.methodAi", "AI") : t("activity.classify.methodStatistical", "Statistical");
}

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
  const { t } = useTranslation();
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
      setError(e instanceof Error ? e.message : t("activity.classify.classifyFailed", "Classification failed"));
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
      setError(e instanceof Error ? e.message : t("activity.classify.feedbackFailed", "Failed to save feedback"));
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
      setError(e instanceof Error ? e.message : t("activity.classify.feedbackFailed", "Failed to save feedback"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="hra-classification-method hra-border min-w-55 rounded-lg p-2.5">
      <div className="hra-row gap-2" >
        <span className="hra-classification-kicker hra-text-secondary text-meta font-semibold uppercase">
          {methodLabel(method, t)}
        </span>
        <div className="flex-1" />
        <button
          className="hra-btn"
          data-variant="cta"
          onClick={handleClassify}
          disabled={classifying}
          title={method === "ai"
            ? t("activity.classify.aiTooltip", "Runs a local Ollama model against this activity's pace/HR pattern (takes ~15-25s on CPU). Always available, even if already classified — reclassifying resets the activity's shared review verdict back to pending.")
            : t("activity.classify.statisticalTooltip", "Applies deterministic rules to this activity's pace variance, splits, and pauses — instant, no Ollama needed. Always available, even if already classified — reclassifying resets the activity's shared review verdict back to pending.")}
        >
          {classifying ? t("activity.classify.classifyingProgress", `Classifying… ${elapsedSec.toFixed(1)}s`, { sec: elapsedSec.toFixed(1) })
            : classification ? t("activity.classify.reclassify", "Reclassify") : t("activity.classify.classify", "Classify")}
        </button>
      </div>
      {!classifying && lastDurationSec != null && (
        <div className="hra-text-muted text-meta text-right mt-0.5" >
          {t("activity.classify.took", `took ${lastDurationSec.toFixed(1)}s`, { sec: lastDurationSec.toFixed(1) })}
        </div>
      )}

      <div className="mt-2">
        {classification ? (
          <span className="hra-classification-pill hra-dyn-border hra-dyn-color inline-flex items-center text-meta font-semibold uppercase" data-verdict-source={isVerdictSource}>
            {t(WORKOUT_CLASSIFICATION_KEY[classification as WorkoutClassification] ?? "unknown", classification)}
            {isVerdictSource && <span title={t("activity.classify.verdictSourceTooltip", "This card's result is the activity's confirmed classification")}>✓</span>}
          </span>
        ) : (
          <span className="hra-text-muted text-meta" >{t("activity.classify.notYetClassified", "Not yet classified")}</span>
        )}
      </div>

      {explanation && <div className="hra-text-secondary text-meta mt-1.5" >{explanation}</div>}

      {classification && !showCorrection && (
        <div className="hra-row gap-2 mt-2" >
          <button onClick={handleApprove} title={t("activity.classify.approveTooltip", "Confirm this card's classification as the activity's answer")}
            className="hra-feedback-button hra-dyn-border hra-dyn-color text-label leading-none rounded-md py-1 px-2.5 bg-transparent cursor-pointer"
            data-tone="green" data-selected={isVerdictSource && activity.user_feedback === "approved"}>
            👍
          </button>
          <button onClick={() => setShowCorrection(true)} title={t("activity.classify.rejectTooltip", "This card's classification is wrong")}
            className="hra-feedback-button hra-dyn-border hra-dyn-color text-label leading-none rounded-md py-1 px-2.5 bg-transparent cursor-pointer"
            data-tone="red" data-selected={isVerdictSource && activity.user_feedback === "rejected"}>
            👎
          </button>
        </div>
      )}
      {isVerdictSource && activity.user_feedback === "rejected" && activity.final_classification && (
        <div className="hra-text-muted text-meta mt-1.5" >
          {(() => {
            const classificationLabel = t(WORKOUT_CLASSIFICATION_KEY[activity.final_classification as WorkoutClassification] ?? "unknown", activity.final_classification);
            const reasonSuffix = activity.user_correction_reason ? ` (${activity.user_correction_reason})` : "";
            return t("activity.classify.correctedTo", `Corrected to: ${classificationLabel}${reasonSuffix}`, {
              classification: classificationLabel, reason: reasonSuffix,
            });
          })()}
        </div>
      )}

      {showCorrection && (
        <div className="hra-border-top flex gap-2 items-center flex-wrap mt-2 pt-2" >
          {/* Deliberately still a native <select> (HRA-98 deviation) — a
              Radix Select can't be driven by the characterization test's
              fireEvent.change, and this Story's own AC requires the
              existing FE test suite to pass unmodified; see the In Review
              comment for the tradeoff. Option VALUES stay the raw English
              constants either field is typed/persisted as — only the
              displayed text (classification labels) goes through t();
              CORRECTION_REASONS is explicitly out of this Story's scope
              (backend-sourced free text per its own "Explicitly out of
              scope" section), so its options are untranslated either way. */}
          <select value={reason} onChange={e => setReason(e.target.value as CorrectionReason)} className="text-meta">
            <option value="">{t("activity.classify.whyWrong", "Why was this wrong?")}</option>
            {CORRECTION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={corrected} onChange={e => setCorrected(e.target.value as WorkoutClassification)} className="text-meta">
            <option value="">{t("activity.classify.whatWasIt", "What was it actually?")}</option>
            {WORKOUT_CLASSIFICATIONS.map(c => <option key={c} value={c}>{t(WORKOUT_CLASSIFICATION_KEY[c], c)}</option>)}
          </select>
          <button
            className="hra-btn" data-variant="cta"
            data-tone="red"
            onClick={handleReject} disabled={!reason || !corrected || submitting}
          >
            {submitting ? "…" : t("common.submit", "Submit")}
          </button>
          <button onClick={() => setShowCorrection(false)}
            className="hra-border-strong hra-text-secondary text-meta rounded-md py-1 px-3 bg-transparent cursor-pointer"
            >
            {t("common.cancel", "Cancel")}
          </button>
        </div>
      )}

      {error && <div className="mt-2"><ErrorBanner message={error} /></div>}
    </div>
  );
}

// Overall status line (derived from the activity's one shared verdict) plus
// the two independent MethodResultCards. Split-size is one shared control
// here — it applies to whichever card's Classify button gets clicked next,
// not a per-card setting, since it's a single "how granular" preference the
// user sets once before running either.
export function ClassificationCard({ activity, onUpdate, splitMeters: splitMetersProp, onSplitMetersChange }: {
  activity: Activity; onUpdate: (a: Activity) => void;
  // Optional (dashboard design-system rework, "reorganize activity layout")
  // — ActivityDetailBody lifts this so its classification accordion's
  // collapsed summary can show the current sampling granularity; falls back
  // to purely-local state so the pre-existing hand-written test harness
  // (ClassificationCard.test.tsx, which renders this with just
  // activity/onUpdate) keeps working unmodified.
  splitMeters?: number; onSplitMetersChange?: (m: number) => void;
}) {
  const { t } = useTranslation();
  const [splitMetersState, setSplitMetersState] = useState(1000);
  const splitMeters = splitMetersProp ?? splitMetersState;
  const setSplitMeters = onSplitMetersChange ?? setSplitMetersState;
  const status = classificationStatus(activity);

  return (
    <Card className="mb-4">
      <div className="hra-control-row gap-2.5 mb-2.5" >
        {status === "confirmed" && activity.final_classification ? (
          <span className="hra-classification-pill hra-classification-status hra-dyn-border hra-dyn-color inline-block text-meta font-semibold uppercase" data-status={status}>
            {(() => {
              const label = t(WORKOUT_CLASSIFICATION_KEY[activity.final_classification as WorkoutClassification] ?? "unknown", activity.final_classification);
              return t("activity.classify.confirmedAs", `Confirmed: ${label}`, { classification: label });
            })()}
          </span>
        ) : (
          <span className="hra-classification-status hra-dyn-color text-meta" data-status={status}>
            {status === "pending" ? t("activity.classify.pendingReview", "Pending review") : t("activity.classify.notYetClassified", "Not yet classified")}
          </span>
        )}
        <div className="flex-1" />
        <div className="hra-segment inline-flex rounded-full overflow-hidden"
          title={t("activity.classify.splitTooltip", "Split granularity used to (re)classify — finer splits can surface short interval structure a coarser split smooths out")}>
          {([1000, 500] as const).map(m => (
            <button key={m} onClick={() => setSplitMeters(m)}
              className="hra-segment-item hra-classification-segment-item text-meta border-0 cursor-pointer"
              data-active={splitMeters === m}>
              {m === 1000 ? t("activity.classify.split1km", "1km") : t("activity.classify.split05km", "0.5km")}
            </button>
          ))}
        </div>
      </div>

      <div className="hra-chip-row gap-2.5" >
        <MethodResultCard activity={activity} method="ai" splitMeters={splitMeters} onUpdate={onUpdate} />
        <MethodResultCard activity={activity} method="statistical" splitMeters={splitMeters} onUpdate={onUpdate} />
      </div>
    </Card>
  );
}
