import { useEffect, useState } from "react";
import { Save } from "lucide-react";
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
  const eligibleTypes = types.filter(t => t.min_distance_m <= (activity.distance_m ?? 0));
  const dirty = selectedTypeId !== activity.activity_type_id;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      onUpdate(await api.garmin.setType(activity.id, selectedTypeId, name.trim() || null));
      setOpen(false);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save activity type");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <Select
        value={String(selectedTypeId)}
        onValueChange={v => setSelectedTypeId(Number(v))}
        options={eligibleTypes.map(t => ({ value: String(t.id), label: t.name }))}
        placeholder="Type"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          disabled={!dirty}
          title={dirty ? "Save the selected activity type" : "No change to save"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 28, height: 28, borderRadius: 6, background: "none",
            border: "1px solid var(--border-strong)",
            color: dirty ? "var(--accent)" : "var(--text-muted)",
            cursor: dirty ? "pointer" : "default",
            opacity: dirty ? 1 : 0.5,
          }}
        >
          <Save size={14} />
        </PopoverTrigger>
        <PopoverContent>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 200 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
              Name this {types.find(t => t.id === selectedTypeId)?.name.toLowerCase() ?? "session"}
            </span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Berlin Marathon"
              autoFocus
              style={{
                fontSize: 13, padding: "6px 8px", borderRadius: 6,
                border: "1px solid var(--border-strong)", background: "var(--bg-card)", color: "var(--text-primary)",
              }}
            />
            {error && <span style={{ fontSize: 11, color: "var(--accent-red)" }}>{error}</span>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setOpen(false)}
                style={{ fontSize: 12, border: "1px solid var(--border-strong)", borderRadius: 6, padding: "4px 12px", background: "none", color: "var(--text-secondary)", cursor: "pointer" }}>
                Cancel
              </button>
              <button className="hra-btn" data-variant="cta" onClick={handleSave} disabled={saving}>
                {saving ? "…" : "Save"}
              </button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
