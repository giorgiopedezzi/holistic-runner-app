/**
 * TrainingPlanAccordion.tsx (HRA-116)
 * Shared Section -> Week -> Day review/edit UI for the training-plan DSL
 * (docs/runplan-dsl.md) — built once so the template card (HRA-117) and the
 * instance card (HRA-118) don't each duplicate this nesting and its
 * computed totals. Pure component + computation only: takes already-built
 * `SectionView[]` (domain/runplan-aggregate.ts's builders) and edit
 * callbacks as props; it never calls generate/save/approve/delete/
 * instantiate itself — that's the two card Stories.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AccordionCard } from "./ui/AccordionCard";
import type { AggregateTotals, DayView, DistanceTotal, SectionView, WeekView } from "../domain/runplan-aggregate";

interface TrainingPlanAccordionProps {
  // The owning template's/instance's own name — substituted for the
  // implicit default section's display name (raw_dsl === ""), never written
  // back into the section's own stored name.
  ownerName: string;
  sections: SectionView[];
  onSectionEdit: (sectionIndex: number, patch: { name?: string; notes?: string }) => void;
  onWeekEdit: (sectionIndex: number, weekIndex: number, patch: { notes?: string }) => void;
  onDayEdit: (sectionIndex: number, weekIndex: number, dayIndex: number, patch: { dsl?: string; notes?: string }) => void;
  // HRA-118: an instance has no first-class Section/Week entities to rename
  // (each day just carries a denormalized section_name/week_number string) —
  // when true, Section name/note and Week note render as plain read-only
  // text instead of inputs. Day dsl/note stay editable regardless. Default
  // false (templates, HRA-117, remain fully editable at every level).
  readOnlySectionWeek?: boolean;
}

const inputClass = "hra-border-strong hra-bg-card hra-text-primary";

function fmtDistance(distance: DistanceTotal, t: (key: string, def: string, opts?: Record<string, unknown>) => string): string {
  const km = (distance.meters / 1000).toFixed(1);
  return distance.approximate
    ? t("runplan.accordion.distanceApprox", `~${km} km`, { km })
    : t("runplan.accordion.distance", `${km} km`, { km });
}

function TotalsLine({ totals }: { totals: AggregateTotals }) {
  const { t } = useTranslation();
  return (
    <div className="hra-text-secondary" style={{ fontSize: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
      <span>{t("runplan.accordion.totalDays", `${totals.totalDays} days`, { n: totals.totalDays })}</span>
      <span>{t("runplan.accordion.activeDays", `${totals.activeDays} active`, { n: totals.activeDays })}</span>
      <span>{t("runplan.accordion.runningDays", `${totals.runningDays} running`, { n: totals.runningDays })}</span>
      <span>{t("runplan.accordion.restDays", `${totals.restDays} rest`, { n: totals.restDays })}</span>
      <span>{fmtDistance(totals.distance, t)}</span>
    </div>
  );
}

function DayEditor({
  day, onEdit,
}: {
  day: DayView;
  onEdit: (patch: { dsl?: string; notes?: string }) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const title = `D${day.day}${day.suffix ?? ""}${day.needs_review ? " ⚠" : ""}`;

  return (
    <AccordionCard title={title} expanded={expanded} onToggle={() => setExpanded(v => !v)}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label className="hra-text-secondary" style={{ fontSize: 12 }}>
          {t("runplan.accordion.dslLabel", "Workout (DSL)")}
          <textarea
            className={inputClass}
            value={day.dsl}
            onChange={e => onEdit({ dsl: e.target.value })}
            rows={2}
            style={{ width: "100%", marginTop: 4, fontFamily: "monospace", fontSize: 12, padding: 6 }}
          />
        </label>
        <label className="hra-text-secondary" style={{ fontSize: 12 }}>
          {t("runplan.accordion.noteLabel", "Note")}
          <input
            className={inputClass}
            value={day.notes ?? ""}
            onChange={e => onEdit({ notes: e.target.value })}
            placeholder={t("runplan.accordion.notePlaceholder", "Optional note")}
            style={{ width: "100%", marginTop: 4, padding: 6 }}
          />
        </label>
        <div className="hra-text-secondary" style={{ fontSize: 12 }}>
          {fmtDistance(day.distance, t)}
        </div>
        {day.needs_review && day.warnings.length > 0 && (
          <ul className="hra-text-danger" style={{ fontSize: 12, margin: 0, paddingLeft: 18 }}>
            {day.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
        )}
        {day.needs_review && day.warnings.length === 0 && (
          <div className="hra-text-danger" style={{ fontSize: 12 }}>
            {t("runplan.accordion.needsReview", "This day needs review before it can be saved.")}
          </div>
        )}
      </div>
    </AccordionCard>
  );
}

function WeekEditor({
  week, onWeekEdit, onDayEdit, readOnlySectionWeek,
}: {
  week: WeekView;
  onWeekEdit: (patch: { notes?: string }) => void;
  onDayEdit: (dayIndex: number, patch: { dsl?: string; notes?: string }) => void;
  readOnlySectionWeek: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <AccordionCard title={t("runplan.accordion.weekTitle", `Week ${week.number}`, { n: week.number })} expanded={expanded} onToggle={() => setExpanded(v => !v)}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <TotalsLine totals={week.totals} />
        {readOnlySectionWeek ? (
          week.notes && <div className="hra-text-secondary" style={{ fontSize: 12 }}>{week.notes}</div>
        ) : (
          <label className="hra-text-secondary" style={{ fontSize: 12 }}>
            {t("runplan.accordion.noteLabel", "Note")}
            <input
              className={inputClass}
              value={week.notes ?? ""}
              onChange={e => onWeekEdit({ notes: e.target.value })}
              placeholder={t("runplan.accordion.notePlaceholder", "Optional note")}
              style={{ width: "100%", marginTop: 4, padding: 6 }}
            />
          </label>
        )}
        {week.days.map((day, dayIndex) => (
          <DayEditor key={dayIndex} day={day} onEdit={patch => onDayEdit(dayIndex, patch)} />
        ))}
      </div>
    </AccordionCard>
  );
}

function SectionEditor({
  section, ownerName, onSectionEdit, onWeekEdit, onDayEdit, readOnlySectionWeek,
}: {
  section: SectionView;
  ownerName: string;
  onSectionEdit: (patch: { name?: string; notes?: string }) => void;
  onWeekEdit: (weekIndex: number, patch: { notes?: string }) => void;
  onDayEdit: (weekIndex: number, dayIndex: number, patch: { dsl?: string; notes?: string }) => void;
  readOnlySectionWeek: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  // raw_dsl === "" means two different things depending on mode: for a
  // template, "the implicit default section — no real SECTION line exists,
  // show the owner's name instead" (HRA-116); for an instance (always
  // readOnlySectionWeek, HRA-118), every section lacks raw_dsl by
  // construction (plan_instance_days has no header text at all) even though
  // section.name is a real, meaningful denormalized value — so the
  // owner-name substitution only applies in template mode.
  const isDefaultSection = !readOnlySectionWeek && section.raw_dsl === "";
  const displayName = isDefaultSection ? ownerName : section.name;

  return (
    <AccordionCard title={displayName} expanded={expanded} onToggle={() => setExpanded(v => !v)}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <TotalsLine totals={section.totals} />
        {isDefaultSection ? (
          <div className="hra-text-muted" style={{ fontSize: 12 }}>
            {t("runplan.accordion.defaultSectionName", `Name follows the plan's own name — ${ownerName}`, { name: ownerName })}
          </div>
        ) : readOnlySectionWeek ? (
          <div className="hra-text-primary" style={{ fontSize: 13, fontWeight: 600 }}>{section.name}</div>
        ) : (
          <label className="hra-text-secondary" style={{ fontSize: 12 }}>
            {t("runplan.accordion.sectionNameLabel", "Section name")}
            <input
              className={inputClass}
              value={section.name}
              onChange={e => onSectionEdit({ name: e.target.value })}
              style={{ width: "100%", marginTop: 4, padding: 6 }}
            />
          </label>
        )}
        {readOnlySectionWeek ? (
          section.notes && <div className="hra-text-secondary" style={{ fontSize: 12 }}>{section.notes}</div>
        ) : (
          <label className="hra-text-secondary" style={{ fontSize: 12 }}>
            {t("runplan.accordion.noteLabel", "Note")}
            <input
              className={inputClass}
              value={section.notes ?? ""}
              onChange={e => onSectionEdit({ notes: e.target.value })}
              placeholder={t("runplan.accordion.notePlaceholder", "Optional note")}
              style={{ width: "100%", marginTop: 4, padding: 6 }}
            />
          </label>
        )}
        {section.weeks.map((week, weekIndex) => (
          <WeekEditor
            key={weekIndex}
            week={week}
            onWeekEdit={patch => onWeekEdit(weekIndex, patch)}
            onDayEdit={(dayIndex, patch) => onDayEdit(weekIndex, dayIndex, patch)}
            readOnlySectionWeek={readOnlySectionWeek}
          />
        ))}
      </div>
    </AccordionCard>
  );
}

export function TrainingPlanAccordion({ ownerName, sections, onSectionEdit, onWeekEdit, onDayEdit, readOnlySectionWeek = false }: TrainingPlanAccordionProps) {
  return (
    <div>
      {sections.map((section, sectionIndex) => (
        <SectionEditor
          key={sectionIndex}
          section={section}
          ownerName={ownerName}
          onSectionEdit={patch => onSectionEdit(sectionIndex, patch)}
          onWeekEdit={(weekIndex, patch) => onWeekEdit(sectionIndex, weekIndex, patch)}
          onDayEdit={(weekIndex, dayIndex, patch) => onDayEdit(sectionIndex, weekIndex, dayIndex, patch)}
          readOnlySectionWeek={readOnlySectionWeek}
        />
      ))}
    </div>
  );
}
