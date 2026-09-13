/**
 * CompareReportsModal.tsx (HRA-340)
 * "Compare two complete report definitions" — Report A and Report B are each
 * independently a Plan or a Range report (GET .../reports/plan or GET
 * /api/v1/reports/range), fetched through the EXISTING endpoints and reduced
 * to one normalized ComparisonSide shape by domain/report-compare.ts. This
 * component does no calculation of its own: every number shown here already
 * came out of the shared reporting engine.
 *
 * Report A/B definitions are restricted to Plan and Range (never single-
 * workout/race reports, HRA-336) — see report-compare.ts's own top-of-file
 * note for why. Restricting to these two also means every ACs' "unavailable,
 * not fabricated" branch (HR/pause/stamina on a range side, structured
 * quality-workout evidence on a plan side) is reachable without inventing
 * new backend computation for this Story.
 *
 * Mobile (AC: "a clear selector or stacked progressive disclosure; a
 * compressed desktop comparison table and page-level horizontal scrolling
 * are not acceptable at 320 CSS px"): each side's identity sits in its own
 * AccordionCard (stacked progressive disclosure, the same pattern
 * RangeReportModal's own quality-workout list and unplanned-activities
 * section already use) and every comparison row is a single flex-wrap
 * column (label, then A/B/delta stacked or wrapped), never a wide table —
 * so nothing here needs a responsive table-compression trick at all.
 *
 * Drill-down (AC: "navigation into either report's evidence and back
 * preserves both complete report definitions"): opening a side's own detail
 * reuses the EXISTING PlanReportModal/RangeReportModal (never a second
 * report UI); this modal's own URL-backed compareA/compareB state is
 * untouched while that child modal is open, so closing it returns to the
 * exact same two definitions.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useQuery } from "@/hooks/useQuery";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { useReportNumericSelection, useReportRangeMode, useReportStringSelection } from "@/hooks/useReportNav";
import { fmtDuration, fmtKm, fmtPace, instanceDayDateLabel } from "@/utils/fmt";
import { AccordionCard, DatePicker, Empty, ErrorBanner, LoadingSpinner, Select, WarningBanner } from "@/components/ui";
import { AggregateHrSection, AggregatePausesSection, ComparableStaminaSection } from "./ReportEvidenceSections";
import { PlanReportModal } from "./PlanReportModal";
import { RangeReportModal } from "./RangeReportModal";
import {
  compareDataset, compatibilityIssues, hrComparisonAvailable, pauseComparisonAvailable,
  planReportToSide, qualityComparisonAvailable, rangeReportToSide, staminaComparisonAvailable,
  type ComparisonSide, type DatasetKey, type MetricComparison, type MetricKey, type ReportDefinition,
} from "@/domain/report-compare";
import type { PlanInstance, ReportRangeMode } from "@/types/api";

interface Props {
  initialA?: ReportDefinition;
  initialB?: ReportDefinition;
  onClose: () => void;
}

const TODAY = new Date().toISOString().slice(0, 10);

function paceCell(secPerKm: number | null | undefined): string {
  return secPerKm != null ? `${fmtPace(secPerKm / 60)}/km` : "—";
}

function metricCell(key: MetricKey, value: number | null): string {
  if (value == null) return "—";
  if (key === "distanceM") return fmtKm(value);
  if (key === "durationSec") return fmtDuration(value);
  return paceCell(value);
}

// AC "signed" delta — a percentage/absolute change, never fabricated when
// either side lacks the metric (MetricComparison.absDiff is already null
// in that case, see report-compare.ts).
function deltaCell(key: MetricKey, m: MetricComparison, t: (k: string, d: string) => string): string {
  if (m.absDiff == null) return t("compareReports.unavailable", "Unavailable");
  const sign = m.absDiff > 0 ? "+" : "";
  const abs = key === "distanceM" ? fmtKm(Math.abs(m.absDiff)) : key === "durationSec" ? fmtDuration(Math.abs(m.absDiff)) : paceCell(Math.abs(m.absDiff));
  const pct = m.pctDiff != null ? ` (${sign}${m.pctDiff.toFixed(1)}%)` : "";
  return `${sign}${m.absDiff < 0 ? "-" : ""}${abs}${pct}`;
}

function metricLabel(key: MetricKey, t: (k: string, d: string) => string): string {
  if (key === "distanceM") return t("workoutReport.distance", "Distance");
  if (key === "durationSec") return t("workoutReport.duration", "Duration");
  return t("reportEvidence.avgPace", "Average pace");
}

function datasetLabel(key: DatasetKey, t: (k: string, d: string) => string): string {
  if (key === "original") return t("workoutReport.original", "Original");
  if (key === "current") return t("workoutReport.current", "Current");
  return t("workoutReport.actual", "Actual");
}

function ModeToggle({ mode, onChange }: { mode: ReportRangeMode; onChange: (r: ReportRangeMode) => void }) {
  const { t } = useTranslation();
  return (
    <div className="hra-segment">
      <button className="hra-segment-item" data-active={mode === "plan_to_date"} onClick={() => onChange("plan_to_date")}>
        {t("reportEvidence.range.planToDate", "Plan-to-date")}
      </button>
      <button className="hra-segment-item" data-active={mode === "full_plan"} onClick={() => onChange("full_plan")}>
        {t("reportEvidence.range.fullPlan", "Full plan")}
      </button>
    </div>
  );
}

interface SideState {
  kind: "plan" | "range";
  instanceId: number | null;
  from: string;
  to: string;
  mode: ReportRangeMode;
}

function useSideState(prefix: string, initial?: ReportDefinition): [SideState, {
  setKind: (k: "plan" | "range") => void; setInstanceId: (id: number) => void;
  setFrom: (v: string) => void; setTo: (v: string) => void; setMode: (m: ReportRangeMode) => void;
}] {
  const [kindRaw, setKindRaw] = useReportStringSelection(`${prefix}Kind`);
  const [instanceId, setInstanceIdRaw] = useReportNumericSelection(`${prefix}Instance`);
  const [from, setFromRaw] = useReportStringSelection(`${prefix}From`);
  const [to, setToRaw] = useReportStringSelection(`${prefix}To`);
  const [mode, setMode] = useReportRangeMode(`${prefix}Mode`);

  const initialKind: "plan" | "range" = initial?.kind ?? "range";
  const kind: "plan" | "range" = kindRaw === "plan" || kindRaw === "range" ? kindRaw : initialKind;
  const resolvedInstanceId = instanceId ?? (initial?.kind === "plan" ? initial.instanceId : null);
  const resolvedFrom = from ?? (initial?.kind === "range" ? initial.from : TODAY);
  const resolvedTo = to ?? (initial?.kind === "range" ? initial.to : TODAY);
  const resolvedMode: ReportRangeMode = mode ?? (initial?.range ?? "plan_to_date");

  return [
    { kind, instanceId: resolvedInstanceId, from: resolvedFrom, to: resolvedTo, mode: resolvedMode },
    {
      setKind: setKindRaw,
      setInstanceId: (id: number) => setInstanceIdRaw(id),
      setFrom: setFromRaw,
      setTo: setToRaw,
      setMode,
    },
  ];
}

function toDefinition(s: SideState): ReportDefinition | null {
  if (s.kind === "plan") return s.instanceId != null ? { kind: "plan", instanceId: s.instanceId, range: s.mode } : null;
  return { kind: "range", from: s.from, to: s.to, range: s.mode };
}

function DefinitionPicker({
  label, state, actions, planInstances,
}: {
  label: string; state: SideState; actions: ReturnType<typeof useSideState>[1]; planInstances: PlanInstance[];
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <span className="hra-text-primary text-label font-semibold">{label}</span>
      <Select
        value={state.kind}
        onValueChange={v => actions.setKind(v === "plan" ? "plan" : "range")}
        options={[
          { value: "range", label: t("compareReports.kind.range", "Date range") },
          { value: "plan", label: t("compareReports.kind.plan", "Plan instance") },
        ]}
        ariaLabel={t("compareReports.kindLabel", "Report type")}
      />
      {state.kind === "plan" ? (
        <Select
          value={state.instanceId != null ? String(state.instanceId) : ""}
          onValueChange={v => actions.setInstanceId(Number(v))}
          options={planInstances.map(p => ({ value: String(p.id), label: p.name ?? t("manage.planTemplates.untitled", "Untitled plan") }))}
          placeholder={t("compareReports.selectPlan", "Select a plan…")}
          ariaLabel={t("compareReports.planLabel", "Plan instance")}
        />
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <DatePicker value={state.from} onChange={actions.setFrom} max={state.to} />
          <span className="hra-text-muted text-meta">{t("common.to", "to")}</span>
          <DatePicker value={state.to} onChange={actions.setTo} min={state.from} />
        </div>
      )}
      <ModeToggle mode={state.mode} onChange={actions.setMode} />
    </div>
  );
}

function IdentityPanel({ side, expanded, onToggle, onOpenDrillDown }: {
  side: ComparisonSide; expanded: boolean; onToggle: () => void; onOpenDrillDown: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AccordionCard title={side.identity.label} expanded={expanded} onToggle={onToggle}>
      <div className="flex flex-col gap-1.5">
        <div className="hra-fact-row">
          <span className="hra-text-muted text-meta">{t("compareReports.identity.kind", "Type")}</span>
          <span className="hra-text-primary text-body">
            {side.identity.kind === "plan" ? t("compareReports.kind.plan", "Plan instance") : t("compareReports.kind.range", "Date range")}
          </span>
        </div>
        <div className="hra-fact-row">
          <span className="hra-text-muted text-meta">{t("compareReports.identity.mode", "Scope")}</span>
          <span className="hra-text-primary text-body">
            {side.identity.range === "plan_to_date" ? t("reportEvidence.range.planToDate", "Plan-to-date") : t("reportEvidence.range.fullPlan", "Full plan")}
          </span>
        </div>
        {side.identity.grouping && (
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("compareReports.identity.grouping", "Grouping")}</span>
            <span className="hra-text-primary text-body">{side.identity.grouping}</span>
          </div>
        )}
        {side.identity.scheduleTimezone && (
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("compareReports.identity.timezone", "Schedule timezone")}</span>
            <span className="hra-text-primary text-body">{side.identity.scheduleTimezone}</span>
          </div>
        )}
        {side.identity.hasOriginalBaseline != null && (
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("compareReports.identity.originalBaseline", "Original baseline")}</span>
            <span className="hra-text-primary text-body">{side.identity.hasOriginalBaseline ? t("common.yes", "Yes") : t("common.no", "No")}</span>
          </div>
        )}
        {side.identity.dateSpanStart && side.identity.dateSpanEnd && (
          <div className="hra-fact-row">
            <span className="hra-text-muted text-meta">{t("compareReports.identity.span", "Date span")}</span>
            <span className="hra-text-primary text-body">{instanceDayDateLabel(side.identity.dateSpanStart)} → {instanceDayDateLabel(side.identity.dateSpanEnd)}</span>
          </div>
        )}
        <div className="hra-fact-row">
          <span className="hra-text-muted text-meta">{t("compareReports.identity.generated", "Generated")}</span>
          <span className="hra-text-primary text-body">{new Date(side.identity.generatedAt).toLocaleString()}</span>
        </div>
        <div className="hra-fact-row">
          <span className="hra-text-muted text-meta">{t("compareReports.identity.asOf", "As of")}</span>
          <span className="hra-text-primary text-body">{new Date(side.identity.asOf).toLocaleString()}</span>
        </div>
        <div className="hra-fact-row">
          <span className="hra-text-muted text-meta">{t("compareReports.identity.coverage", "Coverage")}</span>
          <span className="hra-text-primary text-body">
            {t("rangeReport.coverage", `${side.coverage.trustedActivities} trusted · ${side.coverage.ambiguousActivities} ambiguous · ${side.coverage.extraActivities} unplanned`,
              { trusted: side.coverage.trustedActivities, ambiguous: side.coverage.ambiguousActivities, extra: side.coverage.extraActivities })}
          </span>
        </div>
        <button type="button" className="hra-btn self-start" data-variant="outline" onClick={onOpenDrillDown}>
          {t("compareReports.openFull", "Open full report")}
        </button>
      </div>
    </AccordionCard>
  );
}

function MetricRow({ metricKey, m, t }: { metricKey: MetricKey; m: MetricComparison; t: (k: string, d: string) => string }) {
  return (
    <div className="hra-border rounded-lg p-2.5 flex flex-col gap-1">
      <span className="hra-text-secondary text-label font-semibold">{metricLabel(metricKey, t)}</span>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="hra-text-muted text-meta">A: {metricCell(metricKey, m.valueA)}</span>
        <span className="hra-text-muted text-meta">B: {metricCell(metricKey, m.valueB)}</span>
        <span className="hra-text-primary text-body">{deltaCell(metricKey, m, t)}</span>
      </div>
    </div>
  );
}

function DatasetComparisonSection({ datasetKey, a, b }: { datasetKey: DatasetKey; a: ComparisonSide; b: ComparisonSide }) {
  const { t } = useTranslation();
  const comparisons = compareDataset(a.datasets[datasetKey], b.datasets[datasetKey]);
  const anyAvailable = comparisons.some(m => m.availableA || m.availableB);
  if (!anyAvailable) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="hra-text-secondary text-label font-semibold">{datasetLabel(datasetKey, t)}</span>
      {comparisons.filter(m => m.availableA || m.availableB).map(m => (
        <MetricRow key={m.key} metricKey={m.key} m={m} t={t} />
      ))}
    </div>
  );
}

function DenominatorRow({ label, denA, denB }: {
  label: string; denA?: { total: number; completed: number; missed: number; upcoming: number }; denB?: { total: number; completed: number; missed: number; upcoming: number };
}) {
  const { t } = useTranslation();
  if (!denA && !denB) return null;
  return (
    <div className="hra-border rounded-lg p-2.5 flex flex-col gap-1">
      <span className="hra-text-secondary text-label font-semibold">{label}</span>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="hra-text-muted text-meta">
          A: {denA ? t("reportEvidence.weekExecution", `${denA.completed}/${denA.total} completed`, { completed: denA.completed, total: denA.total }) : t("compareReports.unavailable", "Unavailable")}
        </span>
        <span className="hra-text-muted text-meta">
          B: {denB ? t("reportEvidence.weekExecution", `${denB.completed}/${denB.total} completed`, { completed: denB.completed, total: denB.total }) : t("compareReports.unavailable", "Unavailable")}
        </span>
      </div>
    </div>
  );
}

function EvidenceComparisonSection({ a, b }: { a: ComparisonSide; b: ComparisonSide }) {
  const { t } = useTranslation();
  const hrAvailable = hrComparisonAvailable(a, b);
  const pauseAvailable = pauseComparisonAvailable(a, b);
  const staminaAvailable = staminaComparisonAvailable(a, b);

  if (!hrAvailable && !pauseAvailable && !staminaAvailable) {
    return (
      <WarningBanner message={t("compareReports.evidenceUnavailable", "HR, pause, and stamina comparison need both sides to be Plan reports with recorded evidence — unavailable for this pairing.")} />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {hrAvailable && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <AggregateHrSection hr={a.evidence!.hr} />
          <AggregateHrSection hr={b.evidence!.hr} />
        </div>
      )}
      {pauseAvailable && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <AggregatePausesSection pauses={a.evidence!.pauses} />
          <AggregatePausesSection pauses={b.evidence!.pauses} />
        </div>
      )}
      {staminaAvailable && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ComparableStaminaSection comparableStamina={a.evidence!.comparableStamina} />
          <ComparableStaminaSection comparableStamina={b.evidence!.comparableStamina} />
        </div>
      )}
    </div>
  );
}

// AC "A long-run/race comparison can place active pace, total paused time,
// and finish stamina together where data is reliable, without deriving a
// quality score" — a plain juxtaposition of three already-computed facts per
// side, never a blended/derived number.
function LongRunSnapshotSection({ a, b }: { a: ComparisonSide; b: ComparisonSide }) {
  const { t } = useTranslation();
  const paceA = a.datasets.actual.paceSecPerKm ?? null;
  const paceB = b.datasets.actual.paceSecPerKm ?? null;
  const pausedA = a.evidence?.pauses?.totalPausedFromPausesSec ?? null;
  const pausedB = b.evidence?.pauses?.totalPausedFromPausesSec ?? null;
  const staminaA = a.evidence?.comparableStamina?.stamina.finish ?? null;
  const staminaB = b.evidence?.comparableStamina?.stamina.finish ?? null;
  const anyData = paceA != null || paceB != null || pausedA != null || pausedB != null || staminaA != null || staminaB != null;
  if (!anyData) return null;
  return (
    <div className="hra-border-strong rounded-lg p-3 flex flex-col gap-2">
      <span className="hra-text-primary text-label font-semibold">{t("compareReports.longRun.title", "Long-run / race snapshot")}</span>
      <div className="hra-fact-row">
        <span className="hra-text-muted text-meta">{t("compareReports.longRun.pace", "Active pace")}</span>
        <span className="hra-text-primary text-body">A: {paceCell(paceA)} · B: {paceCell(paceB)}</span>
      </div>
      <div className="hra-fact-row">
        <span className="hra-text-muted text-meta">{t("workoutReport.pauses.total", "Total paused")}</span>
        <span className="hra-text-primary text-body">A: {fmtDuration(pausedA)} · B: {fmtDuration(pausedB)}</span>
      </div>
      <div className="hra-fact-row">
        <span className="hra-text-muted text-meta">{t("workoutReport.stamina.finish", "Finish")}</span>
        <span className="hra-text-primary text-body">A: {staminaA ?? "—"} · B: {staminaB ?? "—"}</span>
      </div>
    </div>
  );
}

function QualityComparisonSection({ a, b }: { a: ComparisonSide; b: ComparisonSide }) {
  const { t } = useTranslation();
  if (!qualityComparisonAvailable(a, b)) {
    return (
      <WarningBanner message={t("compareReports.qualityUnavailable", "Structured quality-workout comparison needs both sides to be Date-range reports with at least one quality session — unavailable for this pairing.")} />
    );
  }
  const qa = a.qualityEvidence!;
  const qb = b.qualityEvidence!;
  const kinds = Array.from(new Set([...Object.keys(qa.byKind), ...Object.keys(qb.byKind)])) as (keyof typeof qa.byKind)[];
  return (
    <div className="flex flex-col gap-2">
      {kinds.map(kind => {
        const ka = qa.byKind[kind];
        const kb = qb.byKind[kind];
        return (
          <div key={String(kind)} className="hra-border rounded-lg p-2.5 flex flex-col gap-1">
            <span className="hra-text-secondary text-label font-semibold">{String(kind)}</span>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="hra-text-muted text-meta">A: {ka ? `${ka.withEvidence}/${ka.total}` : t("compareReports.unavailable", "Unavailable")}</span>
              <span className="hra-text-muted text-meta">B: {kb ? `${kb.withEvidence}/${kb.total}` : t("compareReports.unavailable", "Unavailable")}</span>
            </div>
          </div>
        );
      })}
      <div className="hra-fact-row">
        <span className="hra-text-muted text-meta">{t("rangeReport.qualitySegmentCoverage", "Work segments aligned")}</span>
        <span className="hra-text-primary text-body">
          A: {qa.segments.alignedWorkSegments}/{qa.segments.totalWorkSegments} · B: {qb.segments.alignedWorkSegments}/{qb.segments.totalWorkSegments}
        </span>
      </div>
    </div>
  );
}

async function fetchSide(def: ReportDefinition | null): Promise<ComparisonSide | null> {
  if (!def) return null;
  if (def.kind === "plan") {
    const report = await api.planInstances.planReport(def.instanceId, def.range);
    return planReportToSide(def, report, report.provenance.planInstanceName ?? "");
  }
  const report = await api.reports.range(def.from, def.to, def.range);
  return rangeReportToSide(def, report);
}

export function CompareReportsModal({ initialA, initialB, onClose }: Props) {
  const { t } = useTranslation();
  const dialogRef = useDialogA11y(onClose);

  const [stateA, actionsA] = useSideState("compareA", initialA);
  const [stateB, actionsB] = useSideState("compareB", initialB);

  const planInstancesQ = useQuery(() => api.planInstances.list(), []);
  const planInstancesState = planInstancesQ.state;
  const planInstances = planInstancesState.status === "success" ? planInstancesState.data : [];

  // Default an unselected "plan" side's instance to the first available one
  // once the list resolves, rather than leaving the fetch permanently unable
  // to run — mirrors PlanInstancesSection's own "first instance wins" default
  // for a picker with no prior selection. Depends on the query's own state
  // object (stable identity between resolves), not the derived `planInstances`
  // array literal, which would otherwise be a fresh array every render.
  useEffect(() => {
    if (stateA.kind === "plan" && stateA.instanceId == null && planInstancesState.status === "success" && planInstancesState.data.length > 0) {
      actionsA.setInstanceId(planInstancesState.data[0].id);
    }
  }, [stateA.kind, stateA.instanceId, planInstancesState, actionsA]);
  useEffect(() => {
    if (stateB.kind === "plan" && stateB.instanceId == null && planInstancesState.status === "success" && planInstancesState.data.length > 0) {
      actionsB.setInstanceId(planInstancesState.data[0].id);
    }
  }, [stateB.kind, stateB.instanceId, planInstancesState, actionsB]);

  const defA = toDefinition(stateA);
  const defB = toDefinition(stateB);

  const sideAQ = useQuery(() => fetchSide(defA), [defA?.kind, defA?.kind === "plan" ? defA.instanceId : null, defA?.kind === "range" ? defA.from : null, defA?.kind === "range" ? defA.to : null, defA?.range]);
  const sideBQ = useQuery(() => fetchSide(defB), [defB?.kind, defB?.kind === "plan" ? defB.instanceId : null, defB?.kind === "range" ? defB.from : null, defB?.kind === "range" ? defB.to : null, defB?.range]);

  const [expandedA, setExpandedA] = useState(true);
  const [expandedB, setExpandedB] = useState(true);
  const [drillDown, setDrillDown] = useState<"A" | "B" | null>(null);

  const sideA = sideAQ.state.status === "success" ? sideAQ.state.data : null;
  const sideB = sideBQ.state.status === "success" ? sideBQ.state.data : null;
  const loading = sideAQ.state.status === "loading" || sideAQ.state.status === "idle" || sideBQ.state.status === "loading" || sideBQ.state.status === "idle";
  const error = sideAQ.state.status === "error" ? sideAQ.state.error : sideBQ.state.status === "error" ? sideBQ.state.error : null;

  const drillDownDef = drillDown === "A" ? defA : drillDown === "B" ? defB : null;

  return (
    <div className="hra-modal-backdrop hra-modal-layer fixed inset-0 flex items-center justify-center p-6">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-reports-title"
        className="hra-activity-modal hra-bg-surface hra-border rounded-2xl w-full overflow-y-auto p-6 flex flex-col gap-4"
      >
        <div className="flex items-center gap-3">
          <span id="compare-reports-title" className="hra-text-primary text-heading font-semibold flex-1 min-w-0">{t("compareReports.title", "Compare reports")}</span>
          <button onClick={onClose} aria-label={t("common.close", "Close")} className="hra-text-muted text-heading border-0 bg-transparent cursor-pointer leading-none px-1">
            ×
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DefinitionPicker label={t("compareReports.sideA", "Report A")} state={stateA} actions={actionsA} planInstances={planInstances} />
          <DefinitionPicker label={t("compareReports.sideB", "Report B")} state={stateB} actions={actionsB} planInstances={planInstances} />
        </div>

        {loading && <LoadingSpinner label={t("workoutReport.loading", "Loading report…")} />}
        {error && <ErrorBanner message={error} />}

        {sideA && sideB && (
          <CompareReportsBody
            a={sideA} b={sideB}
            expandedA={expandedA} expandedB={expandedB}
            onToggleA={() => setExpandedA(v => !v)} onToggleB={() => setExpandedB(v => !v)}
            onOpenDrillDownA={() => setDrillDown("A")} onOpenDrillDownB={() => setDrillDown("B")}
          />
        )}
      </div>

      {drillDownDef?.kind === "plan" && (
        <PlanReportModal
          instanceId={drillDownDef.instanceId}
          weekKey={`compare${drillDown}PlanWeek`}
          workoutKey={`compare${drillDown}PlanWorkout`}
          modeKey={`compare${drillDown}PlanMode`}
          onClose={() => setDrillDown(null)}
        />
      )}
      {drillDownDef?.kind === "range" && (
        <RangeReportModal from={drillDownDef.from} to={drillDownDef.to} onClose={() => setDrillDown(null)} />
      )}
    </div>
  );
}

function CompareReportsBody({
  a, b, expandedA, expandedB, onToggleA, onToggleB, onOpenDrillDownA, onOpenDrillDownB,
}: {
  a: ComparisonSide; b: ComparisonSide; expandedA: boolean; expandedB: boolean;
  onToggleA: () => void; onToggleB: () => void; onOpenDrillDownA: () => void; onOpenDrillDownB: () => void;
}) {
  const { t } = useTranslation();
  const issues = compatibilityIssues(a, b);
  const anyDataset = (["original", "current", "actual"] as DatasetKey[]).some(
    key => compareDataset(a.datasets[key], b.datasets[key]).some(m => m.availableA || m.availableB),
  );

  return (
    <div className="flex flex-col gap-4">
      {issues.map(issue => (
        <WarningBanner key={issue.code} message={t(issue.messageKey, issue.defaultMessage, issue.values)} />
      ))}

      <div className="flex flex-col gap-2">
        <IdentityPanel side={a} expanded={expandedA} onToggle={onToggleA} onOpenDrillDown={onOpenDrillDownA} />
        <IdentityPanel side={b} expanded={expandedB} onToggle={onToggleB} onOpenDrillDown={onOpenDrillDownB} />
      </div>

      {anyDataset ? (
        <div className="flex flex-col gap-4">
          <DatasetComparisonSection datasetKey="original" a={a} b={b} />
          <DatasetComparisonSection datasetKey="current" a={a} b={b} />
          <DatasetComparisonSection datasetKey="actual" a={a} b={b} />
        </div>
      ) : (
        <Empty message={t("compareReports.noData", "Neither side has recorded metrics for this pairing yet.")} />
      )}

      <div className="flex flex-col gap-2">
        <DenominatorRow label={t("compareReports.execution", "Execution")} denA={a.denominators.execution} denB={b.denominators.execution} />
        <DenominatorRow label={t("compareReports.outcome", "Outcome")} denA={a.denominators.outcome} denB={b.denominators.outcome} />
      </div>

      <LongRunSnapshotSection a={a} b={b} />

      <div className="flex flex-col gap-2">
        <span className="hra-text-primary text-label font-semibold">{t("workoutReport.hr.title", "Heart rate")} · {t("workoutReport.pauses.title", "Pauses")} · {t("workoutReport.stamina.title", "Stamina")}</span>
        <EvidenceComparisonSection a={a} b={b} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="hra-text-primary text-label font-semibold">{t("rangeReport.qualityTitle", "Structured quality-workout comparison")}</span>
        <QualityComparisonSection a={a} b={b} />
      </div>
    </div>
  );
}
