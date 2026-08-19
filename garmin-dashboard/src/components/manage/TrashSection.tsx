import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Card } from "@/components/ui";
import type { TrashedActivity, TrashedBodyMeasurement } from "@/types/api";
import { fmtKm, fmtWeight, fmtDate } from "@/utils/fmt";
import { TrashList } from "./TrashList";

export function TrashSection() {
  const [activities, setActivities] = useState<TrashedActivity[] | null>(null);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);
  const [activitiesLoading, setActivitiesLoading] = useState(true);

  const [measurements, setMeasurements] = useState<TrashedBodyMeasurement[] | null>(null);
  const [measurementsError, setMeasurementsError] = useState<string | null>(null);
  const [measurementsLoading, setMeasurementsLoading] = useState(true);

  function refreshActivities() {
    setActivitiesLoading(true);
    api.garmin.trash().then(setActivities).catch(e => setActivitiesError(e instanceof Error ? e.message : "Failed to load trash")).finally(() => setActivitiesLoading(false));
  }
  function refreshMeasurements() {
    setMeasurementsLoading(true);
    api.body.trash().then(setMeasurements).catch(e => setMeasurementsError(e instanceof Error ? e.message : "Failed to load trash")).finally(() => setMeasurementsLoading(false));
  }

  useEffect(() => { refreshActivities(); refreshMeasurements(); }, []);

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>Trash</div>
        <button
          className="hra-nav-hover"
          onClick={() => { refreshActivities(); refreshMeasurements(); }}
          title="Refresh — e.g. after deleting something above"
          style={{ background: "none", border: "none", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", cursor: "pointer", fontSize: 13, padding: "2px 5px", lineHeight: 1 }}
        >
          ⟳
        </button>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
        Items deleted above land here first. Restore brings them straight back; emptying the trash permanently deletes
        them (their data is wiped to reclaim space, but enough is kept internally that a resync still won't reimport them).
      </div>

      <TrashList
        title={`Activities (${activities?.length ?? "…"})`}
        items={activities}
        loading={activitiesLoading}
        error={activitiesError}
        renderRow={a => `${fmtDate(a.date_only)} — ${a.sport ?? "other"} — ${a.distance_m != null ? fmtKm(a.distance_m) : "—"} — ${a.source}`}
        onRestore={async ids => { await api.garmin.restore(ids); refreshActivities(); }}
        onPurge={async ids => { await api.garmin.purge(ids); refreshActivities(); }}
      />
      <TrashList
        title={`Withings measurements (${measurements?.length ?? "…"})`}
        items={measurements}
        loading={measurementsLoading}
        error={measurementsError}
        renderRow={m => `${fmtDate(m.date_only)} — ${m.weight_kg != null ? fmtWeight(m.weight_kg) : "—"}`}
        onRestore={async ids => { await api.body.restore(ids); refreshMeasurements(); }}
        onPurge={async ids => { await api.body.purge(ids); refreshMeasurements(); }}
      />
    </Card>
  );
}
