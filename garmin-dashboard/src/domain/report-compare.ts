/**
 * report-compare.ts (HRA-340)
 * Pure comparison logic for "compare two complete report definitions" — never
 * a second calculation engine: every number rendered here already came out of
 * the shared reporting engine (garmin-stats/src/domain/reporting/report.ts)
 * via the existing Plan/Range report endpoints. This module only (a) picks
 * apart a fetched PlanReport/RangeReport into one normalized ComparisonSide
 * shape so both kinds can be displayed the same way, and (b) pairs up TWO
 * sides' SAME dataset key (original-vs-original, current-vs-current,
 * actual-vs-actual) — it never combines two different dataset keys across
 * sides (Story AC: "never combines Report A Actual with Report B Current").
 *
 * Report A/B definitions are deliberately restricted to Plan and Range
 * reports (not single-workout/race reports, HRA-336) — HRA-336 is not one of
 * this Story's own listed Dependencies, and Plan+Range already exercise every
 * ACs' compatible/incompatible branch: Plan reports carry real HR/pause/
 * stamina evidence (aggregate-evidence.ts), Range reports carry real
 * structured quality-workout evidence (HRA-342) — comparing across kinds is
 * what naturally produces the "unavailable, not fabricated" half of the ACs,
 * since neither kind has BOTH today.
 */
import type {
  AggregateEvidence, PlanReport, RangeGrouping, RangeQualityEvidence, RangeReport,
  ReportDatasetMetrics, ReportRangeMode, DimensionDenominator,
} from "@/types/api";

export type ReportDefinitionKind = "plan" | "range";

export type ReportDefinition =
  | { kind: "plan"; instanceId: number; range: ReportRangeMode }
  | { kind: "range"; from: string; to: string; range: ReportRangeMode };

export interface ComparisonIdentity {
  kind: ReportDefinitionKind;
  label: string;
  scheduleTimezone: string | null;
  hasOriginalBaseline: boolean | null;
  range: ReportRangeMode;
  grouping: RangeGrouping | null;
  dateSpanStart: string | null;
  dateSpanEnd: string | null;
  generatedAt: string;
  asOf: string;
}

export interface ComparisonCoverage {
  totalActivitiesInScope: number;
  trustedActivities: number;
  ambiguousActivities: number;
  extraActivities: number;
}

export interface ComparisonSide {
  definition: ReportDefinition;
  identity: ComparisonIdentity;
  datasets: { original: ReportDatasetMetrics; current: ReportDatasetMetrics; actual: ReportDatasetMetrics };
  denominators: { execution?: DimensionDenominator; outcome?: DimensionDenominator };
  coverage: ComparisonCoverage;
  // Only ever populated for "plan" kind sides — Range reports don't compute
  // aggregate HR/pause/stamina evidence today (checked: range-report.ts's
  // RangeReportResult carries no such field). A "range" side is null here,
  // never a fabricated zero/empty evidence object.
  evidence: AggregateEvidence | null;
  // Only ever populated for "range" kind sides — Plan/Week reports still
  // hardcode structuredQualityEvidence as "not_implemented" (checked:
  // plan-report.ts). A "plan" side is null here for the same reason.
  qualityEvidence: RangeQualityEvidence | null;
  drillDown: { workoutIds: string[]; activityIds: number[] };
}

// Inclusive day count between two YYYY-MM-DD calendar dates — used only to
// label a duration mismatch (AC3), never a value fed into a metric delta.
export function inclusiveDaySpan(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

export function planReportToSide(definition: Extract<ReportDefinition, { kind: "plan" }>, report: PlanReport, planLabel: string): ComparisonSide {
  return {
    definition,
    identity: {
      kind: "plan",
      label: planLabel,
      scheduleTimezone: report.provenance.scheduleTimezone,
      hasOriginalBaseline: report.provenance.hasOriginalBaseline,
      range: report.provenance.range,
      grouping: null,
      dateSpanStart: report.dateSpan.start,
      dateSpanEnd: report.dateSpan.end,
      generatedAt: report.provenance.generatedAt,
      asOf: report.provenance.asOf,
    },
    datasets: report.overall.datasets,
    denominators: report.overall.denominators,
    coverage: report.overall.coverage,
    evidence: report.overallEvidence,
    qualityEvidence: null,
    drillDown: report.overall.drillDown,
  };
}

export function rangeReportToSide(definition: Extract<ReportDefinition, { kind: "range" }>, report: RangeReport): ComparisonSide {
  return {
    definition,
    identity: {
      kind: "range",
      label: `${report.provenance.from} → ${report.provenance.to}`,
      scheduleTimezone: null,
      hasOriginalBaseline: null,
      range: report.provenance.range,
      grouping: report.provenance.grouping,
      dateSpanStart: report.provenance.from,
      dateSpanEnd: report.provenance.to,
      generatedAt: report.provenance.generatedAt,
      asOf: report.provenance.asOf,
    },
    datasets: report.aggregate.datasets,
    denominators: report.aggregate.denominators,
    coverage: report.aggregate.coverage,
    evidence: null,
    qualityEvidence: report.qualityEvidence,
    drillDown: report.aggregate.drillDown,
  };
}

// ── same-dataset-key metric comparison (AC2, AC5, AC9) ──────────────────────

export type MetricKey = "distanceM" | "durationSec" | "paceSecPerKm";
export type DatasetKey = "original" | "current" | "actual";

export interface MetricComparison {
  key: MetricKey;
  availableA: boolean;
  availableB: boolean;
  valueA: number | null;
  valueB: number | null;
  // B minus A — null whenever either side is unavailable, never a
  // fabricated 0 (AC11's "never enters trusted totals silently").
  absDiff: number | null;
  pctDiff: number | null;
}

const METRIC_KEYS: MetricKey[] = ["distanceM", "durationSec", "paceSecPerKm"];

// AC5: distance/duration/pace reuse the shared engine's already-computed
// totals verbatim — this function only subtracts two already-final numbers,
// it never re-derives them from raw activities/segments.
export function compareDataset(a: ReportDatasetMetrics, b: ReportDatasetMetrics): MetricComparison[] {
  return METRIC_KEYS.map(key => {
    const rawA = a[key];
    const rawB = b[key];
    const availableA = rawA !== undefined && rawA !== null;
    const availableB = rawB !== undefined && rawB !== null;
    const valueA = availableA ? (rawA as number) : null;
    const valueB = availableB ? (rawB as number) : null;
    const canDiff = availableA && availableB;
    const absDiff = canDiff ? valueB! - valueA! : null;
    const pctDiff = canDiff && valueA !== 0 ? (absDiff! / valueA!) * 100 : null;
    return { key, availableA, availableB, valueA, valueB, absDiff, pctDiff };
  });
}

// ── prominent incompatibility labeling (AC3) ────────────────────────────────

export interface CompatibilityIssue {
  code: "kind" | "range-mode" | "grouping" | "duration";
  messageKey: string;
  defaultMessage: string;
  values: Record<string, string | number>;
}

export function compatibilityIssues(a: ComparisonSide, b: ComparisonSide): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];

  if (a.identity.kind !== b.identity.kind) {
    issues.push({
      code: "kind", messageKey: "compareReports.issue.kind",
      defaultMessage: `Comparing a ${a.identity.kind} report with a ${b.identity.kind} report — grouping and identity fields differ in meaning.`,
      values: { kindA: a.identity.kind, kindB: b.identity.kind },
    });
  }

  if (a.identity.range !== b.identity.range) {
    issues.push({
      code: "range-mode", messageKey: "compareReports.issue.rangeMode",
      defaultMessage: `Report A uses ${a.identity.range}, Report B uses ${b.identity.range} — totals and denominators are not directly comparable.`,
      values: { rangeA: a.identity.range, rangeB: b.identity.range },
    });
  }

  if (a.identity.kind === "range" && b.identity.kind === "range" && a.identity.grouping !== b.identity.grouping) {
    issues.push({
      code: "grouping", messageKey: "compareReports.issue.grouping",
      defaultMessage: `Report A groups by ${a.identity.grouping}, Report B groups by ${b.identity.grouping}.`,
      values: { groupingA: a.identity.grouping ?? "", groupingB: b.identity.grouping ?? "" },
    });
  }

  const spanA = a.identity.dateSpanStart && a.identity.dateSpanEnd ? inclusiveDaySpan(a.identity.dateSpanStart, a.identity.dateSpanEnd) : null;
  const spanB = b.identity.dateSpanStart && b.identity.dateSpanEnd ? inclusiveDaySpan(b.identity.dateSpanStart, b.identity.dateSpanEnd) : null;
  if (spanA != null && spanB != null && spanA !== spanB) {
    issues.push({
      code: "duration", messageKey: "compareReports.issue.duration",
      defaultMessage: `Report A spans ${spanA} day(s), Report B spans ${spanB} day(s) — totals are not like-for-like.`,
      values: { spanA, spanB },
    });
  }

  return issues;
}

// ── HR / pause / stamina availability (AC8, AC10) ───────────────────────────
// Deliberately a pure "both present" gate, never a partial/blended reading —
// a "range" side's evidence is always null (see ComparisonSide's own note
// above), so any comparison touching a range side truthfully reports
// unavailable rather than fabricating coverage that was never computed.

export function pauseComparisonAvailable(a: ComparisonSide, b: ComparisonSide): boolean {
  return !!a.evidence?.pauses?.hasTrackData && !!b.evidence?.pauses?.hasTrackData;
}

export function hrComparisonAvailable(a: ComparisonSide, b: ComparisonSide): boolean {
  return a.evidence?.hr != null && b.evidence?.hr != null;
}

export function staminaComparisonAvailable(a: ComparisonSide, b: ComparisonSide): boolean {
  return a.evidence?.comparableStamina != null && b.evidence?.comparableStamina != null;
}

// AC "quality-workout comparisons remain separated by compatible workout
// type" — both sides must actually carry HRA-342 structured evidence (range
// kind only) with at least one session, never a single blended pace value.
export function qualityComparisonAvailable(a: ComparisonSide, b: ComparisonSide): boolean {
  return !!a.qualityEvidence && a.qualityEvidence.totalWorkouts > 0 && !!b.qualityEvidence && b.qualityEvidence.totalWorkouts > 0;
}
