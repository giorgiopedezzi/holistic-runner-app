/**
 * PlanInstanceCalendar.tsx (HRA-143, day-cell content HRA-144, bars/clock HRA-145)
 * Agenda-mode view for PlanInstancesSection's expanded row — a read-only
 * shadcn-big-calendar (react-big-calendar under the hood) rendering one
 * event per resolved day (`date != null`). Enabler slice for Epic HRA-142:
 * no drag-drop or click-to-edit — this component never wires onSelectEvent
 * or the DnD addon, so the calendar is passive by construction, not just by
 * omitted handlers. HRA-144 replaced the bare-string event title with a
 * custom `components.event` renderer (workout-type icon + truncated DSL
 * text + a needs_review flag). HRA-145 adds three metric bars (distance,
 * max speed, speed range) plus a duration "clock" in the cell's corner —
 * the clock was an explicit follow-up addition beyond the Jira Story's own
 * 3-bar Ask, confirmed with the user during this Story (see the PR comment
 * for the full decision trail).
 */
import { useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ShadcnBigCalendar, dateFnsLocalizer } from "shadcn-big-calendar";
import "shadcn-big-calendar/styles";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import { AlertTriangle, Bed, Bike, CircleHelp, Dumbbell, Footprints } from "lucide-react";
import { DAY_PREFIX_RE } from "@/components/TrainingPlanAccordion";
import { speedRampColor } from "@/components/activity/shared";
import { fmtElapsedClock } from "@/domain/activity-chart";
import type { SectionView, ResolvedDayMetrics } from "@/domain/runplan-aggregate";
import type { WorkoutType } from "@/types/runplan";
import { distanceUnitLabel, getUnitSystem, kmToMi, kmhToMph, speedUnitLabel } from "@/utils/units";

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
  metrics: ResolvedDayMetrics;
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
// relies on. No second reconstruction needed at this layer. HRA-145:
// `day.metrics` is likewise already computed by that same builder
// (buildInstanceSectionView calls computeResolvedDayMetrics per day) — this
// component only reads it, never recomputes it.
function eventsFromSections(sections: SectionView[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const section of sections) {
    for (const week of section.weeks) {
      for (const day of week.days) {
        if (day.date == null || day.metrics == null) continue;
        const date = parseLocalDate(day.date);
        const title = day.dsl.replace(DAY_PREFIX_RE, "").trim() || day.dsl;
        events.push({ title, start: date, end: date, allDay: true, workoutType: day.workout_type, needsReview: day.needs_review, metrics: day.metrics });
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

function formatDistanceM(m: number): string {
  const km = m / 1000;
  const val = getUnitSystem() === "imperial" ? kmToMi(km) : km;
  return `${val.toFixed(1)} ${distanceUnitLabel()}`;
}
function formatSpeedKmh(kmh: number): string {
  const val = getUnitSystem() === "imperial" ? kmhToMph(kmh) : kmh;
  return `${val.toFixed(1)} ${speedUnitLabel()}`;
}

// HRA-145: everything needed to scale/color one day's bars+clock, computed
// once per render of the calendar (see the two useMemos in
// PlanInstanceCalendar below) rather than recomputed per cell.
interface BarScaling {
  visibleMaxDistanceM: number; // Ask #2: max total_distance_m among days CURRENTLY VISIBLE, recomputed on navigation
  instanceMinSpeedKmh: number | null; // Ask #3/#4: color+length normalization range, whole plan instance
  instanceMaxSpeedKmh: number | null;
  instanceMaxDurationSec: number; // clock scaling — "a full clock = the longest session in the plan"
}

function speedColorT(value: number, scaling: BarScaling): number {
  const { instanceMinSpeedKmh: min, instanceMaxSpeedKmh: max } = scaling;
  if (min == null || max == null || max <= min) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

// HRA-145 Ask #1-3 + HRA-144's existing icon/DSL/needs_review row: the day
// cell's full content. Bars sit below the icon+text row (Ask #2-4); the
// duration clock is a small radial indicator overlaid in the cell's top
// right corner, per explicit follow-up instruction during this Story
// (distinct from and additive to the 3 Jira-specified bars).
function DayCellEvent({ event, scaling }: { event: CalendarEvent; scaling: BarScaling }) {
  const { t } = useTranslation();
  const Icon = WORKOUT_TYPE_ICONS[event.workoutType];
  const [key, fallback] = WORKOUT_TYPE_LABEL_KEYS[event.workoutType];
  const workoutTypeLabel = t(key, fallback);
  const { metrics } = event;

  // Ask #5: REST/TODO/fully-unresolved days show icon+DSL only — no bars,
  // no zero-length placeholders. A day with genuinely zero distance AND no
  // resolvable speed renders nothing here.
  const hasDistanceBar = metrics.totalDistanceM > 0 && scaling.visibleMaxDistanceM > 0;
  const hasSpeedBars = metrics.minSpeedKmh != null && metrics.maxSpeedKmh != null
    && scaling.instanceMaxSpeedKmh != null && scaling.instanceMaxSpeedKmh > 0;
  const hasClock = metrics.totalDurationSec > 0 && scaling.instanceMaxDurationSec > 0;

  const distancePct = hasDistanceBar ? Math.min(100, (metrics.totalDistanceM / scaling.visibleMaxDistanceM) * 100) : 0;
  const maxSpeedPct = hasSpeedBars ? Math.min(100, (metrics.maxSpeedKmh! / scaling.instanceMaxSpeedKmh!) * 100) : 0;
  const rangeStartPct = hasSpeedBars ? Math.min(100, (metrics.minSpeedKmh! / scaling.instanceMaxSpeedKmh!) * 100) : 0;
  const rangeWidthPct = hasSpeedBars ? Math.max(0, maxSpeedPct - rangeStartPct) : 0;
  const speedColor = hasSpeedBars ? speedRampColor(speedColorT(metrics.maxSpeedKmh!, scaling)) : undefined;
  const clockPct = hasClock ? Math.min(100, (metrics.totalDurationSec / scaling.instanceMaxDurationSec) * 100) : 0;

  return (
    <span style={{ position: "relative", display: "flex", flexDirection: "column", width: "100%" }}>
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

      {(hasDistanceBar || hasSpeedBars) && (
        <span className="hra-agenda-bars">
          {hasDistanceBar && (
            <span className="hra-agenda-bar-track" title={t("manage.planInstances.distanceTooltip", `Distance: ${formatDistanceM(metrics.totalDistanceM)}`, { value: formatDistanceM(metrics.totalDistanceM) })}>
              <span className="hra-agenda-bar-fill hra-agenda-bar-fill--distance" style={{ width: `${distancePct}%` }} />
            </span>
          )}
          {hasSpeedBars && (
            <span className="hra-agenda-bar-track" title={t("manage.planInstances.maxSpeedTooltip", `Max speed: ${formatSpeedKmh(metrics.maxSpeedKmh!)}`, { value: formatSpeedKmh(metrics.maxSpeedKmh!) })}>
              <span className="hra-agenda-bar-fill" style={{ width: `${maxSpeedPct}%`, "--bar-fill": speedColor } as CSSProperties} />
            </span>
          )}
          {hasSpeedBars && (
            <span
              className="hra-agenda-bar-track"
              title={t(
                "manage.planInstances.speedRangeTooltip",
                `Speed range: ${formatSpeedKmh(metrics.minSpeedKmh!)} – ${formatSpeedKmh(metrics.maxSpeedKmh!)}`,
                { min: formatSpeedKmh(metrics.minSpeedKmh!), max: formatSpeedKmh(metrics.maxSpeedKmh!) },
              )}
            >
              <span className="hra-agenda-bar-fill" style={{ left: `${rangeStartPct}%`, width: `${rangeWidthPct}%`, "--bar-fill": speedColor } as CSSProperties} />
            </span>
          )}
        </span>
      )}

      {hasClock && (
        <span
          className="hra-agenda-clock"
          title={t("manage.planInstances.durationTooltip", `Duration: ${fmtElapsedClock(metrics.totalDurationSec)}`, { value: fmtElapsedClock(metrics.totalDurationSec) })}
          style={{ "--clock-pct": clockPct } as CSSProperties}
        />
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

  // Ask #3/#4: max speed across the WHOLE plan instance — computed once per
  // instance load (i.e. whenever `sections`/`events` changes), not per
  // visible window.
  const instanceSpeedRange = useMemo(() => {
    const maxSpeeds = events.map(e => e.metrics.maxSpeedKmh).filter((v): v is number => v != null);
    const minSpeeds = events.map(e => e.metrics.minSpeedKmh).filter((v): v is number => v != null);
    return {
      instanceMaxSpeedKmh: maxSpeeds.length > 0 ? Math.max(...maxSpeeds) : null,
      instanceMinSpeedKmh: minSpeeds.length > 0 ? Math.min(...minSpeeds) : null,
    };
  }, [events]);
  const instanceMaxDurationSec = useMemo(
    () => events.reduce((max, e) => Math.max(max, e.metrics.totalDurationSec), 0),
    [events],
  );

  // Ask #2: max total_distance_m among days CURRENTLY VISIBLE, recomputed
  // on month navigation — scoped to the navigated month (year+month match),
  // not the full leading/trailing-week grid react-big-calendar also renders
  // for adjacent months.
  const visibleMaxDistanceM = useMemo(() => {
    const visible = events.filter(e => e.start.getFullYear() === date.getFullYear() && e.start.getMonth() === date.getMonth());
    return visible.reduce((max, e) => Math.max(max, e.metrics.totalDistanceM), 0);
  }, [events, date]);

  const scaling = useMemo<BarScaling>(
    () => ({ visibleMaxDistanceM, ...instanceSpeedRange, instanceMaxDurationSec }),
    [visibleMaxDistanceM, instanceSpeedRange, instanceMaxDurationSec],
  );
  // A stable component identity per `scaling` value — an inline arrow
  // function in `components.event` below would get a fresh identity every
  // render, forcing react-big-calendar to remount (not just re-render)
  // every visible day cell each time this component re-renders.
  const EventComponent = useMemo(
    () => (props: { event: CalendarEvent }) => <DayCellEvent {...props} scaling={scaling} />,
    [scaling],
  );

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
        components={{ event: EventComponent }}
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
