import { useEffect, useState, type CSSProperties } from "react";
import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { Select, Popover, PopoverTrigger, PopoverContent } from "@/components/ui";
import type { Activity, ActivityType } from "@/types/api";
import { useDemoMode } from "@/hooks/useDemoMode";

// Sits beside the sport badge/Delete button in ActivityRow's/ActivityDetailBody's
// header row: a dropdown of training-session types (Training, Race 5km, ...) plus
// a labeled Save/Rename button that opens a small popup to name the session (e.g.
// the race's name) before the PUT actually fires — see garmin-stats'
// activities.controller.ts setType. Always enabled (dashboard design-system
// rework: "make it always enabled, so rename works independently") — it used to
// only activate once the Type dropdown itself changed, which meant renaming an
// already-named activity had no way to happen on its own.
export function ActivityTypePicker({ activity, onUpdate, selectWidth, actionWidth, height }: {
  activity: Activity; onUpdate: (a: Activity) => void;
  // Fixed sizing (dashboard design-system rework: "keep them at a fixed
  // width... same height") — ActivityRow passes these so the type Select
  // and the Save/Rename button never jitter in width as the label switches
  // between "Save & name"/"Rename" or between languages; left undefined
  // (natural/content-sized) for ActivityDetailBody's own header, which has
  // no neighboring fixed-width Delete button to line up against.
  selectWidth?: number; actionWidth?: number; height?: number;
}) {
  const { t } = useTranslation();
  const demoMode = useDemoMode();
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState(activity.activity_type_id);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.activityTypes.list().then(setTypes).catch(() => setTypes([])); }, []);

  // A different activity loaded (e.g. switching accordion rows) — drop any
  // unsaved pick and resync to what's actually persisted for the new one.
  useEffect(() => {
    setSelectedTypeId(activity.activity_type_id);
  }, [activity.id, activity.activity_type_id]);

  // Only types whose min_distance_m fits within this activity's actual
  // distance are offered — a 5K can't be tagged "Marathon".
  const eligibleTypes = types.filter(at => at.min_distance_m <= (activity.distance_m ?? 0));
  // Already has a name → this is a RENAME (editing what's there); otherwise
  // it's a first-time SAVE & NAME. Purely a label/copy distinction now — the
  // button itself is always actionable regardless of which applies.
  const hasName = Boolean(activity.activity_name);
  const actionLabel = hasName ? t("activity.typePicker.renameButton", "Rename") : t("activity.typePicker.saveButton", "Save & name");

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      onUpdate(await api.garmin.setType(activity.id, selectedTypeId, name.trim() || null));
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("activity.typePicker.saveFailed", "Failed to save activity type"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="hra-row gap-1.5">
      <Select
        value={String(selectedTypeId)}
        onValueChange={v => setSelectedTypeId(Number(v))}
        options={eligibleTypes.map(at => ({ value: String(at.id), label: at.name }))}
        placeholder={t("activity.typePicker.typePlaceholder", "Type")}
        triggerWidth={selectWidth}
        triggerHeight={height}
      />
      <Popover open={open} onOpenChange={o => {
        setOpen(o);
        // Seed the input from whatever's actually persisted every time the
        // popover opens — renaming edits the current name, it doesn't start
        // from a blank field (a first-time save has no name to seed from,
        // so this is simply "").
        if (o) setName(activity.activity_name ?? "");
      }}>
        <PopoverTrigger
          title={demoMode
            ? t("common.demoModeHint", "Not available for demo")
            : hasName
              ? t("activity.typePicker.renameTooltip", "Change this activity's saved name")
              : t("activity.typePicker.saveTooltip", "Save the selected type and optionally name this activity")}
          disabled={demoMode}
          className="hra-activity-type-action hra-btn flex items-center justify-center gap-1.5 text-meta py-1 px-2.5 shrink-0"
          data-variant="cta"
          style={{
            "--activity-action-width": actionWidth != null ? `${actionWidth}px` : undefined,
            "--activity-action-height": height != null ? `${height}px` : undefined,
          } as CSSProperties}
        >
          <Save size={13} />
          {actionLabel}
        </PopoverTrigger>
        <PopoverContent>
          <div className="flex flex-col gap-2 min-w-50">
            <span className="hra-text-secondary text-meta font-semibold">
              {(() => {
                const typeName = types.find(at => at.id === selectedTypeId)?.name.toLowerCase() ?? t("activity.typePicker.sessionFallback", "session");
                return hasName
                  ? t("activity.typePicker.renameThis", `Rename this ${typeName}`, { type: typeName })
                  : t("activity.typePicker.nameThis", `Name this ${typeName}`, { type: typeName });
              })()}
            </span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t("activity.typePicker.namePlaceholder", "e.g. Berlin Marathon")}
              autoFocus
              className="hra-border-strong hra-bg-card hra-text-primary text-label py-1.5 px-2 rounded-md"
            />
            {error && <span className="hra-text-danger text-meta">{error}</span>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setOpen(false)}
                className="hra-border-strong hra-text-secondary text-meta rounded-md py-1 px-3 bg-transparent cursor-pointer">
                {t("common.cancel", "Cancel")}
              </button>
              <button className="hra-btn" data-variant="cta" onClick={handleSave} disabled={saving}>
                {saving ? "…" : actionLabel}
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
