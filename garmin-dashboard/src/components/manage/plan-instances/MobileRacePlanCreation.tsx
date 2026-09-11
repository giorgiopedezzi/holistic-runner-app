/**
 * MobileRacePlanCreation.tsx (HRA-302)
 * Full-screen mobile flow for "Usa per una gara" (PlanTemplatesSection's own
 * mobile row, HRA-296/HRA-297), the entry point those Stories left disabled
 * pending this one. Template choice already happened by the time this opens
 * (the runner tapped that template's row) — this only covers HRA-294's
 * remaining steps: race name/date, goal time, review, create.
 *
 * Eligibility and pace resolution are never re-derived here: GET
 * .../mobile-eligibility and POST .../instantiate/preview both reuse the
 * exact same domain/runplan resolver the real POST .../instantiate call
 * already uses (garmin-stats/src/domain/runplan/mobile-eligibility.ts) — this
 * component only renders whatever those two calls report. An ineligible
 * template (racePaceAnchor requires desktop's manual anchor table, or the
 * template's own graph never fully resolves) shows one concise explanation
 * and a way back, never a partial or guessed plan (HRA-302 AC5).
 *
 * Same full-screen dialog shape and dirty-guard convention as
 * MobileWorkoutEditor.tsx/MobileWorkoutSwap.tsx (HRA-300/HRA-301) — covers
 * the viewport, Cancel/Create pinned above the keyboard, back/browser
 * navigation intercepted while the form step has unsaved input.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/api/client";
import { ConfirmModal } from "@/components/ui";
import { buildTemplateSectionView } from "@/domain/runplan-aggregate";
import { addDaysISO } from "./planInstanceEditor.selectors";
import { fmtPace } from "@/utils/fmt";
import { paceUnitLabel } from "@/utils/units";
import { isoToday } from "@/utils/date";
import { notify } from "@/utils/toast";
import type { PlanInstanceWithDays, PlanTemplate } from "@/types/api";
import type { RunPlan } from "@/types/runplan";

const GOAL_TIME_RE = /^([0-9]{1,2}):([0-5][0-9]):([0-5][0-9])$/;

type Eligibility = {
  eligible: boolean;
  race_pace_anchor: string | null;
  distance_m: number | null;
  reason: "already-resolved" | "ambiguous-anchors" | "unresolvable" | null;
};

type Step =
  | { kind: "checking" }
  | { kind: "ineligible" }
  | { kind: "form" }
  | { kind: "review"; startDate: string; resolvedPaces: Record<string, number> }
  | { kind: "error"; message: string };

interface Props {
  template: PlanTemplate;
  onClose: () => void;
  onCreated: (instance: PlanInstanceWithDays) => void;
}

// Total scheduled days across every section — used only to derive a start
// date that lands the plan's last day on race day (start = raceDate -
// (totalDays - 1)). Purely a day count from the template's own already-parsed
// structure, no pace resolution involved.
function totalPlanDays(plan: RunPlan): number {
  return plan.sections.reduce((sum, section) => {
    const view = buildTemplateSectionView(section, plan.metadata.pace_policy);
    return sum + view.totals.totalDays;
  }, 0);
}

export function MobileRacePlanCreation({ template, onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [step, setStep] = useState<Step>({ kind: "checking" });

  const [raceName, setRaceName] = useState("");
  const [raceDate, setRaceDate] = useState("");
  const [goalTime, setGoalTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const isDirty = raceName.trim() !== "" || raceDate.trim() !== "" || goalTime.trim() !== "";
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const closingRef = useRef(false);

  // Same accidental-navigation guard as MobileWorkoutEditor (HRA-300) — a
  // pushed history entry intercepted by popstate, the one mechanism that
  // covers both a real browser back press and a future Capacitor back button.
  useEffect(() => {
    window.history.pushState({ hraMobileRacePlanCreation: true }, "");
    function handlePopState() {
      if (closingRef.current) return;
      if (dirtyRef.current && step.kind !== "review") {
        window.history.pushState({ hraMobileRacePlanCreation: true }, "");
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

  useEffect(() => {
    let cancelled = false;
    api.planTemplates.mobileEligibility(template.id).then(result => {
      if (cancelled) return;
      setEligibility(result);
      setStep(result.eligible ? { kind: "form" } : { kind: "ineligible" });
    }).catch(() => {
      if (cancelled) return;
      setStep({ kind: "ineligible" });
    });
    return () => { cancelled = true; };
  }, [template.id]);

  function closeNow() {
    closingRef.current = true;
    window.history.back();
    onClose();
  }

  function requestClose() {
    if (isDirty && step.kind !== "review") { setShowDiscardConfirm(true); return; }
    closeNow();
  }

  const needsGoalTime = eligibility?.race_pace_anchor != null;
  const goalTimeValid = !needsGoalTime || GOAL_TIME_RE.test(goalTime.trim());
  const canReview = raceName.trim() !== "" && raceDate.trim() !== "" && goalTimeValid && (!needsGoalTime || goalTime.trim() !== "");

  async function onReview() {
    if (!canReview || submitting) return;
    setSubmitting(true);
    try {
      const plan = JSON.parse(template.parsed_plan) as RunPlan;
      const days = totalPlanDays(plan);
      const startDate = addDaysISO(raceDate, -(Math.max(days, 1) - 1));
      const preview = await api.planTemplates.instantiatePreview(template.id, {
        start_date: startDate,
        goal_time: needsGoalTime ? goalTime.trim() : undefined,
        race_pace_anchor: needsGoalTime ? eligibility!.race_pace_anchor! : undefined,
      });
      if (preview.needs_review) {
        // The structural check passed but this specific input still leaves a
        // day unresolved (e.g. an edge-case template) — never fabricate a
        // plan (HRA-302 AC5); fall back to the same desktop-required screen,
        // with the runner's safe fields preserved (they're still in state).
        setStep({ kind: "ineligible" });
        return;
      }
      setStep({ kind: "review", startDate, resolvedPaces: preview.resolved_paces });
    } catch (e) {
      setStep({ kind: "error", message: e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  async function onCreate() {
    if (step.kind !== "review" || creating) return;
    setCreating(true);
    try {
      const instance = await api.planTemplates.instantiate(template.id, {
        name: raceName.trim(),
        start_date: step.startDate,
        goal_time: needsGoalTime ? goalTime.trim() : undefined,
        race_pace_anchor: needsGoalTime ? eligibility!.race_pace_anchor! : undefined,
        race_name: raceName.trim(),
        race_date: raceDate,
      });
      notify(t("manage.planInstances.mobileCreate.created", "Race plan created."));
      onCreated(instance);
      closeNow();
    } catch (e) {
      // A failed Create must never claim success and must keep every entered
      // field — stay on the review step exactly as-is, just surface the error.
      notify(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e), "error");
    } finally {
      setCreating(false);
    }
  }

  const paceEntries = step.kind === "review" ? Object.entries(step.resolvedPaces) : [];
  const paceLine = paceEntries.map(([anchor, secPerKm]) => `${anchor} ${fmtPace(secPerKm / 60)}${paceUnitLabel()}`).join(" · ");

  return (
    <div className="hra-mobile-workout-editor fixed inset-0 flex flex-col hra-bg-surface" role="dialog" aria-modal="true">
      <div className="flex items-center gap-3 p-4 hra-border-strong border-b">
        <span className="hra-text-primary text-label font-semibold flex-1 min-w-0 truncate">
          {t("manage.planInstances.mobileCreate.title", `Use ${template.name} for a race`, { template: template.name })}
        </span>
        <button
          type="button"
          onClick={requestClose}
          aria-label={t("common.close", "Close")}
          className="hra-text-muted text-heading border-0 bg-transparent cursor-pointer leading-none px-1"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {step.kind === "checking" && (
          <div className="hra-text-secondary text-meta">{t("manage.planInstances.mobileCreate.checking", "Checking this template…")}</div>
        )}

        {step.kind === "ineligible" && (
          <div className="flex flex-col gap-3">
            <p className="hra-text-primary text-body">
              {t(
                "manage.planInstances.mobileCreate.ineligibleBody",
                "This template's paces need advanced setup that isn't available on mobile yet.",
              )}
            </p>
            <p className="hra-text-secondary text-meta">
              {t("manage.plans.advancedEditingDesktopOnly", "Advanced editing is available from desktop.")}
            </p>
          </div>
        )}

        {(step.kind === "form" || step.kind === "error") && (
          <>
            <label className="hra-text-secondary text-meta flex flex-col gap-1">
              {t("manage.planInstances.raceNameLabel", "Race name")}
              <input
                type="text" className="hra-border-strong hra-bg-card hra-text-primary w-full mt-1 text-body p-3 rounded-lg"
                value={raceName} onChange={e => setRaceName(e.target.value)}
                aria-label={t("manage.planInstances.raceNameLabel", "Race name")}
              />
            </label>
            <label className="hra-text-secondary text-meta flex flex-col gap-1">
              {t("manage.planInstances.raceDateLabel", "Race date")}
              <input
                type="date" className="hra-border-strong hra-bg-card hra-text-primary w-full mt-1 text-body p-3 rounded-lg"
                value={raceDate} min={isoToday()} onChange={e => setRaceDate(e.target.value)}
                aria-label={t("manage.planInstances.raceDateLabel", "Race date")}
              />
            </label>
            {needsGoalTime && (
              <label className="hra-text-secondary text-meta flex flex-col gap-1">
                {t("manage.planInstances.goalTimeLabel", "Goal time")}
                <input
                  type="text" inputMode="numeric" placeholder={t("manage.planInstances.goalTimePlaceholder", "HH:MM:SS")}
                  className="hra-border-strong hra-bg-card hra-text-primary w-full mt-1 text-body p-3 rounded-lg"
                  value={goalTime} onChange={e => setGoalTime(e.target.value)}
                  aria-label={t("manage.planInstances.goalTimeAria", "Goal time (HH:MM:SS)")}
                  aria-invalid={goalTime.trim() !== "" && !goalTimeValid ? true : undefined}
                />
              </label>
            )}
            {step.kind === "error" && <div role="alert" className="hra-text-danger text-meta">{step.message}</div>}
          </>
        )}

        {step.kind === "review" && (
          <div className="flex flex-col gap-3">
            <div className="hra-fact-row flex items-baseline justify-between gap-3">
              <span className="hra-text-muted text-meta">{t("manage.planInstances.raceNameLabel", "Race name")}</span>
              <span className="hra-text-primary text-body">{raceName}</span>
            </div>
            <div className="hra-fact-row flex items-baseline justify-between gap-3">
              <span className="hra-text-muted text-meta">{t("manage.planInstances.raceDateLabel", "Race date")}</span>
              <span className="hra-text-primary text-body">{raceDate}</span>
            </div>
            <div className="hra-fact-row flex items-baseline justify-between gap-3">
              <span className="hra-text-muted text-meta">{t("manage.planInstances.mobileCreate.startDate", "Plan starts")}</span>
              <span className="hra-text-primary text-body">{step.startDate}</span>
            </div>
            {paceEntries.length > 0 && (
              <div className="hra-fact-row flex items-baseline justify-between gap-3">
                <span className="hra-text-muted text-meta">{t("manage.planInstances.mobileCreate.resolvedPaces", "Resolved paces")}</span>
                <span className="hra-text-primary text-body">{paceLine}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="hra-mobile-workout-editor-actions flex items-center gap-3 hra-border-strong border-t">
        <button type="button" className="hra-btn flex-1" onClick={requestClose}>
          {t("common.cancel", "Cancel")}
        </button>
        {(step.kind === "form" || step.kind === "error") && (
          <button
            type="button" className="hra-btn flex-1" data-variant="green"
            disabled={!canReview || submitting}
            onClick={onReview}
          >
            {submitting ? t("common.saving", "Saving…") : t("manage.planInstances.mobileCreate.reviewButton", "Review")}
          </button>
        )}
        {step.kind === "review" && (
          <button type="button" className="hra-btn flex-1" data-variant="green" disabled={creating} onClick={onCreate}>
            {creating ? t("common.saving", "Saving…") : t("manage.planInstances.mobileCreate.createButton", "Create")}
          </button>
        )}
      </div>

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
