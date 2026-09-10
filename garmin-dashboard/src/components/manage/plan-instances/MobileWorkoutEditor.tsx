/**
 * MobileWorkoutEditor.tsx (HRA-300)
 * Full-screen mobile editor for ONE plan-instance workout — opened from a
 * race-plan workout row or its corresponding Agenda entry (both render
 * through PlanInstanceCalendar, which mounts this in place of the desktop
 * DayEditModal whenever useIsPhone() is true and an instanceId is supplied).
 * Deliberately NOT DayEditModal's centered popup-over-a-card shape (HRA-300's
 * own "never a small textarea inside an expanded card" rule) — this covers
 * the whole viewport, with Save/Cancel pinned above the keyboard/safe-area.
 *
 * Persists through the SAME per-day pipeline every other day-level edit in
 * this app already uses (PATCH /plan-instances/:id/days/:dayId, HRA-149) —
 * no new endpoint, no mobile-only data model. Type switching reuses
 * TrainingPlanAccordion's own icon/label/fold-to-"other" mapping and
 * runplan-patch's nextWorkoutTypeDsl (HRA-300 extraction of HRA-163's own
 * mutation) — the exact same DSL-text rule the desktop switch already
 * follows, not a parallel implementation.
 *
 * Single DSL field, not the desktop's split dsl/notes pair: the Story's own
 * scope list names one "Full-width multiline DSL input", so any trailing
 * "# note" is edited inline as part of the same text here, deliberately
 * simpler than InstanceDayRow's two-field layout.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight } from "lucide-react";
import { api, ApiError } from "@/api/client";
import { ConfirmModal } from "@/components/ui";
import {
  DAY_PREFIX_RE, WORKOUT_TYPE_SWITCH_ICONS, WORKOUT_TYPE_SWITCH_LABEL_KEYS, workoutTypeSwitchValue,
  type WorkoutTypeSwitchValue,
} from "@/components/TrainingPlanAccordion";
import { nextWorkoutTypeDsl, splitNote } from "@/domain/runplan-patch";
import { reconstructDslFromResolvedDay, type DayView } from "@/domain/runplan-aggregate";
import { instanceDayDateLabel } from "@/utils/fmt";
import { notify } from "@/utils/toast";
import type { PlanInstanceDay } from "@/types/api";
import type { ParseWarning } from "@/types/runplan";

type Validation =
  | { status: "checking" }
  | { status: "valid"; previewText: string }
  | { status: "invalid"; warnings: ParseWarning[] };

interface Props {
  day: DayView;
  instanceId: number;
  onClose: () => void;
  onSaved: (updated: PlanInstanceDay) => void;
  // HRA-301: opens the explicit mobile day-swap flow (MobileWorkoutSwap) for
  // this same day — omitted where the caller has no full-plan `sections` to
  // build a cross-week target list from (the mobile current-week-only
  // preview ribbon), in which case no swap entry point is offered there.
  onSwap?: () => void;
}

export function MobileWorkoutEditor({ day, instanceId, onClose, onSaved, onSwap }: Props) {
  const { t } = useTranslation();
  const dayId = day.id!;
  const dayPrefix = day.dsl.match(DAY_PREFIX_RE)?.[0] ?? "";
  const initialText = day.dsl.slice(dayPrefix.length);
  const [draftText, setDraftText] = useState(initialText);
  const [activeType, setActiveType] = useState<WorkoutTypeSwitchValue>(workoutTypeSwitchValue(day.workout_type));
  const [pendingType, setPendingType] = useState<WorkoutTypeSwitchValue | null>(null);
  const [validation, setValidation] = useState<Validation>({ status: "checking" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const isDirty = draftText !== initialText;
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const closingRef = useRef(false);

  // HRA-300 AC: accidental navigation (browser/route back) requires an
  // explicit discard decision while dirty. Pushing a history entry on open
  // and intercepting popstate is the one mechanism that covers BOTH a real
  // browser back press and a Capacitor WebView's hardware back button —
  // this repo has no Capacitor integration to attach a native listener to
  // (verified: no @capacitor/* dependency anywhere), and Capacitor's own
  // default Android back-button behavior is itself to call history.back()
  // absent a registered listener, so this is the correct hook point for
  // when that integration is eventually added, not a placeholder guess.
  useEffect(() => {
    window.history.pushState({ hraMobileWorkoutEditor: true }, "");
    function handlePopState() {
      if (closingRef.current) return;
      if (dirtyRef.current) {
        window.history.pushState({ hraMobileWorkoutEditor: true }, "");
        setShowDiscardConfirm(true);
        return;
      }
      closingRef.current = true;
      onClose();
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirtyRef.current) return;
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Debounced live validation/preview — same 400ms cadence and endpoint
  // (POST .../validate, parse-only, never persists) usePlanDayEditor's own
  // scheduleLiveValidate already uses for the desktop List view.
  useEffect(() => {
    const bodyMain = splitNote(draftText).main.trim();
    if (!bodyMain) {
      setValidation({
        status: "invalid",
        warnings: [{ line: 1, content: "", message: t("manage.planInstances.mobileEditor.emptyWorkout", "Enter a workout, or switch to Rest/Other.") }],
      });
      return;
    }
    setValidation({ status: "checking" });
    const fullDsl = `${dayPrefix}${draftText}`;
    const timer = setTimeout(() => {
      api.planInstances.validateDay(instanceId, dayId, fullDsl)
        .then(result => {
          if (result.needs_review || !result.workout_type || !result.segments) {
            setValidation({ status: "invalid", warnings: result.warnings });
            return;
          }
          setActiveType(workoutTypeSwitchValue(result.workout_type));
          const previewNote = splitNote(draftText).note;
          const previewText = reconstructDslFromResolvedDay({
            section_name: "", week_number: 0, date: day.date ?? "",
            day: day.day, suffix: day.suffix, category: day.category,
            workout_type: result.workout_type, segments: result.segments,
            activity_target: result.activity_target ?? undefined,
            activity_description: result.activity_description ?? undefined,
            notes: previewNote, needs_review: false,
          }).replace(DAY_PREFIX_RE, "");
          setValidation({ status: "valid", previewText });
        })
        .catch(e => {
          setValidation({ status: "invalid", warnings: [{ line: 1, content: "", message: e instanceof Error ? e.message : String(e) }] });
        });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftText]);

  function closeNow() {
    closingRef.current = true;
    window.history.back();
    onClose();
  }

  function requestClose() {
    if (isDirty) { setShowDiscardConfirm(true); return; }
    closeNow();
  }

  function applyWorkoutTypeSwitch(workoutType: WorkoutTypeSwitchValue) {
    const currentNote = splitNote(draftText).note;
    const newLine = nextWorkoutTypeDsl(`${dayPrefix}${draftText}`, currentNote, workoutType);
    setDraftText(newLine.slice(dayPrefix.length));
    setActiveType(workoutType);
    setPendingType(null);
  }

  async function onSave() {
    if (validation.status !== "valid" || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.planInstances.patchDay(instanceId, dayId, { dsl: `${dayPrefix}${draftText}` });
      onSaved(updated);
      notify(t("manage.planInstances.mobileEditor.saved", "Workout saved."));
      closeNow();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const dateLabel = day.date != null ? instanceDayDateLabel(day.date) : "";
  const typeConfirmCurrentText = draftText.trim();
  const typeConfirmTitle = pendingType === "run"
    ? t("manage.planInstances.workoutTypeConfirmClearTitle", `Clear ${dateLabel}'s workout text ("${typeConfirmCurrentText}") so you can enter a new run?`, { date: dateLabel, body: typeConfirmCurrentText })
    : t(
      "manage.planInstances.workoutTypeConfirmSetTitle",
      `Set ${dateLabel} to ${pendingType === "rest" ? t("runplan.accordion.workoutTypeRest", "Rest") : t("runplan.accordion.workoutTypeOther", "Other")}? This replaces the current workout text ("${typeConfirmCurrentText}").`,
      { date: dateLabel, type: pendingType === "rest" ? t("runplan.accordion.workoutTypeRest", "Rest") : t("runplan.accordion.workoutTypeOther", "Other"), body: typeConfirmCurrentText },
    );

  return (
    <div className="hra-mobile-workout-editor fixed inset-0 flex flex-col hra-bg-surface" role="dialog" aria-modal="true">
      <div className="flex items-center gap-3 p-4 hra-border-strong border-b">
        <span className="hra-text-primary text-label font-semibold flex-1 min-w-0">{dateLabel}</span>
        <button
          type="button"
          onClick={requestClose}
          aria-label={t("common.close", "Close")}
          className="hra-text-muted text-heading border-0 bg-transparent cursor-pointer leading-none px-1"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        <div className="hra-segment w-full" role="group" aria-label={t("runplan.accordion.workoutTypeSwitchLabel", "Day type")}>
          {(["run", "rest", "other"] as const).map(v => {
            const Icon = WORKOUT_TYPE_SWITCH_ICONS[v];
            const [key, fallback] = WORKOUT_TYPE_SWITCH_LABEL_KEYS[v];
            const label = t(key, fallback);
            return (
              <button
                key={v} type="button" className="hra-segment-item flex-1 py-2 px-2 flex items-center justify-center gap-1.5" data-active={activeType === v}
                onClick={() => v !== activeType && setPendingType(v)} title={label} aria-label={label}
              >
                <Icon size={16} />
                <span className="text-meta">{label}</span>
              </button>
            );
          })}
        </div>

        {onSwap && (
          <button
            type="button"
            className="hra-btn flex items-center justify-center gap-2"
            onClick={onSwap}
          >
            <ArrowLeftRight size={16} aria-hidden="true" />
            {t("manage.planInstances.mobileEditor.swapButton", "Swap with…")}
          </button>
        )}

        <label className="hra-text-secondary text-meta flex flex-col gap-1">
          {t("runplan.accordion.dslLabel", "Workout plan text (DSL)")}
          <textarea
            className="hra-border-strong hra-bg-card hra-text-primary w-full mt-1 font-mono text-body p-3 rounded-lg"
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            rows={6}
            aria-label={t("runplan.accordion.dslLabel", "Workout plan text (DSL)")}
            aria-invalid={validation.status === "invalid" ? true : undefined}
          />
        </label>

        {validation.status === "checking" && (
          <div className="hra-text-muted text-meta">{t("manage.planInstances.mobileEditor.checking", "Checking…")}</div>
        )}
        {validation.status === "valid" && (
          <div className="hra-text-secondary text-meta flex flex-col gap-1">
            <span className="hra-text-muted">{t("manage.planInstances.mobileEditor.previewLabel", "Preview")}</span>
            <span className="hra-text-primary font-mono">{validation.previewText}</span>
          </div>
        )}
        {validation.status === "invalid" && (
          <div role="alert" className="hra-text-danger text-meta flex flex-col gap-1">
            {validation.warnings.map((w, i) => <span key={i}>{w.message}</span>)}
          </div>
        )}
        {saveError && <div role="alert" className="hra-text-danger text-meta">{saveError}</div>}
      </div>

      <div className="hra-mobile-workout-editor-actions flex items-center gap-3 hra-border-strong border-t">
        <button type="button" className="hra-btn flex-1" onClick={requestClose}>
          {t("common.cancel", "Cancel")}
        </button>
        <button
          type="button"
          className="hra-btn flex-1"
          data-variant="green"
          disabled={validation.status !== "valid" || saving}
          onClick={onSave}
        >
          {saving ? t("manage.planInstances.mobileEditor.saving", "Saving…") : t("manage.planInstances.mobileEditor.saveButton", "Save")}
        </button>
      </div>

      <ConfirmModal
        open={pendingType != null}
        title={<div className="hra-text-primary text-label font-semibold leading-normal mb-4">{typeConfirmTitle}</div>}
        confirmLabel={t("common.confirm", "Confirm")}
        maxWidth={420}
        onConfirm={() => pendingType && applyWorkoutTypeSwitch(pendingType)}
        onCancel={() => setPendingType(null)}
      />
      <ConfirmModal
        open={showDiscardConfirm}
        title={<div className="hra-text-primary text-label font-semibold leading-normal mb-4">{t("manage.planInstances.mobileEditor.discardTitle", "Discard your changes?")}</div>}
        confirmLabel={t("manage.planInstances.mobileEditor.discardConfirm", "Discard")}
        variant="danger"
        onConfirm={() => { setShowDiscardConfirm(false); closeNow(); }}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </div>
  );
}
