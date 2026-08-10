/**
 * ManageTab.tsx
 * Sync Garmin/Withings/Strava data, and delete data ranges. Browsing
 * individual activities lives in ActivitiesTab now, not here.
 */

import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import type { SyncResult } from "@/api/client";
import { Card, SectionTitle, ErrorBanner, LoadingSpinner, ProgressBar, StatusLine } from "@/components/ui";
import type { Activity, BodyMeasurement, DeviceStatus, WithingsStatus, StravaStatus, TrashedActivity, TrashedBodyMeasurement, ClassificationMethod } from "@/types/api";
import { classificationStatus } from "@/types/api";
import { fmtKm, fmtWeight } from "@/utils/fmt";

function isoToday() { return new Date().toISOString().slice(0, 10); }
function isoAgo(d: number) { return new Date(Date.now() - d * 86400000).toISOString().slice(0, 10); }

// ── Shared sync logic ────────────────────────────────────────────────────
type SyncPhase = "download" | "import";
interface SyncProgress { phase: SyncPhase; current: number; total: number; label?: string; }

const PHASE_LABEL: Record<SyncPhase, string> = {
  download: "Step 1/2 — Downloading files from device",
  import:   "Step 2/2 — Importing into database",
};

type SyncEvent =
  | { type: "progress"; phase: SyncPhase; current: number; total: number; label?: string }
  | { type: "done"; imported: number; skipped: number; errors: number }
  | { type: "error"; message: string };

// Shared by UploadSection's own button and SyncAllBar, so both use the exact
// same streaming/parsing logic instead of two copies drifting apart.
async function runGarminSync(onProgress?: (p: SyncProgress) => void): Promise<SyncResult> {
  const res = await fetch(`/api/v1/sync/garmin`, { method: "POST" });
  if (!res.ok || !res.body) throw new Error(`Server responded ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result: SyncResult | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const evt = JSON.parse(line) as SyncEvent;
      if (evt.type === "progress") onProgress?.(evt);
      else if (evt.type === "error") throw new Error(evt.message);
      else result = evt;
    }
  }

  if (!result) throw new Error("Sync ended without a result");
  return result;
}

function deviceStatusMessage(device: DeviceStatus | null): string {
  switch (device?.reason) {
    case "device_not_found":          return "Device not found — plug in via USB";
    case "storage_not_found":
    case "garmin_folder_not_found":
    case "activity_folder_not_found": return "Device connected, but its Activity folder isn't accessible";
    case "timeout":                   return "Device check timed out — try again";
    case "powershell_error":
    case "parse_error":               return "Couldn't check device status";
    default:                          return "Device not found — plug in via USB";
  }
}

// ── Sync all ──────────────────────────────────────────────────────────────
interface SyncAllBarProps {
  withingsFrom: string; withingsTo: string;
  stravaFrom:   string; stravaTo:   string;
}

function SyncAllBar({ withingsFrom, withingsTo, stravaFrom, stravaTo }: SyncAllBarProps) {
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [log, setLog] = useState<string[]>([]);

  async function syncAll() {
    setStatus("running");
    const lines: string[] = [];
    const push = (s: string) => { lines.push(s); setLog([...lines]); };

    try {
      const device = await api.garmin.deviceStatus();
      if (device.connected) {
        push("Syncing Garmin…");
        const r = await runGarminSync();
        push(`Garmin: ${r.imported} imported, ${r.skipped} skipped, ${r.errors} errors.`);
      } else {
        push("Garmin: skipped — device not connected.");
      }
    } catch (e) {
      push(`Garmin: failed — ${e instanceof Error ? e.message : "sync error"}`);
    }

    try {
      const token = await api.body.tokenStatus();
      if (token.present && token.valid) {
        push("Syncing Withings…");
        const r = await api.body.sync(withingsFrom, withingsTo);
        push(`Withings: ${r.imported} imported, ${r.skipped} skipped, ${r.errors} errors.`);
      } else {
        push("Withings: skipped — not logged in.");
      }
    } catch (e) {
      push(`Withings: failed — ${e instanceof Error ? e.message : "sync error"}`);
    }

    try {
      const token = await api.strava.tokenStatus();
      if (token.present && token.valid) {
        push("Syncing Strava…");
        const r = await api.strava.sync(stravaFrom, stravaTo);
        push(`Strava: ${r.imported} imported, ${r.skipped} skipped, ${r.errors} errors.`);
      } else {
        push("Strava: skipped — not logged in.");
      }
    } catch (e) {
      push(`Strava: failed — ${e instanceof Error ? e.message : "sync error"}`);
    }

    setStatus("done");
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>Sync all</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Runs every sync below in one go — skips whichever source isn't ready (device unplugged, not logged in).
          </div>
        </div>
        <button
          onClick={syncAll}
          disabled={status === "running"}
          style={{
            background: "var(--accent-blue)", color: "#fff", border: "none",
            borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 500,
            cursor: status === "running" ? "not-allowed" : "pointer", opacity: status === "running" ? 0.6 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {status === "running" ? "Syncing…" : "⚡ Sync all"}
        </button>
      </div>
      {log.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 2 }}>
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </Card>
  );
}

// ── Upload section (Garmin) ─────────────────────────────────────────────
function UploadSection() {
  const [status,   setStatus]   = useState<"idle"|"running"|"done"|"error">("idle");
  const [msg,      setMsg]      = useState("");
  const [progress, setProgress] = useState<SyncProgress | null>(null);

  const [device, setDevice] = useState<DeviceStatus | null>(null);
  const [checkingDevice, setCheckingDevice] = useState(false);

  async function checkDevice() {
    setCheckingDevice(true);
    try {
      setDevice(await api.garmin.deviceStatus());
    } catch {
      setDevice({ connected: false, reason: "powershell_error" });
    }
    setCheckingDevice(false);
  }

  useEffect(() => { checkDevice(); }, []);

  const canSync = status !== "running" && device?.connected === true;

  async function triggerSync() {
    setStatus("running");
    setMsg("");
    setProgress(null);
    try {
      const result = await runGarminSync(setProgress);
      setMsg(`Done — ${result.imported} imported, ${result.skipped} skipped, ${result.errors} errors.`);
      setStatus("done");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Sync failed");
      setStatus("error");
    } finally {
      setProgress(null);
    }
  }

  return (
    <Card>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Sync Garmin activities</div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
        Runs the PowerShell MTP bridge to pull new .FIT files from your Forerunner 965 and import them into the DB.
        Connect the watch via USB first. Pulls every new file on the device — there's no date range to set here, since the device is diffed against what's already imported, not queried by date.
      </div>

      <StatusLine
        state={checkingDevice ? "checking" : device?.connected ? "ok" : "warn"}
        message={checkingDevice ? "Checking device…" : device?.connected ? `${device.name ?? "Device"} connected` : deviceStatusMessage(device)}
        onRecheck={checkDevice}
        checking={checkingDevice}
      />

      <button
        onClick={triggerSync}
        disabled={!canSync}
        title={!canSync && status !== "running" ? "Connect the watch first" : undefined}
        style={{
          background: "var(--accent-green)", color: "var(--bg)", border: "none",
          borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 500,
          cursor: canSync ? "pointer" : "not-allowed", opacity: canSync ? 1 : 0.5,
        }}
      >
        {status === "running" ? "Syncing…" : "↓ Sync from device"}
      </button>

      {status === "running" && (
        <div style={{ marginTop: 14 }}>
          <ProgressBar
            label={progress ? `${PHASE_LABEL[progress.phase]}${progress.label ? ` — ${progress.label}` : ""}` : "Checking device for new files…"}
            current={progress?.current}
            total={progress?.total}
          />
        </div>
      )}

      {msg && (
        <div style={{
          marginTop: 12, fontSize: 12, padding: "8px 12px", borderRadius: 6,
          background: status === "error" ? "var(--bg-danger)" : "var(--surface-1)",
          color: status === "error" ? "var(--accent-red)" : "var(--text-secondary)",
          border: `1px solid ${status === "error" ? "var(--accent-red)" : "var(--border)"}44`,
        }}>
          {msg}
        </div>
      )}
    </Card>
  );
}

// ── Withings sync section ────────────────────────────────────────────────
function fmtExpiry(unixSeconds: number): string {
  const diffH = (unixSeconds - Date.now() / 1000) / 3600;
  if (diffH <= 0) return "soon";
  if (diffH < 24) return `in ${Math.max(1, Math.round(diffH))}h`;
  return `in ${Math.round(diffH / 24)}d`;
}

interface WithingsSyncSectionProps {
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}

function WithingsSyncSection({ from, to, onFromChange, onToChange }: WithingsSyncSectionProps) {
  const [status, setStatus] = useState<"idle"|"running"|"done"|"error">("idle");
  const [msg,    setMsg]    = useState("");

  const [token, setToken] = useState<WithingsStatus | null>(null);
  const [checkingToken, setCheckingToken] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  async function checkToken() {
    setCheckingToken(true);
    try {
      setToken(await api.body.tokenStatus());
    } catch {
      setToken({ present: false, valid: false });
    }
    setCheckingToken(false);
  }

  useEffect(() => { checkToken(); }, []);

  async function login() {
    setLoggingIn(true);
    setMsg("");
    try {
      const { url } = await api.body.loginUrl();
      const popup = window.open(url, "withings-login", "width=480,height=720");
      if (!popup) {
        setMsg("Your browser blocked the popup — allow popups for this site and try again.");
        setLoggingIn(false);
        return;
      }

      const poll = window.setInterval(() => {
        void (async () => {
          if (popup.closed) {
            window.clearInterval(poll);
            setLoggingIn(false);
            await checkToken();
            return;
          }
          const s = await api.body.tokenStatus();
          if (s.valid) {
            window.clearInterval(poll);
            popup.close();
            setLoggingIn(false);
            setToken(s);
          }
        })();
      }, 1500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not start login");
      setLoggingIn(false);
    }
  }

  async function triggerSync() {
    setStatus("running");
    setMsg("Fetching measurements from Withings…");
    try {
      const data = await api.body.sync(from, to);
      setMsg(`Done — ${data.imported} imported, ${data.skipped} skipped, ${data.errors} errors.`);
      setStatus("done");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Sync failed");
      setStatus("error");
    }
  }

  const connected = token?.present === true && token?.valid === true;
  const canSync   = status !== "running" && connected;

  return (
    <Card>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Sync Withings measurements</div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
        Pulls weight and body composition measurements from the Withings API for the range below (defaults to since your last sync if you leave it alone).
      </div>

      <StatusLine
        state={checkingToken ? "checking" : connected ? "ok" : token?.present ? "error" : "warn"}
        message={
          checkingToken ? "Checking token…"
          : connected   ? `Connected${token?.expiresAt ? ` · expires ${fmtExpiry(token.expiresAt)}` : ""}`
          : token?.present ? "Withings session expired — please log in again"
          : "Not connected to Withings"
        }
        onRecheck={checkToken}
        checking={checkingToken}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Date range:</label>
        <input type="date" value={from} onChange={e => onFromChange(e.target.value)} max={to} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>→</span>
        <input type="date" value={to} onChange={e => onToChange(e.target.value)} min={from} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={login}
          disabled={loggingIn}
          style={{
            background: "none", color: "var(--accent-blue)", border: "1px solid var(--accent-blue)",
            borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 500,
            cursor: loggingIn ? "not-allowed" : "pointer", opacity: loggingIn ? 0.6 : 1,
          }}
        >
          {loggingIn ? "Waiting for login…" : connected ? "Re-login" : "Login to Withings"}
        </button>

        <button
          onClick={triggerSync}
          disabled={!canSync}
          title={!canSync && status !== "running" ? "Log in to Withings first" : undefined}
          style={{
            background: "var(--accent-green)", color: "var(--bg)", border: "none",
            borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 500,
            cursor: canSync ? "pointer" : "not-allowed", opacity: canSync ? 1 : 0.5,
          }}
        >
          {status === "running" ? "Syncing…" : "↓ Sync from Withings"}
        </button>
      </div>

      {msg && (
        <div style={{
          marginTop: 12, fontSize: 12, padding: "8px 12px", borderRadius: 6,
          background: status === "error" ? "var(--bg-danger)" : "var(--surface-1)",
          color: status === "error" ? "var(--accent-red)" : "var(--text-secondary)",
          border: `1px solid ${status === "error" ? "var(--accent-red)" : "var(--border)"}44`,
        }}>
          {msg}
        </div>
      )}
    </Card>
  );
}

// ── Strava sync section ──────────────────────────────────────────────────
// Structural copy of WithingsSyncSection — same status/login-popup/date
// range/sync pattern, adapted for Strava's OAuth (server.ts's callback for
// this one lives on the main port, see CLAUDE.md).
interface StravaSyncSectionProps {
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}

function StravaSyncSection({ from, to, onFromChange, onToChange }: StravaSyncSectionProps) {
  const [status, setStatus] = useState<"idle"|"running"|"done"|"error">("idle");
  const [msg,    setMsg]    = useState("");

  const [token, setToken] = useState<StravaStatus | null>(null);
  const [checkingToken, setCheckingToken] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  async function checkToken() {
    setCheckingToken(true);
    try {
      setToken(await api.strava.tokenStatus());
    } catch {
      setToken({ present: false, valid: false });
    }
    setCheckingToken(false);
  }

  useEffect(() => { checkToken(); }, []);

  async function login() {
    setLoggingIn(true);
    setMsg("");
    try {
      const { url } = await api.strava.loginUrl();
      const popup = window.open(url, "strava-login", "width=480,height=720");
      if (!popup) {
        setMsg("Your browser blocked the popup — allow popups for this site and try again.");
        setLoggingIn(false);
        return;
      }

      const poll = window.setInterval(() => {
        void (async () => {
          if (popup.closed) {
            window.clearInterval(poll);
            setLoggingIn(false);
            await checkToken();
            return;
          }
          const s = await api.strava.tokenStatus();
          if (s.valid) {
            window.clearInterval(poll);
            popup.close();
            setLoggingIn(false);
            setToken(s);
          }
        })();
      }, 1500);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not start login");
      setLoggingIn(false);
    }
  }

  async function triggerSync() {
    setStatus("running");
    setMsg("Fetching activities from Strava…");
    try {
      const data = await api.strava.sync(from, to);
      setMsg(`Done — ${data.imported} imported, ${data.skipped} skipped, ${data.errors} errors.`);
      setStatus("done");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Sync failed");
      setStatus("error");
    }
  }

  const connected = token?.present === true && token?.valid === true;
  const canSync   = status !== "running" && connected;

  return (
    <Card>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Sync Strava activities</div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
        Pulls activities from the Strava API for the range below (defaults to since your last sync if you leave it alone).
        Activities that match an existing one in time and distance are skipped as likely duplicates rather than double-imported.
      </div>

      <StatusLine
        state={checkingToken ? "checking" : connected ? "ok" : token?.present ? "error" : "warn"}
        message={
          checkingToken ? "Checking token…"
          : connected   ? `Connected${token?.expiresAt ? ` · expires ${fmtExpiry(token.expiresAt)}` : ""}`
          : token?.present ? "Strava session expired — please log in again"
          : "Not connected to Strava"
        }
        onRecheck={checkToken}
        checking={checkingToken}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Date range:</label>
        <input type="date" value={from} onChange={e => onFromChange(e.target.value)} max={to} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>→</span>
        <input type="date" value={to} onChange={e => onToChange(e.target.value)} min={from} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={login}
          disabled={loggingIn}
          style={{
            background: "none", color: "var(--accent-blue)", border: "1px solid var(--accent-blue)",
            borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 500,
            cursor: loggingIn ? "not-allowed" : "pointer", opacity: loggingIn ? 0.6 : 1,
          }}
        >
          {loggingIn ? "Waiting for login…" : connected ? "Re-login" : "Login to Strava"}
        </button>

        <button
          onClick={triggerSync}
          disabled={!canSync}
          title={!canSync && status !== "running" ? "Log in to Strava first" : undefined}
          style={{
            background: "var(--accent-green)", color: "var(--bg)", border: "none",
            borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 500,
            cursor: canSync ? "pointer" : "not-allowed", opacity: canSync ? 1 : 0.5,
          }}
        >
          {status === "running" ? "Syncing…" : "↓ Sync from Strava"}
        </button>
      </div>

      {msg && (
        <div style={{
          marginTop: 12, fontSize: 12, padding: "8px 12px", borderRadius: 6,
          background: status === "error" ? "var(--bg-danger)" : "var(--surface-1)",
          color: status === "error" ? "var(--accent-red)" : "var(--text-secondary)",
          border: `1px solid ${status === "error" ? "var(--accent-red)" : "var(--border)"}44`,
        }}>
          {msg}
        </div>
      )}
    </Card>
  );
}

// ── Delete section ─────────────────────────────────────────────────────────
function DeleteSection() {
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
    <Card style={{ borderColor: "#e24b4a33" }}>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
        Delete data range <span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>· local database only</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 16 }}>
        Moves records to the local database's trash (below) rather than removing them outright — restore them any time, or
        empty the trash to permanently reclaim the space. Nothing is touched on your Garmin watch, Strava, or Withings
        account either way, and a resync won't bring a trashed (or permanently deleted) item back on its own.
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
          <input type="checkbox" checked={delActivities} onChange={e => setDelActivities(e.target.checked)} />
          Activities (Garmin + Strava)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
          <input type="checkbox" checked={delBody} onChange={e => setDelBody(e.target.checked)} />
          Withings measurements
        </label>
        <button
          onClick={() => { setDelActivities(true); setDelBody(true); }}
          style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
        >
          Select all
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} max={to} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>→</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} min={from} />
      </div>

      {canDelete && (
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
          This will delete{" "}
          {delActivities && <strong style={{ color: "var(--accent-red)" }}>{activityCount ?? "…"} activities</strong>}
          {delActivities && delBody && " and "}
          {delBody && <strong style={{ color: "var(--accent-red)" }}>{bodyCount ?? "…"} measurements</strong>}
          {" "}in this range.
        </div>
      )}

      {canDelete && (
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", marginBottom: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={showData} onChange={e => setShowData(e.target.checked)} />
          Show data
        </label>
      )}

      {showData && delActivities && (
        <div style={{ maxHeight: 160, overflow: "auto", marginBottom: 10, border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}>
          {activityPreview === null ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading…</div>
          ) : activityPreview.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No activities in this range.</div>
          ) : activityPreview.map(a => (
            <div key={a.id} style={{ fontSize: 12, padding: "3px 0", color: "var(--text-secondary)" }}>
              {a.date_only} — {a.sport ?? "other"} — {fmtKm(a.distance_m)} — {a.source ?? "garmin"}
            </div>
          ))}
        </div>
      )}

      {showData && delBody && (
        <div style={{ maxHeight: 160, overflow: "auto", marginBottom: 10, border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}>
          {bodyPreview === null ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading…</div>
          ) : bodyPreview.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No measurements in this range.</div>
          ) : bodyPreview.map((m, i) => (
            <div key={i} style={{ fontSize: 12, padding: "3px 0", color: "var(--text-secondary)" }}>
              {m.date_only} — {fmtWeight(m.weight_kg)}
            </div>
          ))}
        </div>
      )}

      {!confirm ? (
        <button onClick={() => setConfirm(true)} disabled={!canDelete}
          style={{
            background: "none", color: "var(--accent-red)", border: "1px solid var(--accent-red)", borderRadius: 8,
            padding: "6px 16px", fontSize: 13, cursor: canDelete ? "pointer" : "not-allowed", opacity: canDelete ? 1 : 0.5,
          }}>
          Move to trash…
        </button>
      ) : (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--accent-red)" }}>
            Move to trash, {from} to {to}?
          </span>
          <button onClick={doDelete} disabled={loading}
            style={{ background: "var(--accent-red)", color: "#fff", border: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }}>
            {loading ? "…" : "Confirm"}
          </button>
          <button onClick={() => setConfirm(false)}
            style={{ background: "none", border: "1px solid var(--border-strong)", borderRadius: 6, padding: "5px 14px", fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      )}

      {result && <div style={{ marginTop: 10, fontSize: 12, color: "var(--accent-green)" }}>{result}</div>}
      {error  && <ErrorBanner message={error} />}
    </Card>
  );
}

// ── Trash ────────────────────────────────────────────────────────────────
// Both entity types (activities, body measurements) share one card/UI shape
// — a checkbox list plus Restore / Empty trash (permanent) actions — but
// stay two independent lists/selections/requests, matching how the Delete
// card above already treats them as two separate things.
function TrashList<T extends { id: number; deleted_at: string }>({
  title, items, loading, error, renderRow, onRestore, onPurge,
}: {
  title: string;
  items: T[] | null;
  loading: boolean;
  error: string | null;
  renderRow: (item: T) => string;
  onRestore: (ids: number[]) => Promise<void>;
  onPurge: (ids: number[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSelected(new Set()); setConfirmPurge(false); }, [items]);

  function toggle(id: number) {
    setSelected(s => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function toggleAll() {
    setSelected(s => (items && s.size === items.length ? new Set() : new Set(items?.map(i => i.id) ?? [])));
  }

  async function doRestore() {
    setBusy(true);
    try { await onRestore([...selected]); } finally { setBusy(false); }
  }
  async function doPurge() {
    setBusy(true);
    try { await onPurge([...selected]); setConfirmPurge(false); } finally { setBusy(false); }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{title}</div>
      {loading && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading…</div>}
      {error && <ErrorBanner message={error} />}
      {!loading && !error && items && items.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Trash is empty.</div>
      )}
      {!loading && !error && items && items.length > 0 && (
        <>
          <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: 8, marginBottom: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", cursor: "pointer", marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
              <input type="checkbox" checked={selected.size === items.length} onChange={toggleAll} />
              Select all ({items.length})
            </label>
            {items.map(item => (
              <label key={item.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer", padding: "3px 0" }}>
                <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} />
                {renderRow(item)}
              </label>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={doRestore} disabled={selected.size === 0 || busy}
              style={{
                fontSize: 12, padding: "5px 14px", borderRadius: 6, border: "1px solid var(--accent-blue)",
                background: "none", color: "var(--accent-blue)",
                cursor: selected.size === 0 || busy ? "not-allowed" : "pointer", opacity: selected.size === 0 ? 0.5 : 1,
              }}>
              Restore selected
            </button>

            {!confirmPurge ? (
              <button onClick={() => setConfirmPurge(true)} disabled={selected.size === 0 || busy}
                title="Permanently deletes the selected item(s) — this can't be undone. The filename/date is still kept internally so a resync won't bring it back."
                style={{
                  fontSize: 12, padding: "5px 14px", borderRadius: 6, border: "1px solid var(--accent-red)",
                  background: "none", color: "var(--accent-red)",
                  cursor: selected.size === 0 || busy ? "not-allowed" : "pointer", opacity: selected.size === 0 ? 0.5 : 1,
                }}>
                Delete permanently…
              </button>
            ) : (
              <>
                <span style={{ fontSize: 12, color: "var(--accent-red)" }}>Permanently delete {selected.size} item(s)? This can't be undone.</span>
                <button onClick={doPurge} disabled={busy}
                  style={{ background: "var(--accent-red)", color: "#fff", border: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }}>
                  {busy ? "…" : "Confirm"}
                </button>
                <button onClick={() => setConfirmPurge(false)}
                  style={{ background: "none", border: "1px solid var(--border-strong)", borderRadius: 6, padding: "5px 14px", fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── AI workout classification (bulk) ────────────────────────────────────
// Same date-range → checkbox-list → bulk-action shape as DeleteSection/
// TrashSection above, but with two distinct actions (classify/reclassify vs
// confirm) and live progress, since classifying is genuinely slow. No bulk
// backend endpoint for classify — this loops POST /api/activities/:id/classify
// sequentially so the "Classifying N/M…" counter is real, not simulated
// (see server.ts's note on why there's no bulk classify route). Confirm is
// fast/DB-only, so it does use the real bulk endpoint.
function ClassifySection() {
  const [from, setFrom] = useState(isoAgo(30));
  const [to,   setTo]   = useState(isoToday());
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [splitMeters, setSplitMeters] = useState(1000);
  const [method, setMethod] = useState<ClassificationMethod>("ai");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // "Mark where you are" — briefly highlights whichever rows a bulk confirm
  // just touched. Selection itself gets cleared right after (activities
  // changing reference re-triggers the setSelected(new Set()) effect below),
  // so without this there'd be no visual trace of what just happened once
  // the checkboxes clear, especially now that scroll position is preserved
  // and the list doesn't visibly "jump" to draw the eye on its own.
  const [justConfirmed, setJustConfirmed] = useState<Set<number>>(new Set());
  const justConfirmedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function load() {
    setLoading(true);
    setLoadError(null);
    api.garmin.activities(from, to)
      // Scoped to running only — the six categories are running-specific
      // terminology, classifying e.g. a bike ride wouldn't be meaningful.
      .then(all => setActivities(all.filter(a => a.sport === "running")))
      .catch(e => setLoadError(e instanceof Error ? e.message : "Failed to load activities"))
      .finally(() => setLoading(false));
  }
  // Same fetch as load(), but never toggles `loading` — load() gates the
  // whole scrollable list behind {!loading && ...}, so calling it after an
  // in-place action (like bulk confirm) unmounts and remounts the list
  // container, resetting its scroll position to the top. This variant keeps
  // the container mounted the whole time, so the browser preserves scroll
  // offset the same way it would for any other in-place content update.
  function refresh() {
    api.garmin.activities(from, to)
      .then(all => setActivities(all.filter(a => a.sport === "running")))
      .catch(e => setActionError(e instanceof Error ? e.message : "Failed to refresh"));
  }
  useEffect(() => { load(); }, [from, to]);
  useEffect(() => setSelected(new Set()), [activities]);
  useEffect(() => () => { if (justConfirmedTimer.current) clearTimeout(justConfirmedTimer.current); }, []);

  function toggle(id: number) {
    setSelected(s => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function toggleAll() {
    setSelected(s => (activities && s.size === activities.length ? new Set() : new Set(activities?.map(a => a.id) ?? [])));
  }
  function updateOne(id: number, updated: Activity) {
    setActivities(list => list ? list.map(a => (a.id === id ? updated : a)) : list);
  }

  async function classifySelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    setActionError(null);
    setProgress({ current: 0, total: ids.length });
    const errors: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      try {
        updateOne(ids[i], await api.garmin.classify(ids[i], splitMeters, method));
      } catch (e) {
        errors.push(`#${ids[i]}: ${e instanceof Error ? e.message : "failed"}`);
      }
      setProgress({ current: i + 1, total: ids.length });
    }
    if (errors.length) setActionError(errors.slice(0, 3).join("; ") + (errors.length > 3 ? ` (+${errors.length - 3} more)` : ""));
    setProgress(null);
    setBusy(false);
  }

  async function confirmSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.garmin.confirmBulk(ids, method);
      refresh(); // in-place refresh, not load() — see refresh()'s note on why (preserves scroll position)
      if (justConfirmedTimer.current) clearTimeout(justConfirmedTimer.current);
      setJustConfirmed(new Set(ids));
      justConfirmedTimer.current = setTimeout(() => setJustConfirmed(new Set()), 3000);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Confirm failed");
    }
    setBusy(false);
  }

  // Confirm always acts on the currently-selected method's slot (same
  // switch classify uses), not "either slot" — matches confirmActivityById's
  // $source-scoped WHERE clause in server.ts.
  const canConfirm = [...selected].some(id => {
    const a = activities?.find(a2 => a2.id === id);
    return method === "ai" ? a?.ai_classification : a?.statistical_classification;
  });

  return (
    <Card>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>AI workout classification</div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
        Classifies running activities (Recovery Run, Long Session, Repeats/Intervals, Progressive Run, Fartlek, Tapasciata /
        Light Maintenance) using either a local Ollama model or instant deterministic rules — nothing leaves this machine
        either way. Each batch run here uses one method (switch below); the single-activity detail view can run and compare
        both. Reclassifying is always allowed, even on an already-confirmed activity, and resets it back to pending review.
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} max={to} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>→</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} min={from} />
      </div>

      {loading && <LoadingSpinner />}
      {loadError && <ErrorBanner message={loadError} />}

      {!loading && !loadError && activities && (
        <>
          {activities.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>No running activities in this range.</div>
          ) : (
            <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: 8, marginBottom: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", cursor: "pointer", marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
                <input type="checkbox" checked={selected.size === activities.length} onChange={toggleAll} />
                Select all ({activities.length})
              </label>
              {activities.map(a => {
                const status = classificationStatus(a);
                const pendingColor = "var(--accent-orange)";
                const confirmedColor = "var(--accent-green)";
                const mutedColor = "var(--text-muted)";
                const pill = (text: string, key: string, isConfirmedSource: boolean) => {
                  // Both slots always get their own pill, regardless of
                  // confirm state — collapsing to a single "Confirmed: X"
                  // pill (an earlier version) hid whichever result wasn't
                  // chosen as final, even though it's still stored and still
                  // useful to see for comparison. The confirmed slot (if
                  // any) is just colored/marked differently, not the only
                  // one shown.
                  const col = isConfirmedSource ? confirmedColor : status === "confirmed" ? mutedColor : pendingColor;
                  return (
                    <span key={key} style={{
                      fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 20,
                      border: `1px solid ${col}`, color: col, textTransform: "uppercase", letterSpacing: "0.03em",
                    }}>
                      {isConfirmedSource && "✓ "}{text}
                    </span>
                  );
                };
                const resultPills = [
                  a.ai_classification && pill(`AI: ${a.ai_classification}`, "ai", status === "confirmed" && a.classification_method === "ai"),
                  a.statistical_classification && pill(`Stats: ${a.statistical_classification}`, "stats", status === "confirmed" && a.classification_method === "statistical"),
                ].filter((x): x is React.ReactElement => Boolean(x));
                return (
                  <label key={a.id} style={{
                    display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)",
                    cursor: "pointer", padding: "3px 4px", borderRadius: 4,
                    // Flash-then-fade marker for whichever rows a bulk
                    // confirm just touched — background is set immediately,
                    // then justConfirmed clears on a timer (see
                    // confirmSelected), and the transition animates that
                    // change back to transparent instead of an instant cut.
                    background: justConfirmed.has(a.id) ? "color-mix(in srgb, var(--accent-green) 18%, transparent)" : "transparent",
                    transition: "background-color 2.5s ease-out",
                  }}>
                    <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                    <span style={{ minWidth: 86 }}>{a.date_only}</span>
                    <span style={{ minWidth: 60 }}>{fmtKm(a.distance_m)}</span>
                    {resultPills.length > 0 ? resultPills : (
                      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>unclassified</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", borderRadius: 999, overflow: "hidden", border: "1px solid var(--border-strong)" }}
              title="Classification method: a local Ollama model, or instant deterministic rules over the same pace-variance/split/pause stats (no LLM, works even if Ollama isn't running)">
              {(["ai", "statistical"] as const).map(m => (
                <button key={m} onClick={() => setMethod(m)}
                  style={{
                    fontSize: 10, padding: "3px 8px", border: "none", cursor: "pointer",
                    background: method === m ? "var(--bg-card)" : "transparent",
                    color: method === m ? "var(--text-primary)" : "var(--text-muted)",
                  }}>
                  {m === "ai" ? "AI" : "Statistical"}
                </button>
              ))}
            </div>
            <div style={{ display: "inline-flex", borderRadius: 999, overflow: "hidden", border: "1px solid var(--border-strong)" }}
              title="Split granularity used to (re)classify — finer splits can surface short interval structure a coarser split smooths out">
              {([1000, 500] as const).map(m => (
                <button key={m} onClick={() => setSplitMeters(m)}
                  style={{
                    fontSize: 10, padding: "3px 8px", border: "none", cursor: "pointer",
                    background: splitMeters === m ? "var(--bg-card)" : "transparent",
                    color: splitMeters === m ? "var(--text-primary)" : "var(--text-muted)",
                  }}>
                  {m === 1000 ? "1km" : "0.5km"}
                </button>
              ))}
            </div>
            <button onClick={classifySelected} disabled={selected.size === 0 || busy}
              style={{
                fontSize: 12, padding: "5px 14px", borderRadius: 6, border: "1px solid var(--accent-blue)",
                background: "none", color: "var(--accent-blue)",
                cursor: (selected.size === 0 || busy) ? "not-allowed" : "pointer", opacity: selected.size === 0 ? 0.5 : 1,
              }}>
              Classify / Reclassify selected
            </button>
            <button onClick={confirmSelected} disabled={!canConfirm || busy}
              title={`Bulk-approves the ${(method === "ai" ? "AI" : "Statistical")} classification for already-classified selected activities, no reason needed — same as thumbs-up per activity`}
              style={{
                fontSize: 12, padding: "5px 14px", borderRadius: 6, border: "1px solid var(--accent-green)",
                background: "none", color: "var(--accent-green)",
                cursor: (!canConfirm || busy) ? "not-allowed" : "pointer", opacity: !canConfirm ? 0.5 : 1,
              }}>
              Confirm selected ({(method === "ai" ? "AI" : "Statistical")})
            </button>
          </div>

          {progress && (
            <div style={{ marginTop: 10 }}>
              <ProgressBar label={`Classifying ${progress.current}/${progress.total}…`} current={progress.current} total={progress.total} accent="var(--accent-blue)" />
            </div>
          )}
          {actionError && <div style={{ marginTop: 10 }}><ErrorBanner message={actionError} /></div>}
        </>
      )}
    </Card>
  );
}

function TrashSection() {
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
          onClick={() => { refreshActivities(); refreshMeasurements(); }}
          title="Refresh — e.g. after deleting something above"
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1 }}
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
        renderRow={a => `${a.date_only} — ${a.sport ?? "other"} — ${a.distance_m != null ? fmtKm(a.distance_m) : "—"} — ${a.source}`}
        onRestore={async ids => { await api.garmin.restore(ids); refreshActivities(); }}
        onPurge={async ids => { await api.garmin.purge(ids); refreshActivities(); }}
      />
      <TrashList
        title={`Withings measurements (${measurements?.length ?? "…"})`}
        items={measurements}
        loading={measurementsLoading}
        error={measurementsError}
        renderRow={m => `${m.date_only} — ${m.weight_kg != null ? fmtWeight(m.weight_kg) : "—"}`}
        onRestore={async ids => { await api.body.restore(ids); refreshMeasurements(); }}
        onPurge={async ids => { await api.body.purge(ids); refreshMeasurements(); }}
      />
    </Card>
  );
}

// ── Activity list ──────────────────────────────────────────────────────────
export function ManageTab() {
  const [withingsFrom, setWithingsFrom] = useState(isoAgo(30));
  const [withingsTo,   setWithingsTo]   = useState(isoToday());
  const [stravaFrom,   setStravaFrom]   = useState(isoAgo(30));
  const [stravaTo,     setStravaTo]     = useState(isoToday());

  return (
    <>
      <SectionTitle>Sync</SectionTitle>
      <SyncAllBar withingsFrom={withingsFrom} withingsTo={withingsTo} stravaFrom={stravaFrom} stravaTo={stravaTo} />
      <UploadSection />
      <WithingsSyncSection from={withingsFrom} to={withingsTo} onFromChange={setWithingsFrom} onToChange={setWithingsTo} />
      <StravaSyncSection from={stravaFrom} to={stravaTo} onFromChange={setStravaFrom} onToChange={setStravaTo} />

      <SectionTitle>AI workout classification</SectionTitle>
      <ClassifySection />

      <SectionTitle>Delete — local database only</SectionTitle>
      <DeleteSection />

      <SectionTitle>Trash</SectionTitle>
      <TrashSection />
    </>
  );
}
