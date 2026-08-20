import { useEffect, useState, type CSSProperties } from "react";
import { Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { Select, Popover, PopoverTrigger, PopoverContent } from "@/components/ui";
import type { Activity, ActivityType } from "@/types/api";

// Sits beside the sport badge/Delete button in ActivityDetailBody's header
// row: a dropdown of training-session types (Training, Race 5km, ...) plus a
// save icon that's only clickable once the picked type actually differs from
// what's persisted. Saving opens a small popup to name the session (e.g. the
// race's name) before the PUT actually fires — see garmin-stats'
// activities.controller.ts setType.
export function ActivityTypePicker({ activity, onUpdate }: { activity: Activity; onUpdate: (a: Activity) => void }) {
  const { t } = useTranslation();
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
  const dirty = selectedTypeId !== activity.activity_type_id;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      onUpdate(await api.garmin.setType(activity.id, selectedTypeId, name.trim() || null));
      setOpen(false);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("activity.typePicker.saveFailed", "Failed to save activity type"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="hra-row" style={{ gap: 6 }}>
      <Select
        value={String(selectedTypeId)}
        onValueChange={v => setSelectedTypeId(Number(v))}
        options={eligibleTypes.map(at => ({ value: String(at.id), label: at.name }))}
        placeholder={t("activity.typePicker.typePlaceholder", "Type")}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={!dirty}
          title={dirty ? t("activity.typePicker.saveTooltip", "Save the selected activity type") : t("activity.typePicker.noChangeTooltip", "No change to save")}
          className="hra-border-strong hra-dyn-color"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: 6, background: "none",
            "--dyn-color": dirty ? "var(--accent)" : "var(--text-muted)",
            cursor: dirty ? "pointer" : "default",
            opacity: dirty ? 1 : 0.5,
          } as CSSProperties}
        >
          <Save size={14} />
        </PopoverTrigger>
        <PopoverContent>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 200 }}>
            <span className="hra-text-secondary" style={{ fontSize: 12, fontWeight: 600 }}>
              {(() => {
                const typeName = types.find(at => at.id === selectedTypeId)?.name.toLowerCase() ?? t("activity.typePicker.sessionFallback", "session");
                return t("activity.typePicker.nameThis", `Name this ${typeName}`, { type: typeName });
              })()}
            </span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t("activity.typePicker.namePlaceholder", "e.g. Berlin Marathon")}
              autoFocus
              className="hra-border-strong hra-bg-card hra-text-primary"
              style={{
                fontSize: 13, padding: "6px 8px", borderRadius: 6,
              }}
            />
            {error && <span className="hra-text-danger" style={{ fontSize: 11 }}>{error}</span>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setOpen(false)}
                className="hra-border-strong hra-text-secondary"
                style={{ fontSize: 12, borderRadius: 6, padding: "4px 12px", background: "none", cursor: "pointer" }}>
                {t("common.cancel", "Cancel")}
              </button>
              <button className="hra-btn" data-variant="cta" onClick={handleSave} disabled={saving}>
                {saving ? "…" : t("common.save", "Save")}
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
