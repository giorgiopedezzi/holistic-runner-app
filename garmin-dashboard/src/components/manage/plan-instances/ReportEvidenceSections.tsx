/**
 * ReportEvidenceSections.tsx (HRA-338)
 * Shared HR/pauses/comparable-stamina sections for the week and entire-plan
 * reports — the multi-workout counterpart of WorkoutReportModal.tsx's own
 * HrSection/StaminaSection/PausesSection (HRA-337), never a second HR/pause
 * calculation: this only renders what AggregateEvidence (backend
 * aggregate-evidence.ts) already computed. Kept in its own file rather than
 * exported from WorkoutReportModal.tsx to avoid touching that already-shipped
 * component for a new, additive screen.
 */
import { useTranslation } from "react-i18next";
import { fmtDuration } from "@/utils/fmt";
import { PauseInspectionDialog } from "@/components/activity/PauseInspectionDialog";
import type { PauseInspectionRow } from "@/domain/pauses";
import type { AggregateEvidence, WorkoutPauseEvidence } from "@/types/api";

export function AggregateHrSection({ hr }: { hr: AggregateEvidence["hr"] }) {
  const { t } = useTranslation();
  if (!hr) {
    return (
      <div className="hra-border rounded-lg p-3 flex flex-col gap-1.5">
        <span className="hra-text-secondary text-label font-semibold">{t("workoutReport.hr.title", "Heart rate")}</span>
        <span className="hra-text-muted text-meta">{t("workoutReport.hr.empty", "No HR evidence recorded.")}</span>
      </div>
    );
  }
  return (
    <div className="hra-border rounded-lg p-3 flex flex-col gap-1.5">
      <span className="hra-text-secondary text-label font-semibold">{t("workoutReport.hr.title", "Heart rate")}</span>
      <div className="hra-fact-row">
        <span className="hra-text-muted text-meta">{t("workoutReport.hr.avg", "Average")}</span>
        <span className="hra-text-primary text-body">{hr.avgHr != null ? `${Math.round(hr.avgHr)} bpm` : "—"}</span>
      </div>
      <div className="hra-fact-row">
        <span className="hra-text-muted text-meta">{t("workoutReport.hr.max", "Max")}</span>
        <span className="hra-text-primary text-body">{hr.maxHr != null ? `${hr.maxHr} bpm` : "—"}</span>
      </div>
      {hr.coverage.withHr < hr.coverage.total && (
        <span className="hra-text-muted text-meta">
          {t("workoutReport.hr.partialCoverage", `HR available for ${hr.coverage.withHr} of ${hr.coverage.total} accepted activities.`,
            { withHr: hr.coverage.withHr, total: hr.coverage.total })}
        </span>
      )}
    </div>
  );
}

function toPauseInspectionRows(pauses: WorkoutPauseEvidence): PauseInspectionRow[] {
  return pauses.details.map(d => ({
    afterIndex: d.index - 1,
    elapsedSec: d.elapsedSec,
    durationSec: d.durationSec,
    distanceM: d.distanceM,
    hrBefore: d.hrBefore,
    hrAfter: d.hrAfter,
    hrDelta: d.hrRecoveryDelta,
    staminaBefore: d.staminaBefore,
    staminaAfter: d.staminaAfter,
    recorded: d.provenance === "recorded",
  }));
}

export function AggregatePausesSection({ pauses }: { pauses: AggregateEvidence["pauses"] }) {
  const { t } = useTranslation();
  if (!pauses || !pauses.hasTrackData) {
    return (
      <div className="hra-border rounded-lg p-3 flex flex-col gap-1.5">
        <span className="hra-text-secondary text-label font-semibold">{t("workoutReport.pauses.title", "Pauses")}</span>
        <span className="hra-text-muted text-meta">{t("workoutReport.pauses.noTrackData", "No track data available to detect pauses.")}</span>
      </div>
    );
  }
  return (
    <div className="hra-border rounded-lg p-3 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="hra-text-secondary text-label font-semibold">{t("workoutReport.pauses.title", "Pauses")}</span>
        <PauseInspectionDialog rows={toPauseInspectionRows(pauses)} />
      </div>
      {pauses.pauseCount === 0 ? (
        <span className="hra-text-muted text-meta">{t("workoutReport.pauses.empty", "No pauses detected.")}</span>
      ) : (
        <>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.pauses.count", "Count")}</span>
            <span className="hra-text-primary text-body">{pauses.pauseCount}</span>
          </div>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.pauses.longest", "Longest")}</span>
            <span className="hra-text-primary text-body">{fmtDuration(pauses.longestPauseSec)}</span>
          </div>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.pauses.total", "Total paused")}</span>
            <span className="hra-text-primary text-body">{fmtDuration(pauses.totalPausedFromPausesSec)}</span>
          </div>
        </>
      )}
    </div>
  );
}

// HRA-338: deliberately renders AT MOST ONE session's stamina series — never
// a blended average across the report's whole accepted population (a
// depletion curve from a short easy day and a long run aren't comparable
// quantities, see aggregate-evidence.ts's own design note).
export function ComparableStaminaSection({ comparableStamina }: { comparableStamina: AggregateEvidence["comparableStamina"] }) {
  const { t } = useTranslation();
  if (!comparableStamina) {
    return (
      <div className="hra-border rounded-lg p-3 flex flex-col gap-1.5">
        <span className="hra-text-secondary text-label font-semibold">{t("workoutReport.stamina.title", "Stamina")}</span>
        <span className="hra-text-muted text-meta">
          {t("reportEvidence.stamina.noComparable", "No comparable long run or race in this scope yet.")}
        </span>
      </div>
    );
  }
  const { stamina, reason } = comparableStamina;
  return (
    <div className="hra-border rounded-lg p-3 flex flex-col gap-1.5">
      <span className="hra-text-secondary text-label font-semibold">{t("workoutReport.stamina.title", "Stamina")}</span>
      <span className="hra-text-muted text-meta">
        {reason === "race"
          ? t("reportEvidence.stamina.reasonRace", "From the race in this scope")
          : t("reportEvidence.stamina.reasonLongestRun", "From this scope's own longest run")}
      </span>
      {stamina.coverage.withStamina === 0 ? (
        <span className="hra-text-muted text-meta">{t("workoutReport.stamina.empty", "No stamina evidence recorded.")}</span>
      ) : (
        <>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.stamina.start", "Start (first valid)")}</span>
            <span className="hra-text-primary text-body">{stamina.firstValid ?? "—"}</span>
          </div>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.stamina.finish", "Finish")}</span>
            <span className="hra-text-primary text-body">{stamina.finish ?? "—"}</span>
          </div>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.stamina.depletion", "Depletion")}</span>
            <span className="hra-text-primary text-body">{stamina.depletionPoints != null ? `${stamina.depletionPoints} pts` : "—"}</span>
          </div>
        </>
      )}
    </div>
  );
}

// HRA-342 is not built yet — this deliberately never fabricates a
// quality-workout comparison, and a plain whole-scope average pace (shown
// elsewhere in these reports) is never relabeled as a quality-workout claim.
export function QualityWorkoutUnavailableNote() {
  const { t } = useTranslation();
  return (
    <span className="hra-text-muted text-meta">
      {t("reportEvidence.qualityUnavailable", "Structured quality-workout comparison isn't available yet.")}
    </span>
  );
}
