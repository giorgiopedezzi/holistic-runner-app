/**
 * PlanInstanceFormFields.tsx (HRA-169, extracted from PlanInstancesSection.tsx)
 * Rows 1-3 of the unified instantiate/edit plan screen — Identity (Template/
 * Name/Race name/Race date/Link a race), Timing (Start date/Days-before-race/
 * Rest day label + week-1-anchor warning), and Pace-mode (Race pace anchor/
 * Pace input/Goal time + distance override). One component covering all
 * three rows (splitting further would over-fragment ~120 lines of
 * near-identical field markup, per the Story's own scope) — flat
 * scalar/callback props only, no state or context of its own;
 * PlanInstancesSection.tsx keeps owning every underlying value.
 */
import { useTranslation } from "react-i18next";
import { DatePicker, Select } from "@/components/ui";
import { Field, NONE_ANCHOR } from "@/components/manage/PlanInstancesSection";
import type { PlanTemplate } from "@/types/api";

interface Props {
  // Row 1 — identity
  templates: PlanTemplate[] | null;
  templateId: string;
  onTemplateSelectChange: (id: string) => void;
  fieldsLocked: boolean;
  instName: string;
  setInstName: (v: string) => void;
  raceName: string;
  setRaceName: (v: string) => void;
  raceDate: string;
  onRaceDateChange: (v: string) => void;
  raceUrl: string;
  setRaceUrl: (v: string) => void;
  fieldDisabled: boolean;
  formEnabled: boolean;

  // Row 2 — timing
  startDate: string;
  onStartDateChange: (v: string) => void;
  daysBeforeRace: string;
  onDaysBeforeRaceChange: (v: string) => void;
  restDayLabel: string;
  setRestDayLabel: (v: string) => void;
  showWeek1AnchorWarning: boolean;

  // Row 3 — pace mode
  racePaceAnchor: string;
  onRacePaceAnchorChange: (v: string) => void;
  templateAnchors: string[];
  paceMode: "anchor" | "goalTime";
  setPaceMode: (v: "anchor" | "goalTime") => void;
  hasRacePaceAnchor: boolean;
  goalTimeDisplayValue: string;
  onGoalTimeInput: (raw: string) => void;
  equivalentGoalTimeSec: number | null;
  showDistanceOverride: boolean;
  distanceM: string;
  setDistanceM: (v: string) => void;
}

export function PlanInstanceFormFields({
  templates, templateId, onTemplateSelectChange, fieldsLocked,
  instName, setInstName, raceName, setRaceName, raceDate, onRaceDateChange, raceUrl, setRaceUrl,
  fieldDisabled, formEnabled,
  startDate, onStartDateChange, daysBeforeRace, onDaysBeforeRaceChange, restDayLabel, setRestDayLabel,
  showWeek1AnchorWarning,
  racePaceAnchor, onRacePaceAnchorChange, templateAnchors, paceMode, setPaceMode, hasRacePaceAnchor,
  goalTimeDisplayValue, onGoalTimeInput, equivalentGoalTimeSec, showDistanceOverride, distanceM, setDistanceM,
}: Props) {
  const { t } = useTranslation();

  return (
    <>
      {/* Row 1 — identity. Template gates the whole form below; Name is
          required; Race name/Race date/Link a race are independently
          optional. Equal-width grid, not ad hoc flex-basis guessing.
          HRA-133: same row whether creating fresh or viewing an existing
          instance — startEdit() populates every field from the instance's
          own persisted values, fieldsLocked/fieldDisabled just gate
          interactivity, not visibility (AC1's "same screen shape"). */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 6 }}>
        <Field label={t("manage.planInstances.templateLabel", "Template")} required>
          <Select
            value={templateId} onValueChange={onTemplateSelectChange}
            options={(templates ?? []).map(tpl => ({ value: String(tpl.id), label: tpl.name }))}
            placeholder={t("manage.planInstances.templatePlaceholder", "Pick a template…")}
            triggerStyle={{ width: "100%" }}
            disabled={fieldsLocked}
          />
        </Field>
        <Field label={t("manage.planTemplates.nameLabel", "Name")} required>
          <input type="text" className="hra-border-strong hra-bg-card hra-text-primary" value={instName} onChange={e => setInstName(e.target.value)} disabled={fieldDisabled} style={{ width: "100%", padding: "0 10px" }} />
        </Field>
        <Field label={t("manage.planInstances.raceNameLabel", "Race name")}>
          <input type="text" className="hra-border-strong hra-bg-card hra-text-primary" value={raceName} onChange={e => setRaceName(e.target.value)} disabled={fieldDisabled} placeholder={t("common.optional", "Optional")} style={{ width: "100%", padding: "0 10px" }} />
        </Field>
        <Field label={t("manage.planInstances.raceDateLabel", "Race date")}>
          <DatePicker value={raceDate} onChange={onRaceDateChange} disabled={fieldDisabled} />
        </Field>
        <Field label={t("manage.planInstances.linkRaceLabel", "Link a race")}>
          <input type="text" className="hra-border-strong hra-bg-card hra-text-primary" value={raceUrl} onChange={e => setRaceUrl(e.target.value)} disabled={fieldDisabled} placeholder={t("manage.planInstances.linkRacePlaceholder", "e.g. https://www.baa.org/races/boston-marathon")} style={{ width: "100%", padding: "0 10px" }} />
        </Field>
      </div>
      <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 16 }}>
        <span className="hra-text-danger">*</span> {t("manage.planInstances.requiredLegend", "required")}
        {!fieldsLocked && !formEnabled && <> — {t("manage.planInstances.pickTemplateFirst", "pick a Template above to enable the rest of this form.")}</>}
      </div>

      {/* Row 2 — timing. */}
      <div style={{ display: "grid", gridTemplateColumns: "160px 160px 220px", gap: 10, marginBottom: 6 }}>
        <Field label={t("manage.planInstances.startDateLabel", "Start date")}>
          <DatePicker value={startDate} onChange={onStartDateChange} disabled={fieldDisabled} />
        </Field>
        <Field label={t("manage.planInstances.daysBeforeRaceLabel", "Days before race")}>
          <input
            className="hra-border-strong hra-bg-card hra-text-primary"
            value={daysBeforeRace} onChange={e => onDaysBeforeRaceChange(e.target.value)}
            type="number" disabled={fieldDisabled || !raceDate}
            placeholder={raceDate ? undefined : t("manage.planInstances.daysBeforeRaceUnavailable", "Set a race date above")}
            style={{ width: "100%", padding: "0 10px" }}
          />
        </Field>
        <Field label={t("manage.planInstances.restDayLabelLabel", "Rest day label")}>
          <input
            className="hra-border-strong hra-bg-card hra-text-primary"
            value={restDayLabel} onChange={e => setRestDayLabel(e.target.value)}
            disabled={fieldDisabled} placeholder={t("manage.planInstances.restDayLabelPlaceholder", "e.g. Easy jog")}
            style={{ width: "100%", padding: "0 10px" }}
          />
        </Field>
      </div>
      <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 4 }}>
        {t("manage.planInstances.timingLinkHint", "🔗 Start date and Days before race are linked once Race date is set — editing either recomputes the other.")}
      </div>
      <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 16 }}>
        {t("manage.planInstances.restDayLabelHint", "Any day 1-7 the template doesn't declare for a week is auto-filled as a REST day carrying this label as its note.")}
      </div>
      {showWeek1AnchorWarning && (
        <div className="hra-text-warning" style={{ fontSize: 11, marginBottom: 16 }}>
          {t("manage.planInstances.week1AnchorWarning", "Start date doesn't land the plan's implied Monday on an actual Monday — the plan will still be created, but check your dates.")}
        </div>
      )}

      {/* Row 3 — pace: Race pace anchor + Pace input mode + Goal time all on
          one line (HRA-137 Ask #1). */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 24, marginBottom: 6 }}>
        <Field label={t("manage.planInstances.racePaceAnchorLabel", "Race pace anchor")}>
          <div className="hra-segment">
            {[NONE_ANCHOR, ...templateAnchors].map(a => (
              <button key={a} className="hra-segment-item" data-active={racePaceAnchor === a} disabled={fieldDisabled} onClick={() => onRacePaceAnchorChange(a)}>
                {a === NONE_ANCHOR ? t("manage.planInstances.racePaceAnchorNone", "None") : a}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t("manage.planInstances.paceLabel", "Pace input")}>
          <div className="hra-segment">
            <button className="hra-segment-item" data-active={paceMode === "goalTime"} disabled={fieldDisabled || !hasRacePaceAnchor} onClick={() => setPaceMode("goalTime")}>{t("manage.planInstances.goalTimeMode", "Goal time")}</button>
            <button className="hra-segment-item" data-active={paceMode === "anchor"} disabled={fieldDisabled} onClick={() => setPaceMode("anchor")}>{t("manage.planInstances.anchorMode", "Anchor override")}</button>
          </div>
        </Field>
        <Field label={t("manage.planInstances.goalTimeLabel", "Goal time")}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              className="hra-border-strong hra-bg-card hra-text-primary"
              value={goalTimeDisplayValue}
              onChange={e => onGoalTimeInput(e.target.value)}
              disabled={fieldDisabled || paceMode !== "goalTime"}
              inputMode="numeric" maxLength={8} style={{ width: 90 }}
              placeholder={t("manage.planInstances.goalTimePlaceholder", "HH:MM:SS")}
              aria-label={t("manage.planInstances.goalTimeAria", "Goal time (HH:MM:SS)")}
            />
            {paceMode === "anchor" && equivalentGoalTimeSec != null && (
              <span className="hra-anchor-tag">{t("manage.planInstances.goalTimeFromAnchor", "(from {{anchor}}'s pace)", { anchor: racePaceAnchor })}</span>
            )}
          </div>
        </Field>
      </div>
      <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 14 }}>
        {t("manage.planInstances.paceModeHint", "Goal time is only selectable while a race pace anchor is chosen — \"None\" forces Anchor override.")}
      </div>

      {hasRacePaceAnchor && paceMode === "goalTime" && showDistanceOverride && (
        <div style={{ marginBottom: 16 }}>
          <Field label={t("manage.planInstances.distanceLabel", "Distance (m) — optional override, defaults to the template's own distance")}>
            <input className="hra-border-strong hra-bg-card hra-text-primary" value={distanceM} onChange={e => setDistanceM(e.target.value)} disabled={fieldDisabled} type="number" style={{ width: 200, padding: "0 10px" }} placeholder={t("manage.planInstances.distancePlaceholder", "e.g. 21097")} />
          </Field>
        </div>
      )}
      {hasRacePaceAnchor && paceMode === "anchor" && (
        <div className="hra-text-muted" style={{ fontSize: 11, marginBottom: 16 }}>
          {t("manage.planInstances.anchorModeHint", "Set {{anchor}}'s pace directly in its row in the table below.", { anchor: racePaceAnchor })}
        </div>
      )}
    </>
  );
}
