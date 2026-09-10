/**
 * AgendaTab.tsx (HRA-248, always-visible calendar HRA-263)
 * "Your agenda" — the app's default landing tab: today's workout (or REST,
 * or an explicit "nothing planned" state) for whichever approved plan
 * instance's resolved days cover today, without navigating to Plans and
 * finding the right instance. Read-only: reuses apiDaysToSections +
 * PlanInstanceCalendar (Manage → Plans' own Agenda view) with readOnlyDays
 * always true here — editing an active plan's days is already disallowed by
 * the existing readOnlyDays-from-isApproved rule (HRA-126), unrelated to
 * this tab. Independent of SplashScreen, which only gates visibility and
 * never touches tab state.
 *
 * HRA-263: the calendar itself is now always rendered, even with no active
 * plan (`instance == null` → `sections = []`, still fed to
 * PlanInstanceCalendar so HRA-262's recorded-activity matching still applies
 * — see that component's own no-plan activityRange fallback). The former
 * full-page blocking Empty state is gone; "no active plan" and "nothing at
 * all for today" are now two independent, non-blocking lines above the
 * calendar, not a takeover.
 */
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useQuery } from "@/hooks/useQuery";
import { isoToday } from "@/utils/date";
import { apiDaysToSections } from "@/components/manage/plan-instances/planInstanceEditor.mappers";
import { CategoryLegend, PlanInstanceCalendar } from "@/components/manage/PlanInstanceCalendar";
import { Empty, ErrorBanner, LoadingSpinner } from "@/components/ui";

// PlanInstanceCalendar's onScheduledTimeEdit/onDaySwap are required props,
// but readOnlyDays={true} below gates every internal call site that would
// invoke them (drag handlers, the scheduled-time popover) — real no-ops,
// not a workaround.
function noop() {}

interface Props {
  onNavigateToPlans: () => void;
  // HRA-265: threaded from App.tsx — see PlanInstanceCalendar.tsx's own prop
  // of the same name.
  onNavigateToActivity: (activityId: number) => void;
}

export function AgendaTab({ onNavigateToPlans, onNavigateToActivity }: Props) {
  const { t } = useTranslation();
  const date = isoToday();
  const { state, refetch } = useQuery(() => api.planInstances.active(date), [date]);
  // HRA-263: called unconditionally (rules of hooks) even though its result
  // is only used once `state` itself has resolved below — decides whether
  // today specifically has neither a plan day nor a recorded activity, which
  // is a stricter/independent question from "is there an active plan at all".
  const { state: todayActivityState } = useQuery(() => api.garmin.activities(date, date), [date]);

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingSpinner label={t("agenda.loading", "Loading your agenda…")} />;
  }
  if (state.status === "error") {
    return <ErrorBanner message={state.error} />;
  }

  const instance = state.data;
  const sections = instance != null ? apiDaysToSections(instance.days) : [];
  const instanceLabel = instance?.name ?? t("manage.planTemplates.untitled", "Untitled plan");

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
      <CategoryLegend />
      <PlanInstanceCalendar
        sections={sections}
        readOnlyDays
        onScheduledTimeEdit={noop}
        onDaySwap={noop}
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
      />
    </>
  );
}
