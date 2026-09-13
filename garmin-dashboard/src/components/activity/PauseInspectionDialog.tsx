import { useTranslation } from "react-i18next";
import { ListOrdered } from "lucide-react";
import { Sheet, SheetTrigger, SheetContent } from "@/components/ui";
import { useIsPhone } from "@/hooks/useIsPhone";
import { fmtDuration, fmtKm } from "@/utils/fmt";
import { fmtPauseDuration, type PauseInspectionRow } from "@/domain/pauses";

interface PauseInspectionDialogProps {
  rows: PauseInspectionRow[];
}

// HRA-311: "Pauses (N)" — a read-only, always-current inspection of the same
// pause/HR-recovery collection the chart already renders (`rows` comes
// straight from ActivityDetailBody's own `buildPauseInspectionRows(track,
// pauses)` memo, not a copy computed in here), so opening/closing it can
// never touch replay state or drift from the chart's own pause/anomaly
// settings. Desktop renders a compact semantic <table>; phone reflows into
// plain `.hra-fact-row` rows (Container budget rule, .claude/rules/
// frontend.md) — divider-separated typography, no nested per-pause cards.
//
// HRA-337: also reused, unmodified, by WorkoutReportModal — the single-
// workout report maps its own backend-computed WorkoutPauseDetail[] into
// this exact PauseInspectionRow[] shape so pause inspection never has a
// second UI. elapsed position + stamina context (AC7) and recorded/inferred
// provenance (AC8) were added to PauseInspectionRow itself so both callers
// get them for free.
export function PauseInspectionDialog({ rows }: PauseInspectionDialogProps) {
  const { t } = useTranslation();
  const isPhone = useIsPhone();
  if (rows.length === 0) return null;

  const triggerLabel = t("activity.pauseDialog.trigger", `Pauses (${rows.length})`, { count: rows.length });
  const unavailable = t("activity.pauseDialog.unavailable", "Unavailable");

  function hrRecoveryText(row: PauseInspectionRow): string {
    if (row.hrBefore == null || row.hrAfter == null || row.hrDelta == null) return unavailable;
    // Same magnitude/sign convention ActivityChartSection's own sr-only HR
    // recovery list already uses: a drop (delta > 0, before minus after) —
    // the HR actually recovering — reads as "−", a rise as "+".
    const sign = row.hrDelta > 0 ? "−" : row.hrDelta < 0 ? "+" : "±";
    const delta = `${sign}${Math.abs(Math.round(row.hrDelta))}`;
    return t("activity.pauseDialog.hrRecoveryValue", `${row.hrBefore} → ${row.hrAfter} bpm · ${delta} bpm`,
      { before: row.hrBefore, after: row.hrAfter, delta });
  }

  function staminaText(row: PauseInspectionRow): string {
    if (row.staminaBefore == null || row.staminaAfter == null) return unavailable;
    return t("activity.pauseDialog.staminaValue", `${row.staminaBefore} → ${row.staminaAfter}`,
      { before: row.staminaBefore, after: row.staminaAfter });
  }

  function provenanceText(row: PauseInspectionRow): string {
    return row.recorded
      ? t("activity.pauseDialog.provenanceRecorded", "Recorded")
      : t("activity.pauseDialog.provenanceInferred", "Inferred");
  }

  return (
    <Sheet>
      <SheetTrigger className="hra-chip-action hra-border-strong hra-text-secondary text-label rounded-full bg-transparent cursor-pointer flex items-center gap-1.5">
        <ListOrdered size={14} aria-hidden="true" />
        {triggerLabel}
      </SheetTrigger>
      <SheetContent title={t("activity.pauseDialog.title", "Pauses")} variant="dialog">
        {isPhone ? (
          <div>
            {rows.map((row, i) => (
              <div key={row.afterIndex} className="hra-fact-row">
                <div className="hra-fact-row-stat">
                  <span className="hra-fact-row-stat-label">{t("activity.pauseDialog.rowLabel", `Pause ${i + 1}`, { n: i + 1 })}</span>
                  <span className="hra-fact-row-stat-values hra-text-primary text-data">{fmtPauseDuration(row.durationSec)}</span>
                </div>
                <div className="hra-fact-row-stat">
                  <span className="hra-fact-row-stat-label">{t("activity.pauseDialog.colElapsed", "At")}</span>
                  <span className="hra-fact-row-stat-values hra-text-secondary text-meta">{fmtDuration(row.elapsedSec)}</span>
                </div>
                <div className="hra-fact-row-stat">
                  <span className="hra-fact-row-stat-label">{t("activity.pauseDialog.colDistance", "Distance")}</span>
                  <span className="hra-fact-row-stat-values hra-text-secondary text-meta">{fmtKm(row.distanceM)}</span>
                </div>
                <div className="hra-fact-row-stat">
                  <span className="hra-fact-row-stat-label">{t("activity.pauseDialog.colHrRecovery", "HR recovery")}</span>
                  <span className="hra-fact-row-stat-values hra-text-secondary text-meta">{hrRecoveryText(row)}</span>
                </div>
                <div className="hra-fact-row-stat">
                  <span className="hra-fact-row-stat-label">{t("activity.pauseDialog.colStamina", "Stamina")}</span>
                  <span className="hra-fact-row-stat-values hra-text-secondary text-meta">{staminaText(row)}</span>
                </div>
                <div className="hra-fact-row-stat">
                  <span className="hra-fact-row-stat-label">{t("activity.pauseDialog.colProvenance", "Source")}</span>
                  <span className="hra-fact-row-stat-values hra-text-secondary text-meta">{provenanceText(row)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <table className="w-full border-collapse text-meta">
            <caption className="sr-only">{t("activity.pauseDialog.title", "Pauses")}</caption>
            <thead>
              <tr>
                <th scope="col" className="hra-text-muted hra-border-bottom py-1.5 px-2 text-left">{t("activity.pauseDialog.colNumber", "#")}</th>
                <th scope="col" className="hra-text-muted hra-border-bottom py-1.5 px-2 text-right">{t("activity.pauseDialog.colElapsed", "At")}</th>
                <th scope="col" className="hra-text-muted hra-border-bottom py-1.5 px-2 text-right">{t("activity.pauseDialog.colDuration", "Duration")}</th>
                <th scope="col" className="hra-text-muted hra-border-bottom py-1.5 px-2 text-right">{t("activity.pauseDialog.colDistance", "Distance")}</th>
                <th scope="col" className="hra-text-muted hra-border-bottom py-1.5 px-2 text-right">{t("activity.pauseDialog.colHrRecovery", "HR recovery")}</th>
                <th scope="col" className="hra-text-muted hra-border-bottom py-1.5 px-2 text-right">{t("activity.pauseDialog.colStamina", "Stamina")}</th>
                <th scope="col" className="hra-text-muted hra-border-bottom py-1.5 px-2 text-right">{t("activity.pauseDialog.colProvenance", "Source")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.afterIndex}>
                  <th scope="row" className="hra-text-primary hra-border-bottom py-1.25 px-2 text-left font-normal">{i + 1}</th>
                  <td className="hra-text-secondary hra-border-bottom py-1.25 px-2 text-right">{fmtDuration(row.elapsedSec)}</td>
                  <td className="hra-text-secondary hra-border-bottom py-1.25 px-2 text-right">{fmtPauseDuration(row.durationSec)}</td>
                  <td className="hra-text-secondary hra-border-bottom py-1.25 px-2 text-right">{fmtKm(row.distanceM)}</td>
                  <td className="hra-text-secondary hra-border-bottom py-1.25 px-2 text-right">{hrRecoveryText(row)}</td>
                  <td className="hra-text-secondary hra-border-bottom py-1.25 px-2 text-right">{staminaText(row)}</td>
                  <td className="hra-text-secondary hra-border-bottom py-1.25 px-2 text-right">{provenanceText(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SheetContent>
    </Sheet>
  );
}
