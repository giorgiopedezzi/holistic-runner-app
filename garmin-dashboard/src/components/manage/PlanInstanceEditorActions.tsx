/**
 * PlanInstanceEditorActions.tsx (HRA-170, extracted from PlanInstancesSection.tsx)
 * The unified plan screen's CTA row: Create instance (unlocked) or Save /
 * Approve / the Regenerate-from-date compound control (locked), plus Restore
 * and the List/Agenda toggle. Flat scalar/callback props only, no state of
 * its own — PlanInstancesSection.tsx keeps owning every underlying value.
 */
import { useTranslation } from "react-i18next";
import { DatePicker } from "@/components/ui";
import { useDemoMode } from "@/hooks/useDemoMode";

interface Props {
  fieldsLocked: boolean;
  instantiateLoading: boolean;
  canInstantiate: boolean;
  onInstantiate: () => void;
  saveLoading: boolean;
  hasSections: boolean;
  // HRA-249: still needed for the Regenerate hint below (Regenerate stays
  // approval-gated, out of this Story's scope) — no longer used to
  // force-disable Save/Approve.
  isApproved: boolean;
  saveEnabled: boolean;
  onSaveClick: () => void;
  approveLoading: boolean;
  editingId: number | null;
  onApprove: () => void;
  regenerateLoading: boolean;
  regenerateDisabled: boolean;
  regenerateBucketDirty: boolean;
  onRegenerateClick: () => void;
  effectiveFrom: string;
  setEffectiveFrom: (v: string) => void;
  minEffectiveFrom: string;
  isDirty: boolean;
  onRestoreClick: (dirty: boolean) => void;
  viewMode: "list" | "agenda";
  setViewMode: (v: "list" | "agenda") => void;
}

export function PlanInstanceEditorActions({
  fieldsLocked, instantiateLoading, canInstantiate, onInstantiate,
  saveLoading, hasSections, isApproved, saveEnabled, onSaveClick,
  approveLoading, editingId, onApprove,
  regenerateLoading, regenerateDisabled, regenerateBucketDirty, onRegenerateClick,
  effectiveFrom, setEffectiveFrom, minEffectiveFrom,
  isDirty, onRestoreClick, viewMode, setViewMode,
}: Props) {
  const { t } = useTranslation();
  const demoMode = useDemoMode();
  const demoTitle = demoMode ? t("common.demoModeHint", "Not available for demo") : undefined;

  return (
    <div className="hra-plan-instance-section-gap hra-row-wrap items-center" >
      {!fieldsLocked ? (
        <button className="hra-btn" data-variant="green" onClick={onInstantiate} disabled={!canInstantiate || instantiateLoading || demoMode} title={demoTitle}>
          {instantiateLoading ? t("common.saving", "Saving…") : t("manage.planInstances.createButton", "Create plan from template")}
        </button>
      ) : (
        <>
          {/* HRA-249: no longer force-disabled by isApproved — editing an
              already-active plan is allowed, with a persistent warning
              instead of a lock (see PlanInstancesSection.tsx's
              WarningBanner). Save still legitimately disables via
              !saveEnabled when there's nothing dirty to save. */}
          <button className="hra-btn" data-variant="green" onClick={onSaveClick} disabled={saveLoading || !hasSections || !saveEnabled || demoMode} title={demoTitle}>
            {saveLoading ? t("common.saving", "Saving…") : t("common.save", "Save")}
          </button>
          <button className="hra-btn" onClick={onApprove} disabled={approveLoading || editingId == null || demoMode} title={demoTitle}>
            {approveLoading ? t("manage.planTemplates.approving", "Activating…") : t("manage.planTemplates.approveButton", "Activate")}
          </button>
          {/* AC3/AC6: label + date picker + button as ONE real control — a
              button-shaped div with the DatePicker nested INSIDE it
              (compact/borderless, index.css's .hra-regenerate-unit
              override). A literal <button> can't contain the date
              picker's own nested <button> (invalid HTML), so this is
              role="button" on a <div>, with tabIndex/onKeyDown restoring
              the click/keyboard-activate behavior a real button gives
              for free, and data-disabled driving the same visual
              language .hra-btn:disabled already has. The nested
              DatePicker's own click is wrapped in a stopPropagation span
              so opening the calendar doesn't also fire Regenerate. */}
          <div
            className="hra-btn hra-regenerate-unit inline-flex items-center gap-1.5" data-variant="green"
            role="button" tabIndex={regenerateDisabled || demoMode ? -1 : 0}
            onClick={() => { if (!regenerateDisabled && !demoMode) onRegenerateClick(); }}
            onKeyDown={e => { if (!regenerateDisabled && !demoMode && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onRegenerateClick(); } }}
            data-disabled={regenerateDisabled || demoMode || undefined}
            aria-disabled={regenerateDisabled || demoMode}
            title={demoMode
              ? demoTitle
              : !isApproved && !regenerateBucketDirty ? t("manage.planInstances.regenerateDisabledHint", "Change start date or a pace anchor first.") : undefined}
          >
            <span>{regenerateLoading ? t("common.saving", "Saving…") : t("manage.planInstances.regenerateFromLabel", "Regenerate from")}</span>
            <span onClick={e => e.stopPropagation()} className="inline-flex">
              <DatePicker value={effectiveFrom} onChange={setEffectiveFrom} min={minEffectiveFrom} disabled={regenerateDisabled || demoMode} />
            </span>
          </div>
        </>
      )}
      {/* HRA-159: "Restore" renames to "Reset to previous values" here —
          a dedicated key, not a change to the shared common.restore
          key PlanTemplatesSection.tsx also uses, since this Story's ask
          is scoped to the instance card only. HRA-249: disabled whenever
          the active row has no unsaved changes (nothing to restore),
          mirroring PlanTemplatesSection.tsx's own disabled={!isEditorDirty()}
          gating. */}
      <button className="hra-btn" onClick={() => onRestoreClick(isDirty)} disabled={!isDirty}>
        {t("manage.planInstances.resetButton", "Reset to previous values")}
      </button>
      {/* HRA-157: List/Agenda switch relocated here from its own row
          above the accordion/calendar — right-aligned via marginLeft:
          auto in this flex row, while the buttons above stay
          left-aligned. Only shown once there's something to switch
          between, same gating the old location used. */}
      {hasSections && (
        <div className="hra-segment ml-auto">
          <button className="hra-segment-item" data-active={viewMode === "list"} onClick={() => setViewMode("list")}>
            {t("manage.planInstances.viewList", "List")}
          </button>
          <button className="hra-segment-item" data-active={viewMode === "agenda"} onClick={() => setViewMode("agenda")}>
            {t("manage.planInstances.viewAgenda", "Agenda")}
          </button>
        </div>
      )}
    </div>
  );
}
