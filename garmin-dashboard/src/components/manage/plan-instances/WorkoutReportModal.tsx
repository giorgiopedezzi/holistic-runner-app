/**
 * WorkoutReportModal.tsx (HRA-336)
 * The single-workout/race report — a factual Original/Current/Actual view for
 * ONE planned workout, backed by GET /api/v1/plan-instances/:id/reports/
 * workouts/:workoutId (garmin-stats/src/domain/reporting/workout-report.ts).
 * This component does no calculation of its own — it only renders the
 * already-computed dataset metrics/lineage/race fields the backend returns
 * (this Story's own guardrail: no second calculation engine). The one piece
 * of real client-side reuse is the existing pace-band overlay
 * (PlannedPaceTargetChart, domain/planned-workout.ts's buildPaceTargetBandModel)
 * via the optional `paceTargetBands` prop — the caller already has it
 * computed (AgendaTab/PlanInstanceCalendar's own DayView), so this modal
 * doesn't re-derive it from raw segments.
 *
 * Progressive disclosure at mobile widths (320 CSS px, AC): Original/Current/
 * Actual stack as separate rows by default; they only ever sit side by side
 * from `sm:` up (`grid-cols-1 sm:grid-cols-3`).
 */
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/api/client";
import { useQuery } from "@/hooks/useQuery";
import { fmtDuration, fmtKm, fmtPace, instanceDayDateLabel } from "@/utils/fmt";
import { Empty, ErrorBanner, LoadingSpinner } from "@/components/ui";
import { PlannedPaceTargetChart } from "@/components/PlannedPaceTargetChart";
import type { PaceTargetBandModel } from "@/domain/planned-workout";
import type { WorkoutDatasetMetrics, WorkoutEvidenceState, WorkoutReport } from "@/types/api";

interface Props {
  instanceId: number;
  workoutId: string;
  // Already-computed client-side chart model for THIS same day, when the
  // caller has one (Agenda/the race-plan calendar always do — see the
  // top-of-file comment). Never fetched or derived by this modal itself.
  paceTargetBands?: PaceTargetBandModel;
  onClose: () => void;
}

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

function stateLabel(t: (k: string, d: string) => string, state: WorkoutEvidenceState): string {
  if (state === "completed") return t("workoutReport.state.completed", "Completed");
  if (state === "missed") return t("workoutReport.state.missed", "Missed");
  return t("workoutReport.state.upcoming", "Upcoming");
}

function DatasetCard({ title, metrics, empty }: { title: string; metrics: WorkoutDatasetMetrics | null; empty: string }) {
  const { t } = useTranslation();
  return (
    <div className="hra-border rounded-lg p-3 flex flex-col gap-1.5 flex-1 min-w-0">
      <span className="hra-text-secondary text-label font-semibold">{title}</span>
      {metrics ? (
        <>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.distance", "Distance")}</span>
            <span className="hra-text-primary text-body">{fmtKm(metrics.distanceM)}{metrics.approximate ? " *" : ""}</span>
          </div>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.duration", "Duration")}</span>
            <span className="hra-text-primary text-body">{fmtDuration(metrics.durationSec)}</span>
          </div>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.pace", "Pace")}</span>
            <span className="hra-text-primary text-body">
              {metrics.paceSecPerKm != null ? `${fmtPace(metrics.paceSecPerKm / 60)}/km` : "—"}
            </span>
          </div>
        </>
      ) : (
        <span className="hra-text-muted text-meta">{empty}</span>
      )}
    </div>
  );
}

function RaceSection({ report }: { report: WorkoutReport }) {
  const { t } = useTranslation();
  const { race } = report;
  if (!race.isRace) return null;
  return (
    <div className="hra-border-strong rounded-lg p-3 flex flex-col gap-2">
      <span className="hra-text-primary text-label font-semibold">{t("workoutReport.race.title", "Race")}</span>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="hra-text-secondary text-meta font-semibold">{t("workoutReport.race.target", "Target")}</span>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.distance", "Distance")}</span>
            <span className="hra-text-primary text-body">{fmtKm(race.targetDistanceM ?? null)}</span>
          </div>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.race.finishTime", "Finish time")}</span>
            <span className="hra-text-primary text-body">{fmtDuration(race.targetDurationSec ?? null)}</span>
          </div>
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("workoutReport.pace", "Pace")}</span>
            <span className="hra-text-primary text-body">
              {race.targetPaceSecPerKm != null ? `${fmtPace(race.targetPaceSecPerKm / 60)}/km` : "—"}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="hra-text-secondary text-meta font-semibold">{t("workoutReport.race.actual", "Actual")}</span>
          {race.actualSource === "activity" ? (
            <>
              <div className="hra-fact-row">
                <span className="hra-text-muted text-meta">{t("workoutReport.race.elapsed", "Elapsed (race clock)")}</span>
                <span className="hra-text-primary text-body">{fmtDuration(race.actualElapsedSec ?? null)}</span>
              </div>
              <div className="hra-fact-row">
                <span className="hra-text-muted text-meta">{t("workoutReport.race.moving", "Moving (context only)")}</span>
                <span className="hra-text-secondary text-meta">{fmtDuration(race.actualMovingSec ?? null)}</span>
              </div>
              <span className="hra-text-muted text-meta">{t("workoutReport.race.sourceActivity", "Source: linked activity")}</span>
            </>
          ) : (
            <span className="hra-text-muted text-meta">{t("workoutReport.race.noEvidence", "No accepted result yet — this race remains unresolved.")}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function WorkoutReportModal({ instanceId, workoutId, paceTargetBands, onClose }: Props) {
  const { t } = useTranslation();
  const { state } = useQuery(() => api.planInstances.workoutReport(instanceId, workoutId), [instanceId, workoutId]);

  return (
    <div className="hra-modal-backdrop hra-modal-layer fixed inset-0 flex items-center justify-center p-6">
      <div className="hra-activity-modal hra-bg-surface hra-border rounded-2xl w-full overflow-y-auto p-6 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="hra-text-primary text-heading font-semibold flex-1 min-w-0">
            {t("workoutReport.title", "Workout report")}
          </span>
          <button
            onClick={onClose}
            aria-label={t("common.close", "Close")}
            className="hra-text-muted text-heading border-0 bg-transparent cursor-pointer leading-none px-1"
          >
            ×
          </button>
        </div>

        {state.status === "loading" || state.status === "idle" ? (
          <LoadingSpinner label={t("workoutReport.loading", "Loading report…")} />
        ) : state.status === "error" ? (
          <ErrorBanner message={errorMessage(state.error)} />
        ) : (
          <ReportBody report={state.data} paceTargetBands={paceTargetBands} />
        )}
      </div>
    </div>
  );
}

function ReportBody({ report, paceTargetBands }: { report: WorkoutReport; paceTargetBands?: PaceTargetBandModel }) {
  const { t } = useTranslation();
  const { identity, provenance } = report;
  const displayDate = identity.currentDate ?? identity.originalDate;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          {displayDate && <span className="hra-text-primary text-label font-semibold">{instanceDayDateLabel(displayDate)}</span>}
          <span className="hra-text-secondary text-meta">{stateLabel(t, report.state)}</span>
        </div>
        <span className="hra-text-muted text-meta">
          {provenance.planInstanceName ?? t("manage.planTemplates.untitled", "Untitled plan")}
          {identity.sectionName ? ` · ${identity.sectionName}` : ""}
          {identity.weekNumber != null ? ` · ${t("workoutReport.week", `Week ${identity.weekNumber}`, { n: identity.weekNumber })}` : ""}
        </span>
      </div>

      {!provenance.hasOriginalBaseline && (
        <Empty message={t("workoutReport.emptyNoBaseline", "This plan has no Original baseline yet.")} />
      )}

      {report.originalEqualsCurrent ? (
        <div className="flex flex-col gap-2">
          <span className="hra-text-muted text-meta">{t("workoutReport.unchanged", "Original plan unchanged")}</span>
          <DatasetCard
            title={t("workoutReport.planned", "Planned")}
            metrics={report.planned.current}
            empty={t("workoutReport.noPlannedMetrics", "No planned metrics available.")}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DatasetCard
            title={t("workoutReport.original", "Original")}
            metrics={report.planned.original}
            empty={t("workoutReport.originalRemoved", "Removed from the plan since freeze.")}
          />
          <DatasetCard
            title={t("workoutReport.current", "Current")}
            metrics={report.planned.current}
            empty={t("workoutReport.currentAdded", "Added to the plan after Original froze.")}
          />
        </div>
      )}

      {paceTargetBands && <PlannedPaceTargetChart model={paceTargetBands} />}

      <DatasetCard
        title={t("workoutReport.actual", "Actual")}
        metrics={report.actual.metrics}
        empty={
          report.state === "upcoming"
            ? t("workoutReport.upcomingNoActual", "Not due yet.")
            : report.state === "missed"
              ? t("workoutReport.missedNoActual", "No recorded activity — marked missed.")
              : t("workoutReport.noActual", "No recorded activity.")
        }
      />
      {report.actual.hasAmbiguousEvidence && (
        <span className="hra-text-muted text-meta">
          {t("workoutReport.ambiguous", "An unresolved activity link exists for this workout — visible, but not counted above until confirmed.")}
        </span>
      )}

      <RaceSection report={report} />

      <span className="hra-text-muted text-meta">
        {t(
          "workoutReport.provenance",
          `Generated ${new Date(provenance.generatedAt).toLocaleString()} · revision C${provenance.currentRevision}/O${provenance.originalRevision}`,
          { generatedAt: new Date(provenance.generatedAt).toLocaleString(), current: provenance.currentRevision, original: provenance.originalRevision },
        )}
      </span>
    </div>
  );
}
