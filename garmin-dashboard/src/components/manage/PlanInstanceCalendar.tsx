/**
 * PlanInstanceCalendar.tsx (HRA-143)
 * Agenda-mode view for PlanInstancesSection's expanded row — a read-only
 * shadcn-big-calendar (react-big-calendar under the hood) rendering one
 * event per resolved day (`date != null`). Enabler slice for Epic HRA-142:
 * no icon/DSL/bar cell content yet (HRA-144/HRA-145 build that), no
 * drag-drop or click-to-edit — this component never wires onSelectEvent or
 * the DnD addon, so the calendar is passive by construction, not just by
 * omitted handlers.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShadcnBigCalendar, dateFnsLocalizer } from "shadcn-big-calendar";
import "shadcn-big-calendar/styles";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import { DAY_PREFIX_RE } from "@/components/TrainingPlanAccordion";
import type { SectionView } from "@/domain/runplan-aggregate";

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
}

function parseLocalDate(dateISO: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function eventsFromSections(sections: SectionView[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const section of sections) {
    for (const week of section.weeks) {
      for (const day of week.days) {
        if (day.date == null) continue;
        const date = parseLocalDate(day.date);
        const title = day.dsl.replace(DAY_PREFIX_RE, "").trim() || day.dsl;
        events.push({ title, start: date, end: date, allDay: true });
      }
    }
  }
  return events;
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
