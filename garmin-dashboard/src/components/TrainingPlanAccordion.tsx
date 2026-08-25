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
import { useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { AccordionCard } from "./ui/AccordionCard";
import { fmtDate, fmtWeekdayShort } from "@/utils/fmt";
import type { AggregateTotals, DayView, DistanceTotal, SectionView, WeekView } from "../domain/runplan-aggregate";

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
function useDragSwap<TRef>(ref: TRef | undefined, onSwap: ((a: TRef, b: TRef) => void) | undefined) {
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
    fmtDistance(totals.distance, t),
  ].join(" · ");
}

// D<n>[suffix][ [tag]]: — the whole D-line prefix up to and including the
// colon (garmin-stats/src/domain/runplan/parser.ts's DAY_RE), stripped so
// only the workout description text after it remains.
const DAY_PREFIX_RE = /^D\d+[a-c]?(?:\s*\[[^\]]+\])?\s*:\s*/;

// HRA-125: an instance day's title shows its real calendar date + weekday
// instead of the "D<n>" placeholder — templates have no calendar dates
// (day.date is only ever set for instance days, runplan-aggregate.ts's
// buildInstanceSectionView), so template mode keeps day.dsl unchanged (AC3).
// Only the D<n> prefix is replaced — the workout text after the colon (and
// any trailing "# note" the DSL line already carries) stays visible (AC2).
function dayLabel(day: DayView): string {
  if (day.date == null) return day.dsl;
  const workoutText = day.dsl.replace(DAY_PREFIX_RE, "");
  return `${fmtDate(day.date)} ${fmtWeekdayShort(day.date)} ${workoutText}`;
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

// HRA-128: an instance day (day.date set) no longer needs a click-to-expand
// accordion — DSL/Notes render directly in a compact row, with the
// (non-editable) date pulled out into its own prominent badge instead of
// blending into the label text. Template days (day.date == null) keep the
// original accordion-with-textarea layout unchanged — templates were never
// in this Story's scope (HRA-116/117), and the whole distinguishing signal
// (day.date) already exists for exactly this kind of instance-only fork
// (see dayLabel() above, HRA-125).
function InstanceDayRow({
  day, date, onEdit, readOnlyDays, dayRef, onDaySwap,
}: {
  day: DayView;
  date: string;
  onEdit: (patch: { dsl?: string; notes?: string }) => void;
  readOnlyDays: boolean;
  dayRef?: DayRef;
  onDaySwap?: (a: DayRef, b: DayRef) => void;
}) {
  const { t } = useTranslation();
  const drag = useDragSwap(dayRef, readOnlyDays ? undefined : onDaySwap);
  const dateBadge = `${fmtWeekdayShort(date)} ${fmtDate(date)}`;
  const workoutText = day.dsl.replace(DAY_PREFIX_RE, "");

  return (
    <div
      {...drag.handlers}
      className={`card hra-text-primary${drag.isDragOver ? " hra-swap-drop-target" : ""}`}
      style={drag.swappable ? { cursor: "grab" } : undefined}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="hra-day-date-badge">{dateBadge}</span>
        {/* HRA-126: once approved, the dsl/note inputs simply don't render —
            plain text takes their place so the row still reads correctly. */}
        {readOnlyDays ? (
          <span style={{ flex: 1, minWidth: 0 }}>{workoutText}</span>
        ) : (
          <input
            className={inputClass}
            value={day.dsl}
            onChange={e => onEdit({ dsl: e.target.value })}
            aria-label={t("runplan.accordion.dslLabel", "Workout (DSL)")}
            style={{ flex: 1, minWidth: 0, fontFamily: "monospace", fontSize: 13, padding: 6 }}
          />
        )}
        <span className="hra-text-secondary" style={{ fontSize: 12, flexShrink: 0 }}>{fmtDistance(day.distance, t)}</span>
        {day.needs_review && <WarningBadge t={t} />}
      </div>
      {readOnlyDays ? (
        day.notes && <div className="hra-text-muted" style={{ fontSize: 12, marginTop: 6 }}>{day.notes}</div>
      ) : (
        <input
          className={inputClass}
          value={day.notes ?? ""}
          onChange={e => onEdit({ notes: e.target.value })}
          placeholder={t("runplan.accordion.notePlaceholder", "Optional note")}
          aria-label={t("runplan.accordion.noteLabel", "Note")}
          style={{ width: "100%", marginTop: 6, padding: 6, fontSize: 12 }}
        />
      )}
      {day.needs_review && day.warnings.length > 0 && (
        <ul className="hra-text-danger" style={{ fontSize: 12, margin: "6px 0 0", paddingLeft: 18 }}>
          {day.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
        </ul>
      )}
      {day.needs_review && day.warnings.length === 0 && (
        <div className="hra-text-danger" style={{ fontSize: 12, marginTop: 6 }}>
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
    <div {...drag.handlers} className={drag.isDragOver ? "hra-swap-drop-target" : undefined} style={drag.swappable ? { cursor: "grab" } : undefined}>
      <AccordionCard
        title={<TitleRow label={dayLabel(day)} summary={fmtDistance(day.distance, t)} hasWarning={day.needs_review} note={day.notes} t={t} />}
        expanded={expanded} onToggle={() => setExpanded(v => !v)}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* HRA-126: once approved, the dsl/note inputs simply don't render —
              same "hide the input, the title/tooltip already shows the value"
              pattern readOnlySectionWeek already uses for Section/Week above. */}
          {!readOnlyDays && (
            <>
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
            </>
          )}
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
}) {
  return props.day.date != null
    ? <InstanceDayRow {...props} date={props.day.date} />
    : <TemplateDayRow {...props} />;
}

function WeekEditor({
  week, sectionIndex, weekIndex, onWeekEdit, onDayEdit, readOnlySectionWeek, readOnlyDays, onDaySwap, onWeekSwap,
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
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const label = t("runplan.accordion.weekTitle", `Week ${week.number}`, { n: week.number });
  const weekRef: WeekRef = { sectionIndex, weekIndex };
  const drag = useDragSwap(weekRef, readOnlyDays ? undefined : onWeekSwap);

  return (
    <div {...drag.handlers} className={drag.isDragOver ? "hra-swap-drop-target" : undefined} style={drag.swappable ? { cursor: "grab" } : undefined}>
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
            <DayEditor
              key={dayIndex} day={day} onEdit={patch => onDayEdit(dayIndex, patch)} readOnlyDays={readOnlyDays}
              dayRef={{ sectionIndex, weekIndex, dayIndex }} onDaySwap={onDaySwap}
            />
          ))}
        </div>
      </AccordionCard>
    </div>
  );
}

function SectionEditor({
  section, sectionIndex, ownerName, onSectionEdit, onWeekEdit, onDayEdit, readOnlySectionWeek, readOnlyDays, onDaySwap, onWeekSwap,
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
            sectionIndex={sectionIndex}
            weekIndex={weekIndex}
            onWeekEdit={patch => onWeekEdit(weekIndex, patch)}
            onDayEdit={(dayIndex, patch) => onDayEdit(weekIndex, dayIndex, patch)}
            readOnlySectionWeek={readOnlySectionWeek}
            readOnlyDays={readOnlyDays}
            onDaySwap={onDaySwap}
            onWeekSwap={onWeekSwap}
          />
        ))}
      </div>
    </AccordionCard>
  );
}

export function TrainingPlanAccordion({
  ownerName, sections, onSectionEdit, onWeekEdit, onDayEdit, readOnlySectionWeek = false, readOnlyDays = false, onDaySwap, onWeekSwap,
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
        />
      ))}
    </div>
  );
}
