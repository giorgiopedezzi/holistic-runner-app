import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { Select } from "@/components/ui";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useAppMode } from "@/hooks/useAppMode";
import type { AssociationStatus, AssociationView, PlanInstanceDayWithInstance } from "@/types/api";
import { notify } from "@/utils/toast";

// HRA-334: inspect/confirm/replace/remove this activity's persisted link to a
// planned workout (garmin-stats' workout_associations table — see
// docs/schema.md). A sibling concern to ActivityDetailBody's own ephemeral
// same-day plannedDays picker (which drives the pace-target chart overlay,
// HRA-206/207/208, unaffected by this control) — this is the durable
// provenance record itself, not the overlay.
const STATUS_KEY: Record<AssociationStatus, string> = {
  automatic: "activity.association.statusAutomatic",
  manual_confirmed: "activity.association.statusConfirmed",
  manual_changed: "activity.association.statusChanged",
  unresolved: "activity.association.statusUnresolved",
};

export function WorkoutAssociationControl({ activityId }: { activityId: number }) {
  const { t } = useTranslation();
  const demoMode = useDemoMode();
  const { canPersist } = useAppMode();
  const persistBlocked = demoMode || !canPersist;
  const persistBlockedTitle = !canPersist
    ? t("guest.persistence.signInHint", "Sign in to save this to your account.")
    : demoMode ? t("common.demoModeHint", "Not available for demo") : undefined;
  const [association, setAssociation] = useState<AssociationView | null>(null);
  const [candidates, setCandidates] = useState<PlanInstanceDayWithInstance[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [pickedWorkoutId, setPickedWorkoutId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let ignore = false;
    api.garmin.association(activityId).then(a => { if (!ignore) setAssociation(a); }).catch(() => { if (!ignore) setAssociation(null); });
    setPicking(false);
    setCandidates(null);
    return () => { ignore = true; };
  }, [activityId]);

  async function openPicker() {
    setPicking(true);
    if (candidates == null) {
      try {
        const rows = await api.garmin.associationCandidates(activityId);
        setCandidates(rows);
        setPickedWorkoutId(rows[0]?.workout_id ?? "");
      } catch {
        setCandidates([]);
      }
    }
  }

  async function save(workoutId: string) {
    setBusy(true);
    try {
      setAssociation(await api.garmin.setAssociation(activityId, workoutId));
      setPicking(false);
      notify(t("activity.association.saved", "Planned workout link saved."));
    } catch (e) {
      notify(e instanceof Error ? e.message : t("activity.association.saveFailed", "Failed to save the planned workout link."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      setAssociation(await api.garmin.clearAssociation(activityId));
      setPicking(false);
      notify(t("activity.association.removed", "Marked as not part of any plan."));
    } catch (e) {
      notify(e instanceof Error ? e.message : t("activity.association.removeFailed", "Failed to remove the planned workout link."), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!association) return null;

  const linked = association.workout_id != null && association.status != null;

  return (
    <div className="hra-row-wrap items-center gap-2">
      <span className="hra-text-secondary text-meta">{t("activity.association.label", "Planned workout")}</span>
      {linked ? (
        <>
          <span className="text-label">
            {association.instance_name}
            {association.section_name != null && ` · ${association.section_name}`}
            {association.week_number != null && ` · ${t("activity.association.week", `Week ${association.week_number}`, { week: association.week_number })}`}
          </span>
          <span className="hra-text-muted text-meta">{t(STATUS_KEY[association.status!], association.status!)}</span>
          {association.status !== "manual_confirmed" && (
            <button className="hra-btn text-meta py-1 px-2.5" disabled={persistBlocked || busy} title={persistBlockedTitle} onClick={() => save(association.workout_id!)}>
              {t("activity.association.confirm", "Confirm")}
            </button>
          )}
          <button className="hra-btn text-meta py-1 px-2.5" disabled={persistBlocked || busy} title={persistBlockedTitle} onClick={openPicker}>
            {t("activity.association.replace", "Replace")}
          </button>
          <button className="hra-btn text-meta py-1 px-2.5" data-tone="red" disabled={persistBlocked || busy} title={persistBlockedTitle} onClick={handleRemove}>
            {t("activity.association.remove", "Remove")}
          </button>
        </>
      ) : (
        <>
          <span className="hra-text-muted text-meta">
            {association.status === "manual_changed"
              ? t("activity.association.unplanned", "Not part of any plan")
              : t("activity.association.none", "No planned workout matched")}
          </span>
          <button className="hra-btn text-meta py-1 px-2.5" disabled={persistBlocked || busy} title={persistBlockedTitle} onClick={openPicker}>
            {t("activity.association.link", "Link…")}
          </button>
        </>
      )}
      {picking && (
        <div className="hra-row gap-1.5 items-center basis-full">
          {candidates == null ? (
            <span className="hra-text-muted text-meta">{t("activity.association.loading", "Loading…")}</span>
          ) : candidates.length === 0 ? (
            <span className="hra-text-muted text-meta">{t("activity.association.noCandidates", "No matching planned workout for this date.")}</span>
          ) : (
            <>
              <Select
                value={pickedWorkoutId}
                onValueChange={setPickedWorkoutId}
                options={candidates.map(c => ({
                  value: c.workout_id,
                  label: `${c.instance_name ?? ""} · ${c.section_name} · Week ${c.week_number}`,
                }))}
                ariaLabel={t("activity.association.pickerLabel", "Planned workout")}
              />
              <button className="hra-btn" data-variant="cta" disabled={busy || !pickedWorkoutId} onClick={() => save(pickedWorkoutId)}>
                {t("common.save", "Save")}
              </button>
            </>
          )}
          <button onClick={() => setPicking(false)}
            className="hra-border-strong hra-text-secondary text-meta rounded-md py-1 px-3 bg-transparent cursor-pointer">
            {t("common.cancel", "Cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
