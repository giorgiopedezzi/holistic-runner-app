/**
 * PlanInstanceCalendar.tsx (HRA-143, day-cell content HRA-144)
 * Agenda-mode view for PlanInstancesSection's expanded row — a read-only
 * shadcn-big-calendar (react-big-calendar under the hood) rendering one
 * event per resolved day (`date != null`). Enabler slice for Epic HRA-142:
 * no drag-drop or click-to-edit — this component never wires onSelectEvent
 * or the DnD addon, so the calendar is passive by construction, not just by
 * omitted handlers. HRA-144 replaced the bare-string event title with a
 * custom `components.event` renderer (workout-type icon + truncated DSL
 * text + a needs_review flag) — HRA-145 builds the distance/speed bars on
 * top of this same cell.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShadcnBigCalendar, dateFnsLocalizer } from "shadcn-big-calendar";
import "shadcn-big-calendar/styles";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import { AlertTriangle, Bed, Bike, CircleHelp, Dumbbell, Footprints } from "lucide-react";
import { DAY_PREFIX_RE } from "@/components/TrainingPlanAccordion";
import type { SectionView } from "@/domain/runplan-aggregate";
import type { WorkoutType } from "@/types/runplan";

// Month view only, per this Story's scope ("verify month navigation" — no
// week/day/agenda-view-type switching asked for). Restricting `views`
// removes those buttons from the toolbar entirely rather than leaving them
// present but unused.
const CALENDAR_VIEWS = ["month"] as const;

const locales = { enUS };
// A plain date-fns localizer — month/weekday names stay English (see the
// component doc comment: full app-locale wiring, like ui/Calendar.tsx's
// utils/locale.ts, is a reasonable follow-up but not named by this Story's
// AC list, which only asks for a themed, navigable, read-only month grid).
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });

interface CalendarEvent {
  title: string;
  start: Date;
  end: Date;
  allDay: true;
  workoutType: WorkoutType;
  needsReview: boolean;
}

// HRA-144 Ask #1: run/rest/strength/cross/todo -> lucide-react icon.
const WORKOUT_TYPE_ICONS: Record<WorkoutType, typeof Footprints> = {
  run: Footprints, rest: Bed, strength: Dumbbell, cross: Bike, todo: CircleHelp,
};

function parseLocalDate(dateISO: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// HRA-144: `day.dsl` here is already the reconstructed DSL text —
// PlanInstancesSection's sectionsFromDays runs every ResolvedDay through
// reconstructDslFromResolvedDay (domain/runplan-aggregate.ts) before
// building `sections`, the same call TrainingPlanAccordion's own List view
// relies on. No second reconstruction needed at this layer.
function eventsFromSections(sections: SectionView[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const section of sections) {
    for (const week of section.weeks) {
      for (const day of week.days) {
        if (day.date == null) continue;
        const date = parseLocalDate(day.date);
        const title = day.dsl.replace(DAY_PREFIX_RE, "").trim() || day.dsl;
        events.push({ title, start: date, end: date, allDay: true, workoutType: day.workout_type, needsReview: day.needs_review });
      }
    }
  }
  return events;
}

const WORKOUT_TYPE_LABEL_KEYS: Record<WorkoutType, [string, string]> = {
  run: ["manage.planInstances.workoutType.run", "Run"],
  rest: ["manage.planInstances.workoutType.rest", "Rest"],
  strength: ["manage.planInstances.workoutType.strength", "Strength"],
  cross: ["manage.planInstances.workoutType.cross", "Cross training"],
  todo: ["manage.planInstances.workoutType.todo", "To do"],
};

// HRA-144 Ask #1-3: icon for workout_type + truncated DSL text (Ask #2: a
// fixed-width flex row with CSS ellipsis, `title=` on the text span itself
// carries the untruncated line — same "no new hardcoded colors" rule as
// everywhere else in this app, colors come from the existing .hra-* classes/
// tokens) + a needs_review AlertTriangle, same icon/class/tooltip pattern
// PlanInstancesSection's own rowStatusHint() already uses for the identical
// signal elsewhere in this card. `components.event` is called as a real
// component by react-big-calendar, so its own useTranslation() call is fine.
// react-big-calendar ships no type declarations of its own (JS-only
// package) — shadcn-big-calendar's re-exported `EventProps` therefore
// resolves to `any`, so this uses a plain local prop type instead of that
// re-export.
function DayCellEvent({ event }: { event: CalendarEvent }) {
  const { t } = useTranslation();
  const Icon = WORKOUT_TYPE_ICONS[event.workoutType];
  const [key, fallback] = WORKOUT_TYPE_LABEL_KEYS[event.workoutType];
  const workoutTypeLabel = t(key, fallback);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, width: "100%" }}>
      <span title={workoutTypeLabel} style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
        <Icon size={12} />
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }} title={event.title}>
        {event.title}
      </span>
      {event.needsReview && (
        <span
          title={t("manage.planInstances.needsReviewTooltip", "Needs review")}
          className="hra-text-warning"
          style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}
        >
          <AlertTriangle size={12} />
        </span>
      )}
    </span>
  );
}

interface Props {
  sections: SectionView[];
}

export function PlanInstanceCalendar({ sections }: Props) {
  const { t } = useTranslation();
  const events = useMemo(() => eventsFromSections(sections), [sections]);
  const [date, setDate] = useState<Date>(() => events[0]?.start ?? new Date());

  return (
    <div className="hra-agenda-calendar" style={{ height: 560 }}>
      <ShadcnBigCalendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        views={[...CALENDAR_VIEWS]}
        defaultView="month"
        date={date}
        onNavigate={setDate}
        style={{ height: "100%" }}
        components={{ event: DayCellEvent }}
        messages={{
          today: t("manage.planInstances.calendarToday", "Today"),
          previous: t("manage.planInstances.calendarPrevious", "Back"),
          next: t("manage.planInstances.calendarNext", "Next"),
          month: t("manage.planInstances.calendarMonth", "Month"),
          noEventsInRange: t("manage.planInstances.calendarNoEvents", "No days in range."),
        }}
      />
    </div>
  );
}
