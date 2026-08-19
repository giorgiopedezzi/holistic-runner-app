import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
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
      <div className="hra-block-title" style={{ marginBottom: 4 }}>Sync Garmin activities</div>
      <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 12 }}>
        Runs the PowerShell MTP bridge to pull new .FIT files from your Forerunner 965 and import them into the DB.
        Connect the watch via USB first. Pulls every new file on the device — there's no date range to set here, since the device is diffed against what's already imported, not queried by date.
      </div>

      <StatusLine
        state={checkingDevice ? "checking" : device?.connected ? "ok" : "warn"}
        message={checkingDevice ? "Checking device…" : device?.connected ? `${device.name ?? "Device"} connected` : deviceStatusMessage(device)}
        onRecheck={checkDevice}
      />

      <button
        className="hra-btn"
        data-variant="cta"
        style={{ "--btn-color": "var(--accent-green)" } as CSSProperties}
        onClick={triggerSync}
        disabled={!canSync}
        title={!canSync && status !== "running" ? "Connect the watch first" : undefined}
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
        <div className="hra-status-msg" data-status={status === "error" ? "error" : undefined} style={{ marginTop: 12 }}>
          {msg}
        </div>
      )}
    </Card>
  );
}
