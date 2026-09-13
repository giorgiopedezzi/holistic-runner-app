/**
 * WeekReportModal.tsx (HRA-338)
 * The week report — grouped-by-workout Original-vs-Current-vs-Actual view for
 * ONE planned week (a structural slot: section_name + week_number, never a
 * calendar-date span), backed by GET /api/v1/plan-instances/:id/reports/
 * weeks (garmin-stats/src/domain/reporting/{report,plan-report}.ts). Does no
 * calculation of its own — same "no second calculation engine" guardrail
 * WorkoutReportModal.tsx (HRA-336) already follows. Clicking a workout row
 * hands its workout_id to the caller (`onOpenWorkout`) so drill-down reuses
 * the EXISTING single-workout WorkoutReportModal rather than a second
 * per-workout UI.
 *
 * Progressive disclosure at mobile widths (320 CSS px): Original/Current/
 * Actual stack as separate rows by default; they only ever sit side by side
 * from `sm:` up, same convention WorkoutReportModal already uses.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/api/client";
import { useQuery } from "@/hooks/useQuery";
import { fmtDuration, fmtKm, fmtPace, instanceDayDateLabel } from "@/utils/fmt";
import { Badge, Empty, ErrorBanner, LoadingSpinner } from "@/components/ui";
import { AggregateHrSection, AggregatePausesSection, ComparableStaminaSection, QualityWorkoutUnavailableNote } from "./ReportEvidenceSections";
import type {
  ReportDatasetMetrics, ReportRangeMode, ReportWorkoutIdentity, WeekReport, WorkoutEvidenceState, WorkoutLineageStatus,
} from "@/types/api";

interface Props {
  instanceId: number;
  sectionName: string;
  weekNumber: number;
  onClose: () => void;
  onOpenWorkout?: (workoutId: string) => void;
}

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

function DatasetCard({ title, metrics, empty }: { title: string; metrics: ReportDatasetMetrics | undefined; empty: string }) {
  const { t } = useTranslation();
  const hasAny = metrics && (metrics.distanceM != null || metrics.durationSec != null || metrics.paceSecPerKm !== undefined);
  return (
    <div className="hra-border rounded-lg p-3 flex flex-col gap-1.5 flex-1 min-w-0">
      <span className="hra-text-secondary text-label font-semibold">{title}</span>
      {hasAny ? (
        <>
          {metrics!.distanceM != null && (
            <div className="hra-fact-row">
              <span className="hra-text-muted text-meta">{t("workoutReport.distance", "Distance")}</span>
              <span className="hra-text-primary text-body">{fmtKm(metrics!.distanceM)}{metrics!.approximate ? " *" : ""}</span>
            </div>
          )}
          {metrics!.durationSec != null && (
            <div className="hra-fact-row">
              <span className="hra-text-muted text-meta">{t("workoutReport.duration", "Duration")}</span>
              <span className="hra-text-primary text-body">{fmtDuration(metrics!.durationSec)}</span>
            </div>
          )}
          {metrics!.paceSecPerKm !== undefined && (
            <div className="hra-fact-row">
              {/* AC: a whole-scope average pace is never presented as a
                  quality-workout (repetition/threshold/tempo) claim — this
                  is always the plain "Average pace" label. */}
              <span className="hra-text-muted text-meta">{t("reportEvidence.avgPace", "Average pace")}</span>
              <span className="hra-text-primary text-body">
                {metrics!.paceSecPerKm != null ? `${fmtPace(metrics!.paceSecPerKm / 60)}/km` : "—"}
              </span>
            </div>
          )}
        </>
      ) : (
        <span className="hra-text-muted text-meta">{empty}</span>
      )}
    </div>
  );
}

function stateLabel(t: (k: string, d: string) => string, state: WorkoutEvidenceState): string {
  if (state === "completed") return t("workoutReport.state.completed", "Completed");
  if (state === "missed") return t("workoutReport.state.missed", "Missed");
  return t("workoutReport.state.upcoming", "Upcoming");
}

function lineageBadge(t: (k: string, d: string) => string, lineage: WorkoutLineageStatus): { label: string; color: string } | null {
  switch (lineage) {
    case "unchanged": return null; // the common case — no badge needed
    case "moved": return { label: t("reportEvidence.lineage.moved", "Moved"), color: "var(--color-info)" };
    case "modified": return { label: t("reportEvidence.lineage.modified", "Modified"), color: "var(--color-warning)" };
    case "moved_and_modified": return { label: t("reportEvidence.lineage.movedAndModified", "Moved & modified"), color: "var(--color-warning)" };
    case "removed": return { label: t("reportEvidence.lineage.removed", "Removed"), color: "var(--color-danger)" };
    case "added": return { label: t("reportEvidence.lineage.added", "Added"), color: "var(--color-success)" };
  }
}

function WorkoutRow({ identity, report, onOpenWorkout }: { identity: ReportWorkoutIdentity; report: WeekReport["report"]; onOpenWorkout?: (workoutId: string) => void }) {
  const { t } = useTranslation();
  const scoped = report.scope.find(s => s.workout_id === identity.workoutId);
  const execution = report.comparisons.execution?.find(e => e.workout_id === identity.workoutId);
  const outcome = report.comparisons.outcome?.find(o => o.workout_id === identity.workoutId);
  const badge = lineageBadge(t, scoped?.lineage ?? "unchanged");
  const date = identity.currentDate ?? identity.originalDate;

  return (
    <div
      className={["hra-border rounded-lg p-2.5 flex items-center gap-2 flex-wrap", onOpenWorkout ? "cursor-pointer" : ""].filter(Boolean).join(" ")}
      onClick={onOpenWorkout ? () => onOpenWorkout(identity.workoutId) : undefined}
      role={onOpenWorkout ? "button" : undefined}
      tabIndex={onOpenWorkout ? 0 : undefined}
    >
      <span className="hra-text-primary text-body flex-1 min-w-0">
        {date ? instanceDayDateLabel(date) : t("reportEvidence.noDate", "No date")}
        {identity.workoutType ? ` · ${identity.workoutType}` : ""}
      </span>
      {execution && <span className="hra-text-secondary text-meta">{stateLabel(t, execution.state)}</span>}
      {!execution && outcome && <span className="hra-text-secondary text-meta">{stateLabel(t, outcome.state)}</span>}
      {badge && <Badge label={badge.label} color={badge.color} />}
    </div>
  );
}

function RangeToggle({ range, onChange }: { range: ReportRangeMode; onChange: (r: ReportRangeMode) => void }) {
  const { t } = useTranslation();
  return (
    <div className="hra-segment">
      <button className="hra-segment-item" data-active={range === "plan_to_date"} onClick={() => onChange("plan_to_date")}>
        {t("reportEvidence.range.planToDate", "Plan-to-date")}
      </button>
      <button className="hra-segment-item" data-active={range === "full_plan"} onClick={() => onChange("full_plan")}>
        {t("reportEvidence.range.fullPlan", "Full plan")}
      </button>
    </div>
  );
}

export function WeekReportModal({ instanceId, sectionName, weekNumber, onClose, onOpenWorkout }: Props) {
  const { t } = useTranslation();
  const [range, setRange] = useState<ReportRangeMode>("plan_to_date");
  const { state } = useQuery(() => api.planInstances.weekReport(instanceId, sectionName, weekNumber, range), [instanceId, sectionName, weekNumber, range]);

  return (
    <div className="hra-modal-backdrop hra-modal-layer fixed inset-0 flex items-center justify-center p-6">
      <div className="hra-activity-modal hra-bg-surface hra-border rounded-2xl w-full overflow-y-auto p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="hra-text-primary text-heading font-semibold flex-1 min-w-0">
            {t("reportEvidence.weekTitle", `Week ${weekNumber} report`, { n: weekNumber })}
          </span>
          <button onClick={onClose} aria-label={t("common.close", "Close")} className="hra-text-muted text-heading border-0 bg-transparent cursor-pointer leading-none px-1">
            ×
          </button>
        </div>
        <RangeToggle range={range} onChange={setRange} />

        {state.status === "loading" || state.status === "idle" ? (
          <LoadingSpinner label={t("workoutReport.loading", "Loading report…")} />
        ) : state.status === "error" ? (
          <ErrorBanner message={errorMessage(state.error)} />
        ) : (
          <WeekReportBody report={state.data} onOpenWorkout={onOpenWorkout} />
        )}
      </div>
    </div>
  );
}

function WeekReportBody({ report, onOpenWorkout }: { report: WeekReport; onOpenWorkout?: (workoutId: string) => void }) {
  const { t } = useTranslation();
  const { report: r, evidence } = report;

  return (
    <div className="flex flex-col gap-4">
      <span className="hra-text-muted text-meta">
        {report.provenance.planInstanceName ?? t("manage.planTemplates.untitled", "Untitled plan")}
        {report.dateSpan.start && report.dateSpan.end
          ? ` · ${instanceDayDateLabel(report.dateSpan.start)} → ${instanceDayDateLabel(report.dateSpan.end)}`
          : ""}
      </span>

      {!r.provenance.hasOriginalBaseline && (
        <Empty message={t("workoutReport.emptyNoBaseline", "This plan has no Original baseline yet.")} />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <DatasetCard title={t("workoutReport.original", "Original")} metrics={r.datasets.original} empty={t("reportEvidence.noOriginalWeek", "No Original data for this week.")} />
        <DatasetCard title={t("workoutReport.current", "Current")} metrics={r.datasets.current} empty={t("reportEvidence.noCurrentWeek", "No Current data for this week.")} />
        <DatasetCard title={t("workoutReport.actual", "Actual")} metrics={r.datasets.actual} empty={t("workoutReport.noActual", "No recorded activity.")} />
      </div>

      {r.denominators.execution && (
        <span className="hra-text-secondary text-meta">
          {t(
            "reportEvidence.executionSummary",
            `Execution: ${r.denominators.execution.completed} completed, ${r.denominators.execution.missed} missed of ${r.denominators.execution.total}${r.denominators.execution.upcoming > 0 ? `, ${r.denominators.execution.upcoming} upcoming` : ""}`,
            { completed: r.denominators.execution.completed, missed: r.denominators.execution.missed, total: r.denominators.execution.total, upcoming: r.denominators.execution.upcoming },
          )}
        </span>
      )}

      {report.workouts.length === 0 ? (
        <Empty message={t("reportEvidence.noWorkouts", "No workouts in this week.")} />
      ) : (
        <div className="flex flex-col gap-2">
          {report.workouts.map(w => <WorkoutRow key={w.workoutId} identity={w} report={r} onOpenWorkout={onOpenWorkout} />)}
        </div>
      )}

      {r.coverage.ambiguousActivities > 0 && (
        <span className="hra-text-muted text-meta">
          {t(
            "workoutReport.ambiguous",
            "An unresolved activity link exists for this workout — visible, but not counted above until confirmed.",
          )}
        </span>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <AggregateHrSection hr={evidence.hr} />
        <ComparableStaminaSection comparableStamina={evidence.comparableStamina} />
        <AggregatePausesSection pauses={evidence.pauses} />
      </div>

      <QualityWorkoutUnavailableNote />

      <span className="hra-text-muted text-meta">
        {t("workoutReport.provenance", `Generated ${new Date(r.provenance.generatedAt).toLocaleString()}`, { generatedAt: new Date(r.provenance.generatedAt).toLocaleString() })}
      </span>
    </div>
  );
}
