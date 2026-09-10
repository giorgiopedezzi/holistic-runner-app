/**
 * MobileWorkoutSwap.tsx (HRA-301)
 * Explicit mobile day-swap flow — "Scambia con…", reachable from
 * MobileWorkoutEditor's own action row (HRA-300's "shared workout action
 * model"), no drag gesture. A swap exchanges two calendar days' scheduled
 * content (dsl/notes + scheduled_time); the two calendar POSITIONS and their
 * own D-line identity never move (domain/runplan-patch.ts's swapDayContent,
 * the exact function the desktop drag-swap uses — see usePlanDayEditor.ts's
 * swapDaysByRef).
 *
 * Persists immediately through the SAME per-day PATCH pipeline
 * MobileWorkoutEditor already established for mobile (PATCH
 * /plan-instances/:id/days/:dayId, HRA-149) — one call per affected day, both
 * dsl and scheduled_time in the same request. This is a deliberate departure
 * from the desktop drag-swap's own behavior (usePlanDayEditor.swapDaysByRef,
 * local-only for dsl/notes until the instance's bulk Save persists it): the
 * desktop path's bulk Save (PATCH /plan-instances/:id with a full days
 * replace) unconditionally resets EVERY day's customized_at to null
 * (plan-templates.controller.ts's patchInstance handler), so routing this
 * Story's swap through it would silently defeat HRA-299's own customization
 * marker on every save, not just fail to set it on the swapped days. Only
 * the single-day PATCH sets customized_at (plan-instances.service.ts's
 * patchDay), which is why mobile's explicit swap — like HRA-300's DSL edits
 * before it — persists per-day, immediately, rather than staging a local
 * edit for the bulk-save flow.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight } from "lucide-react";
import { api, ApiError } from "@/api/client";
import { ConfirmModal } from "@/components/ui";
import { DAY_PREFIX_RE } from "@/components/TrainingPlanAccordion";
import { weekDateRange, type DayView, type SectionView } from "@/domain/runplan-aggregate";
import { swapDayContent } from "@/domain/runplan-patch";
import { flattenSwapTargets, type SwapBlockedReason } from "@/domain/day-swap-eligibility";
import { instanceDayDateLabel } from "@/utils/fmt";
import { isoToday } from "@/utils/date";
import { notify } from "@/utils/toast";
import type { PlanInstanceDay } from "@/types/api";

interface Props {
  source: DayView;
  sections: SectionView[];
  instanceId: number;
  raceDate: string | null | undefined;
  hasActivity: (date: string) => boolean;
  onClose: () => void;
  onSwapped: (updatedSource: PlanInstanceDay, updatedTarget: PlanInstanceDay) => void;
}

function dayLabel(day: DayView): string {
  return day.dsl.replace(DAY_PREFIX_RE, "").trim();
}

function blockedReasonLabel(reason: SwapBlockedReason, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (reason) {
    case "same-day":
      return t("manage.planInstances.mobileSwap.blockedSameDay", "This is the workout you're swapping.");
    case "past-or-completed":
      return t("manage.planInstances.mobileSwap.blockedPastOrCompleted", "Past or completed days can't be swapped.");
    case "race-day":
      return t("manage.planInstances.mobileSwap.blockedRaceDay", "Race day can't be swapped.");
  }
}

type SwapRecord = {
  updatedSource: PlanInstanceDay;
  updatedTarget: PlanInstanceDay;
  originalSource: { dsl: string; scheduledTime: string | null | undefined };
  originalTarget: { dsl: string; scheduledTime: string | null | undefined };
};

export function MobileWorkoutSwap({ source, sections, instanceId, raceDate, hasActivity, onClose, onSwapped }: Props) {
  const { t } = useTranslation();
  const [pendingTarget, setPendingTarget] = useState<DayView | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const [result, setResult] = useState<SwapRecord | null>(null);
  const [undoing, setUndoing] = useState(false);

  const ctx = { today: isoToday(), raceDate, hasActivity };
  const sourceLabel = `${source.date ? instanceDayDateLabel(source.date) : ""} — ${dayLabel(source)}`;

  async function doSwap(target: DayView) {
    if (source.id == null || target.id == null) return;
    setSwapping(true);
    setSwapError(null);
    const [newSourceDsl, newTargetDsl] = swapDayContent(source.dsl, target.dsl);
    try {
      const [updatedSource, updatedTarget] = await Promise.all([
        api.planInstances.patchDay(instanceId, source.id, { dsl: newSourceDsl, scheduled_time: target.scheduled_time ?? null }),
        api.planInstances.patchDay(instanceId, target.id, { dsl: newTargetDsl, scheduled_time: source.scheduled_time ?? null }),
      ]);
      onSwapped(updatedSource, updatedTarget);
      setResult({
        updatedSource, updatedTarget,
        originalSource: { dsl: source.dsl, scheduledTime: source.scheduled_time },
        originalTarget: { dsl: target.dsl, scheduledTime: target.scheduled_time },
      });
      notify(t("manage.planInstances.mobileSwap.succeeded", "Workouts swapped."));
      setPendingTarget(null);
    } catch (e) {
      setSwapError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setSwapping(false);
    }
  }

  // A swap is its own inverse — re-applying it to the just-persisted state
  // restores exactly the original dsl/scheduled_time on both days, so
  // "Annulla" is always a safe, well-defined action right after a successful
  // swap (AC9) — nothing else can have touched these two rows in the
  // interim, since this whole flow is a single-user, single-screen action.
  async function doUndo() {
    if (!result) return;
    setUndoing(true);
    setSwapError(null);
    try {
      await Promise.all([
        api.planInstances.patchDay(instanceId, result.updatedSource.id, { dsl: result.originalSource.dsl, scheduled_time: result.originalSource.scheduledTime ?? null }),
        api.planInstances.patchDay(instanceId, result.updatedTarget.id, { dsl: result.originalTarget.dsl, scheduled_time: result.originalTarget.scheduledTime ?? null }),
      ]).then(([undoneSource, undoneTarget]) => onSwapped(undoneSource, undoneTarget));
      notify(t("manage.planInstances.mobileSwap.undone", "Swap undone."));
      onClose();
    } catch (e) {
      setSwapError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div className="hra-mobile-workout-editor fixed inset-0 flex flex-col hra-bg-surface" role="dialog" aria-modal="true">
      <div className="flex items-center gap-3 p-4 hra-border-strong border-b">
        <ArrowLeftRight size={18} className="hra-text-secondary" aria-hidden="true" />
        <span className="hra-text-primary text-label font-semibold flex-1 min-w-0">
          {t("manage.planInstances.mobileSwap.title", `Swap: ${sourceLabel}`, { day: sourceLabel })}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close", "Close")}
          className="hra-text-muted text-heading border-0 bg-transparent cursor-pointer leading-none px-1"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4" aria-live="polite">
        {result ? (
          <div role="status" className="flex flex-col gap-3">
            <p className="hra-text-primary text-body">
              {t("manage.planInstances.mobileSwap.successBody", "The two workouts have been swapped.")}
            </p>
            {swapError && <div role="alert" className="hra-text-danger text-meta">{swapError}</div>}
            <div className="flex gap-3">
              <button type="button" className="hra-btn flex-1" onClick={doUndo} disabled={undoing}>
                {undoing ? t("common.saving", "Saving…") : t("manage.planInstances.mobileSwap.undoButton", "Undo")}
              </button>
              <button type="button" className="hra-btn flex-1" data-variant="green" onClick={onClose}>
                {t("common.done", "Done")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="hra-text-secondary text-meta">
              {t("manage.planInstances.mobileSwap.pickTarget", "Choose another day to swap this workout with.")}
            </p>
            {sections.map((section, sectionIndex) => (
              <div key={sectionIndex} className="flex flex-col gap-3">
                {section.weeks.map((week, weekIndex) => {
                  const range = weekDateRange(week);
                  const targets = flattenSwapTargets(source, [{ ...section, weeks: [week] }], ctx);
                  if (targets.length === 0) return null;
                  return (
                    <div key={weekIndex} className="flex flex-col gap-1">
                      <div className="hra-text-muted text-meta">
                        {t(
                          "manage.planInstances.mobileSwap.weekHeading",
                          `Week ${week.number}${range ? ` (${instanceDayDateLabel(range.start)} → ${instanceDayDateLabel(range.end)})` : ""}`,
                          { week: week.number },
                        )}
                      </div>
                      {targets.map(({ day, blocked }) => (
                        <button
                          key={day.id}
                          type="button"
                          className="hra-btn flex items-center justify-between gap-2 text-left"
                          disabled={blocked != null}
                          aria-disabled={blocked != null}
                          title={blocked ? blockedReasonLabel(blocked, t) : undefined}
                          onClick={() => setPendingTarget(day)}
                        >
                          <span className="min-w-0 truncate">{day.date ? instanceDayDateLabel(day.date) : ""} — {dayLabel(day)}</span>
                          {blocked && <span className="hra-text-muted text-meta flex-shrink-0">{blockedReasonLabel(blocked, t)}</span>}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
            {swapError && !pendingTarget && <div role="alert" className="hra-text-danger text-meta">{swapError}</div>}
          </>
        )}
      </div>

      {!result && (
        <div className="hra-mobile-workout-editor-actions flex items-center gap-3 hra-border-strong border-t">
          <button type="button" className="hra-btn flex-1" onClick={onClose}>
            {t("common.cancel", "Cancel")}
          </button>
        </div>
      )}

      <ConfirmModal
        open={pendingTarget != null}
        title={
          pendingTarget && (
            <div className="hra-text-primary text-label font-semibold leading-normal mb-4 flex flex-col gap-2">
              <span>{t("manage.planInstances.mobileSwap.confirmTitle", "Confirm swap")}</span>
              <span className="text-body font-normal">
                {t(
                  "manage.planInstances.mobileSwap.confirmBody",
                  `${source.date ? instanceDayDateLabel(source.date) : ""} (${dayLabel(source)}) ↔ ${pendingTarget.date ? instanceDayDateLabel(pendingTarget.date) : ""} (${dayLabel(pendingTarget)})`,
                  { a: sourceLabel, b: `${pendingTarget.date ? instanceDayDateLabel(pendingTarget.date) : ""} — ${dayLabel(pendingTarget)}` },
                )}
              </span>
              {swapError && <span role="alert" className="hra-text-danger text-meta">{swapError}</span>}
            </div>
          )
        }
        confirmLabel={swapping ? t("common.saving", "Saving…") : t("manage.planInstances.swapConfirmButton", "Swap")}
        maxWidth={420}
        onConfirm={() => pendingTarget && !swapping && doSwap(pendingTarget)}
        onCancel={() => { if (!swapping) setPendingTarget(null); }}
      />
    </div>
  );
}
