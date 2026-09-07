/**
 * PlanTemplateWeekView.tsx (HRA-283)
 * PlanTemplatesSection's alternate week-at-a-time grid — visually modeled on
 * PlanInstanceCalendar's real Agenda, but with none of that view's date or
 * actual-workout machinery, since templates never have either (a template
 * day only ever has a D-number, never a calendar date). Pure component: it
 * never touches dsl_source itself — PlanTemplatesSection owns that (the same
 * "no API/patch wiring in this component" split TrainingPlanAccordion.tsx
 * already establishes for the List view).
 *
 * Reuses TrainingPlanAccordion's own TemplateDayRow verbatim for a declared
 * day (same collapsed title, same click-to-expand Structured/DSL editor, same
 * useDragSwap-based drag handle) — no new editing UI. An undeclared D-number
 * renders as a REST-day summary instead (the same icon/label this file's
 * sibling uses for a real REST day's Structured view); the first interaction
 * with it — opening it, or a drop landing on it — asks the caller to
 * materialize a real `D<n>: REST` line via onMaterializeDay, after which it
 * behaves as an ordinary declared day.
 */
import { useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { Bed, ChevronLeft, ChevronRight } from "lucide-react";
import { flattenWeeks, type SectionView } from "@/domain/runplan-aggregate";
import { TemplateDayRow, type DayRef, type EditedRef } from "@/components/TrainingPlanAccordion";
import type { OffsetUnit } from "@/types/runplan";

const DAY_NUMBERS = [1, 2, 3, 4, 5, 6, 7] as const;

interface Props {
  ownerName: string;
  sections: SectionView[];
  onDayEdit: (sectionIndex: number, weekIndex: number, dayIndex: number, patch: { dsl?: string; notes?: string }) => void;
  onDaySwap: (a: DayRef, b: DayRef) => void;
  // Materializes an undeclared D-number into a real `D<n>: REST` line —
  // `swapWith` is set only when the interaction that triggered it was a
  // drop (the dragged day's own ref), so the caller can also fold in the
  // usual swapDayContent exchange in the same update, moving the dragged
  // day's content into this now-real day and leaving REST behind at the
  // drag's own origin (AC5/AC6 — no new swap logic beyond swapDayContent
  // itself).
  onMaterializeDay: (sectionIndex: number, weekIndex: number, dayNumber: number, swapWith?: DayRef) => void;
  offsetUnit: OffsetUnit;
  highlightedRef?: EditedRef;
}

// Reuses the exact icon + i18n key TemplateDayRow's own Structured view shows
// for a real REST day (STATE_DAY_ICONS.rest / STATE_DAY_LABEL_KEYS.rest) —
// an undeclared slot is presented as "what this day will read as if you
// don't touch it," not a separate visual language.
function UndeclaredDaySlot({ onMaterialize }: { onMaterialize: (swapWith?: DayRef) => void }) {
  const { t } = useTranslation();
  const [dragOver, setDragOver] = useState(false);
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData("text/plain");
    if (!raw) { onMaterialize(); return; }
    try { onMaterialize(JSON.parse(raw) as DayRef); } catch { onMaterialize(); }
  }
  const label = t("runplan.accordion.stateRestLabel", "Rest day");
  return (
    <div
      role="button"
      tabIndex={0}
      className={`card hra-text-secondary flex flex-col items-center justify-center gap-1.5 p-3 min-h-24 cursor-pointer${dragOver ? " hra-swap-drop-target" : ""}`}
      onClick={() => onMaterialize()}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onMaterialize(); } }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      aria-label={label}
      title={label}
    >
      <Bed size={16} />
      <span className="text-meta">{label}</span>
    </div>
  );
}

export function PlanTemplateWeekView({ ownerName, sections, onDayEdit, onDaySwap, onMaterializeDay, offsetUnit, highlightedRef }: Props) {
  const { t } = useTranslation();
  const flatWeeks = flattenWeeks(sections);
  const [pos, setPos] = useState(0);
  // A regenerate/edit can shrink the flattened week count out from under a
  // stale pos (e.g. a section's own WEEKS spec shrinking) — clamp rather
  // than index out of bounds.
  const clampedPos = flatWeeks.length === 0 ? 0 : Math.min(pos, flatWeeks.length - 1);
  const current = flatWeeks[clampedPos];
  // Cleared on navigation so a later week reusing the same D-number doesn't
  // inherit a stale "just materialized, open me" flag from a different week.
  const [justMaterializedDay, setJustMaterializedDay] = useState<number | null>(null);

  if (!current) {
    return <div className="hra-text-muted text-meta">{t("runplan.weekView.empty", "No weeks to show.")}</div>;
  }

  const { sectionIndex, weekIndex } = current;
  const section = sections[sectionIndex];
  const week = section.weeks[weekIndex];
  // Mirrors SectionEditor's own default-section substitution (raw_dsl === ""
  // signals "no real SECTION header exists yet" — HRA-116) — display-only,
  // same convention, not a second implementation of that rule.
  const isDefaultSection = section.raw_dsl === "";
  const sectionDisplayName = isDefaultSection ? ownerName : section.name;
  const weekLabel = t("runplan.accordion.weekTitle", `Week ${week.number}`, { n: week.number });

  function goPrev() { setJustMaterializedDay(null); setPos(p => Math.max(0, p - 1)); }
  function goNext() { setJustMaterializedDay(null); setPos(p => Math.min(flatWeeks.length - 1, p + 1)); }

  function handleMaterialize(dayNumber: number, swapWith?: DayRef) {
    onMaterializeDay(sectionIndex, weekIndex, dayNumber, swapWith);
    setJustMaterializedDay(dayNumber);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="hra-agenda-nav">
        <button
          type="button" className="hra-icon-button hra-btn" data-variant="outline"
          onClick={goPrev} disabled={clampedPos === 0}
          aria-label={t("runplan.weekView.previousWeek", "Previous week")}
        >
          <ChevronLeft size={15} />
        </button>
        <span className="hra-text-primary text-label font-semibold">{sectionDisplayName} — {weekLabel}</span>
        <button
          type="button" className="hra-icon-button hra-btn" data-variant="outline"
          onClick={goNext} disabled={clampedPos === flatWeeks.length - 1}
          aria-label={t("runplan.weekView.nextWeek", "Next week")}
        >
          <ChevronRight size={15} />
        </button>
      </div>
      {/* Fixed 7-column grid regardless of section boundaries or declared
          D-count (AC2) — horizontally scrollable rather than squeezing
          columns illegibly on a narrow screen (no phone-specific layout was
          specified for this Story). */}
      <div className="overflow-x-auto">
        <div className="hra-week-view-grid grid grid-cols-7 gap-2">
          {DAY_NUMBERS.map(dayNumber => {
            const dayIndex = week.days.findIndex(d => d.day === dayNumber);
            const highlighted = highlightedRef?.kind === "day"
              && highlightedRef.sectionIndex === sectionIndex && highlightedRef.weekIndex === weekIndex && highlightedRef.dayIndex === dayIndex;
            return (
              <div key={dayNumber} className="flex flex-col gap-1 min-w-0">
                <div className="hra-text-secondary text-label text-center">
                  {t("runplan.weekView.dayHeader", `Day ${dayNumber}`, { n: dayNumber })}
                </div>
                {dayIndex === -1 ? (
                  <UndeclaredDaySlot onMaterialize={swapWith => handleMaterialize(dayNumber, swapWith)} />
                ) : (
                  <TemplateDayRow
                    day={week.days[dayIndex]}
                    onEdit={patch => onDayEdit(sectionIndex, weekIndex, dayIndex, patch)}
                    readOnlyDays={false}
                    dayRef={{ sectionIndex, weekIndex, dayIndex }}
                    onDaySwap={onDaySwap}
                    offsetUnit={offsetUnit}
                    highlighted={highlighted}
                    defaultExpanded={justMaterializedDay === dayNumber}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
