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
import { useState, type DragEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Bed, CircleHelp, Play } from "lucide-react";
import { AccordionCard } from "./ui/AccordionCard";
import { CATEGORY_CARD_CLASS, CATEGORY_ICONS } from "./manage/categoryVisuals";
import { instanceDayDateLabel } from "@/utils/fmt";
import { weekDateRange, type AggregateTotals, type DayView, type DistanceTotal, type SectionView, type WeekView } from "../domain/runplan-aggregate";
import { recomposeDayLine, splitNote } from "@/domain/runplan-patch";
import { PlannedPaceTargetChart } from "./PlannedPaceTargetChart";

// HRA-127 follow-up: identifies one Day/Week row for the drag-and-drop swap
// below — plain index tuples, same "sectionIndex/weekIndex/dayIndex" shape
// onSectionEdit/onWeekEdit/onDayEdit already key by.
export interface DayRef { sectionIndex: number; weekIndex: number; dayIndex: number }
export interface WeekRef { sectionIndex: number; weekIndex: number }

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
  // HRA-126: independent of readOnlySectionWeek — when true, Day dsl/note
  // also stop being editable (the dsl/note inputs simply don't render, same
  // "hide the input, the title/tooltip already shows the value" pattern
  // readOnlySectionWeek uses above). Set by the instance card once an
  // instance's approved_at is set, locking the whole plan view. Default
  // false (an unapproved instance, or any template, stays fully editable).
  readOnlyDays?: boolean;
  // HRA-127 follow-up: native HTML5 drag-and-drop, as an alternative UX to
  // the picker-based swap the instance card already offers — dragging one
  // Day/Week row onto another calls back with both refs; the CALLER does
  // the actual content exchange (the same swapDayContent-based logic the
  // picker uses) and is expected to no-op a drop onto the row's own self.
  // Optional — templates never pass these, so their rows stay non-draggable.
  // Gated by readOnlyDays above regardless of whether these are supplied
  // (an approved instance gets neither the picker panel nor drag-and-drop).
  onDaySwap?: (a: DayRef, b: DayRef) => void;
  onWeekSwap?: (a: WeekRef, b: WeekRef) => void;
  // HRA-150: instance-only — an instance day's scheduled_time persists via
  // its own PATCH immediately on edit, unlike dsl/notes above (which stay
  // local until the whole-day bulk Save). Optional: templates have no
  // scheduled_time concept, so PlanTemplatesSection never passes this.
  onScheduledTimeEdit?: (sectionIndex: number, weekIndex: number, dayIndex: number, scheduledTime: string | null) => void;
  // HRA-163, DSL-text mechanism added in a live follow-up: instance-only —
  // the note row's run/rest/other switch. Unlike onScheduledTimeEdit above,
  // this does NOT persist on its own; the caller stages a confirm (the
  // switch overwrites the day's workout text) and, once confirmed, applies
  // it through the SAME onDayEdit({dsl}) path a manual DSL edit already
  // uses (local-only until the whole-day bulk Save). Optional: templates
  // have no per-day manual type override, so PlanTemplatesSection never
  // passes this.
  onWorkoutTypeEdit?: (sectionIndex: number, weekIndex: number, dayIndex: number, workoutType: WorkoutTypeSwitchValue) => void;
  // Live follow-up: instance-only — a day's dsl/notes stay local until the
  // whole-day bulk Save (HRA-149/150), so a day can silently differ from
  // what's actually persisted with no visible sign of it. Pure read, keyed
  // by the day itself (unlike the edit callbacks above, no section/week/day
  // index currying needed) — PlanInstancesSection already tracks each day's
  // persisted baseline (persistedDsl, HRA-134) to answer this. Optional:
  // templates have no persisted-baseline concept to compare against.
  isDayDirty?: (day: DayView) => boolean;
}

// DayRef/WeekRef are always flat, plain object literals built with the same
// key order at every call site — JSON comparison is a simple, safe way to
// compare them without fighting TypeScript's index-signature rules for a
// generic Record-shaped parameter.
function refsEqual<TRef>(a: TRef, b: TRef): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Native HTML5 DnD (no library — this app is deliberately zero-dependency).
// The dragged row's own ref travels as JSON text/plain payload; dropping
// reads it back and hands both refs to the caller-supplied swap callback.
// A lightweight "is a valid drop target hovering over me" boolean drives
// the `.hra-swap-drop-target` outline (index.css) — visual feedback only,
// never persisted state.
// HRA-152: exported so PlanInstanceCalendar.tsx's Agenda-view day cells can
// reuse this same generic drag-and-drop mechanics for their own day swap —
// "no new swap logic, only a new UI entry point" (the Story's own Ask #1)
// applies just as much to this hook as to swapDaysByRef/swapDayContent.
export function useDragSwap<TRef>(ref: TRef | undefined, onSwap: ((a: TRef, b: TRef) => void) | undefined) {
  const [isDragOver, setIsDragOver] = useState(false);
  const swappable = ref != null && onSwap != null;
  if (!swappable) return { swappable: false as const, isDragOver: false, handlers: {} };
  // stopPropagation on every drag/drop-target handler: a Day row's own
  // draggable wrapper is nested inside its Week row's (WeekEditor renders
  // DayEditor as a child) — without it, hovering a day would bubble up and
  // light up the enclosing week's drop-target outline too.
  const handlers = {
    draggable: true,
    onDragStart: (e: DragEvent) => { e.stopPropagation(); e.dataTransfer.setData("text/plain", JSON.stringify(ref)); e.dataTransfer.effectAllowed = "move"; },
    onDragOver: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; },
    onDragEnter: (e: DragEvent) => { e.stopPropagation(); setIsDragOver(true); },
    onDragLeave: (e: DragEvent) => { e.stopPropagation(); setIsDragOver(false); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const raw = e.dataTransfer.getData("text/plain");
      if (!raw) return;
      let source: TRef;
      try { source = JSON.parse(raw); } catch { return; }
      if (refsEqual(source, ref)) return;
      onSwap(source, ref);
    },
  };
  return { swappable: true as const, isDragOver, handlers };
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
    // HRA-156: a distinct tally from the needs-review warning badge above —
    // an "other" day is already resolved (zero warnings), just worth
    // surfacing separately since it's unparsed free text, not a real plan.
    ...(totals.otherDays > 0 ? [t("runplan.accordion.otherDays", `${totals.otherDays} other`, { n: totals.otherDays })] : []),
    fmtDistance(totals.distance, t),
  ].join(" · ");
}

// D<n>[suffix][ [tag]]: — the whole D-line prefix up to and including the
// colon (garmin-stats/src/domain/runplan/parser.ts's DAY_RE), stripped so
// only the workout description text after it remains. Exported: HRA-131's
// swap-confirm modal (PlanInstancesSection.tsx) needs the same stripped
// workout text this file already uses for InstanceDayRow's editable field.
export const DAY_PREFIX_RE = /^D\d+[a-c]?(?:\s*\[[^\]]+\])?\s*:\s*/;

// HRA-163, mechanism changed in a live follow-up: the note row's
// run/rest/other switch — sets the DSL text field itself (REST/OTHER's own
// bare DSL keyword; RUN clears the body) once the caller's confirm modal is
// accepted, via the same onDayEdit({dsl}) path a manual DSL edit already
// uses — see PlanInstancesSection.tsx's onWorkoutTypeEdit/
// confirmWorkoutTypeChange. Only 3 values are ever WRITTEN through this
// control (todo/cross/strength stay DSL-only, edited via the D-line's own
// keywords) — but every WorkoutType value must READ into one of the 3
// buttons, so a day whose real type isn't run/rest folds into "other" for
// display (never silently shows "run").
export type WorkoutTypeSwitchValue = "run" | "rest" | "other";
const WORKOUT_TYPE_SWITCH_ICONS: Record<WorkoutTypeSwitchValue, (props: { size?: number }) => ReactNode> = {
  run: Play, rest: Bed, other: CircleHelp,
};
const WORKOUT_TYPE_SWITCH_LABEL_KEYS: Record<WorkoutTypeSwitchValue, [string, string]> = {
  run: ["runplan.accordion.workoutTypeRun", "Run"],
  rest: ["runplan.accordion.workoutTypeRest", "Rest"],
  other: ["runplan.accordion.workoutTypeOther", "Other"],
};
function workoutTypeSwitchValue(workoutType: string): WorkoutTypeSwitchValue {
  return workoutType === "run" || workoutType === "rest" ? workoutType : "other";
}

// HRA-125: an instance day's title shows its real calendar date + weekday
// instead of the "D<n>" placeholder — templates have no calendar dates
// (day.date is only ever set for instance days, runplan-aggregate.ts's
// buildInstanceSectionView), so template mode keeps day.dsl unchanged (AC3).
// Only the D<n> prefix is replaced — the workout text after the colon (and
// any trailing "# note" the DSL line already carries) stays visible (AC2).
// NOTE: since HRA-128 split DayEditor into InstanceDayRow/TemplateDayRow,
// this function is only ever called with day.date == null (TemplateDayRow) —
// the date branch below is unreachable through today's call graph, kept only
// so this function stays a single source of truth if a caller needs it again.
function dayLabel(day: DayView): string {
  if (day.date == null) return day.dsl;
  const workoutText = day.dsl.replace(DAY_PREFIX_RE, "");
  return `${instanceDayDateLabel(day.date)} ${workoutText}`;
}

function weekHasWarnings(week: WeekView): boolean {
  return week.days.some(d => d.needs_review);
}

function sectionHasWarnings(section: SectionView): boolean {
  return section.weeks.some(weekHasWarnings);
}

function WarningBadge({ t }: { t: Translate }) {
  return (
    <span className="hra-text-danger text-meta"  title={t("runplan.accordion.needsReviewBadge", "Needs review")}>
      ⚠
    </span>
  );
}

// Live follow-up: an instance day whose dsl/notes differ from what's
// actually persisted (local-only until the whole-day bulk Save) — distinct
// from WarningBadge above (a parse issue with the CONTENT itself, needs_review).
// Same icon/color/copy as the collapsed-row-level indicator this file's own
// sibling already shows for the same concept (PlanInstancesSection.tsx's
// rowStatusHint — AlertTriangle + hra-text-warning + the same i18n key),
// so "unsaved" reads as one consistent visual language at both the
// whole-instance and per-day granularity.
function UnsavedBadge({ t }: { t: Translate }) {
  return (
    <span className="hra-text-warning inline-flex items-center"  title={t("manage.planInstances.unsavedChanges", "Unsaved changes")}>
      <AlertTriangle size={12} />
    </span>
  );
}

function NoteIcon({ note }: { note?: string }) {
  if (!note) return null;
  return (
    <span className="hra-tooltip hra-text-muted text-meta cursor-help" data-tooltip={note} >
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
    <div className="flex items-center justify-between flex-1 gap-2.5 min-w-0">
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
      <span className="hra-text-secondary flex items-center gap-2 text-meta font-normal shrink-0" >
        {summary}
        {hasWarning && <WarningBadge t={t} />}
        <NoteIcon note={note} />
      </span>
    </div>
  );
}

// HRA-128: an instance day (day.date set) no longer needs a click-to-expand
// accordion — DSL/Notes render directly in a compact row, with the
// (non-editable) date pulled out into its own prominent badge instead of
// blending into the label text. Template days (day.date == null) keep the
// original accordion-with-textarea layout unchanged — templates were never
// in this Story's scope (HRA-116/117), and the whole distinguishing signal
// (day.date) already exists for exactly this kind of instance-only fork
// (see dayLabel() above, HRA-125).
function InstanceDayRow({
  day, date, onEdit, readOnlyDays, dayRef, onDaySwap, onScheduledTimeEdit, onWorkoutTypeEdit, isDayDirty,
}: {
  day: DayView;
  date: string;
  onEdit: (patch: { dsl?: string; notes?: string }) => void;
  readOnlyDays: boolean;
  dayRef?: DayRef;
  onDaySwap?: (a: DayRef, b: DayRef) => void;
  onScheduledTimeEdit?: (scheduledTime: string | null) => void;
  onWorkoutTypeEdit?: (workoutType: WorkoutTypeSwitchValue) => void;
  isDayDirty?: (day: DayView) => boolean;
}) {
  const { t } = useTranslation();
  const drag = useDragSwap(dayRef, readOnlyDays ? undefined : onDaySwap);
  const dateBadge = instanceDayDateLabel(date);
  // HRA-160: reuses the same TrainingLoadCategory -> icon/--cat-color data
  // the Agenda view's CategoryLegend/CategoryCriteriaPopover already draw
  // from (categoryVisuals.tsx) — no new palette. Instance days always carry
  // a trainingLoadCategory (buildInstanceSectionView classifies every one),
  // but the field is optional on DayView (templates never set it), hence
  // the fallback.
  const category = day.trainingLoadCategory ?? "easy_recovery";
  const CategoryIcon = CATEGORY_ICONS[category];
  const categoryCatClass = CATEGORY_CARD_CLASS[category] ?? "";
  // The D<n>[suffix][tag]: prefix only carries meaning in template mode (it's
  // how the DSL text addresses a specific day) — an instance day already
  // shows its real date via dateBadge above, so the prefix is dead weight in
  // this row. Stripped from what's displayed/edited, but reattached verbatim
  // on every edit (recomposeDayLine's patch.dsl replaces the whole line, so
  // dropping the prefix here would silently corrupt day.dsl otherwise).
  const dayPrefix = day.dsl.match(DAY_PREFIX_RE)?.[0] ?? "";
  // HRA-161: the trailing "# note" is stripped here too — it's already shown
  // in the separate Note input below, so leaving it in this field just
  // duplicates it. On edit, the note is reattached via recomposeDayLine's own
  // reattachment logic (not reimplemented here) before the patch goes out,
  // so the existing note survives a DSL-only edit untouched.
  const workoutText = splitNote(day.dsl.slice(dayPrefix.length)).main;
  // HRA-150: HH:MM 24-hour, matching <input type="time">'s own value format
  // — no explicit scheduled_time (undefined/null) displays the 08:00 default.
  const scheduledTime = day.scheduled_time ?? "08:00";
  // HRA-163: AC2/AC4 — reflects the day's real workout_type, folding every
  // non-run/rest value (todo/cross/strength/other) into "other" for display.
  const workoutTypeValue = workoutTypeSwitchValue(day.workout_type);
  const ActiveWorkoutTypeIcon = WORKOUT_TYPE_SWITCH_ICONS[workoutTypeValue];
  const [workoutTypeKey, workoutTypeFallback] = WORKOUT_TYPE_SWITCH_LABEL_KEYS[workoutTypeValue];
  // Live follow-up: this day's dsl/notes differ from what's actually
  // persisted (local-only until the whole-day bulk Save) — see UnsavedBadge.
  const dirty = isDayDirty?.(day) ?? false;

  return (
    <div
      {...drag.handlers}
      className={`card hra-text-primary${drag.isDragOver ? " hra-swap-drop-target" : ""}`}
      data-swappable={drag.swappable || undefined}
    >
      {/* Live follow-up (post-HRA-165): both rows are now ONE CSS Grid,
          columns [leading auto][middle 1fr][trailing auto], instead of two
          independent flex rows — a plain two-flex-row layout can't guarantee
          "column N in row 1 is the same width as column N in row 2" when
          both columns hold DIFFERENT, independently-sized content (date
          pill vs. switch; distance text vs. a native time input), which is
          exactly what was reported as misaligned. Grid tracks size to the
          WIDEST cell in that column across BOTH rows, so the date-pill/
          switch pair and the distance/time-input pair each land on a shared
          width automatically, no measurement or magic px numbers — and
          the DSL/Notes inputs (the shared 1fr middle track) end up the same
          width too, so their right edges line up, satisfying that
          requirement for free. Every cell below sets an EXPLICIT
          gridRow/gridColumn (not relying on document-order auto-flow) —
          required because several cells render nothing at all when a
          condition is false (the warning badge, an empty read-only note),
          and a skipped grid child under auto-flow would silently shift
          every later cell into the wrong column.
          Gap note: row 1 previously used gap:10, row 2 gap:8 — a single
          grid can only have one column-gap for both rows, so this now uses
          8 throughout (row 2's own gap, unchanged, per instruction; row 1's
          own gap shrinks by 2px as a minor, flagged side effect of sharing
          one grid). */}
      <div className="hra-plan-day-grid grid items-center gap-x-2 gap-y-1.5">
        {/* HRA-160: border color now comes from the day's classified
            category (--cat-color, set by the same hra-agenda-cat-* class
            the Agenda view uses) — the badge's own later-declared
            `background` rule (index.css) still wins the cascade over that
            class's own tinted background, so only the border changes here,
            not the pill's solid fill. Icon (same CATEGORY_ICONS map)
            renders after the date text. */}
        <span className={[`hra-day-date-badge ${categoryCatClass}`, "row-start-1 col-start-1"].filter(Boolean).join(" ")} >
          {dateBadge}
          <CategoryIcon size={12} />
        </span>
        {/* HRA-126: once approved, the dsl/note inputs simply don't render —
            plain text takes their place so the row still reads correctly. */}
        {readOnlyDays ? (
          <span className="row-start-1 col-start-2 min-w-0">{workoutText}</span>
        ) : (
          <input
            className={[inputClass, "row-start-1 col-start-2 w-full min-w-0 font-mono text-label p-1.5"].filter(Boolean).join(" ")}
            value={workoutText}
            onChange={e => onEdit({ dsl: recomposeDayLine(`${dayPrefix}${e.target.value}`, { notes: day.notes }) })}
            aria-label={t("runplan.accordion.dslLabel", "Workout (DSL)")}
          />
        )}
        <span className="hra-text-secondary row-start-1 col-start-3 flex items-center gap-2 text-meta" >
          {fmtDistance(day.distance, t)}
          {dirty && <UnsavedBadge t={t} />}
          {day.needs_review && <WarningBadge t={t} />}
        </span>

        {/* run/rest/other switch — "directly below the date pill" (HRA-163
            AC1) means literally here, in the date pill's own grid column,
            so the two share a width by construction (see the grid comment
            above) rather than an invisible clone. */}
        {readOnlyDays ? (
          <span className="hra-text-secondary row-start-2 col-start-1 flex items-center"  title={t(workoutTypeKey, workoutTypeFallback)}>
            <ActiveWorkoutTypeIcon size={14} />
          </span>
        ) : (
          <div className="hra-segment row-start-2 col-start-1 w-full" role="group" aria-label={t("runplan.accordion.workoutTypeSwitchLabel", "Day type")} >
            {(["run", "rest", "other"] as const).map(v => {
              const Icon = WORKOUT_TYPE_SWITCH_ICONS[v];
              const [key, fallback] = WORKOUT_TYPE_SWITCH_LABEL_KEYS[v];
              const label = t(key, fallback);
              return (
                <button
                  key={v} type="button" className="hra-segment-item flex-1 py-1 px-2 flex items-center justify-center" data-active={workoutTypeValue === v}
                  onClick={() => v !== workoutTypeValue && onWorkoutTypeEdit?.(v)} title={label} aria-label={label}
                >
                  <Icon size={14} />
                </button>
              );
            })}
          </div>
        )}
        {readOnlyDays ? (
          day.notes && <div className="hra-text-muted row-start-2 col-start-2 min-w-0 text-meta" >{day.notes}</div>
        ) : (
          <input
            className={[inputClass, "row-start-2 col-start-2 w-full min-w-0 p-1.5 text-meta"].filter(Boolean).join(" ")}
            value={day.notes ?? ""}
            onChange={e => onEdit({ notes: e.target.value })}
            placeholder={t("runplan.accordion.notePlaceholder", "Optional note")}
            aria-label={t("runplan.accordion.noteLabel", "Note")}
          />
        )}
        {readOnlyDays ? (
          <span className="hra-text-secondary row-start-2 col-start-3 text-meta" >{scheduledTime}</span>
        ) : (
          <input
            type="time"
            className={[inputClass, "row-start-2 col-start-3 w-full p-1.5 text-meta"].filter(Boolean).join(" ")}
            value={scheduledTime}
            onChange={e => onScheduledTimeEdit?.(e.target.value || null)}
            aria-label={t("runplan.accordion.scheduledTimeLabel", "Scheduled time")}
          />
        )}
      </div>
      {day.paceTargetBands && <PlannedPaceTargetChart model={day.paceTargetBands} />}
      {day.needs_review && day.warnings.length > 0 && (
        <ul className="hra-warning-list hra-text-danger text-meta mt-1.5 mb-0">
          {day.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
        </ul>
      )}
      {day.needs_review && day.warnings.length === 0 && (
        <div className="hra-text-danger text-meta mt-1.5" >
          {t("runplan.accordion.needsReview", "This day needs review before it can be saved.")}
        </div>
      )}
    </div>
  );
}

// Template day (day.date == null): unchanged accordion-with-textarea layout,
// split out from DayEditor below purely so its hooks (useState/useDragSwap)
// are never called on the InstanceDayRow branch — calling both branches'
// hooks unconditionally in one component, then early-returning, would
// violate the rules of hooks.
function TemplateDayRow({
  day, onEdit, readOnlyDays, dayRef, onDaySwap,
}: {
  day: DayView;
  onEdit: (patch: { dsl?: string; notes?: string }) => void;
  readOnlyDays: boolean;
  dayRef?: DayRef;
  onDaySwap?: (a: DayRef, b: DayRef) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const drag = useDragSwap(dayRef, readOnlyDays ? undefined : onDaySwap);

  // day.dsl is the whole raw line ("D3: 5km @ RG") — using it directly as
  // the label (ellipsis-truncated by TitleRow) reports the actual workout
  // at a glance, instead of a redundant bare "D3".
  return (
    <div {...drag.handlers} className={drag.isDragOver ? "hra-swap-drop-target" : undefined} data-swappable={drag.swappable || undefined}>
      <AccordionCard
        title={<TitleRow label={dayLabel(day)} summary={fmtDistance(day.distance, t)} hasWarning={day.needs_review} note={day.notes} t={t} />}
        expanded={expanded} onToggle={() => setExpanded(v => !v)}
      >
        <div className="flex flex-col gap-2">
          {/* HRA-126: once approved, the dsl/note inputs simply don't render —
              same "hide the input, the title/tooltip already shows the value"
              pattern readOnlySectionWeek already uses for Section/Week above. */}
          {!readOnlyDays && (
            <>
              <label className="hra-text-secondary text-meta" >
                {t("runplan.accordion.dslLabel", "Workout (DSL)")}
                <textarea
                  className={[inputClass, "w-full mt-1 font-mono text-meta p-1.5"].filter(Boolean).join(" ")}
                  value={day.dsl}
                  onChange={e => onEdit({ dsl: e.target.value })}
                  rows={2}
                />
              </label>
              <label className="hra-text-secondary text-meta" >
                {t("runplan.accordion.noteLabel", "Note")}
                <input
                  className={[inputClass, "w-full mt-1 p-1.5"].filter(Boolean).join(" ")}
                  value={day.notes ?? ""}
                  onChange={e => onEdit({ notes: e.target.value })}
                  placeholder={t("runplan.accordion.notePlaceholder", "Optional note")}
                />
              </label>
            </>
          )}
          {day.needs_review && day.warnings.length > 0 && (
            <ul className="hra-warning-list hra-text-danger text-meta m-0">
              {day.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
            </ul>
          )}
          {day.needs_review && day.warnings.length === 0 && (
            <div className="hra-text-danger text-meta" >
              {t("runplan.accordion.needsReview", "This day needs review before it can be saved.")}
            </div>
          )}
        </div>
      </AccordionCard>
    </div>
  );
}

// Dispatches on day.date (HRA-125's own instance-vs-template signal) — kept
// hook-free so each branch's component owns its own hooks unconditionally.
function DayEditor(props: {
  day: DayView;
  onEdit: (patch: { dsl?: string; notes?: string }) => void;
  readOnlyDays: boolean;
  dayRef?: DayRef;
  onDaySwap?: (a: DayRef, b: DayRef) => void;
  onScheduledTimeEdit?: (scheduledTime: string | null) => void;
  onWorkoutTypeEdit?: (workoutType: WorkoutTypeSwitchValue) => void;
  isDayDirty?: (day: DayView) => boolean;
}) {
  return props.day.date != null
    ? <InstanceDayRow {...props} date={props.day.date} />
    : <TemplateDayRow {...props} />;
}

function WeekEditor({
  week, sectionIndex, weekIndex, onWeekEdit, onDayEdit, readOnlySectionWeek, readOnlyDays, onDaySwap, onWeekSwap, onScheduledTimeEdit, onWorkoutTypeEdit, isDayDirty,
}: {
  week: WeekView;
  sectionIndex: number;
  weekIndex: number;
  onWeekEdit: (patch: { notes?: string }) => void;
  onDayEdit: (dayIndex: number, patch: { dsl?: string; notes?: string }) => void;
  readOnlySectionWeek: boolean;
  readOnlyDays: boolean;
  onDaySwap?: (a: DayRef, b: DayRef) => void;
  onWeekSwap?: (a: WeekRef, b: WeekRef) => void;
  onScheduledTimeEdit?: (dayIndex: number, scheduledTime: string | null) => void;
  onWorkoutTypeEdit?: (dayIndex: number, workoutType: WorkoutTypeSwitchValue) => void;
  isDayDirty?: (day: DayView) => boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const weekTitle = t("runplan.accordion.weekTitle", `Week ${week.number}`, { n: week.number });
  const weekRef: WeekRef = { sectionIndex, weekIndex };
  const drag = useDragSwap(weekRef, readOnlyDays ? undefined : onWeekSwap);
  // HRA-129: same "(start → end)" bracket convention DateRangeBar.tsx/
  // DateRangesSection.tsx already use for a named range — each side uses the
  // same weekday-first day format (instanceDayDateLabel) the day rows
  // themselves use, not a bare date, so a week's range reads consistently
  // with the days inside it. Review follow-up: rendered right next to the
  // "Week N" label itself (not appended to the totals summary on the right)
  // — the range identifies *which* week this is, same role as the label.
  const range = weekDateRange(week);
  const label = range ? `${weekTitle} (${instanceDayDateLabel(range.start)} → ${instanceDayDateLabel(range.end)})` : weekTitle;
  const summary = compactTotals(week.totals, t);

  return (
    <div {...drag.handlers} className={drag.isDragOver ? "hra-swap-drop-target" : undefined} data-swappable={drag.swappable || undefined}>
      <AccordionCard
        title={<TitleRow label={label} summary={summary} hasWarning={weekHasWarnings(week)} note={week.notes} t={t} />}
        expanded={expanded} onToggle={() => setExpanded(v => !v)}
      >
        <div className="flex flex-col gap-3">
          {!readOnlySectionWeek && (
            <label className="hra-text-secondary text-meta" >
              {t("runplan.accordion.noteLabel", "Note")}
              <input
                className={[inputClass, "w-full mt-1 p-1.5"].filter(Boolean).join(" ")}
                value={week.notes ?? ""}
                onChange={e => onWeekEdit({ notes: e.target.value })}
                placeholder={t("runplan.accordion.notePlaceholder", "Optional note")}
              />
            </label>
          )}
          {week.days.map((day, dayIndex) => (
            <DayEditor
              key={dayIndex} day={day} onEdit={patch => onDayEdit(dayIndex, patch)} readOnlyDays={readOnlyDays}
              dayRef={{ sectionIndex, weekIndex, dayIndex }} onDaySwap={onDaySwap}
              onScheduledTimeEdit={onScheduledTimeEdit ? time => onScheduledTimeEdit(dayIndex, time) : undefined}
              onWorkoutTypeEdit={onWorkoutTypeEdit ? workoutType => onWorkoutTypeEdit(dayIndex, workoutType) : undefined}
              isDayDirty={isDayDirty}
            />
          ))}
        </div>
      </AccordionCard>
    </div>
  );
}

function SectionEditor({
  section, sectionIndex, ownerName, onSectionEdit, onWeekEdit, onDayEdit, readOnlySectionWeek, readOnlyDays, onDaySwap, onWeekSwap, onScheduledTimeEdit, onWorkoutTypeEdit, isDayDirty,
}: {
  section: SectionView;
  sectionIndex: number;
  ownerName: string;
  onSectionEdit: (patch: { name?: string; notes?: string }) => void;
  onWeekEdit: (weekIndex: number, patch: { notes?: string }) => void;
  onDayEdit: (weekIndex: number, dayIndex: number, patch: { dsl?: string; notes?: string }) => void;
  readOnlySectionWeek: boolean;
  readOnlyDays: boolean;
  onDaySwap?: (a: DayRef, b: DayRef) => void;
  onWeekSwap?: (a: WeekRef, b: WeekRef) => void;
  onScheduledTimeEdit?: (weekIndex: number, dayIndex: number, scheduledTime: string | null) => void;
  onWorkoutTypeEdit?: (weekIndex: number, dayIndex: number, workoutType: WorkoutTypeSwitchValue) => void;
  isDayDirty?: (day: DayView) => boolean;
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
      <div className="flex flex-col gap-3">
        {isDefaultSection ? (
          <div className="hra-text-muted text-meta" >
            {t("runplan.accordion.defaultSectionName", `Name follows the plan's own name — ${ownerName}`, { name: ownerName })}
          </div>
        ) : !readOnlySectionWeek && (
          <label className="hra-text-secondary text-meta" >
            {t("runplan.accordion.sectionNameLabel", "Section name")}
            <input
              className={[inputClass, "w-full mt-1 p-1.5"].filter(Boolean).join(" ")}
              value={section.name}
              onChange={e => onSectionEdit({ name: e.target.value })}
            />
          </label>
        )}
        {!isDefaultSection && !readOnlySectionWeek && (
          <label className="hra-text-secondary text-meta" >
            {t("runplan.accordion.noteLabel", "Note")}
            <input
              className={[inputClass, "w-full mt-1 p-1.5"].filter(Boolean).join(" ")}
              value={section.notes ?? ""}
              onChange={e => onSectionEdit({ notes: e.target.value })}
              placeholder={t("runplan.accordion.notePlaceholder", "Optional note")}
            />
          </label>
        )}
        {section.weeks.map((week, weekIndex) => (
          <WeekEditor
            key={weekIndex}
            week={week}
            sectionIndex={sectionIndex}
            weekIndex={weekIndex}
            onWeekEdit={patch => onWeekEdit(weekIndex, patch)}
            onDayEdit={(dayIndex, patch) => onDayEdit(weekIndex, dayIndex, patch)}
            readOnlySectionWeek={readOnlySectionWeek}
            readOnlyDays={readOnlyDays}
            onDaySwap={onDaySwap}
            onWeekSwap={onWeekSwap}
            onScheduledTimeEdit={onScheduledTimeEdit ? (dayIndex, time) => onScheduledTimeEdit(weekIndex, dayIndex, time) : undefined}
            onWorkoutTypeEdit={onWorkoutTypeEdit ? (dayIndex, workoutType) => onWorkoutTypeEdit(weekIndex, dayIndex, workoutType) : undefined}
            isDayDirty={isDayDirty}
          />
        ))}
      </div>
    </AccordionCard>
  );
}

export function TrainingPlanAccordion({
  ownerName, sections, onSectionEdit, onWeekEdit, onDayEdit, readOnlySectionWeek = false, readOnlyDays = false, onDaySwap, onWeekSwap, onScheduledTimeEdit, onWorkoutTypeEdit, isDayDirty,
}: TrainingPlanAccordionProps) {
  return (
    <div>
      {sections.map((section, sectionIndex) => (
        <SectionEditor
          key={sectionIndex}
          section={section}
          sectionIndex={sectionIndex}
          ownerName={ownerName}
          onSectionEdit={patch => onSectionEdit(sectionIndex, patch)}
          onWeekEdit={(weekIndex, patch) => onWeekEdit(sectionIndex, weekIndex, patch)}
          onDayEdit={(weekIndex, dayIndex, patch) => onDayEdit(sectionIndex, weekIndex, dayIndex, patch)}
          readOnlySectionWeek={readOnlySectionWeek}
          readOnlyDays={readOnlyDays}
          onDaySwap={onDaySwap}
          onWeekSwap={onWeekSwap}
          onScheduledTimeEdit={onScheduledTimeEdit ? (weekIndex, dayIndex, time) => onScheduledTimeEdit(sectionIndex, weekIndex, dayIndex, time) : undefined}
          onWorkoutTypeEdit={onWorkoutTypeEdit ? (weekIndex, dayIndex, workoutType) => onWorkoutTypeEdit(sectionIndex, weekIndex, dayIndex, workoutType) : undefined}
          isDayDirty={isDayDirty}
        />
      ))}
    </div>
  );
}
