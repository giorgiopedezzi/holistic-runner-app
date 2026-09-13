/**
 * RangeReportModal.tsx (HRA-341)
 * The date-range/race-range report — cross-plan, unlike WeekReportModal/
 * PlanReportModal/WorkoutReportModal (each scoped to one plan instance),
 * backed by GET /api/v1/reports/range (garmin-stats/src/domain/reporting/
 * range-report.ts). Does no calculation of its own.
 *
 * Drill-down chain (AC: "every count and aggregate drills down to the exact
 * referenced workouts"): clicking an included plan instance opens the
 * EXISTING PlanReportModal for it (which already chains into WeekReportModal
 * → WorkoutReportModal) rather than a second instance-detail UI; clicking a
 * quality workout opens the EXISTING WorkoutReportModal directly. One report
 * component per granularity, reused, never duplicated.
 *
 * Mobile-first (AC: "narrow layouts prioritize one metric at a time ...
 * no page-level horizontal scrolling at 320 CSS px"): every section stacks
 * in a single column by default (grid-cols-1 sm:grid-cols-3, same pattern
 * PlanReportModal already uses), and the only wide content (the quality
 * workout list) sits inside its own AccordionCard, collapsed by default.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useQuery } from "@/hooks/useQuery";
import { fmtDuration, fmtKm, fmtPace, instanceDayDateLabel } from "@/utils/fmt";
import { ALL_SENTINEL } from "@/utils/date";
import { AccordionCard, Empty, ErrorBanner, LoadingSpinner } from "@/components/ui";
import { PlanReportModal } from "./PlanReportModal";
import { WorkoutReportModal } from "./WorkoutReportModal";
import type {
  RangeInstanceReport, RangeQualityWorkoutEntry, RangeReport, ReportDatasetMetrics, ReportRangeMode,
} from "@/types/api";

interface Props {
  from: string;
  to: string;
  onClose: () => void;
}

function dateLabel(t: (k: string, d: string) => string, date: string): string {
  return date === ALL_SENTINEL ? t("dateRange.allAvailable", "All available data") : instanceDayDateLabel(date);
}

function paceCell(secPerKm: number | null | undefined): string {
  return secPerKm != null ? `${fmtPace(secPerKm / 60)}/km` : "—";
}

// Same "small local duplicate, not a shared import" convention
// PlanReportModal/WeekReportModal/WorkoutReportModal each already follow for
// their own DatasetCard — visually identical today, independent screens
// that may reasonably diverge.
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
              <span className="hra-text-primary text-body">{paceCell(metrics!.paceSecPerKm)}</span>
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

function groupingLabel(t: (k: string, d: string) => string, grouping: RangeReport["provenance"]["grouping"]): string {
  if (grouping === "workout") return t("rangeReport.grouping.workout", "By workout");
  if (grouping === "week") return t("rangeReport.grouping.week", "By week");
  return t("rangeReport.grouping.month", "By month");
}

function InstanceRow({ instance, onOpen }: { instance: RangeInstanceReport; onOpen: () => void }) {
  const { t } = useTranslation();
  const den = instance.report.denominators.execution;
  return (
    <div className="hra-border rounded-lg p-2.5 flex items-center gap-2 flex-wrap cursor-pointer" onClick={onOpen} role="button" tabIndex={0}>
      <span className="hra-text-primary text-body flex-1 min-w-0">
        {instance.planInstanceName ?? t("manage.planTemplates.untitled", "Untitled plan")}
        {instance.dateSpan.start && instance.dateSpan.end ? ` (${instanceDayDateLabel(instance.dateSpan.start)} → ${instanceDayDateLabel(instance.dateSpan.end)})` : ""}
      </span>
      <span className="hra-text-secondary text-meta">{fmtKm(instance.report.datasets.current.distanceM ?? null)}</span>
      {den && (
        <span className="hra-text-muted text-meta">
          {t("reportEvidence.weekExecution", `${den.completed}/${den.total} completed`, { completed: den.completed, total: den.total })}
        </span>
      )}
    </div>
  );
}

function QualityWorkoutRow({ entry, onOpen }: { entry: RangeQualityWorkoutEntry; onOpen: () => void }) {
  const { t } = useTranslation();
  const kind = entry.comparison.kind;
  const kindLabel = kind === "repetition" ? t("qualityWorkout.kind.repetition", "Repetitions")
    : kind === "threshold" ? t("qualityWorkout.kind.threshold", "Threshold")
    : kind === "tempo" ? t("qualityWorkout.kind.tempo", "Tempo")
    : t("qualityWorkout.kind.progressive", "Progressive");
  return (
    <div className="hra-border rounded-lg p-2.5 flex items-center gap-2 flex-wrap cursor-pointer" onClick={onOpen} role="button" tabIndex={0}>
      <span className="hra-text-primary text-body flex-1 min-w-0">
        {entry.currentDate ? instanceDayDateLabel(entry.currentDate) : "—"} · {kindLabel}
        {entry.planInstanceName ? ` · ${entry.planInstanceName}` : ""}
      </span>
      <span className="hra-text-muted text-meta">
        {t("qualityWorkout.coverage", `${entry.comparison.totals.coverage.alignedWorkSegments} of ${entry.comparison.totals.coverage.totalWorkSegments} aligned`,
          { aligned: entry.comparison.totals.coverage.alignedWorkSegments, total: entry.comparison.totals.coverage.totalWorkSegments })}
      </span>
      {!entry.comparison.available && (
        <span className="hra-text-muted text-meta">{t("qualityWorkout.table.source", "Unavailable")}</span>
      )}
    </div>
  );
}

function UnplannedSection({ unplanned }: { unplanned: RangeReport["unplanned"] }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <AccordionCard title={t("rangeReport.unplanned", `Unplanned activities (${unplanned.length})`, { n: unplanned.length })} expanded={expanded} onToggle={() => setExpanded(v => !v)}>
      <div className="flex flex-col gap-1.5">
        {unplanned.map(a => (
          <div key={a.activity_id} className="hra-fact-row">
            <span className="hra-text-muted text-meta">{instanceDayDateLabel(a.local_date)}</span>
            <span className="hra-text-primary text-body">#{a.activity_id}</span>
          </div>
        ))}
      </div>
    </AccordionCard>
  );
}

export function RangeReportModal({ from, to, onClose }: Props) {
  const { t } = useTranslation();
  const [range, setRange] = useState<ReportRangeMode>("plan_to_date");
  const [openInstanceId, setOpenInstanceId] = useState<number | null>(null);
  const [openWorkout, setOpenWorkout] = useState<{ instanceId: number; workoutId: string } | null>(null);
  const [qualityExpanded, setQualityExpanded] = useState(false);
  const { state } = useQuery(() => api.reports.range(from, to, range), [from, to, range]);

  return (
    <div className="hra-modal-backdrop hra-modal-layer fixed inset-0 flex items-center justify-center p-6">
      <div className="hra-activity-modal hra-bg-surface hra-border rounded-2xl w-full overflow-y-auto p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="hra-text-primary text-heading font-semibold flex-1 min-w-0">{t("rangeReport.title", "Training report")}</span>
          <button onClick={onClose} aria-label={t("common.close", "Close")} className="hra-text-muted text-heading border-0 bg-transparent cursor-pointer leading-none px-1">
            ×
          </button>
        </div>
        <span className="hra-text-muted text-meta">{dateLabel(t, from)} → {dateLabel(t, to)}</span>
        <RangeToggle range={range} onChange={setRange} />

        {state.status === "loading" || state.status === "idle" ? (
          <LoadingSpinner label={t("workoutReport.loading", "Loading report…")} />
        ) : state.status === "error" ? (
          <ErrorBanner message={state.error} />
        ) : (
          <RangeReportBody report={state.data} onOpenInstance={setOpenInstanceId} onOpenWorkout={(instanceId, workoutId) => setOpenWorkout({ instanceId, workoutId })}
            qualityExpanded={qualityExpanded} onToggleQuality={() => setQualityExpanded(v => !v)} />
        )}
      </div>

      {openInstanceId != null && <PlanReportModal instanceId={openInstanceId} onClose={() => setOpenInstanceId(null)} />}
      {openWorkout && (
        <WorkoutReportModal instanceId={openWorkout.instanceId} workoutId={openWorkout.workoutId} onClose={() => setOpenWorkout(null)} />
      )}
    </div>
  );
}

function RangeReportBody({
  report, onOpenInstance, onOpenWorkout, qualityExpanded, onToggleQuality,
}: {
  report: RangeReport; onOpenInstance: (instanceId: number) => void; onOpenWorkout: (instanceId: number, workoutId: string) => void;
  qualityExpanded: boolean; onToggleQuality: () => void;
}) {
  const { t } = useTranslation();
  const { aggregate } = report;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="hra-text-secondary text-label font-semibold">
          {t("rangeReport.grouping", `Grouping: ${groupingLabel(t, report.provenance.grouping)}`, { grouping: groupingLabel(t, report.provenance.grouping) })}
        </span>
        <span className="hra-text-muted text-meta">
          {t("rangeReport.coverage", `${aggregate.coverage.trustedActivities} trusted · ${aggregate.coverage.ambiguousActivities} ambiguous · ${aggregate.coverage.extraActivities} unplanned`,
            { trusted: aggregate.coverage.trustedActivities, ambiguous: aggregate.coverage.ambiguousActivities, extra: aggregate.coverage.extraActivities })}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <DatasetCard title={t("workoutReport.original", "Original")} metrics={aggregate.datasets.original} empty={t("reportEvidence.noOriginalPlan", "No Original data for this plan.")} />
        <DatasetCard title={t("workoutReport.current", "Current")} metrics={aggregate.datasets.current} empty={t("reportEvidence.noCurrentPlan", "No Current data for this plan.")} />
        <DatasetCard title={t("workoutReport.actual", "Actual")} metrics={aggregate.datasets.actual} empty={t("workoutReport.noActual", "No recorded activity.")} />
      </div>

      {aggregate.denominators.execution && (
        <span className="hra-text-secondary text-meta">
          {t(
            "reportEvidence.executionSummary",
            `Execution: ${aggregate.denominators.execution.completed} completed, ${aggregate.denominators.execution.missed} missed of ${aggregate.denominators.execution.total}${aggregate.denominators.execution.upcoming > 0 ? `, ${aggregate.denominators.execution.upcoming} upcoming` : ""}`,
            {
              completed: aggregate.denominators.execution.completed, missed: aggregate.denominators.execution.missed,
              total: aggregate.denominators.execution.total, upcoming: aggregate.denominators.execution.upcoming,
            },
          )}
        </span>
      )}

      {report.instances.length === 0 ? (
        <Empty message={t("rangeReport.noPlans", "No plan instance falls inside this range — showing Actual-only evidence.")} />
      ) : (
        <div className="flex flex-col gap-2">
          <span className="hra-text-secondary text-label font-semibold">{t("rangeReport.includedPlans", "Included plans")}</span>
          {report.instances.map(i => (
            <InstanceRow key={i.instanceId} instance={i} onOpen={() => onOpenInstance(i.instanceId)} />
          ))}
        </div>
      )}

      {report.unplanned.length > 0 && (
        <UnplannedSection unplanned={report.unplanned} />
      )}

      <div className="hra-border-strong rounded-lg p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="hra-text-primary text-label font-semibold">{t("rangeReport.qualityTitle", "Structured quality-workout comparison")}</span>
          <span className="hra-text-muted text-meta">
            {t("rangeReport.qualitySessionCoverage", `${report.qualityEvidence.workoutsWithEvidence} of ${report.qualityEvidence.totalWorkouts} sessions aligned`,
              { withEvidence: report.qualityEvidence.workoutsWithEvidence, total: report.qualityEvidence.totalWorkouts })}
          </span>
        </div>
        <span className="hra-text-muted text-meta">
          {t("rangeReport.qualitySegmentCoverage", `${report.qualityEvidence.segments.alignedWorkSegments} of ${report.qualityEvidence.segments.totalWorkSegments} work segments aligned`,
            { aligned: report.qualityEvidence.segments.alignedWorkSegments, total: report.qualityEvidence.segments.totalWorkSegments })}
        </span>
        {report.qualityEvidence.totalWorkouts === 0 ? (
          <span className="hra-text-muted text-meta">{t("rangeReport.qualityEmpty", "No structured quality workouts in this range.")}</span>
        ) : (
          <AccordionCard title={t("qualityWorkout.detailTitle", "Repetitions / blocks")} expanded={qualityExpanded} onToggle={onToggleQuality}>
            <div className="flex flex-col gap-2">
              {report.qualityEvidence.workouts.map(w => (
                <QualityWorkoutRow key={`${w.instanceId}::${w.workoutId}`} entry={w} onOpen={() => onOpenWorkout(w.instanceId, w.workoutId)} />
              ))}
            </div>
          </AccordionCard>
        )}
      </div>

      <span className="hra-text-muted text-meta">
        {t("workoutReport.provenance", `Generated ${new Date(report.provenance.generatedAt).toLocaleString()}`, { generatedAt: new Date(report.provenance.generatedAt).toLocaleString() })}
      </span>
    </div>
  );
}
