import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { Card, ErrorBanner, Checkbox, DatePicker } from "@/components/ui";
import type { Activity, BodyMeasurement } from "@/types/api";
import { fmtKm, fmtWeight, fmtDate, fmtSource } from "@/utils/fmt";
import { isoToday, isoAgo } from "@/utils/date";
import { useDemoMode } from "@/hooks/useDemoMode";

// ── Delete section ─────────────────────────────────────────────────────────
export function DeleteSection() {
  const { t } = useTranslation();
  const demoMode = useDemoMode();
  const [from, setFrom] = useState(isoAgo(30));
  const [to,   setTo]   = useState(isoToday());
  const [delActivities, setDelActivities] = useState(false);
  const [delBody,       setDelBody]       = useState(false);
  const [showData,      setShowData]      = useState(false);

  const [activityCount, setActivityCount] = useState<number | null>(null);
  const [bodyCount,     setBodyCount]     = useState<number | null>(null);
  const [activityPreview, setActivityPreview] = useState<Activity[] | null>(null);
  const [bodyPreview,     setBodyPreview]     = useState<BodyMeasurement[] | null>(null);

  const [confirm, setConfirm] = useState(false);
  const [result,  setResult]  = useState<string | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!delActivities) { setActivityCount(null); return; }
    api.garmin.count(from, to).then(r => setActivityCount(r.count)).catch(() => setActivityCount(null));
  }, [delActivities, from, to]);

  useEffect(() => {
    if (!delBody) { setBodyCount(null); return; }
    api.body.count(from, to).then(r => setBodyCount(r.count)).catch(() => setBodyCount(null));
  }, [delBody, from, to]);

  useEffect(() => {
    if (!showData || !delActivities) { setActivityPreview(null); return; }
    api.garmin.activities(from, to).then(setActivityPreview).catch(() => setActivityPreview(null));
  }, [showData, delActivities, from, to]);

  useEffect(() => {
    if (!showData || !delBody) { setBodyPreview(null); return; }
    api.body.list(from, to).then(setBodyPreview).catch(() => setBodyPreview(null));
  }, [showData, delBody, from, to]);

  const canDelete = delActivities || delBody;

  async function doDelete() {
    setLoading(true); setResult(null); setError(null);
    try {
      const parts: string[] = [];
      if (delActivities) {
        const res = await api.garmin.deleteRange(from, to);
        parts.push(t("manage.delete.activitiesCount", `${res.deleted} activities`, { n: res.deleted }));
      }
      if (delBody) {
        const res = await api.body.deleteRange(from, to);
        parts.push(t("manage.delete.measurementsCount", `${res.deleted} measurements`, { n: res.deleted }));
      }
      const partsJoined = parts.join(t("manage.delete.partsJoiner", " and "));
      setResult(t("manage.delete.movedToTrash", `Moved ${partsJoined} to the trash, ${from} to ${to}.`, { parts: partsJoined, from, to }));
      setConfirm(false);
      setActivityCount(delActivities ? 0 : null);
      setBodyCount(delBody ? 0 : null);
      setActivityPreview(delActivities ? [] : null);
      setBodyPreview(delBody ? [] : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("manage.delete.deleteFailed", "Delete failed"));
    }
    setLoading(false);
  }

  return (
    <Card className="hra-card-danger-border">
      <div className="hra-block-title mb-1" >
        {t("manage.delete.title", "Delete data range")} <span className="hra-text-muted text-meta font-normal" >· {t("manage.delete.localOnly", "local database only")}</span>
      </div>
      <div className="hra-text-secondary text-meta mb-4" >
        {t("manage.delete.description", "Moves records to the local database's trash (below) rather than removing them outright — restore them any time, or empty the trash to permanently reclaim the space. Nothing is touched on your Garmin watch, Strava, or Withings account either way, and a resync won't bring a trashed (or permanently deleted) item back on its own.")}
      </div>

      <div className="hra-control-row gap-4 mb-3" >
        <label className="hra-text-secondary flex items-center gap-1.5 text-meta cursor-pointer" >
          <Checkbox checked={delActivities} onCheckedChange={setDelActivities} />
          {t("manage.delete.activitiesLabel", "Activities (Garmin + Strava)")}
        </label>
        <label className="hra-text-secondary flex items-center gap-1.5 text-meta cursor-pointer" >
          <Checkbox checked={delBody} onCheckedChange={setDelBody} />
          {t("manage.delete.bodyLabel", "Withings measurements")}
        </label>
        <button
          onClick={() => { setDelActivities(true); setDelBody(true); }}
          className="hra-chip-action hra-border-strong hra-text-muted text-meta rounded-full bg-transparent cursor-pointer"
        >
          {t("manage.delete.selectAll", "Select all")}
        </button>
      </div>

      <div className="hra-control-row gap-2 mb-3" >
        <DatePicker value={from} onChange={setFrom} max={to} />
        <span className="hra-text-muted text-meta" >→</span>
        <DatePicker value={to} onChange={setTo} min={from} />
      </div>

      {canDelete && (
        <div className="hra-text-secondary text-meta mb-2.5" >
          {t("manage.delete.willDelete", "This will delete")}{" "}
          {delActivities && <strong className="hra-text-danger">{t("manage.delete.activitiesCount", `${activityCount ?? "…"} activities`, { n: activityCount ?? "…" })}</strong>}
          {delActivities && delBody && t("manage.delete.partsJoiner", " and ")}
          {delBody && <strong className="hra-text-danger">{t("manage.delete.measurementsCount", `${bodyCount ?? "…"} measurements`, { n: bodyCount ?? "…" })}</strong>}
          {" "}{t("manage.delete.inThisRange", "in this range.")}
        </div>
      )}

      {canDelete && (
        <label className="hra-text-secondary flex items-center gap-1.5 text-meta mb-2.5 cursor-pointer" >
          <Checkbox checked={showData} onCheckedChange={setShowData} />
          {t("manage.delete.showData", "Show data")}
        </label>
      )}

      {showData && delActivities && (
        <div className="hra-border max-h-40 overflow-auto mb-2.5 rounded-md p-2" >
          {activityPreview === null ? (
            <div className="hra-text-muted text-meta" >{t("common.loading", "Loading…")}</div>
          ) : activityPreview.length === 0 ? (
            <div className="hra-text-muted text-meta" >{t("manage.delete.noActivitiesInRange", "No activities in this range.")}</div>
          ) : activityPreview.map(a => (
            <div key={a.id} className="hra-list-row hra-text-secondary text-meta">
              {fmtDate(a.date_only)} — {a.sport ?? "other"} — {fmtKm(a.distance_m)} — {fmtSource(a.source ?? "garmin")}
            </div>
          ))}
        </div>
      )}

      {showData && delBody && (
        <div className="hra-border max-h-40 overflow-auto mb-2.5 rounded-md p-2" >
          {bodyPreview === null ? (
            <div className="hra-text-muted text-meta" >{t("common.loading", "Loading…")}</div>
          ) : bodyPreview.length === 0 ? (
            <div className="hra-text-muted text-meta" >{t("manage.delete.noMeasurementsInRange", "No measurements in this range.")}</div>
          ) : bodyPreview.map((m, i) => (
            <div key={i} className="hra-list-row hra-text-secondary text-meta">
              {fmtDate(m.date_only)} — {fmtWeight(m.weight_kg)}
            </div>
          ))}
        </div>
      )}

      {!confirm ? (
        <button
          className="hra-btn" data-variant="cta"
          data-tone="red"
          onClick={() => setConfirm(true)} disabled={!canDelete || demoMode}
          title={demoMode ? t("common.demoModeHint", "Not available for demo") : undefined}
        >
          {t("manage.delete.moveToTrashButton", "Move to trash…")}
        </button>
      ) : (
        <div className="hra-row-wrap">
          <span className="hra-text-danger text-meta" >
            {t("manage.delete.moveToTrashConfirm", `Move to trash, ${from} to ${to}?`, { from, to })}
          </span>
          <button
            className="hra-btn" data-variant="cta"
            data-tone="red"
            onClick={doDelete} disabled={loading}
          >
            {loading ? "…" : t("common.confirm", "Confirm")}
          </button>
          <button onClick={() => setConfirm(false)}
            className="hra-control-action hra-border-strong hra-text-secondary bg-transparent rounded-md text-meta cursor-pointer">
            {t("common.cancel", "Cancel")}
          </button>
        </div>
      )}

      {result && <div className="hra-text-success mt-2.5 text-meta" >{result}</div>}
      {error  && <ErrorBanner message={error} />}
    </Card>
  );
}
