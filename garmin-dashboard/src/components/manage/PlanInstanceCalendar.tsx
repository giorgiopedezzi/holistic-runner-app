/**
 * PlanInstanceCalendar.tsx (HRA-143, day-cell content HRA-144, gauges HRA-145,
 * visual redesign HRA-146)
 * Agenda-mode view for PlanInstancesSection's expanded row — a read-only
 * shadcn-big-calendar (react-big-calendar under the hood) rendering one
 * event per resolved day (`date != null`). Enabler slice for Epic HRA-142:
 * no drag-drop or click-to-edit — this component never wires onSelectEvent
 * or the DnD addon, so the calendar is passive by construction, not just by
 * omitted handlers.
 *
 * HRA-146 replaced HRA-145's stacked bars + corner duration clock with a
 * Route/Clock3/Gauge ring trio (distance/duration/intensity, per that
 * Story's own Ask #3) — the speed-RANGE band HRA-145 also had has no slot
 * in this 3-ring trio and is retired, not carried forward; flagged in the
 * HRA-146 PR comment as a deliberate consolidation, not an oversight.
 * HRA-146 also replaced react-big-calendar's own toolbar/date-header
 * (`components.toolbar`/`components.dateHeader`) with custom ones matching
 * the published mockup, and category-tints each event card by
 * `workout_type` — a placeholder mapping HRA-147/148 will replace with a
 * real classification.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ShadcnBigCalendar, dateFnsLocalizer } from "shadcn-big-calendar";
import "shadcn-big-calendar/styles";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import { AlertTriangle, Bed, Bike, ChevronLeft, ChevronRight, CircleHelp, Clock3, Dumbbell, Footprints, Gauge, Route } from "lucide-react";
import { DAY_PREFIX_RE } from "@/components/TrainingPlanAccordion";
import { speedRampColor } from "@/components/activity/shared";
import { fmtElapsedClock } from "@/domain/activity-chart";
import type { SectionView, ResolvedDayMetrics } from "@/domain/runplan-aggregate";
import type { WorkoutType } from "@/types/runplan";
import { distanceUnitLabel, getUnitSystem, kmToMi, kmhToMph, speedUnitLabel } from "@/utils/units";

// Month view only, per HRA-143's own scope ("verify month navigation" — no
// week/day/agenda-view-type switching asked for). HRA-146's Month/Week
// toggle is visually present but Week stays inert this slice (AC4).
const CALENDAR_VIEWS = ["month"] as const;

const locales = { enUS };
// A plain date-fns localizer — month/weekday names stay English (see the
// component doc comment: full app-locale wiring, like ui/Calendar.tsx's
// utils/locale.ts, is a reasonable follow-up but not named by any Story's
// AC list so far).
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

// HRA-146 Ask #2: category tint per workout_type — run/cross/strength get a
// translucent card; rest/todo get no card at all (see hra-agenda-rest-row
// below). A placeholder mapping: HRA-147/148 replace this with a real
// classification (Easy/Long/Intervals/Progressive/Threshold/Tempo).
const WORKOUT_TYPE_CARD_CLASS: Partial<Record<WorkoutType, string>> = {
  run: "hra-agenda-cat-run", cross: "hra-agenda-cat-cross", strength: "hra-agenda-cat-strength",
};

function parseLocalDate(dateISO: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Follow-up fix: a complex day's DSL text (multiple segments, e.g.
// "10x1000m @ RG; 2km @ jog") reads as one dense run-on when just wrapped —
// splitting at each segment's own "; " separator (the exact join
// reconstructDslFromResolvedDay uses) puts one segment per line instead,
// the same breakdown a human would apply reading it out loud.
function splitDslSegments(text: string): string[] {
  return text.split(/;\s*/).map(s => s.trim()).filter(Boolean);
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

// HRA-145: everything needed to scale/color one day's gauges, computed once
// per render of the calendar (see the useMemos in PlanInstanceCalendar
// below) rather than recomputed per cell. Unchanged by HRA-146's ring
// redesign — same underlying scaling, new visual only.
interface GaugeScaling {
  visibleMaxDistanceM: number; // max total_distance_m among days CURRENTLY VISIBLE, recomputed on navigation
  instanceMinSpeedKmh: number | null; // color+length normalization range, whole plan instance
  instanceMaxSpeedKmh: number | null;
  instanceMaxDurationSec: number; // "a full ring = the longest session in the plan"
}

function speedColorT(value: number, scaling: GaugeScaling): number {
  const { instanceMinSpeedKmh: min, instanceMaxSpeedKmh: max } = scaling;
  if (min == null || max == null || max <= min) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

interface AgendaSummary { workouts: number; runs: number; rest: number; distanceM: number }

// HRA-144 Ask #1-3 + HRA-145's metrics + HRA-146 Ask #2/#3: the day cell's
// full content. REST/TODO days (no metrics ever) render as a muted row with
// no card at all; every other day gets a category-tinted card with the
// Route/Clock3/Gauge ring trio, each ring independently suppressed when its
// own metric isn't resolvable (Ask #3's own AC, mirroring HRA-145's
// "no zero-length placeholder" rule).
function DayCellEvent({ event, scaling }: { event: CalendarEvent; scaling: GaugeScaling }) {
  const { t } = useTranslation();
  const Icon = WORKOUT_TYPE_ICONS[event.workoutType];
  const [key, fallback] = WORKOUT_TYPE_LABEL_KEYS[event.workoutType];
  const workoutTypeLabel = t(key, fallback);

  if (event.workoutType === "rest" || event.workoutType === "todo") {
    return (
      <span className="hra-agenda-rest-row">
        <Icon size={13} />
        {workoutTypeLabel}
      </span>
    );
  }

  const { metrics } = event;
  const hasDistance = metrics.totalDistanceM > 0 && scaling.visibleMaxDistanceM > 0;
  const hasDuration = metrics.totalDurationSec > 0 && scaling.instanceMaxDurationSec > 0;
  const hasIntensity = metrics.maxSpeedKmh != null && scaling.instanceMaxSpeedKmh != null && scaling.instanceMaxSpeedKmh > 0;

  const distancePct = hasDistance ? Math.min(100, (metrics.totalDistanceM / scaling.visibleMaxDistanceM) * 100) : 0;
  const durationPct = hasDuration ? Math.min(100, (metrics.totalDurationSec / scaling.instanceMaxDurationSec) * 100) : 0;
  const intensityPct = hasIntensity ? Math.min(100, (metrics.maxSpeedKmh! / scaling.instanceMaxSpeedKmh!) * 100) : 0;
  const intensityColor = hasIntensity ? speedRampColor(speedColorT(metrics.maxSpeedKmh!, scaling)) : undefined;

  const dslSegments = splitDslSegments(event.title);

  return (
    <span className={`hra-agenda-event-card ${WORKOUT_TYPE_CARD_CLASS[event.workoutType] ?? ""}`}>
      <span className="hra-agenda-event-main-row" style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, width: "100%" }}>
        <span title={workoutTypeLabel} style={{ display: "inline-flex", alignItems: "center", flexShrink: 0, color: "var(--cat-color)" }}>
          <Icon size={12} />
        </span>
        <span className="hra-agenda-event-title">
          {dslSegments.map((segment, i) => (
            <span key={i} className="hra-agenda-event-title-line">{segment}</span>
          ))}
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

      {(hasDistance || hasDuration || hasIntensity) && (
        <span className="hra-agenda-gauges">
          {hasDistance && (
            <span className="hra-agenda-gauge" title={t("manage.planInstances.distanceTooltip", `Distance: ${formatDistanceM(metrics.totalDistanceM)}`, { value: formatDistanceM(metrics.totalDistanceM) })}>
              <Route size={11} />
              <span className="hra-agenda-gauge-ring" style={{ "--gauge-pct": distancePct, "--gauge-fill": "var(--data-pace)" } as CSSProperties} />
            </span>
          )}
          {hasDuration && (
            <span className="hra-agenda-gauge" title={t("manage.planInstances.durationTooltip", `Duration: ${fmtElapsedClock(metrics.totalDurationSec)}`, { value: fmtElapsedClock(metrics.totalDurationSec) })}>
              <Clock3 size={11} />
              {/* Bug fix: NOT var(--accent) — .hra-agenda-calendar scopes its
                  own shadcn-vocabulary --accent (a bare "H S% L%" triplet,
                  see the theming block in index.css) which shadows the
                  app's real hex --accent inside this whole subtree. Using it
                  here made conic-gradient()'s first color stop invalid,
                  rendering this ring invisible in every state, always —
                  --accent-green isn't a shadowed name, so it resolves to the
                  app's real token as intended. */}
              <span className="hra-agenda-gauge-ring" style={{ "--gauge-pct": durationPct, "--gauge-fill": "var(--accent-green)" } as CSSProperties} />
            </span>
          )}
          {hasIntensity && (
            <span className="hra-agenda-gauge" title={t("manage.planInstances.maxSpeedTooltip", `Max speed: ${formatSpeedKmh(metrics.maxSpeedKmh!)}`, { value: formatSpeedKmh(metrics.maxSpeedKmh!) })}>
              <Gauge size={11} />
              <span className="hra-agenda-gauge-ring" style={{ "--gauge-pct": intensityPct, "--gauge-fill": intensityColor } as CSSProperties} />
            </span>
          )}
        </span>
      )}
    </span>
  );
}

// HRA-146 Ask #5: a reserved time-indicator slot beside the day number —
// empty this slice (HRA-151 wires real scheduled_time data into it), today
// marked by a filled circle instead of the whole-cell highlight neutralized
// in index.css. A stable module-scope component (no closure dependencies),
// so — unlike EventComponent/ToolbarComponent below — it needs no useMemo
// wrapper to keep a stable identity across renders.
function AgendaDateHeader({ date, label }: { date: Date; label: ReactNode }) {
  const isToday = isSameCalendarDay(date, new Date());
  return (
    <span className="hra-agenda-date-header">
      <span className="hra-agenda-date-time" aria-hidden="true" />
      <span className="hra-agenda-date-num" data-today={isToday}>{label}</span>
    </span>
  );
}

const ICON_BTN_STYLE: CSSProperties = { width: 32, height: 32, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" };

// HRA-146 Ask #4: replaces react-big-calendar's own toolbar — title +
// accordion-equivalent summary line, chevron nav, Month/Week toggle (Week
// inert this slice, per the AC's own "may be visually present but inert").
function AgendaToolbar({ label, onNavigate, summary }: { label: ReactNode; onNavigate: (action: "PREV" | "NEXT" | "TODAY") => void; summary: AgendaSummary }) {
  const { t } = useTranslation();
  return (
    <div className="hra-agenda-toolbar">
      <div>
        <h2 className="hra-agenda-title">{label}</h2>
        <p className="hra-agenda-summary">
          <span className="val">{summary.workouts}</span> {t("manage.planInstances.calendarWorkouts", "workouts")}
          <span className="dot" />
          <span className="val">{summary.runs}</span> {t("manage.planInstances.calendarRuns", "runs")}
          <span className="dot" />
          <span className="val">{summary.rest}</span> {t("manage.planInstances.calendarRest", "rest")}
          <span className="dot" />
          <span className="val">{formatDistanceM(summary.distanceM)}</span>
        </p>
      </div>
      <div className="hra-agenda-controls">
        <div className="hra-segment" role="group" aria-label={t("manage.planInstances.calendarViewGroup", "Calendar view")}>
          <button type="button" className="hra-segment-item" data-active={true}>{t("manage.planInstances.calendarMonth", "Month")}</button>
          <button
            type="button" className="hra-segment-item" data-active={false} disabled
            title={t("manage.planInstances.calendarWeekComingSoon", "Week view coming soon")}
          >
            {t("manage.planInstances.calendarWeek", "Week")}
          </button>
        </div>
        <div className="hra-agenda-nav">
          <button type="button" className="hra-btn" data-variant="outline" style={ICON_BTN_STYLE} onClick={() => onNavigate("PREV")} aria-label={t("manage.planInstances.calendarPrevious", "Previous month")}>
            <ChevronLeft size={15} />
          </button>
          <button type="button" className="hra-btn" data-variant="outline" onClick={() => onNavigate("TODAY")}>
            {t("manage.planInstances.calendarToday", "Today")}
          </button>
          <button type="button" className="hra-btn" data-variant="outline" style={ICON_BTN_STYLE} onClick={() => onNavigate("NEXT")} aria-label={t("manage.planInstances.calendarNext", "Next month")}>
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  sections: SectionView[];
}

export function PlanInstanceCalendar({ sections }: Props) {
  const events = useMemo(() => eventsFromSections(sections), [sections]);
  const [date, setDate] = useState<Date>(() => events[0]?.start ?? new Date());

  // Ask #3 (intensity ring): max/min speed across the WHOLE plan instance —
  // computed once per instance load (i.e. whenever `sections`/`events`
  // changes), not per visible window.
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

  // Shared by both the distance ring's scaling and the toolbar's summary
  // line — the days in the currently navigated month, recomputed on
  // navigation (Ask #2/#4).
  const visibleEvents = useMemo(
    () => events.filter(e => e.start.getFullYear() === date.getFullYear() && e.start.getMonth() === date.getMonth()),
    [events, date],
  );
  const visibleMaxDistanceM = useMemo(
    () => visibleEvents.reduce((max, e) => Math.max(max, e.metrics.totalDistanceM), 0),
    [visibleEvents],
  );
  const summary = useMemo<AgendaSummary>(() => {
    let workouts = 0, runs = 0, rest = 0, distanceM = 0;
    for (const e of visibleEvents) {
      if (e.workoutType === "rest") rest++;
      else if (e.workoutType !== "todo") workouts++;
      if (e.workoutType === "run") runs++;
      distanceM += e.metrics.totalDistanceM;
    }
    return { workouts, runs, rest, distanceM };
  }, [visibleEvents]);

  const scaling = useMemo<GaugeScaling>(
    () => ({ visibleMaxDistanceM, ...instanceSpeedRange, instanceMaxDurationSec }),
    [visibleMaxDistanceM, instanceSpeedRange, instanceMaxDurationSec],
  );
  // A stable component identity per `scaling`/`summary` value — an inline
  // arrow function in `components.event`/`components.toolbar` below would
  // get a fresh identity every render, forcing react-big-calendar to
  // remount (not just re-render) every visible day cell / the toolbar each
  // time this component re-renders.
  const EventComponent = useMemo(
    () => (props: { event: CalendarEvent }) => <DayCellEvent {...props} scaling={scaling} />,
    [scaling],
  );
  const ToolbarComponent = useMemo(
    () => (props: { label: ReactNode; onNavigate: (action: "PREV" | "NEXT" | "TODAY") => void }) => <AgendaToolbar {...props} summary={summary} />,
    [summary],
  );

  const { t } = useTranslation();

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
        components={{ event: EventComponent, toolbar: ToolbarComponent, dateHeader: AgendaDateHeader }}
        messages={{
          noEventsInRange: t("manage.planInstances.calendarNoEvents", "No days in range."),
        }}
      />
    </div>
  );
}
