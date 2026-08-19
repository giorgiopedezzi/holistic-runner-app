import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "@/api/client";
import { Card, ErrorBanner, Checkbox, DatePicker } from "@/components/ui";
import type { Activity, BodyMeasurement } from "@/types/api";
import { fmtKm, fmtWeight, fmtDate } from "@/utils/fmt";
import { isoToday, isoAgo } from "@/utils/date";

// ── Delete section ─────────────────────────────────────────────────────────
export function DeleteSection() {
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
        parts.push(`${res.deleted} activities`);
      }
      if (delBody) {
        const res = await api.body.deleteRange(from, to);
        parts.push(`${res.deleted} measurements`);
      }
      setResult(`Moved ${parts.join(" and ")} to the trash, ${from} to ${to}.`);
      setConfirm(false);
      setActivityCount(delActivities ? 0 : null);
      setBodyCount(delBody ? 0 : null);
      setActivityPreview(delActivities ? [] : null);
      setBodyPreview(delBody ? [] : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
    setLoading(false);
  }

  return (
    <Card className="hra-card-danger-border">
      <div className="hra-block-title" style={{ marginBottom: 4 }}>
        Delete data range <span className="hra-text-muted" style={{ fontSize: 11, fontWeight: 400 }}>· local database only</span>
      </div>
      <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 16 }}>
        Moves records to the local database's trash (below) rather than removing them outright — restore them any time, or
        empty the trash to permanently reclaim the space. Nothing is touched on your Garmin watch, Strava, or Withings
        account either way, and a resync won't bring a trashed (or permanently deleted) item back on its own.
      </div>

      <div className="hra-control-row" style={{ gap: 16, marginBottom: 12 }}>
        <label className="hra-text-secondary" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
          <Checkbox checked={delActivities} onCheckedChange={setDelActivities} />
          Activities (Garmin + Strava)
        </label>
        <label className="hra-text-secondary" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
          <Checkbox checked={delBody} onCheckedChange={setDelBody} />
          Withings measurements
        </label>
        <button
          onClick={() => { setDelActivities(true); setDelBody(true); }}
          className="hra-border-strong hra-text-muted"
          style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, background: "transparent", cursor: "pointer" }}
        >
          Select all
        </button>
      </div>

      <div className="hra-control-row" style={{ gap: 8, marginBottom: 12 }}>
        <DatePicker value={from} onChange={setFrom} max={to} />
        <span className="hra-text-muted" style={{ fontSize: 12 }}>→</span>
        <DatePicker value={to} onChange={setTo} min={from} />
      </div>

      {canDelete && (
        <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 10 }}>
          This will delete{" "}
          {delActivities && <strong className="hra-text-danger">{activityCount ?? "…"} activities</strong>}
          {delActivities && delBody && " and "}
          {delBody && <strong className="hra-text-danger">{bodyCount ?? "…"} measurements</strong>}
          {" "}in this range.
        </div>
      )}

      {canDelete && (
        <label className="hra-text-secondary" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 10, cursor: "pointer" }}>
          <Checkbox checked={showData} onCheckedChange={setShowData} />
          Show data
        </label>
      )}

      {showData && delActivities && (
        <div className="hra-border" style={{ maxHeight: 160, overflow: "auto", marginBottom: 10, borderRadius: 6, padding: 8 }}>
          {activityPreview === null ? (
            <div className="hra-text-muted" style={{ fontSize: 12 }}>Loading…</div>
          ) : activityPreview.length === 0 ? (
            <div className="hra-text-muted" style={{ fontSize: 12 }}>No activities in this range.</div>
          ) : activityPreview.map(a => (
            <div key={a.id} className="hra-text-secondary" style={{ fontSize: 12, padding: "3px 0" }}>
              {fmtDate(a.date_only)} — {a.sport ?? "other"} — {fmtKm(a.distance_m)} — {a.source ?? "garmin"}
            </div>
          ))}
        </div>
      )}

      {showData && delBody && (
        <div className="hra-border" style={{ maxHeight: 160, overflow: "auto", marginBottom: 10, borderRadius: 6, padding: 8 }}>
          {bodyPreview === null ? (
            <div className="hra-text-muted" style={{ fontSize: 12 }}>Loading…</div>
          ) : bodyPreview.length === 0 ? (
            <div className="hra-text-muted" style={{ fontSize: 12 }}>No measurements in this range.</div>
          ) : bodyPreview.map((m, i) => (
            <div key={i} className="hra-text-secondary" style={{ fontSize: 12, padding: "3px 0" }}>
              {fmtDate(m.date_only)} — {fmtWeight(m.weight_kg)}
            </div>
          ))}
        </div>
      )}

      {!confirm ? (
        <button
          className="hra-btn" data-variant="cta"
          style={{ "--btn-color": "var(--accent-red)" } as CSSProperties}
          onClick={() => setConfirm(true)} disabled={!canDelete}
        >
          Move to trash…
        </button>
      ) : (
        <div className="hra-row-wrap">
          <span className="hra-text-danger" style={{ fontSize: 12 }}>
            Move to trash, {from} to {to}?
          </span>
          <button
            className="hra-btn" data-variant="cta"
            style={{ "--btn-color": "var(--accent-red)" } as CSSProperties}
            onClick={doDelete} disabled={loading}
          >
            {loading ? "…" : "Confirm"}
          </button>
          <button onClick={() => setConfirm(false)}
            className="hra-border-strong hra-text-secondary"
            style={{ background: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      )}

      {result && <div className="hra-text-success" style={{ marginTop: 10, fontSize: 12 }}>{result}</div>}
      {error  && <ErrorBanner message={error} />}
    </Card>
  );
}
