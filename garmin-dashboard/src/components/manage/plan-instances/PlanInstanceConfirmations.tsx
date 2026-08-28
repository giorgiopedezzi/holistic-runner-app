import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal } from "@/components/ui";
import { DAY_PREFIX_RE, type DayRef, type WeekRef } from "@/components/TrainingPlanAccordion";
import { weekDateRange, type DayView, type SectionView } from "@/domain/runplan-aggregate";
import { instanceDayDateLabel } from "@/utils/fmt";
import type { WorkoutTypeChange } from "./usePlanDayEditor";

export type PlanInstanceConfirmation =
  | { type: "rename" }
  | { type: "switch-template"; templateId: string }
  | { type: "regenerate"; manualEditCount: number }
  | { type: "restore" }
  | { type: "workout-type"; change: WorkoutTypeChange }
  | { type: "day-swap"; a: DayRef; b: DayRef }
  | { type: "week-swap"; a: WeekRef; b: WeekRef }
  | { type: "delete"; instanceId: number }
  | null;

interface Props {
  confirmation: PlanInstanceConfirmation;
  sections: SectionView[];
  onConfirm: () => void;
  onCancel: () => void;
}

function ModalTitle({ children }: { children: ReactNode }) {
  return (
    <div className="hra-text-primary text-label font-semibold leading-normal mb-4">
      {children}
    </div>
  );
}

function dayByRef(sections: SectionView[], ref: DayRef) {
  return sections[ref.sectionIndex]?.weeks[ref.weekIndex]?.days[ref.dayIndex];
}

function labelForDay(day: DayView): string {
  return `${instanceDayDateLabel(day.date!)} (${day.dsl.replace(DAY_PREFIX_RE, "")})`;
}

export function PlanInstanceConfirmations({ confirmation, sections, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  if (!confirmation) return null;

  switch (confirmation.type) {
    case "rename":
      return (
        <ConfirmModal
          open
          title={<ModalTitle>{t("manage.planInstances.renameConfirmBody", "This will rename the current plan — it won't create a copy. Continue?")}</ModalTitle>}
          confirmLabel={t("manage.planInstances.renameConfirmButton", "Rename")}
          variant="green"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

    case "switch-template":
      return (
        <ConfirmModal
          open
          title={
            <>
              <div className="hra-text-primary text-label font-semibold mb-2">
                {t("manage.planInstances.switchTemplateTitle", "Discard current instance data?")}
              </div>
              <div className="hra-text-secondary text-meta leading-normal mb-4">
                {t("manage.planInstances.switchTemplateBody", "This instance hasn't been created yet. Picking a different template will lose the name, dates, and pace values you've already entered.")}
              </div>
            </>
          }
          confirmLabel={t("manage.planInstances.switchTemplateConfirm", "Switch template")}
          variant="danger"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

    case "regenerate":
      return (
        <ConfirmModal
          open
          title={
            <ModalTitle>
              {t(
                "manage.planInstances.regenerateConfirmTitle",
                `Regenerating will discard ${confirmation.manualEditCount} manual edit(s) — continue?`,
                { count: confirmation.manualEditCount },
              )}
            </ModalTitle>
          }
          confirmLabel={t("manage.planInstances.regenerateConfirmButton", "Regenerate")}
          variant="danger"
          maxWidth={400}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

    case "restore":
      return (
        <ConfirmModal
          open
          title={<ModalTitle>{t("manage.planInstances.restoreConfirmBody", "You have unsaved changes — reset them to the previous values?")}</ModalTitle>}
          confirmLabel={t("manage.planInstances.resetButton", "Reset to previous values")}
          variant="danger"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

    case "workout-type": {
      const { sectionIndex, weekIndex, dayIndex, workoutType } = confirmation.change;
      const day = sections[sectionIndex]?.weeks[weekIndex]?.days[dayIndex];
      const currentText = day ? day.dsl.replace(DAY_PREFIX_RE, "") : "";
      const dateLabel = day?.date ? instanceDayDateLabel(day.date) : "";
      const typeLabel = workoutType === "rest"
        ? t("runplan.accordion.workoutTypeRest", "Rest")
        : workoutType === "other"
          ? t("runplan.accordion.workoutTypeOther", "Other")
          : t("runplan.accordion.workoutTypeRun", "Run");
      const title = workoutType === "run"
        ? t("manage.planInstances.workoutTypeConfirmClearTitle", `Clear ${dateLabel}'s workout text ("${currentText}") so you can enter a new run?`, { date: dateLabel, body: currentText })
        : t("manage.planInstances.workoutTypeConfirmSetTitle", `Set ${dateLabel} to ${typeLabel}? This replaces the current workout text ("${currentText}").`, { date: dateLabel, type: typeLabel, body: currentText });

      return (
        <ConfirmModal
          open
          title={<ModalTitle>{title}</ModalTitle>}
          confirmLabel={t("common.confirm", "Confirm")}
          maxWidth={420}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );
    }

    case "day-swap": {
      const dayA = dayByRef(sections, confirmation.a);
      const dayB = dayByRef(sections, confirmation.b);
      const body = dayA && dayB ? `${labelForDay(dayA)} with ${labelForDay(dayB)}` : "";
      return (
        <ConfirmModal
          open
          title={<ModalTitle>{t("manage.planInstances.daySwapConfirmTitle", `Swap ${body}?`, { body })}</ModalTitle>}
          confirmLabel={t("manage.planInstances.swapConfirmButton", "Swap")}
          maxWidth={420}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );
    }

    case "week-swap": {
      const weekA = sections[confirmation.a.sectionIndex]?.weeks[confirmation.a.weekIndex];
      const weekB = sections[confirmation.b.sectionIndex]?.weeks[confirmation.b.weekIndex];
      const rangeA = weekA ? weekDateRange(weekA) : null;
      const rangeB = weekB ? weekDateRange(weekB) : null;
      const body = rangeA && rangeB
        ? `week ${instanceDayDateLabel(rangeA.start)} → ${instanceDayDateLabel(rangeA.end)} with week ${instanceDayDateLabel(rangeB.start)} → ${instanceDayDateLabel(rangeB.end)}`
        : "";
      return (
        <ConfirmModal
          open
          title={<ModalTitle>{t("manage.planInstances.weekSwapConfirmTitle", `Swap ${body}?`, { body })}</ModalTitle>}
          confirmLabel={t("manage.planInstances.swapConfirmButton", "Swap")}
          maxWidth={420}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );
    }

    case "delete":
      return (
        <ConfirmModal
          open
          title={<ModalTitle>{t("manage.planInstances.deleteConfirm", "Delete this instance?")}</ModalTitle>}
          confirmLabel={t("common.yesDelete", "Yes, delete")}
          variant="danger"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );
  }
}
