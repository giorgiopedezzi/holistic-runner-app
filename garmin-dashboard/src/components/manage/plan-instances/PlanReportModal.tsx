/**
 * PlanReportModal.tsx (HRA-338)
 * The entire-plan report — the whole plan's own isolated Original/Current/
 * Actual totals plus a per-week breakdown for progression, backed by GET
 * /api/v1/plan-instances/:id/reports/plan (garmin-stats/src/domain/
 * reporting/{report,plan-report}.ts). Does no calculation of its own.
 *
 * Drill-down chain (AC: "every count and aggregate drills down to the exact
 * referenced weeks, workouts..."): clicking a week row opens the EXISTING
 * WeekReportModal (never a second week-detail UI), which in turn hands a
 * clicked workout_id to the EXISTING single-workout WorkoutReportModal
 * (HRA-336) — one report component per granularity, reused, never
 * duplicated.
 */
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/api/client";
import { useQuery } from "@/hooks/useQuery";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useReportRangeMode, useReportStringSelection, useReportWeekSelection } from "@/hooks/useReportNav";
import { fmtDuration, fmtKm, fmtPace, instanceDayDateLabel } from "@/utils/fmt";
import { Empty, ErrorBanner, LoadingSpinner } from "@/components/ui";
import { AggregateHrSection, AggregatePausesSection, ComparableStaminaSection, QualityWorkoutUnavailableNote } from "./ReportEvidenceSections";
import { WeekReportModal } from "./WeekReportModal";
import { WorkoutReportModal } from "./WorkoutReportModal";
import type { PlanReport, PlanWeekSummary, ReportDatasetMetrics, ReportRangeMode } from "@/types/api";

interface Props {
  instanceId: number;
  // URL keys backing this plan report's own drill-down/toggle state
  // (HRA-339) — namespaced per caller (PlanInstancesSection's own top-level
  // plan report vs. RangeReportModal's nested one use distinct keys) so two
  // independently-open drill chains never collide with each other.
  weekKey: string;
  workoutKey: string;
  modeKey: string;
  onClose: () => void;
}

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

// Same optional-fields-only rendering as WeekReportModal's own DatasetCard —
// kept as a small local duplicate rather than a shared import: the two
// modals' cards are visually identical today but are independent screens
// that may reasonably diverge (this one never needs a lineage/state row a
// week's own card might grow later).
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
              <span className="hra-text-muted text-meta">{t("reportEvidence.avgPace", "Average pace")}</span>
              <span className="hra-text-primary text-body">{metrics!.paceSecPerKm != null ? `${fmtPace(metrics!.paceSecPerKm / 60)}/km` : "—"}</span>
            </div>
          )}
        </>
      ) : (
        <span className="hra-text-muted text-meta">{empty}</span>
      )}
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

function WeekRow({ week, onOpen }: { week: PlanWeekSummary; onOpen: () => void }) {
  const { t } = useTranslation();
  const den = week.report.denominators.execution;
  return (
    <div
      className="hra-border rounded-lg p-2.5 flex items-center gap-2 flex-wrap cursor-pointer"
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onOpen();
      }}
      role="button"
      tabIndex={0}
    >
      <span className="hra-text-primary text-body flex-1 min-w-0">
        {t("reportEvidence.week", `Week ${week.key.week_number}`, { n: week.key.week_number })}
        {week.dateSpan.start && week.dateSpan.end ? ` (${instanceDayDateLabel(week.dateSpan.start)} → ${instanceDayDateLabel(week.dateSpan.end)})` : ""}
      </span>
      <span className="hra-text-secondary text-meta">{fmtKm(week.report.datasets.current.distanceM ?? null)}</span>
      {den && (
        <span className="hra-text-muted text-meta">
          {t("reportEvidence.weekExecution", `${den.completed}/${den.total} completed`, { completed: den.completed, total: den.total })}
        </span>
      )}
    </div>
  );
}

export function PlanReportModal({ instanceId, weekKey, workoutKey, modeKey, onClose }: Props) {
  const { t } = useTranslation();
  const [range, setRange] = useReportRangeMode(modeKey);
  const [openWeek, setOpenWeek] = useReportWeekSelection(weekKey);
  const [openWorkoutId, setOpenWorkoutId] = useReportStringSelection(workoutKey);
  const { state } = useQuery(() => api.planInstances.planReport(instanceId, range), [instanceId, range]);
  const dialogRef = useDialogA11y(onClose);

  return (
    <div className="hra-modal-backdrop hra-modal-layer fixed inset-0 flex items-center justify-center p-6">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-report-title"
        className="hra-activity-modal hra-bg-surface hra-border rounded-2xl w-full overflow-y-auto p-6 flex flex-col gap-4"
      >
        <div className="flex items-center gap-3">
          <span id="plan-report-title" className="hra-text-primary text-heading font-semibold flex-1 min-w-0">{t("reportEvidence.planTitle", "Plan report")}</span>
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
          <PlanReportBody report={state.data} onOpenWeek={week => setOpenWeek({ sectionName: week.section_name, weekNumber: week.week_number })} />
        )}
      </div>

      {openWeek && (
        <WeekReportModal
          instanceId={instanceId}
          sectionName={openWeek.sectionName}
          weekNumber={openWeek.weekNumber}
          modeKey={`${weekKey}Mode`}
          onClose={() => setOpenWeek(null)}
          onOpenWorkout={setOpenWorkoutId}
        />
      )}
      {openWorkoutId && (
        <WorkoutReportModal instanceId={instanceId} workoutId={openWorkoutId} onClose={() => setOpenWorkoutId(null)} />
      )}
    </div>
  );
}

function PlanReportBody({ report, onOpenWeek }: { report: PlanReport; onOpenWeek: (week: { section_name: string; week_number: number }) => void }) {
  const { t } = useTranslation();
  const { overall, overallEvidence } = report;

  return (
    <div className="flex flex-col gap-4">
      <span className="hra-text-muted text-meta">
        {report.provenance.planInstanceName ?? t("manage.planTemplates.untitled", "Untitled plan")}
        {report.dateSpan.start && report.dateSpan.end ? ` · ${instanceDayDateLabel(report.dateSpan.start)} → ${instanceDayDateLabel(report.dateSpan.end)}` : ""}
      </span>

      {!overall.provenance.hasOriginalBaseline && (
        <Empty message={t("workoutReport.emptyNoBaseline", "This plan has no Original baseline yet.")} />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <DatasetCard title={t("workoutReport.original", "Original")} metrics={overall.datasets.original} empty={t("reportEvidence.noOriginalPlan", "No Original data for this plan.")} />
        <DatasetCard title={t("workoutReport.current", "Current")} metrics={overall.datasets.current} empty={t("reportEvidence.noCurrentPlan", "No Current data for this plan.")} />
        <DatasetCard title={t("workoutReport.actual", "Actual")} metrics={overall.datasets.actual} empty={t("workoutReport.noActual", "No recorded activity.")} />
      </div>

      {overall.denominators.execution && (
        <span className="hra-text-secondary text-meta">
          {t(
            "reportEvidence.executionSummary",
            `Execution: ${overall.denominators.execution.completed} completed, ${overall.denominators.execution.missed} missed of ${overall.denominators.execution.total}${overall.denominators.execution.upcoming > 0 ? `, ${overall.denominators.execution.upcoming} upcoming` : ""}`,
            { completed: overall.denominators.execution.completed, missed: overall.denominators.execution.missed, total: overall.denominators.execution.total, upcoming: overall.denominators.execution.upcoming },
          )}
        </span>
      )}

      {report.weeks.length === 0 ? (
        <Empty message={t("reportEvidence.noWeeks", "This plan has no weeks yet.")} />
      ) : (
        <div className="flex flex-col gap-2">
          <span className="hra-text-secondary text-label font-semibold">{t("reportEvidence.progression", "Progression by week")}</span>
          {report.weeks.map(w => (
            <WeekRow key={`${w.key.section_name}::${w.key.week_number}`} week={w} onOpen={() => onOpenWeek(w.key)} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <AggregateHrSection hr={overallEvidence.hr} />
        <ComparableStaminaSection comparableStamina={overallEvidence.comparableStamina} />
        <AggregatePausesSection pauses={overallEvidence.pauses} />
      </div>

      <QualityWorkoutUnavailableNote />

      <span className="hra-text-muted text-meta">
        {t("workoutReport.provenance", `Generated ${new Date(overall.provenance.generatedAt).toLocaleString()}`, { generatedAt: new Date(overall.provenance.generatedAt).toLocaleString() })}
      </span>
    </div>
  );
}
