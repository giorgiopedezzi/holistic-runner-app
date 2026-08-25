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
import { SectionTitle } from "@/components/ui";
import { api } from "@/api/client";
import type { PlanTemplate } from "@/types/api";
import { PlanTemplatesSection } from "@/components/manage/PlanTemplatesSection";
import { PlanInstancesSection } from "@/components/manage/PlanInstancesSection";

export function PlansTab() {
  const { t } = useTranslation();

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

  return (
    <>
      <SectionTitle>{t("manage.planTemplatesSectionTitle", "Training-plan templates")}</SectionTitle>
      <PlanTemplatesSection templates={templates} templatesError={templatesError} refreshTemplates={refreshTemplates} />

      <SectionTitle>{t("manage.planInstancesSectionTitle", "Training-plan instances")}</SectionTitle>
      <PlanInstancesSection templates={templates} />
    </>
  );
}
