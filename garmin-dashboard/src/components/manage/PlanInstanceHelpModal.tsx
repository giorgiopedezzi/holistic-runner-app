/**
 * PlanInstanceHelpModal.tsx (HRA-322)
 * Short "How to use it" reference for the Race plans section — what a race
 * plan is, and how to regenerate it after changing its start-date anchor.
 * Mirrors PlanTemplateHelpModal's structure/layout.
 */
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  onClose: () => void;
}

export function PlanInstanceHelpModal({ onClose }: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const sections: { heading: string; body: string }[] = [
    {
      heading: t("manage.planInstances.help.overview.heading", "What a race plan is"),
      body: t(
        "manage.planInstances.help.overview.body",
        "A race plan is a plan template instantiated for one specific race: its symbolic pace anchors (like RG or FL) get resolved to concrete paces, and its weeks/days get real calendar dates anchored to a start date you choose.",
      ),
    },
    {
      heading: t("manage.planInstances.help.regenerate.heading", "Changing the start date"),
      body: t(
        "manage.planInstances.help.regenerate.body",
        "If you change the race plan's start date (or the goal/paces it was anchored to), regenerate it so the resolved paces and calendar dates are recalculated from the new anchor — the plan doesn't update itself automatically when the anchor changes.",
      ),
    },
  ];

  return (
    <div
      className="hra-modal-layer hra-modal-backdrop fixed inset-0 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="hra-help-modal hra-bg-surface hra-border rounded-2xl w-full max-w-160 overflow-y-auto p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="hra-block-title">{t("manage.planInstances.help.title", "How race plans work")}</div>
          <button
            onClick={onClose}
            aria-label={t("common.close", "Close")}
            className="hra-tight-action hra-border-strong hra-text-secondary bg-transparent rounded-md text-meta cursor-pointer"
          >
            {t("common.close", "Close")}
          </button>
        </div>

        {sections.map((section, i) => (
          <div key={i} className="hra-help-section">
            <div className="hra-text-primary text-label font-semibold mb-1.5">{section.heading}</div>
            <div className="hra-help-copy hra-text-secondary text-meta">{section.body}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
