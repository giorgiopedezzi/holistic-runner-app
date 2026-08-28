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
 * the published mockup, and category-tinted each event card by
 * `workout_type` as a placeholder. HRA-148 replaces that placeholder with
 * HRA-147's real `classifyResolvedDay` output (8 categories: Easy/Recovery,
 * Long run, Intervals, Progressive, Threshold, Tempo, Cross training, Rest —
 * cross AND strength both fold into the single Cross training category, per
 * HRA-147's own design) and adds the in-app criteria-reference popover.
 */
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ShadcnBigCalendar, dateFnsLocalizer } from "shadcn-big-calendar";
import "shadcn-big-calendar/styles";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import {
  AlertTriangle, ChevronLeft, ChevronRight, CircleHelp, Clock3, Gauge, Info, Route,
} from "lucide-react";
import { DAY_PREFIX_RE, useDragSwap } from "@/components/TrainingPlanAccordion";
import { speedRampColor } from "@/components/activity/shared";
import { fmtElapsedClock } from "@/domain/activity-chart";
import type { SectionView, ResolvedDayMetrics, TrainingLoadCategory } from "@/domain/runplan-aggregate";
import type { WorkoutType } from "@/types/runplan";
import { distanceUnitLabel, getUnitSystem, kmToMi, kmhToMph, speedUnitLabel } from "@/utils/units";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui";
import {
  CATEGORY_CARD_CLASS, CATEGORY_CRITERIA_KEYS, CATEGORY_ICONS, CATEGORY_LABEL_KEYS, CATEGORY_ORDER,
} from "@/components/manage/categoryVisuals";

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
  trainingLoadCategory: TrainingLoadCategory;
  needsReview: boolean;
  metrics: ResolvedDayMetrics;
  // HRA-151: the day's own backend id (what the per-day PATCH addresses,
  // HRA-149) and its persisted scheduled_time — both only ever set once a
  // day is a real plan_instance_days row, same as DayView's own id/
  // scheduled_time (HRA-150) this is threaded from.
  dayId?: number;
  scheduledTime?: string | null;
}

function parseLocalDate(dateISO: string): Date {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Inverse of parseLocalDate above (local calendar components, not UTC) — the
// key eventsByDateKey below is looked up by (HRA-151, AgendaDateHeader needs
// to find "this cell's own day" among the flat events list react-big-calendar
// hands the date header no direct reference to).
function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// HRA-151 Ask #1: "only on days with a workout" — the same REST/TODO/empty-
// cell exclusion DayCellEvent's own gauges already apply (no event at all,
// or a REST/TODO/OTHER day, all render as the compact no-card row with
// nothing to schedule around). OTHER never carries segments either (HRA-156)
// — same "nothing to schedule" reasoning as TODO.
function dayHasScheduledWorkout(event: CalendarEvent | undefined): boolean {
  return event != null && event.workoutType !== "rest" && event.workoutType !== "todo" && event.workoutType !== "other";
}

// Follow-up fix: a complex day's DSL text (multiple segments, e.g.
// "10x1000m @ RG; 2km @ jog") reads as one dense run-on when just wrapped —
// splitting at each segment's own "; " separator (the exact join
// reconstructDslFromResolvedDay uses) puts one segment per line instead,
// the same breakdown a human would apply reading it out loud. A trailing
// "# note" (reconstructDslFromResolvedDay appends day.notes this way, once,
// at the very end of the whole line) gets its own line too, rather than
// staying glued onto whichever segment happens to be last — the "#" itself
// is kept so a comment still reads as a comment, not just more workout text.
function splitDslSegments(text: string): string[] {
  const bySemicolon = text.split(/;\s*/).map(s => s.trim()).filter(Boolean);
  const lines: string[] = [];
  for (const segment of bySemicolon) {
    const hashIndex = segment.indexOf("#");
    if (hashIndex === -1) { lines.push(segment); continue; }
    const before = segment.slice(0, hashIndex).trim();
    const comment = segment.slice(hashIndex).trim();
    if (before) lines.push(before);
    if (comment) lines.push(comment);
  }
  return lines;
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
        // metrics and trainingLoadCategory are always set together (both instance-path-only
        // fields on DayView — see runplan-aggregate.ts) — one guard covers both.
        if (day.date == null || day.metrics == null || day.trainingLoadCategory == null) continue;
        const date = parseLocalDate(day.date);
        const title = day.dsl.replace(DAY_PREFIX_RE, "").trim() || day.dsl;
        events.push({
          title, start: date, end: date, allDay: true, workoutType: day.workout_type,
          trainingLoadCategory: day.trainingLoadCategory, needsReview: day.needs_review, metrics: day.metrics,
          dayId: day.id, scheduledTime: day.scheduled_time,
        });
      }
    }
  }
  return events;
}

// `todo` isn't a real classification category (HRA-147 folds it into
// Easy/Recovery for the tercile math, but a not-yet-planned day showing an
// "Easy/Recovery" badge would misinform a runner) — the compact row keeps
// this dedicated, category-independent label+icon for it instead.
const TODO_LABEL_KEY: [string, string] = ["manage.planInstances.workoutType.todo", "To do"];
// HRA-156: `other` (unparseable free text, preserved as this day's note) has
// the exact same "would misinform as Easy/Recovery" problem TODO does — same
// dedicated treatment, its own label/icon rather than classifyResolvedDay's
// fallback category.
const OTHER_LABEL_KEY: [string, string] = ["manage.planInstances.workoutType.other", "Other"];

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

// HRA-144 Ask #1-3 + HRA-145's metrics + HRA-146 Ask #2/#3 + HRA-148's real
// classification. REST/TODO days (no metrics ever) render as a muted row
// with no card at all; every other day gets a category-tinted card with the
// Route/Clock3/Gauge ring trio, each ring independently suppressed when its
// own metric isn't resolvable (Ask #3's own AC, mirroring HRA-145's
// "no zero-length placeholder" rule). Card color/icon now come from
// classifyResolvedDay's category (HRA-148 Ask #1), not raw workout_type —
// `todo` is the one exception, kept on its own dedicated label/icon since
// it isn't a real category (see TODO_LABEL_KEY above).
// HRA-152: day swap between two Agenda cells, mirroring the List view's own
// HRA-127-follow-up drag-and-drop (TrainingPlanAccordion.tsx's useDragSwap,
// reused verbatim — see its own export comment) rather than a second DnD
// implementation. Draggable by the event's own backend `dayId` (this
// component has no section/week/day index of its own — PlanInstancesSection
// resolves those from the id, same pattern HRA-151's onScheduledTimeEdit
// already established). Gated on `!readOnlyDays` (Ask #3); every day type
// (including REST/TODO) is draggable, matching the List view's own
// unconditional per-row wiring — day swap was never workout-only there.
function DayCellEvent({ event, scaling, readOnlyDays, onDaySwap }: {
  event: CalendarEvent; scaling: GaugeScaling; readOnlyDays: boolean; onDaySwap?: (a: number, b: number) => void;
}) {
  const { t } = useTranslation();
  const drag = useDragSwap(event.dayId, readOnlyDays ? undefined : onDaySwap);
  const dragProps = { ...drag.handlers, style: drag.swappable ? { cursor: "grab" as const } : undefined };

  if (event.workoutType === "todo") {
    const [key, fallback] = TODO_LABEL_KEY;
    return (
      <span className={`hra-agenda-rest-row${drag.isDragOver ? " hra-swap-drop-target" : ""}`} {...dragProps}>
        <CircleHelp size={13} />
        {t(key, fallback)}
      </span>
    );
  }
  if (event.workoutType === "other") {
    const [key, fallback] = OTHER_LABEL_KEY;
    return (
      <span className={`hra-agenda-rest-row${drag.isDragOver ? " hra-swap-drop-target" : ""}`} {...dragProps}>
        <Info size={13} />
        {t(key, fallback)}
      </span>
    );
  }

  const Icon = CATEGORY_ICONS[event.trainingLoadCategory];
  const [key, fallback] = CATEGORY_LABEL_KEYS[event.trainingLoadCategory];
  const categoryLabel = t(key, fallback);

  if (event.workoutType === "rest") {
    return (
      <span className={`hra-agenda-rest-row${drag.isDragOver ? " hra-swap-drop-target" : ""}`} {...dragProps}>
        <Icon size={13} />
        {categoryLabel}
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
    <span
      className={`hra-agenda-event-card ${CATEGORY_CARD_CLASS[event.trainingLoadCategory] ?? ""}${drag.isDragOver ? " hra-swap-drop-target" : ""}`}
      {...dragProps}
    >
      <span className="hra-agenda-event-main-row flex items-center gap-1 min-w-0 w-full" >
        <span title={categoryLabel} className="hra-category-color inline-flex items-center shrink-0">
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
            className="hra-text-warning inline-flex items-center shrink-0"
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
              <span className="hra-agenda-gauge-ring hra-agenda-gauge-distance" style={{ "--gauge-pct": distancePct } as CSSProperties} />
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
              <span className="hra-agenda-gauge-ring hra-agenda-gauge-duration" style={{ "--gauge-pct": durationPct } as CSSProperties} />
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

// HRA-146 Ask #5's reserved time-indicator slot beside the day number, now
// wired to real scheduled_time data (HRA-151) — inline-editable, per the
// Refinement decision (agenda cells are small, so a lightweight
// <input type="time"> in the reserved slot rather than a full picker
// popover). Today is still marked by the day-number's own filled circle
// (data-today), untouched by this Story. No longer a stable module-scope
// component (it closes over per-cell event/readOnlyDays/edit-callback data
// now) — PlanInstanceCalendar wraps it the same useMemo way EventComponent/
// ToolbarComponent already are, for the same "stable identity, no
// remount-per-render" reason.
// HRA-165: the reserved slot beside the day number is too small for a
// comfortable native <input type="time"> — its own OS-rendered HH/MM
// sub-segments each need their own precise click, and it needed an
// onClick stopPropagation workaround just to keep the cell's own "show
// more"/day-navigation click from also firing. Fixed by moving the actual
// editing surface OUT of the cramped cell entirely: the reserved slot now
// holds a real <button> (a single, unified, larger click target — no
// internal sub-segments to aim at) that opens a Popover with a
// comfortably-sized time input, matching List view's own InstanceDayRow
// input (the sibling this Story's own Context calls "noticeably easier to
// use") rather than a scaled-down copy of it.
//
// Considered and rejected: just enlarging the inline input in place
// (AC1's other option). Rejected because the month cell's date-header row
// is fixed-width by the calendar grid itself — widening the input would
// either shrink the day-number's own space or overflow into the event
// card below it, and it wouldn't remove the underlying "fighting its
// container" problem the Story's Context names (an OS time-input's
// picker chrome doesn't shrink gracefully). A popover sidesteps both:
// Radix's PopoverContent renders through a Portal (ui/Popover.tsx), so
// it's not even a DOM descendant of the calendar cell — the actual time
// input never needs its own stopPropagation guard (nothing here to
// bubble into the cell's click handler), only the trigger button does,
// same guard the old inline input already carried.
function AgendaScheduledTimeEditor({ dayId, scheduledTime, onScheduledTimeEdit }: {
  dayId: number;
  scheduledTime: string;
  onScheduledTimeEdit?: (dayId: number, scheduledTime: string | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = t("manage.planInstances.scheduledTimeLabel", "Scheduled time");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button" className="hra-agenda-date-time-trigger"
          onClick={e => e.stopPropagation()}
          aria-label={label}
        >
          {scheduledTime}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <label className="hra-text-secondary text-meta flex flex-col gap-1" >
          {label}
          <input
            type="time"
            className="hra-border-strong hra-bg-card hra-text-primary p-1.5 text-label"
            value={scheduledTime}
            onChange={e => onScheduledTimeEdit?.(dayId, e.target.value || null)}
          />
        </label>
      </PopoverContent>
    </Popover>
  );
}

function AgendaDateHeader({ date, label, event, readOnlyDays, onScheduledTimeEdit }: {
  date: Date;
  label: ReactNode;
  event?: CalendarEvent;
  readOnlyDays: boolean;
  onScheduledTimeEdit?: (dayId: number, scheduledTime: string | null) => void;
}) {
  const isToday = isSameCalendarDay(date, new Date());
  const showsChip = dayHasScheduledWorkout(event);
  const scheduledTime = event?.scheduledTime ?? "08:00";
  return (
    <span className="hra-agenda-date-header">
      <span className="hra-agenda-date-time">
        {showsChip && (
          readOnlyDays || event?.dayId == null ? (
            <span className="hra-agenda-date-time-chip">{scheduledTime}</span>
          ) : (
            <AgendaScheduledTimeEditor dayId={event!.dayId!} scheduledTime={scheduledTime} onScheduledTimeEdit={onScheduledTimeEdit} />
          )
        )}
      </span>
      <span className="hra-agenda-date-num" data-today={isToday}>{label}</span>
    </span>
  );
}

// HRA-148 Ask #3: an info affordance off the calendar header — a popover
// (not a separate page) listing every category with its actual rule, so a
// runner can see what drives a badge's color/icon rather than guessing.
// `todo` is deliberately absent — it isn't a real classification category
// (see TODO_LABEL_KEY above), so it has no "criteria" to document here.
function CategoryCriteriaPopover() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button" className="hra-icon-button hra-btn" data-variant="outline"
          aria-label={t("manage.planInstances.categoryReferenceTrigger", "What do the agenda colors mean?")}
        >
          <Info size={15} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end">
        <div className="hra-agenda-category-reference">
          <p className="hra-agenda-category-reference-title">
            {t("manage.planInstances.categoryReferenceTitle", "Training-load categories")}
          </p>
          <table className="hra-agenda-category-reference-table">
            <tbody>
              {CATEGORY_ORDER.map(category => {
                const Icon = CATEGORY_ICONS[category];
                const [labelKey, labelFallback] = CATEGORY_LABEL_KEYS[category];
                const [criteriaKey, criteriaFallback] = CATEGORY_CRITERIA_KEYS[category];
                return (
                  <tr key={category} className={CATEGORY_CARD_CLASS[category] ?? ""}>
                    <td className="hra-agenda-category-reference-icon hra-category-color">
                      <Icon size={14} />
                    </td>
                    <td className="hra-agenda-category-reference-label">{t(labelKey, labelFallback)}</td>
                    <td className="hra-agenda-category-reference-criteria">{t(criteriaKey, criteriaFallback)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// HRA-157: persistent workout-type legend — icon + label per category,
// reusing this file's own CATEGORY_ORDER/CATEGORY_LABEL_KEYS/CATEGORY_ICONS/
// CATEGORY_CARD_CLASS (the same data CategoryCriteriaPopover above already
// uses) so the legend and the popover can never drift apart. Exported for
// PlanInstancesSection to render inline, always visible, shared by both List
// and Agenda — `todo`/`other` are deliberately absent, same reasoning as the
// popover (neither is a real classification category, see TODO_LABEL_KEY/
// OTHER_LABEL_KEY above).
export function CategoryLegend() {
  const { t } = useTranslation();
  return (
    <div className="hra-workout-legend" role="list" aria-label={t("manage.planInstances.categoryLegendGroup", "Workout type legend")}>
      {CATEGORY_ORDER.map(category => {
        const Icon = CATEGORY_ICONS[category];
        const [labelKey, labelFallback] = CATEGORY_LABEL_KEYS[category];
        return (
          <span key={category} role="listitem" className={`hra-workout-legend-item ${CATEGORY_CARD_CLASS[category] ?? ""}`}>
            <Icon size={12} />
            {t(labelKey, labelFallback)}
          </span>
        );
      })}
    </div>
  );
}

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
          <button type="button" className="hra-icon-button hra-btn" data-variant="outline" onClick={() => onNavigate("PREV")} aria-label={t("manage.planInstances.calendarPrevious", "Previous month")}>
            <ChevronLeft size={15} />
          </button>
          <button type="button" className="hra-btn" data-variant="outline" onClick={() => onNavigate("TODAY")}>
            {t("manage.planInstances.calendarToday", "Today")}
          </button>
          <button type="button" className="hra-icon-button hra-btn" data-variant="outline" onClick={() => onNavigate("NEXT")} aria-label={t("manage.planInstances.calendarNext", "Next month")}>
            <ChevronRight size={15} />
          </button>
        </div>
        <CategoryCriteriaPopover />
      </div>
    </div>
  );
}

interface Props {
  sections: SectionView[];
  // HRA-151: same "locked once approved" rule every other day-level edit in
  // this app follows (HRA-126) — the chip becomes a plain read-only span
  // instead of an <input>, same pattern InstanceDayRow's own fields use.
  readOnlyDays: boolean;
  onScheduledTimeEdit: (dayId: number, scheduledTime: string | null) => void;
  // HRA-152: day swap between two Agenda cells — see DayCellEvent's own
  // comment. Both dayIds are the dragged/dropped days' own backend ids;
  // PlanInstancesSection resolves them to the {sectionIndex, weekIndex,
  // dayIndex} refs swapDaysByRef needs and stages the same pending-confirm
  // modal the List view's own drag-and-drop already uses.
  onDaySwap: (aDayId: number, bDayId: number) => void;
}

export function PlanInstanceCalendar({ sections, readOnlyDays, onScheduledTimeEdit, onDaySwap }: Props) {
  const events = useMemo(() => eventsFromSections(sections), [sections]);
  // HRA-151: AgendaDateHeader gets one calendar Date per render (react-big-
  // calendar's own dateHeader contract) with no direct link back to "this
  // day's own resolved day" — a plain date-keyed lookup resolves it.
  const eventsByDateKey = useMemo(() => {
    const map = new Map<string, CalendarEvent>();
    for (const e of events) map.set(toDateKey(e.start), e);
    return map;
  }, [events]);
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
      else if (e.workoutType !== "todo" && e.workoutType !== "other") workouts++;
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
    () => (props: { event: CalendarEvent }) => <DayCellEvent {...props} scaling={scaling} readOnlyDays={readOnlyDays} onDaySwap={onDaySwap} />,
    [scaling, readOnlyDays, onDaySwap],
  );
  const ToolbarComponent = useMemo(
    () => (props: { label: ReactNode; onNavigate: (action: "PREV" | "NEXT" | "TODAY") => void }) => <AgendaToolbar {...props} summary={summary} />,
    [summary],
  );
  // Fix (follow-up to HRA-165): DateHeaderComponent used to be re-memoized
  // whenever eventsByDateKey/onScheduledTimeEdit changed — which is EVERY
  // scheduled-time edit, since that edit flows straight back into `sections`
  // (optimistic update) -> `events` -> `eventsByDateKey`. A fresh function
  // identity on `components.dateHeader` makes react-big-calendar treat every
  // date-header cell as a different component type and remount it, which
  // reset AgendaScheduledTimeEditor's own local `open` state — the popover
  // closed itself after the very first edit. Fixed the same way this repo's
  // own i18n `t()` rule handles an unstable dependency that would retrigger
  // an effect/remount (CLAUDE.md): read the latest value through a ref
  // instead of closing over it directly, so DateHeaderComponent's own
  // identity can stay genuinely stable (`[]` deps) while still rendering
  // fresh data every call — react-big-calendar keeps calling the same
  // function, so it never remounts the header (or the popover inside it).
  const eventsByDateKeyRef = useRef(eventsByDateKey);
  eventsByDateKeyRef.current = eventsByDateKey;
  const readOnlyDaysRef = useRef(readOnlyDays);
  readOnlyDaysRef.current = readOnlyDays;
  const onScheduledTimeEditRef = useRef(onScheduledTimeEdit);
  onScheduledTimeEditRef.current = onScheduledTimeEdit;
  const DateHeaderComponent = useMemo(
    () => (props: { date: Date; label: ReactNode }) => (
      <AgendaDateHeader
        {...props}
        event={eventsByDateKeyRef.current.get(toDateKey(props.date))}
        readOnlyDays={readOnlyDaysRef.current}
        onScheduledTimeEdit={(dayId, scheduledTime) => onScheduledTimeEditRef.current?.(dayId, scheduledTime)}
      />
    ),
    [],
  );

  const { t } = useTranslation();

  return (
    <div className="hra-agenda-calendar">
      <ShadcnBigCalendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        views={[...CALENDAR_VIEWS]}
        defaultView="month"
        date={date}
        onNavigate={setDate}
        className="h-full"
        components={{ event: EventComponent, toolbar: ToolbarComponent, dateHeader: DateHeaderComponent }}
        messages={{
          noEventsInRange: t("manage.planInstances.calendarNoEvents", "No days in range."),
        }}
      />
    </div>
  );
}
