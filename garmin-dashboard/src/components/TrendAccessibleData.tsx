/**
 * TrendAccessibleData.tsx  (HRA-310)
 *
 * The non-visual accessible alternative to a Sport trend chart (OverviewTab's
 * SportTrendChart / SportTrendOverlapChart): a concise always-present summary
 * plus a visible, keyboard/touch-operable "View data" disclosure revealing a
 * semantic table of the same grouped current/comparison data the chart
 * plots.
 *
 * Deliberately built from the same OverlapPoint[] the chart itself renders
 * (domain/trends.ts's buildOverlapPoints, already unit-scaled by the caller
 * — see SportTrendPair's scaledOverlap) rather than from the chart's visual
 * composition: HRA-309 (this Story's own declared dependency) left several
 * visual states — tooltip clamping, non-color comparison differentiation,
 * explicit empty/one-activity/missing-metric visuals — unfinished/TODO. The
 * underlying data contract (HRA-255 null propagation, HRA-256 semantic "All")
 * is already correct and stable regardless, so this component reads that
 * contract directly instead of assuming a finished visual composition it
 * cannot rely on yet.
 */
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { GroupMode, OverlapPoint } from "@/domain/trends";
import { fmtMinSecRaw } from "@/utils/fmt";

export interface TrendAccessibleSeriesVisible { distance: boolean; avgPace: boolean; avgHr: boolean }

interface TrendAccessibleDataProps {
  sport: string;
  mode: GroupMode;
  periodLabel: string;
  compareEnabled: boolean;
  comparePeriodLabel?: string;
  // Already unit-scaled (imperial/swim-per-100m), same values the chart
  // itself plots — see SportTrendPair's scaledOverlap.
  points: OverlapPoint[];
  // Period-total activity counts (always real integers, 0 for a genuinely
  // empty period — HRA-255) — kept separate from each row's own
  // currentCount/compareCount (which is null when a given grouping slot has
  // no activities on that side at all, a different case from "the whole
  // period is empty").
  currentCount: number;
  compareCount: number;
  // Which series the chart currently RENDERS (HRA-308's phone-only series
  // toggle) — a series hidden from the visual plot stays fully present in
  // this table; only its column header gets a "hidden from chart" note
  // (AC4: identified as hidden from the plot, never as absent from the
  // dataset).
  seriesVisible: TrendAccessibleSeriesVisible;
  distanceUnit: string;
  paceUnit: string;
}

const GROUP_MODE_FALLBACK: Record<GroupMode, string> = { single: "By activity", week: "By week", month: "By month" };

export function TrendAccessibleData({
  sport, mode, periodLabel, compareEnabled, comparePeriodLabel,
  points, currentCount, compareCount, seriesVisible, distanceUnit, paceUnit,
}: TrendAccessibleDataProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  const unavailable = t("overview.accessibleData.unavailable", "unavailable");
  const groupLabel = t(`overview.group.${mode}`, GROUP_MODE_FALLBACK[mode]);
  const sportLabel = t(`sport.${sport}`, sport.charAt(0).toUpperCase() + sport.slice(1));

  const fmtDistance = (v: number | null) => (v == null ? unavailable : `${v.toFixed(1)} ${distanceUnit}`);
  const fmtPaceCell = (v: number | null) => (v == null ? unavailable : `${fmtMinSecRaw(v)}${paceUnit}`);
  const fmtHr = (v: number | null) => (v == null ? unavailable : `${Math.round(v)} bpm`);
  const fmtCount = (v: number | null) => (v == null ? unavailable : String(v));

  // Distance is always a real computed sum (0 at worst, never null — see
  // TrendPoint.totalKm), so it's always "available"; pace/HR are only
  // available when at least one row (either side) actually has a value —
  // never fabricated from an empty series.
  const avgPaceAvailable = points.some(p => p.currentPace != null || p.comparePace != null);
  const avgHrAvailable = points.some(p => p.currentHr != null || p.compareHr != null);

  const hiddenNote = (visible: boolean) =>
    visible ? "" : ` (${t("overview.accessibleData.hiddenFromChart", "hidden from chart")})`;

  const summaryParts = [
    t("overview.accessibleData.summaryPeriod", `${sportLabel} · ${periodLabel} · grouped ${groupLabel} · ${currentCount} activities`,
      { sport: sportLabel, period: periodLabel, group: groupLabel, count: currentCount }),
  ];
  if (compareEnabled && comparePeriodLabel) {
    summaryParts.push(
      t("overview.accessibleData.summaryCompare", `compared to ${comparePeriodLabel} (${compareCount} activities)`,
        { period: comparePeriodLabel, count: compareCount }),
    );
  }
  const available = t("overview.accessibleData.available", "available");
  const paceAvailability = avgPaceAvailable ? available : unavailable;
  const hrAvailability = avgHrAvailable ? available : unavailable;
  summaryParts.push(
    t("overview.accessibleData.summarySeries",
      `Distance ${available}. Avg pace ${paceAvailability}. Avg HR ${hrAvailability}.`,
      { pace: paceAvailability, hr: hrAvailability }),
  );

  const viewDataLabel = t("overview.accessibleData.viewData", "View data");
  const hideDataLabel = t("overview.accessibleData.hideData", "Hide data");

  return (
    <div className="hra-trend-accessible-data mb-3">
      {/* AC1 — always present, independent of expand state and of whichever
          visual chart state (current-only/overlay/separate/empty/one
          activity/partial metric/hidden series) is currently showing. */}
      <p className="hra-text-secondary text-meta">{summaryParts.join(" ")}</p>

      {/* AC2 — a real <button>, so keyboard (Enter/Space) and touch
          operability, a programmatic expanded/collapsed state
          (aria-expanded/aria-controls) and the app-wide :focus-visible ring
          (index.css) all come for free from the native element; min-h-11/
          min-w-11 (Tailwind's 44px token) guarantees the touch target. */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded(v => !v)}
        className="hra-row-inline gap-1.5 min-h-11 min-w-11 px-2 text-label font-semibold hra-text-primary"
      >
        <ChevronDown size={16} aria-hidden="true" className={expanded ? "rotate-180" : undefined} />
        {expanded ? hideDataLabel : viewDataLabel}
      </button>

      {expanded && (
        <div id={panelId} className="overflow-x-auto mt-2">
          <table className="w-full border-collapse text-meta">
            <caption className="sr-only">
              {t("overview.accessibleData.tableCaption",
                `${sportLabel} data by ${groupLabel.toLowerCase()}${compareEnabled ? ", current vs comparison" : ""}`,
                { sport: sportLabel, group: groupLabel.toLowerCase() })}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="hra-text-muted hra-border-bottom py-1.5 px-2 text-left">{t("overview.accessibleData.colPeriod", "Period")}</th>
                <th scope="col" className="hra-text-muted hra-border-bottom py-1.5 px-2 text-right">{t("overview.accessibleData.colActivities", "Activities")}</th>
                <th scope="col" className="hra-text-muted hra-border-bottom py-1.5 px-2 text-right">{t("overview.stat.distance", "Distance")}{hiddenNote(seriesVisible.distance)}</th>
                <th scope="col" className="hra-text-muted hra-border-bottom py-1.5 px-2 text-right">{t("overview.stat.avgPace", "Avg pace")}{hiddenNote(seriesVisible.avgPace)}</th>
                <th scope="col" className="hra-text-muted hra-border-bottom py-1.5 px-2 text-right">{t("overview.stat.avgHr", "Avg HR")}{hiddenNote(seriesVisible.avgHr)}</th>
              </tr>
            </thead>
            <tbody>
              {points.length === 0 ? (
                <tr>
                  <td colSpan={5} className="hra-text-secondary py-1.25 px-2">{t("overview.accessibleData.noGroups", "No grouped data for this period.")}</td>
                </tr>
              ) : points.map(p => {
                const rowLabel = p.currentLabel ?? p.compareLabel ?? "—";
                const compareLabelSuffix = compareEnabled && p.compareLabel != null && p.compareLabel !== p.currentLabel
                  ? ` (${t("overview.accessibleData.compareShort", "compare")}: ${p.compareLabel})`
                  : "";
                const cell = (curText: string, cmpText: string) =>
                  compareEnabled ? `${curText} · ${t("overview.accessibleData.compareShort", "compare")} ${cmpText}` : curText;
                return (
                  <tr key={p.slot}>
                    <th scope="row" className="hra-text-primary hra-border-bottom py-1.25 px-2 text-left font-normal">{rowLabel}{compareLabelSuffix}</th>
                    <td className="hra-text-secondary hra-border-bottom py-1.25 px-2 text-right">{cell(fmtCount(p.currentCount), fmtCount(p.compareCount))}</td>
                    <td className="hra-text-secondary hra-border-bottom py-1.25 px-2 text-right">{cell(fmtDistance(p.currentKm), fmtDistance(p.compareKm))}</td>
                    <td className="hra-text-secondary hra-border-bottom py-1.25 px-2 text-right">{cell(fmtPaceCell(p.currentPace), fmtPaceCell(p.comparePace))}</td>
                    <td className="hra-text-secondary hra-border-bottom py-1.25 px-2 text-right">{cell(fmtHr(p.currentHr), fmtHr(p.compareHr))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
