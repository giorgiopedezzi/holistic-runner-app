import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { Card } from "@/components/ui";
import type { TrashedActivity, TrashedBodyMeasurement } from "@/types/api";
import { fmtKm, fmtWeight, fmtDate, fmtSource } from "@/utils/fmt";
import { TrashList } from "./TrashList";

export function TrashSection() {
  const { t } = useTranslation();
  const [activities, setActivities] = useState<TrashedActivity[] | null>(null);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);
  const [activitiesLoading, setActivitiesLoading] = useState(true);

  const [measurements, setMeasurements] = useState<TrashedBodyMeasurement[] | null>(null);
  const [measurementsError, setMeasurementsError] = useState<string | null>(null);
  const [measurementsLoading, setMeasurementsLoading] = useState(true);

  function refreshActivities() {
    setActivitiesLoading(true);
    api.garmin.trash().then(setActivities).catch(e => setActivitiesError(e instanceof Error ? e.message : t("manage.trash.loadFailed", "Failed to load trash"))).finally(() => setActivitiesLoading(false));
  }
  function refreshMeasurements() {
    setMeasurementsLoading(true);
    api.body.trash().then(setMeasurements).catch(e => setMeasurementsError(e instanceof Error ? e.message : t("manage.trash.loadFailed", "Failed to load trash"))).finally(() => setMeasurementsLoading(false));
  }

  // Run once on mount — both functions close over `t` (react-i18next's
  // translate function, referentially stable) alongside their own stable
  // state setters, not over anything that should re-trigger this fetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refreshActivities(); refreshMeasurements(); }, []);

  return (
    <Card>
      <div className="hra-row gap-2 mb-1" >
        <div className="hra-block-title">{t("manage.trash.title", "Trash")}</div>
        <button
          className="hra-icon-action hra-nav-hover hra-text-muted bg-transparent border-0 cursor-pointer text-label leading-none"
          onClick={() => { refreshActivities(); refreshMeasurements(); }}
          title={t("manage.trash.refreshTooltip", "Refresh — e.g. after deleting something above")}
        >
          ⟳
        </button>
      </div>
      <div className="hra-text-secondary text-meta mb-4" >
        {t("manage.trash.description", "Items deleted above land here first. Restore brings them straight back; emptying the trash permanently deletes them (their data is wiped to reclaim space, but enough is kept internally that a resync still won't reimport them).")}
      </div>

      <TrashList
        title={t("manage.trash.activitiesTitle", `Activities (${activities?.length ?? "…"})`, { n: activities?.length ?? "…" })}
        items={activities}
        loading={activitiesLoading}
        error={activitiesError}
        renderRow={a => `${fmtDate(a.date_only)} — ${a.sport ?? "other"} — ${a.distance_m != null ? fmtKm(a.distance_m) : "—"} — ${fmtSource(a.source)}`}
        onRestore={async ids => { await api.garmin.restore(ids); refreshActivities(); }}
        onPurge={async ids => { await api.garmin.purge(ids); refreshActivities(); }}
      />
      <TrashList
        title={t("manage.trash.measurementsTitle", `Withings measurements (${measurements?.length ?? "…"})`, { n: measurements?.length ?? "…" })}
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
