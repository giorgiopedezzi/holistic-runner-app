/**
 * TrainingPlanAccordion.tsx (HRA-116, follow-up UX pass)
 * Shared Section -> Week -> Day review/edit UI for the training-plan DSL
 * (docs/runplan-dsl.md) — built once so the template card (HRA-117) and the
 * instance card (HRA-118) don't each duplicate this nesting and its
 * computed totals. Pure component + computation only: takes already-built
 * `SectionView[]` (domain/runplan-aggregate.ts's builders) and edit
 * callbacks as props; it never calls generate/save/approve/delete/
 * instantiate itself — that's the two card Stories.
 *
 * Title-bar summary (follow-up): the computed totals, a note tooltip icon
 * (if a note exists), and a warning badge (if any descendant day needs
 * review) all render in the ALWAYS-VISIBLE title row, not just when
 * expanded — so reviewing a plan only requires opening an accordion level
 * when you actually want to edit it. Week/Section "has warnings" is
 * derived by walking children (any day -> any week -> any section), never
 * stored, matching docs/runplan-dsl.md's own documented rule for this.
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

type Translate = (key: string, def: string, opts?: Record<string, unknown>) => string;

const inputClass = "hra-border-strong hra-bg-card hra-text-primary";

function fmtDistance(distance: DistanceTotal, t: Translate): string {
  const km = (distance.meters / 1000).toFixed(1);
  return distance.approximate
    ? t("runplan.accordion.distanceApprox", `~${km} km`, { km })
    : t("runplan.accordion.distance", `${km} km`, { km });
}

// Same figures TotalsLine used to render only inside the expanded body —
// now joined into one compact string for the always-visible title row.
function compactTotals(totals: AggregateTotals, t: Translate): string {
  return [
    t("runplan.accordion.totalDays", `${totals.totalDays} days`, { n: totals.totalDays }),
    t("runplan.accordion.activeDays", `${totals.activeDays} active`, { n: totals.activeDays }),
    t("runplan.accordion.runningDays", `${totals.runningDays} running`, { n: totals.runningDays }),
    t("runplan.accordion.restDays", `${totals.restDays} rest`, { n: totals.restDays }),
    fmtDistance(totals.distance, t),
  ].join(" · ");
}

function weekHasWarnings(week: WeekView): boolean {
  return week.days.some(d => d.needs_review);
}
function sectionHasWarnings(section: SectionView): boolean {
  return section.weeks.some(weekHasWarnings);
}

function WarningBadge({ t }: { t: Translate }) {
  return (
    <span className="hra-text-danger" style={{ fontSize: 12 }} title={t("runplan.accordion.needsReviewBadge", "Needs review")}>
      ⚠
    </span>
  );
}

function NoteIcon({ note }: { note?: string }) {
  if (!note) return null;
  return (
    <span className="hra-tooltip hra-text-muted" data-tooltip={note} style={{ fontSize: 12, cursor: "help" }}>
      ⓘ
    </span>
  );
}

// The shared title-row shape every level uses: a truncating label on the
// left, a compact summary + optional warning/note icons on the right —
// both inside AccordionCard's own title slot, so it's visible whether the
// level is expanded or not.
function TitleRow({ label, summary, hasWarning, note, t }: {
  label: string; summary?: string; hasWarning?: boolean; note?: string; t: Translate;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flex: 1, gap: 10, minWidth: 0 }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span className="hra-text-secondary" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 400, flexShrink: 0 }}>
        {summary}
        {hasWarning && <WarningBadge t={t} />}
        <NoteIcon note={note} />
      </span>
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
  // day.dsl is already the whole raw line ("D3: 5km @ RG") — using it
  // directly as the label (ellipsis-truncated by TitleRow) reports the
  // actual workout at a glance, instead of a redundant bare "D3".
  return (
    <AccordionCard
      title={<TitleRow label={day.dsl} summary={fmtDistance(day.distance, t)} hasWarning={day.needs_review} note={day.notes} t={t} />}
      expanded={expanded} onToggle={() => setExpanded(v => !v)}
    >
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
  const label = t("runplan.accordion.weekTitle", `Week ${week.number}`, { n: week.number });

  return (
    <AccordionCard
      title={<TitleRow label={label} summary={compactTotals(week.totals, t)} hasWarning={weekHasWarnings(week)} note={week.notes} t={t} />}
      expanded={expanded} onToggle={() => setExpanded(v => !v)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {!readOnlySectionWeek && (
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
    <AccordionCard
      title={<TitleRow label={displayName} summary={compactTotals(section.totals, t)} hasWarning={sectionHasWarnings(section)} note={isDefaultSection ? undefined : section.notes} t={t} />}
      expanded={expanded} onToggle={() => setExpanded(v => !v)}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {isDefaultSection ? (
          <div className="hra-text-muted" style={{ fontSize: 12 }}>
            {t("runplan.accordion.defaultSectionName", `Name follows the plan's own name — ${ownerName}`, { name: ownerName })}
          </div>
        ) : !readOnlySectionWeek && (
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
        {!isDefaultSection && !readOnlySectionWeek && (
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
