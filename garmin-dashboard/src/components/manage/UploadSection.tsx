import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { Card, ProgressBar, StatusLine } from "@/components/ui";
import type { DeviceStatus } from "@/types/api";
import { PHASE_LABEL, deviceStatusMessage, runGarminSync } from "./shared";
import type { SyncProgress } from "./shared";
import { useDemoMode } from "@/hooks/useDemoMode";

// ── Upload section (Garmin) ─────────────────────────────────────────────
export function UploadSection() {
  const { t } = useTranslation();
  const demoMode = useDemoMode();
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

  const canSync = status !== "running" && device?.connected === true && !demoMode;

  async function triggerSync() {
    setStatus("running");
    setMsg("");
    setProgress(null);
    try {
      const result = await runGarminSync(setProgress);
      setMsg(t("manage.sync.doneMessage", `Done — ${result.imported} imported, ${result.skipped} skipped, ${result.errors} errors.`,
        { imported: result.imported, skipped: result.skipped, errors: result.errors }));
      setStatus("done");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t("manage.sync.syncFailed", "Sync failed"));
      setStatus("error");
    } finally {
      setProgress(null);
    }
  }

  return (
    <Card className="mb-4">
      <div className="hra-block-title mb-1" >{t("manage.upload.title", "Sync Garmin activities")}</div>
      <div className="hra-text-secondary text-meta mb-3" >
        {t("manage.upload.description", "Syncs new activities from your watch. Connect via USB first — every new file on the device is pulled in, since it's diffed against what's already imported rather than filtered by date.")}
      </div>
      <details className="hra-text-secondary text-meta mb-3">
        <summary className="cursor-pointer">{t("manage.upload.howItWorksLabel", "How it works")}</summary>
        <p className="mt-1">{t("manage.upload.howItWorksDescription", "Runs a PowerShell bridge over MTP to pull new .FIT files from your Forerunner 965 and import them into the DB.")}</p>
      </details>

      <StatusLine
        state={checkingDevice ? "checking" : device?.connected ? "ok" : "warn"}
        message={checkingDevice ? t("manage.upload.checkingDevice", "Checking device…")
          : device?.connected ? t("manage.upload.deviceConnected", `${device.name ?? t("manage.upload.deviceFallbackName", "Device")} connected`, { name: device.name ?? t("manage.upload.deviceFallbackName", "Device") })
          : deviceStatusMessage(device)}
        onRecheck={checkDevice}
      />

      <button
        className="hra-btn"
        data-variant="cta"
        data-tone="green"
        onClick={triggerSync}
        disabled={!canSync}
        title={demoMode
          ? t("common.demoModeHint", "Not available for demo")
          : !canSync && status !== "running" ? t("manage.upload.connectWatchFirst", "Connect the watch first") : undefined}
      >
        {status === "running" ? t("manage.sync.syncingEllipsis", "Syncing…") : t("manage.upload.syncButton", "↓ Sync from device")}
      </button>

      {status === "running" && (
        <div className="mt-3.5">
          <ProgressBar
            label={progress
              ? `${t(`manage.upload.phase.${progress.phase}`, PHASE_LABEL[progress.phase])}${progress.label ? ` — ${progress.label}` : ""}`
              : t("manage.upload.checkingFiles", "Checking device for new files…")}
            current={progress?.current}
            total={progress?.total}
          />
        </div>
      )}

      {msg && (
        <div className="hra-status-msg mt-3" data-status={status === "error" ? "error" : undefined} >
          {msg}
        </div>
      )}
    </Card>
  );
}
