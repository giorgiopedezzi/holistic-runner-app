import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { Badge, Card, ProgressBar, StatusLine } from "@/components/ui";
import type { FitBatchImportResult, FitImportResult } from "@/api/client";
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
  const [zipStatus, setZipStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [zipMessage, setZipMessage] = useState("");
  const [zipResult, setZipResult] = useState<FitBatchImportResult | null>(null);

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

  async function importZip(file: File) {
    setZipStatus("running");
    setZipMessage("");
    setZipResult(null);
    try {
      const result = await api.garmin.importFitZip(file);
      setZipResult(result);
      setZipMessage(t("manage.upload.zipSummary",
        `${result.summary.imported} imported, ${result.summary.duplicates} duplicates, ${result.summary.failed} failed.`,
        { imported: result.summary.imported, duplicates: result.summary.duplicates, failed: result.summary.failed }));
      setZipStatus("done");
    } catch (error) {
      setZipMessage(error instanceof Error ? error.message : t("manage.upload.zipFailed", "ZIP import failed"));
      setZipStatus("error");
    }
  }

  const resultLabel = (result: FitImportResult) => t(`manage.upload.zipResult.${result.status}`, result.status);
  const resultColor = (result: FitImportResult) => result.status === "imported"
    ? "var(--color-success)"
    : result.status === "duplicate" ? "var(--color-warning)" : "var(--color-danger)";

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

      <div className="hra-border-top mt-4 pt-4">
        <div className="hra-block-title mb-1">{t("manage.upload.zipTitle", "Import FIT files from ZIP")}</div>
        <p className="hra-text-secondary text-meta mb-2">
          {t("manage.upload.zipDescription", "Choose one ZIP containing 1 to 14 FIT activity files. Valid files are imported even if another file fails.")}
        </p>
        <p className="hra-text-muted text-meta mb-3">
          {t("manage.upload.zipPrivacy", "Uploaded files are processed in memory. Raw ZIP and FIT files are not retained; normalized activity and track data are saved.")}
        </p>
        <label className="hra-btn" data-variant="cta" aria-disabled={zipStatus === "running" || demoMode}>
          {zipStatus === "running" ? t("manage.upload.zipImporting", "Importing...") : t("manage.upload.zipButton", "Upload FIT ZIP...")}
          <input
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            className="hidden"
            aria-label={t("manage.upload.zipInputLabel", "Choose a FIT ZIP archive")}
            disabled={zipStatus === "running" || demoMode}
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void importZip(file);
              event.target.value = "";
            }}
          />
        </label>

        {zipMessage && (
          <div className="hra-status-msg mt-3" data-status={zipStatus === "error" ? "error" : undefined} aria-live="polite">
            {zipMessage}
          </div>
        )}
        {zipResult && (
          <div className="mt-3" aria-label={t("manage.upload.zipResultsLabel", "FIT import results")}>
            {zipResult.results.map((result, index) => (
              <div className="hra-fact-row flex items-center gap-2 flex-wrap" key={`${result.filename}-${index}`}>
                <span className="text-data">{result.filename}</span>
                <Badge label={resultLabel(result)} color={resultColor(result)} />
                {result.reason && <span className="hra-text-secondary text-meta">{result.reason}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
