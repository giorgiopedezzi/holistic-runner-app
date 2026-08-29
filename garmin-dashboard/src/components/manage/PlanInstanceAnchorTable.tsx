/**
 * PlanInstanceAnchorTable.tsx (HRA-168, extracted from PlanInstancesSection.tsx)
 * The anchor-override resolution table (Absolute / Relative / ± / Seconds /
 * Status columns) from the unified instantiate/edit plan screen — a
 * self-contained, prop-driven JSX block with no state of its own; every
 * mutation goes back up through the 5 callback props into
 * PlanInstancesSection's own anchorRows state.
 */
import { Badge, Select } from "@/components/ui";
import { useTranslation } from "react-i18next";
import type { AnchorRowState } from "@/components/manage/PlanInstancesSection";

function anchorRowIsEmpty(row: AnchorRowState): boolean {
  return row.absoluteValue.trim() === "" && row.relativeTo === "" && row.seconds.trim() === "";
}

function formatPaceSecPerKm(sec: number): string {
  const total = Math.round(sec);
  const min = Math.floor(total / 60);
  const s = total % 60;
  return `${min}:${String(s).padStart(2, "0")}/km`;
}

interface Props {
  templateAnchors: string[];
  anchorRows: Record<string, AnchorRowState>;
  resolution: { anchor: string; secPerKm: number | null }[];
  racePaceAnchor: string;
  paceMode: "anchor" | "goalTime";
  derivedPaceSecPerKm: number | null;
  fieldDisabled: boolean;
  unresolvedAnchors: string[];
  formEnabled: boolean;
  setAnchorAbsolute: (anchor: string, value: string) => void;
  setAnchorRelativeTo: (anchor: string, value: string) => void;
  setAnchorSign: (anchor: string, sign: "+" | "-") => void;
  setAnchorSeconds: (anchor: string, value: string) => void;
  clearAnchorRow: (anchor: string) => void;
}

export function PlanInstanceAnchorTable({
  templateAnchors, anchorRows, resolution, racePaceAnchor, paceMode, derivedPaceSecPerKm,
  fieldDisabled, unresolvedAnchors, formEnabled,
  setAnchorAbsolute, setAnchorRelativeTo, setAnchorSign, setAnchorSeconds, clearAnchorRow,
}: Props) {
  const { t } = useTranslation();
  const hasRacePaceAnchor = racePaceAnchor !== "__none__";

  return (
    <>
      {templateAnchors.length === 0 ? (
        <div className="hra-text-muted text-meta mb-3" >
          {formEnabled
            ? t("manage.planInstances.resolutionEmpty", "This template references no symbolic pace anchors — nothing to resolve.")
            : t("manage.planInstances.resolutionNoTemplate", "Pick a template above to see its pace anchors.")}
        </div>
      ) : (
        <div className="hra-anchor-table-wrap mb-2" >
          <table className="hra-anchor-table">
            <thead>
              <tr>
                <th rowSpan={2} className="align-bottom">{t("manage.planInstances.colAnchor", "Anchor")}</th>
                <th className="hra-anchor-group hra-anchor-group-start">{t("manage.planInstances.colAbsolute", "Absolute")}</th>
                {/* colSpan 4 (was 3): the Clear column folds into the Relative
                    group visually — its own sub-header cell below has no
                    label of its own, same blank-cell pattern the old
                    standalone rowSpan=2 <th> used, just now living in the
                    sub-row instead of spanning both. */}
                <th className="hra-anchor-group hra-anchor-group-start" colSpan={4}>{t("manage.planInstances.colRelative", "Relative")}</th>
                <th rowSpan={2} className="align-bottom hra-anchor-status-header">{t("manage.planInstances.colStatus", "Status")}</th>
              </tr>
              <tr className="hra-anchor-sub">
                <th className="hra-anchor-group-start">{t("manage.planInstances.colPace", "Pace")}</th>
                <th className="hra-anchor-group-start">{t("manage.planInstances.policyRelativeToLabel", "Relative to")}</th>
                <th>{t("manage.planInstances.colSign", "±")}</th>
                <th>{t("manage.planInstances.policySecondsLabel", "Seconds")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templateAnchors.map(anchor => {
                const derived = hasRacePaceAnchor && paceMode === "goalTime" && anchor === racePaceAnchor;
                const row = anchorRows[anchor] ?? { absoluteValue: "", relativeTo: "", sign: "+" as const, seconds: "" };
                const relativeDisabled = derived || fieldDisabled || row.absoluteValue.trim() !== "";
                const absoluteDisabled = derived || fieldDisabled || row.relativeTo !== "" || row.seconds.trim() !== "";
                const resolved = resolution.find(r => r.anchor === anchor)?.secPerKm ?? null;
                return (
                  <tr key={anchor}>
                    <td className="hra-anchor-name">
                      {anchor}
                      {anchor === racePaceAnchor && (
                        <span className="hra-anchor-tag">{t("manage.planInstances.racePaceTag", "(race pace)")}</span>
                      )}
                    </td>
                    <td className="hra-anchor-group-start">
                      {derived ? (
                        derivedPaceSecPerKm != null ? (
                          <>
                            {formatPaceSecPerKm(derivedPaceSecPerKm)}
                            <span className="hra-anchor-tag">{t("manage.planInstances.derivedFromGoalTime", "(from goal time)")}</span>
                          </>
                        ) : (
                          <span className="hra-anchor-derived">—</span>
                        )
                      ) : row.relativeTo !== "" && resolved != null ? (
                        <>
                          {formatPaceSecPerKm(resolved)}
                          <span className="hra-anchor-tag">{t("manage.planInstances.resolvedFromRelative", "(resolved)")}</span>
                        </>
                      ) : (
                        <input type="text" className="hra-border-strong hra-bg-card hra-text-primary w-full" value={row.absoluteValue} onChange={e => setAnchorAbsolute(anchor, e.target.value)} disabled={absoluteDisabled} placeholder={t("manage.planInstances.anchorAbsolutePlaceholder", "e.g. 5:10/km")} />
                      )}
                    </td>
                    <td className="hra-anchor-group-start">
                      <Select
                        value={row.relativeTo} onValueChange={v => setAnchorRelativeTo(anchor, v)}
                        options={templateAnchors.filter(a => a !== anchor).map(a => ({ value: a, label: a }))}
                        placeholder="—"
                        triggerClassName="w-full"
                        disabled={fieldDisabled}
                      />
                    </td>
                    <td>
                      <div className="hra-segment">
                        <button className="hra-segment-item" data-active={row.sign === "+"} disabled={relativeDisabled} onClick={() => setAnchorSign(anchor, "+")}>+</button>
                        <button className="hra-segment-item" data-active={row.sign === "-"} disabled={relativeDisabled} onClick={() => setAnchorSign(anchor, "-")}>−</button>
                      </div>
                    </td>
                    <td>
                      <input className="hra-border-strong hra-bg-card hra-text-primary w-full" value={row.seconds} onChange={e => setAnchorSeconds(anchor, e.target.value)} disabled={relativeDisabled} type="number" placeholder="—" />
                    </td>
                    <td className="hra-anchor-clear-cell">
                      <button
                        className="hra-tight-action hra-border-strong hra-text-secondary bg-transparent text-meta cursor-pointer"
                        disabled={derived || fieldDisabled || anchorRowIsEmpty(row)}
                        onClick={() => clearAnchorRow(anchor)}
                      >
                        {t("manage.planInstances.clearButton", "Clear")}
                      </button>
                    </td>
                    <td className="hra-anchor-status-cell">
                      <Badge
                        label={resolved != null ? t("manage.planInstances.resolutionResolved", "Resolved") : t("manage.planInstances.resolutionUnresolved", "Unresolved")}
                        color={resolved != null ? "var(--accent-green)" : "var(--accent-red)"}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="hra-text-muted text-meta mb-3.5" >
        {t("manage.planInstances.tableFillHint", "Fill exactly one of Absolute or Relative per row — the other disables once you start typing.")}
      </div>

      <div className="hra-resolution-hint hra-plan-instance-section-gap text-meta" data-unresolved={unresolvedAnchors.length > 0}>
        {unresolvedAnchors.length > 0
          ? t("manage.planInstances.resolutionBlockedHint", "{{anchors}} still unresolved — fill in Absolute or Relative for it above before you can create the instance.", { anchors: unresolvedAnchors.join(", ") })
          : t("manage.planInstances.resolutionReadyHint", "Every anchor resolves — Create instance is ready.")}
      </div>
    </>
  );
}
