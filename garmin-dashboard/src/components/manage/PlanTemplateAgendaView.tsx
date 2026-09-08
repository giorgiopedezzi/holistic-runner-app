/**
 * PlanTemplateAgendaView.tsx (HRA-283, renamed/rebuilt per HRA-285)
 * PlanTemplatesSection's alternate week-at-a-time Agenda view — built on the
 * SAME shadcn-big-calendar (react-big-calendar) vendor library
 * PlanInstanceCalendar.tsx's real Agenda uses, per HRA-285's explicit
 * correction: HRA-283 originally shipped a hand-rolled CSS grid labeled
 * "Week", which didn't match the real Agenda's visual/library identity.
 *
 * Still none of PlanInstanceCalendar's date or actual-workout machinery — a
 * template day only ever has a D-number, never a calendar date, never a
 * scheduled_time, never a matched recorded activity. The vendor calendar is
 * fed a fixed, synthetic anchor week (TEMPLATE_AGENDA_DAY_DATES below) purely
 * so it has real Date objects to lay its 7 columns out with; that date is
 * never surfaced anywhere in the UI — every header reads "Day N", not a date.
 * Every event is `allDay` (there is no time-of-day to place it at), so all 7
 * cards render in the vendor's own all-day row; the empty hourly time-grid
 * beneath it is hidden entirely via .hra-template-agenda-calendar in
 * index.css, since nothing is ever timed.
 *
 * Prev/Next does NOT move the calendar's own `date` — the vendor is always
 * showing the same fixed synthetic week. It instead changes which
 * (sectionIndex, weekIndex) of the template supplies that week's 7 days,
 * exactly as HRA-283's original flattenWeeks-based pos/flatWeeks state
 * already did; unchanged by this Story.
 *
 * Reuses TrainingPlanAccordion's own TemplateDayRow verbatim for a declared
 * day (same collapsed title, same click-to-expand Structured/DSL editor, same
 * useDragSwap-based native drag handle — NOT the vendor's own DnD addon,
 * which is a date/time-repositioning tool with nothing to reposition here).
 * An undeclared D-number renders as a REST-day summary instead; the first
 * interaction with it — opening it, or a drop landing on it — asks the caller
 * to materialize a real `D<n>: REST` line via onMaterializeDay, after which
 * it behaves as an ordinary declared day. Pure component: it never touches
 * dsl_source itself — PlanTemplatesSection owns that.
 */
import { useMemo, useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { Bed, ChevronLeft, ChevronRight } from "lucide-react";
import { ShadcnBigCalendar, dateFnsLocalizer } from "shadcn-big-calendar";
import "shadcn-big-calendar/styles";
import { format, parse, startOfWeek, getDay, addDays } from "date-fns";
import { enUS } from "date-fns/locale";
import { flattenWeeks, type SectionView } from "@/domain/runplan-aggregate";
import { TemplateDayRow, type DayRef, type EditedRef } from "@/components/TrainingPlanAccordion";
import type { OffsetUnit } from "@/types/runplan";

const DAY_NUMBERS = [1, 2, 3, 4, 5, 6, 7] as const;

const locales = { enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });

// A fixed, arbitrary calendar week — never displayed, only used so the
// vendor calendar has real Date objects to lay its 7 columns out with.
// Normalized through the SAME startOfWeek the localizer itself uses, so
// Day 1 always lands in the leftmost column regardless of locale.
const TEMPLATE_AGENDA_ANCHOR = startOfWeek(new Date(2024, 0, 7));
const TEMPLATE_AGENDA_DAY_DATES: Record<number, Date> = Object.fromEntries(
  DAY_NUMBERS.map(n => [n, addDays(TEMPLATE_AGENDA_ANCHOR, n - 1)]),
);
function dayNumberFromDate(date: Date): number {
  for (const n of DAY_NUMBERS) {
    const d = TEMPLATE_AGENDA_DAY_DATES[n];
    if (d.getFullYear() === date.getFullYear() && d.getMonth() === date.getMonth() && d.getDate() === date.getDate()) return n;
  }
  return 1;
}

// Every event sits in the vendor's all-day row (no time-of-day exists for a
// template day) — this array's identity/content never changes, so it's a
// module-scope constant rather than something recomputed per render.
interface TemplateCalendarEvent { dayNumber: number; start: Date; end: Date; allDay: true }
const TEMPLATE_AGENDA_EVENTS: TemplateCalendarEvent[] = DAY_NUMBERS.map(n => ({
  dayNumber: n, start: TEMPLATE_AGENDA_DAY_DATES[n], end: TEMPLATE_AGENDA_DAY_DATES[n], allDay: true,
}));

function noopNavigate() {}

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

// "Day N" only — no date, no scheduled-time chip/editor (templates have
// neither). Stateless/pure, so no ref-stabilization is needed the way the
// data-carrying event renderer below requires.
// react-big-calendar's Week view labels its day columns via
// `components.header` (a Month-only slot, `components.dateHeader`, is what
// the vendor's own docs/Month.js name — confirmed against TimeGridHeader.js,
// which reads `components.header`, not `dateHeader`).
function TemplateDayHeader({ date }: { date: Date }) {
  const { t } = useTranslation();
  const dayNumber = dayNumberFromDate(date);
  return (
    <span className="hra-agenda-date-header">
      <span className="hra-agenda-date-num">{t("runplan.weekView.dayHeader", `Day ${dayNumber}`, { n: dayNumber })}</span>
    </span>
  );
}

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

export function PlanTemplateAgendaView({ ownerName, sections, onDayEdit, onDaySwap, onMaterializeDay, offsetUnit, highlightedRef }: Props) {
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

  const sectionIndex = current?.sectionIndex ?? 0;
  const weekIndex = current?.weekIndex ?? 0;
  const section = sections[sectionIndex];
  const week = section?.weeks[weekIndex];

  function goPrev() { setJustMaterializedDay(null); setPos(p => Math.max(0, p - 1)); }
  function goNext() { setJustMaterializedDay(null); setPos(p => Math.min(flatWeeks.length - 1, p + 1)); }

  function handleMaterialize(dayNumber: number, swapWith?: DayRef) {
    onMaterializeDay(sectionIndex, weekIndex, dayNumber, swapWith);
    setJustMaterializedDay(dayNumber);
  }

  // Stable event-component identity (a fresh function identity on
  // `components.event` would make the vendor remount every day cell on every
  // render, resetting TemplateDayRow's own internal expand/collapse state) —
  // same ref-bridge pattern PlanInstanceCalendar's DateHeaderComponent uses,
  // for the identical reason.
  const stateRef = useRef({ week, sectionIndex, weekIndex, onDayEdit, onDaySwap, offsetUnit, highlightedRef, justMaterializedDay, handleMaterialize });
  stateRef.current = { week, sectionIndex, weekIndex, onDayEdit, onDaySwap, offsetUnit, highlightedRef, justMaterializedDay, handleMaterialize };
  const EventComponent = useMemo(
    () => function TemplateAgendaEvent({ event }: { event: TemplateCalendarEvent }) {
      const { week, sectionIndex, weekIndex, onDayEdit, onDaySwap, offsetUnit, highlightedRef, justMaterializedDay, handleMaterialize } = stateRef.current;
      if (!week) return null;
      const dayNumber = event.dayNumber;
      const dayIndex = week.days.findIndex(d => d.day === dayNumber);
      if (dayIndex === -1) {
        return <UndeclaredDaySlot onMaterialize={swapWith => handleMaterialize(dayNumber, swapWith)} />;
      }
      const highlighted = highlightedRef?.kind === "day"
        && highlightedRef.sectionIndex === sectionIndex && highlightedRef.weekIndex === weekIndex && highlightedRef.dayIndex === dayIndex;
      return (
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
      );
    },
    [],
  );

  if (!current || !week || !section) {
    return <div className="hra-text-muted text-meta">{t("runplan.weekView.empty", "No weeks to show.")}</div>;
  }

  // Mirrors SectionEditor's own default-section substitution (raw_dsl === ""
  // signals "no real SECTION header exists yet" — HRA-116) — display-only,
  // same convention, not a second implementation of that rule.
  const isDefaultSection = section.raw_dsl === "";
  const sectionDisplayName = isDefaultSection ? ownerName : section.name;
  const weekLabel = t("runplan.accordion.weekTitle", `Week ${week.number}`, { n: week.number });

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
      <div className="hra-agenda-calendar hra-template-agenda-calendar">
        <ShadcnBigCalendar
          localizer={localizer}
          events={TEMPLATE_AGENDA_EVENTS}
          startAccessor="start"
          endAccessor="end"
          views={["week"]}
          view="week"
          onView={() => {}}
          date={TEMPLATE_AGENDA_ANCHOR}
          onNavigate={noopNavigate}
          toolbar={false}
          className="h-full"
          components={{ event: EventComponent, header: TemplateDayHeader }}
          messages={{ noEventsInRange: t("runplan.weekView.empty", "No weeks to show.") }}
        />
      </div>
    </div>
  );
}
