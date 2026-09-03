/**
 * AgendaTab.tsx (HRA-248)
 * "Your agenda" — the app's default landing tab: today's workout (or REST,
 * or an explicit "nothing planned" state) for whichever approved plan
 * instance's resolved days cover today, without navigating to Plans and
 * finding the right instance. Read-only: reuses apiDaysToSections +
 * PlanInstanceCalendar (Manage → Plans' own Agenda view) with readOnlyDays
 * always true here — editing an active plan's days is already disallowed by
 * the existing readOnlyDays-from-isApproved rule (HRA-126), unrelated to
 * this tab. Independent of SplashScreen, which only gates visibility and
 * never touches tab state.
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
}

export function AgendaTab({ onNavigateToPlans }: Props) {
  const { t } = useTranslation();
  const date = isoToday();
  const { state } = useQuery(() => api.planInstances.active(date), [date]);

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingSpinner label={t("agenda.loading", "Loading your agenda…")} />;
  }
  if (state.status === "error") {
    return <ErrorBanner message={state.error} />;
  }

  const instance = state.data;
  if (instance == null) {
    return (
      <Empty
        message={t("agenda.emptyLine1", "There is no active plan today.")}
        emphasis={t("agenda.emptyLine2", "Run free. Or rest. Be happy.")}
        action={{ label: t("agenda.viewPlans", "View race plans"), onClick: onNavigateToPlans }}
      />
    );
  }

  const instanceLabel = instance.name ?? t("manage.planTemplates.untitled", "Untitled plan");
  const sections = apiDaysToSections(instance.days);

  return (
    <>
      <p className="hra-text-secondary text-body mb-2">
        {t("agenda.instanceLabel", `Today's plan: ${instanceLabel}`, { name: instanceLabel })}
      </p>
      <CategoryLegend />
      <PlanInstanceCalendar
        sections={sections}
        readOnlyDays
        onScheduledTimeEdit={noop}
        onDaySwap={noop}
        initialDate={new Date()}
      />
    </>
  );
}
