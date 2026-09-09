/**
 * PlansTab.tsx (HRA-139)
 * Training-plan authoring — templates + instances, given their own
 * top-level tab instead of living inside ManageTab ("Data & Sync"), a tab
 * whose own purpose is sync/data-range management, not plan authoring.
 * Pure relocation out of ManageTab.tsx: same two sections, same order, same
 * `templates` lift-and-share (HRA-120's own rule — a template saved in one
 * card must show up in the other's picker/list immediately, since they're
 * sibling cards that both read a list only one of them can mutate).
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SectionTitle, HelpDisclosure } from "@/components/ui";
import { api } from "@/api/client";
import type { PlanTemplate } from "@/types/api";
import { PlanTemplatesSection } from "@/components/manage/PlanTemplatesSection";
import { PlanInstancesSection } from "@/components/manage/PlanInstancesSection";
import { useIsPhone } from "@/hooks/useIsPhone";
import { useUrlState } from "@/hooks/useUrlState";

interface Props {
  // HRA-265: threaded from App.tsx, mirroring AgendaTab's existing
  // onNavigateToPlans callback — see PlanInstanceCalendar.tsx's own prop.
  onNavigateToActivity: (activityId: number) => void;
  // HRA-298: mirrors the same App.tsx setTab pattern AgendaTab's own
  // onNavigateToPlans callback uses, in reverse — the mobile instance
  // preview's "Apri nell'agenda" button switches to the real Agenda tab.
  onNavigateToAgenda: () => void;
}

type MobileView = "templates" | "instances";

export function PlansTab({ onNavigateToActivity, onNavigateToAgenda }: Props) {
  const { t } = useTranslation();
  const isPhone = useIsPhone();
  // HRA-296: persisted via the URL, same convention App.tsx's own top-level
  // `tab` param already uses (useUrlState) — survives ordinary navigation
  // (including a round trip through Agenda, which re-mounts this tab via a
  // plain tab switch) without any new persistence mechanism. Not read/used
  // on desktop, which keeps stacking both sections unconditionally.
  const [rawMobileView, setMobileView] = useUrlState("plansView", "templates");
  const mobileView: MobileView = rawMobileView === "instances" ? "instances" : "templates";

  // Lifted here (not owned by PlanTemplatesSection) so saving a template is
  // immediately visible in PlanInstancesSection's own template picker/list
  // too — the two cards are siblings on this one tab, each previously
  // fetching its own independent copy on mount, so a save in one never
  // reached the other's already-mounted state.
  const [templates, setTemplates] = useState<PlanTemplate[] | null>(null);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const refreshTemplates = useCallback(() => {
    return api.planTemplates.list().then(setTemplates)
      .catch(e => setTemplatesError(e instanceof Error ? e.message : t("manage.planTemplates.loadFailed", "Failed to load templates")));
  }, [t]);
  useEffect(() => { refreshTemplates(); }, [refreshTemplates]);

  // HRA-296: on phone, the two long stacked sections (each with its own
  // title/description/authoring UI) collapse into one segmented Modelli/
  // Piani gara switch plus a compact page header — the explanatory
  // paragraphs each card used to show permanently move into this one
  // contextual-help disclosure instead (AC10). Desktop below is untouched.
  if (isPhone) {
    return (
      <>
        <div className="flex items-center justify-between mb-2">
          <div className="hra-block-title">{t("manage.plans.mobileTitle", "Training plans")}</div>
          <HelpDisclosure
            label={t("manage.plans.mobileHelpLabel", "Help")}
            heading={t("manage.plans.mobileTitle", "Training plans")}
          >
            <p className="mb-2">{t("manage.planTemplates.description", "Reusable RunPlan DSL v1 templates — paced generically (symbolic anchors like RG), instantiated per race with concrete paces and a start date.")}</p>
            <p>{t("manage.planInstances.description", "A concrete race plan generated from a plan template for one race — resolved paces, a start date, and (optionally) a linked race activity.")}</p>
          </HelpDisclosure>
        </div>
        <div className="hra-segment mb-3">
          <button type="button" className="hra-segment-item" data-active={mobileView === "templates"} onClick={() => setMobileView("templates")}>
            {t("manage.plans.mobileTabTemplates", "Templates")}
          </button>
          <button type="button" className="hra-segment-item" data-active={mobileView === "instances"} onClick={() => setMobileView("instances")}>
            {t("manage.plans.mobileTabInstances", "Race plans")}
          </button>
        </div>
        {mobileView === "templates"
          ? <PlanTemplatesSection templates={templates} templatesError={templatesError} refreshTemplates={refreshTemplates} />
          : <PlanInstancesSection templates={templates} onNavigateToActivity={onNavigateToActivity} onNavigateToAgenda={onNavigateToAgenda} />}
      </>
    );
  }

  return (
    <>
      <SectionTitle>{t("manage.planTemplatesSectionTitle", "Plan templates")}</SectionTitle>
      <PlanTemplatesSection templates={templates} templatesError={templatesError} refreshTemplates={refreshTemplates} />

      <SectionTitle>{t("manage.planInstancesSectionTitle", "Race plans")}</SectionTitle>
      <PlanInstancesSection templates={templates} onNavigateToActivity={onNavigateToActivity} onNavigateToAgenda={onNavigateToAgenda} />
    </>
  );
}
