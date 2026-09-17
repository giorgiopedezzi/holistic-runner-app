/**
 * AgendaTab.tsx (HRA-248, always-visible calendar HRA-263)
 * "Your agenda" — the app's default landing tab: today's workout (or REST,
 * or an explicit "nothing planned" state) for whichever approved plan
 * instance's resolved days cover today, without navigating to Plans and
 * finding the right instance. Reuses apiDaysToSections + PlanInstanceCalendar
 * (Manage → Plans' own Agenda view) — the same calendar, not a second
 * implementation.
 *
 * HRA-318 follow-up ("must be just a replica" of the race-plan Agenda view):
 * edit/swap open up from today onward (readOnlyDays below is a per-day
 * predicate, not the flat `true` this tab used before) — a day already run
 * shouldn't be rewritten after the fact. Scheduled-time changes are the one
 * exception (readOnlyScheduledTime={false}): correcting when a past workout
 * was actually done doesn't rewrite what it was. Desktop DSL/notes editing
 * (DayEditModal) stays out of scope here — its onEdit is fired on every
 * keystroke for a local draft a bulk Save persists (PlanInstancesSection's
 * own model), and there's no such Save step on this tab; onDayEdit is left
 * unset, which keeps DayEditModal read-only regardless of date (see that
 * component's own comment). Phone's full-screen MobileWorkoutEditor already
 * persists per-keystroke-safe (one PATCH on its own explicit Save), so it's
 * wired for real once its day is today or later.
 *
 * HRA-263: the calendar itself is now always rendered, even with no active
 * plan (`instance == null` → `sections = []`, still fed to
 * PlanInstanceCalendar so HRA-262's recorded-activity matching still applies
 * — see that component's own no-plan activityRange fallback). The former
 * full-page blocking Empty state is gone; "no active plan" and "nothing at
 * all for today" are now two independent, non-blocking lines above the
 * calendar, not a takeover.
 */
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/api/client";
import { useQuery } from "@/hooks/useQuery";
import { useReportStringSelection } from "@/hooks/useReportNav";
import { isoToday } from "@/utils/date";
import { notify } from "@/utils/toast";
import type { DayView, SectionView } from "@/domain/runplan-aggregate";
import { apiDaysToSections, racePaceReferenceFromPlan } from "@/components/manage/plan-instances/planInstanceEditor.mappers";
import type { RunPlan } from "@/types/runplan";
import type { PlanInstanceWithDays } from "@/types/api";
import { CategoryLegend, PlanInstanceCalendar } from "@/components/manage/PlanInstanceCalendar";
import { useAppMode } from "@/hooks/useAppMode";
import { WorkoutReportModal } from "@/components/manage/plan-instances/WorkoutReportModal";
import { DAY_PREFIX_RE } from "@/components/TrainingPlanAccordion";
import { instanceDayDateLabel } from "@/utils/fmt";
import { Empty, ErrorBanner, LoadingSpinner, ConfirmModal } from "@/components/ui";
import { GuestContextHint } from "@/components/GuestContextHint";

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

function dayViewsById(sections: SectionView[]): Map<number, DayView> {
  const map = new Map<number, DayView>();
  for (const section of sections) for (const week of section.weeks) for (const day of week.days) {
    if (day.id != null) map.set(day.id, day);
  }
  return map;
}

function dayLabel(day: DayView): string {
  return day.dsl.replace(DAY_PREFIX_RE, "").trim();
}

interface Props {
  onNavigateToPlans: () => void;
  // HRA-265: threaded from App.tsx — see PlanInstanceCalendar.tsx's own prop
  // of the same name.
  onNavigateToActivity: (activityId: number) => void;
}

export function AgendaTab({ onNavigateToPlans, onNavigateToActivity }: Props) {
  const { t } = useTranslation();
  // HRA-376: unlike Plans tab's own List/Agenda editors (local-state edits
  // gated behind a canPersist-gated Save), swap and scheduled-time here call
  // the backend directly and immediately (swapWorkouts/patchDay, below) —
  // there is no local-only mode to fall back to, so Guest gets no edit/swap
  // affordance on this tab at all, only browsing.
  const { canPersist } = useAppMode();
  const date = isoToday();
  const { state, refetch } = useQuery(() => api.planInstances.active(date), [date]);
  const { state: templatesState } = useQuery(() => api.planTemplates.list(), []);
  // HRA-263: called unconditionally (rules of hooks) even though its result
  // is only used once `state` itself has resolved below — decides whether
  // today specifically has neither a plan day nor a recorded activity, which
  // is a stricter/independent question from "is there an active plan at all".
  const { state: todayActivityState } = useQuery(() => api.garmin.activities(date, date), [date]);
  // HRA-318 follow-up: edit/swap open up from today onward — a stable
  // predicate (memoized on `date`, which only changes once a day) rather
  // than a fresh arrow function every render, since PlanInstanceCalendar's
  // own EventComponent is memoized on this same prop's identity.
  const readOnlyDays = useMemo(() => (dateKey: string) => !canPersist || dateKey < date, [date, canPersist]);
  const [swapPending, setSwapPending] = useState<{ a: DayView; b: DayView } | null>(null);
  const [swapping, setSwapping] = useState(false);
  // HRA-336: the single-workout/race report. HRA-339: URL-backed by the
  // workout_id alone (instanceId comes from `instance`, resolved fresh on
  // every load) so refresh/direct-link entry restores the open report; the
  // matching DayView is looked up below (once `sections` is computed) purely
  // to keep passing the already-computed paceTargetBands (HRA-173) rather
  // than re-deriving them, not because it's needed for identity.
  const [reportWorkoutId, setReportWorkoutId] = useReportStringSelection("agendaWorkout");

  // HRA-320: a swap (or scheduled-time edit) calls refetch(), which briefly
  // sends `state` back to "loading" with no data at all — the early return
  // below used to unmount PlanInstanceCalendar for that instant, discarding
  // its own internal date/view navigation state, so the tab reopened back on
  // today/this week instead of wherever the user actually was. Keeping the
  // last successfully loaded instance around and rendering through a
  // refetch (instead of unmounting) fixes that; `undefined` (never loaded)
  // is distinct from `null` (loaded, no active plan), so a genuine first
  // load still shows the spinner.
  const lastInstanceRef = useRef<PlanInstanceWithDays | null | undefined>(undefined);
  if (state.status === "success") lastInstanceRef.current = state.data;

  if (lastInstanceRef.current === undefined && (state.status === "loading" || state.status === "idle")) {
    return <LoadingSpinner label={t("agenda.loading", "Loading your agenda…")} />;
  }
  if (lastInstanceRef.current === undefined && state.status === "error") {
    return <ErrorBanner message={state.error} />;
  }

  const instance = lastInstanceRef.current ?? null;
  const template = instance != null && templatesState.status === "success"
    ? templatesState.data.find(candidate => candidate.id === instance.template_id)
    : undefined;
  let racePaceReference = null;
  if (template != null) {
    try { racePaceReference = racePaceReferenceFromPlan(JSON.parse(template.parsed_plan) as RunPlan); } catch { /* malformed saved template falls back safely */ }
  }
  const sections = instance != null ? apiDaysToSections(instance.days, racePaceReference) : [];
  const instanceLabel = instance?.name ?? t("manage.planTemplates.untitled", "Untitled plan");
  const reportDayView = reportWorkoutId
    ? sections.flatMap(s => s.weeks).flatMap(w => w.days).find(d => d.workout_id === reportWorkoutId) ?? null
    : null;

  async function handleScheduledTimeEdit(dayId: number, scheduledTime: string | null) {
    if (instance == null || !canPersist) return;
    try {
      await api.planInstances.patchDay(instance.id, dayId, { scheduled_time: scheduledTime });
      refetch();
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }

  function handleDaySwap(aDayId: number, bDayId: number) {
    if (!canPersist) return;
    const byId = dayViewsById(sections);
    const a = byId.get(aDayId);
    const b = byId.get(bDayId);
    if (a && b) setSwapPending({ a, b });
  }

  async function confirmSwap() {
    if (instance == null || swapPending == null || !canPersist) return;
    const { a, b } = swapPending;
    if (a.id == null || b.id == null) return;
    setSwapping(true);
    try {
      // HRA-333 follow-up: one atomic backend call — content follows
      // workout_id automatically (server-side join), so there's no dsl to
      // reconstruct client-side any more.
      await api.planInstances.swapWorkouts(instance.id, a.id, b.id);
      notify(t("manage.planInstances.mobileSwap.succeeded", "Workouts swapped."));
      setSwapPending(null);
      refetch();
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setSwapping(false);
    }
  }

  const todayHasPlanDay = instance != null && instance.days.some(d => d.date === date);
  // Resolved (success or error) rather than still loading — avoids flashing
  // the "Run free..." copy on for an instant before we actually know whether
  // today has a recorded activity.
  const todayActivityResolved = todayActivityState.status === "success" || todayActivityState.status === "error";
  const todayHasActual = todayActivityState.status === "success" && todayActivityState.data.length > 0;
  const showTodayEmptyCopy = todayActivityResolved && !todayHasPlanDay && !todayHasActual;

  return (
    <>
      {instance != null ? (
        <p className="hra-text-secondary text-body mb-2">
          {t("agenda.instanceLabel", `Today's plan: ${instanceLabel}`, { name: instanceLabel })}
        </p>
      ) : (
        <Empty
          message={t("agenda.emptyLine1", "There is no active plan today.")}
          emphasis={showTodayEmptyCopy ? t("agenda.emptyLine2", "Run free. Or rest. Be happy.") : undefined}
          action={{ label: t("agenda.viewPlans", "View race plans"), onClick: onNavigateToPlans }}
        />
      )}
      {instance != null && showTodayEmptyCopy && (
        <p className="hra-text-secondary text-heading mb-2">
          {t("agenda.emptyLine2", "Run free. Or rest. Be happy.")}
        </p>
      )}
      <GuestContextHint titleKey="guest.guide.agenda.title" title="The real training calendar" bodyKey="guest.guide.agenda.body" body="This calendar connects the plan, changes made along the way, and what was actually completed. With your own data, it follows your plan and activities." />
      <CategoryLegend />
      <PlanInstanceCalendar
        sections={sections}
        readOnlyDays={readOnlyDays}
        readOnlyScheduledTime={!canPersist}
        onScheduledTimeEdit={handleScheduledTimeEdit}
        onDaySwap={handleDaySwap}
        initialDate={new Date()}
        onNavigateToActivity={onNavigateToActivity}
        // HRA-300: Agenda's own workout-row entry point for the mobile
        // full-screen DSL editor — same component, same save command as the
        // race-plan detail view (PlanInstancesSection's current-week
        // ribbon), per that Story's "does not create a second Agenda
        // implementation" instruction. instance is only non-null once
        // `state` has resolved successfully, matching this render's own
        // `instance` derivation below.
        instanceId={instance?.id}
        onDayPersisted={() => refetch()}
        raceDate={instance?.race_date}
        onViewReport={day => setReportWorkoutId(day.workout_id ?? null)}
      />
      {reportWorkoutId && instance != null && (
        <WorkoutReportModal
          instanceId={instance.id}
          workoutId={reportWorkoutId}
          paceTargetBands={reportDayView?.paceTargetBands}
          onClose={() => setReportWorkoutId(null)}
        />
      )}
      <ConfirmModal
        open={swapPending != null}
        title={
          swapPending && (
            <div className="hra-text-primary text-label font-semibold leading-normal mb-4 flex flex-col gap-2">
              <span>{t("manage.planInstances.mobileSwap.confirmTitle", "Confirm swap")}</span>
              <span className="text-body font-normal">
                {t(
                  "manage.planInstances.mobileSwap.confirmBody",
                  `${swapPending.a.date ? instanceDayDateLabel(swapPending.a.date) : ""} (${dayLabel(swapPending.a)}) ↔ ${swapPending.b.date ? instanceDayDateLabel(swapPending.b.date) : ""} (${dayLabel(swapPending.b)})`,
                  {
                    a: `${swapPending.a.date ? instanceDayDateLabel(swapPending.a.date) : ""} — ${dayLabel(swapPending.a)}`,
                    b: `${swapPending.b.date ? instanceDayDateLabel(swapPending.b.date) : ""} — ${dayLabel(swapPending.b)}`,
                  },
                )}
              </span>
            </div>
          )
        }
        confirmLabel={swapping ? t("common.saving", "Saving…") : t("manage.planInstances.swapConfirmButton", "Swap")}
        maxWidth={420}
        onConfirm={() => !swapping && confirmSwap()}
        onCancel={() => { if (!swapping) setSwapPending(null); }}
      />
    </>
  );
}
