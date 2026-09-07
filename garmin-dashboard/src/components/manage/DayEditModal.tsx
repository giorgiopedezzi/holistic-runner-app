/**
 * DayEditModal.tsx (HRA-265)
 * Popup shell (same visual pattern as ActivityModal.tsx: fixed backdrop,
 * literal "×" close button, no close-on-backdrop-click) wrapping the exact
 * same DSL/notes fields TrainingPlanAccordion's InstanceDayRow already edits
 * inline — opened from PlanInstanceCalendar.tsx when a planned-only day is
 * clicked. Edits go through the SAME onDayEdit(patch) local-state path
 * InstanceDayRow's own inputs already use (a whole-instance Save button
 * persists it, unchanged by this Story) — this modal has no Save button of
 * its own, only ×.
 */
import { useTranslation } from "react-i18next";
import { DAY_PREFIX_RE } from "@/components/TrainingPlanAccordion";
import { recomposeDayLine, splitNote } from "@/domain/runplan-patch";
import { instanceDayDateLabel } from "@/utils/fmt";
import type { DayView } from "@/domain/runplan-aggregate";

const inputClass = "hra-border-strong hra-bg-card hra-text-primary";

interface Props {
  day: DayView;
  readOnlyDays: boolean;
  onEdit?: (patch: { dsl?: string; notes?: string }) => void;
  onClose: () => void;
}

export function DayEditModal({ day, readOnlyDays, onEdit, onClose }: Props) {
  const { t } = useTranslation();
  // Same prefix-strip/reattach convention InstanceDayRow already uses — see
  // that component's own comments for why the D-prefix and trailing note are
  // never shown/edited directly in this field.
  const dayPrefix = day.dsl.match(DAY_PREFIX_RE)?.[0] ?? "";
  const workoutText = splitNote(day.dsl.slice(dayPrefix.length)).main;

  return (
    <div className="hra-modal-backdrop hra-modal-layer fixed inset-0 flex items-center justify-center p-6">
      <div className="hra-activity-modal hra-bg-surface hra-border rounded-2xl w-full overflow-y-auto p-6">
        <div className="flex items-center gap-3 mb-5">
          {day.date != null && <span className="hra-text-secondary text-label">{instanceDayDateLabel(day.date)}</span>}
          <div className="flex-1" />
          <button
            onClick={onClose}
            aria-label={t("common.close", "Close")}
            className="hra-text-muted text-heading border-0 bg-transparent cursor-pointer leading-none px-1"
          >
            ×
          </button>
        </div>

        {readOnlyDays ? (
          <div className="hra-text-primary font-mono text-label mb-3">{workoutText}</div>
        ) : (
          <label className="hra-text-secondary text-meta flex flex-col gap-1 mb-3">
            {t("runplan.accordion.dslLabel", "Workout plan text (DSL)")}
            <textarea
              className={[inputClass, "w-full mt-1 font-mono text-meta p-1.5"].filter(Boolean).join(" ")}
              value={workoutText}
              onChange={e => onEdit?.({ dsl: recomposeDayLine(`${dayPrefix}${e.target.value}`, { notes: day.notes }) })}
              rows={3}
            />
          </label>
        )}

        {readOnlyDays ? (
          day.notes && <div className="hra-text-muted text-meta">{day.notes}</div>
        ) : (
          <label className="hra-text-secondary text-meta flex flex-col gap-1">
            {t("runplan.accordion.noteLabel", "Note")}
            <input
              className={[inputClass, "w-full mt-1 p-1.5"].filter(Boolean).join(" ")}
              value={day.notes ?? ""}
              onChange={e => onEdit?.({ notes: e.target.value })}
              placeholder={t("runplan.accordion.notePlaceholder", "Optional note")}
            />
          </label>
        )}
      </div>
    </div>
  );
}
