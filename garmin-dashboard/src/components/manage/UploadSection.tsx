import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Card, ProgressBar, StatusLine } from "@/components/ui";
import type { DeviceStatus } from "@/types/api";
import { PHASE_LABEL, deviceStatusMessage, runGarminSync } from "./shared";
import type { SyncProgress } from "./shared";

// ── Upload section (Garmin) ─────────────────────────────────────────────
export function UploadSection() {
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
    <Card style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Sync Garmin activities</div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
        Runs the PowerShell MTP bridge to pull new .FIT files from your Forerunner 965 and import them into the DB.
        Connect the watch via USB first. Pulls every new file on the device — there's no date range to set here, since the device is diffed against what's already imported, not queried by date.
      </div>

      <StatusLine
        state={checkingDevice ? "checking" : device?.connected ? "ok" : "warn"}
        message={checkingDevice ? "Checking device…" : device?.connected ? `${device.name ?? "Device"} connected` : deviceStatusMessage(device)}
        onRecheck={checkDevice}
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
