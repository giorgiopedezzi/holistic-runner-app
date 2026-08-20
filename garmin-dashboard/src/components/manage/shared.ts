import i18next from "@/i18n";
import type { SyncResult } from "@/api/client";
import type { DeviceStatus } from "@/types/api";

// ── Shared sync logic ────────────────────────────────────────────────────
export type SyncPhase = "download" | "import";
export interface SyncProgress { phase: SyncPhase; current: number; total: number; label?: string; }

export const PHASE_LABEL: Record<SyncPhase, string> = {
  download: "Step 1/2 — Downloading files from device",
  import:   "Step 2/2 — Importing into database",
};

type SyncEvent =
  | { type: "progress"; phase: SyncPhase; current: number; total: number; label?: string }
  | { type: "done"; imported: number; skipped: number; errors: number }
  | { type: "error"; message: string };

// Shared by UploadSection's own button and SyncAllBar, so both use the exact
// same streaming/parsing logic instead of two copies drifting apart.
export async function runGarminSync(onProgress?: (p: SyncProgress) => void): Promise<SyncResult> {
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

export function deviceStatusMessage(device: DeviceStatus | null): string {
  switch (device?.reason) {
    case "device_not_found":          return i18next.t("manage.upload.deviceNotFound", "Device not found — plug in via USB");
    case "storage_not_found":
    case "garmin_folder_not_found":
    case "activity_folder_not_found": return i18next.t("manage.upload.activityFolderInaccessible", "Device connected, but its Activity folder isn't accessible");
    case "timeout":                   return i18next.t("manage.upload.deviceCheckTimeout", "Device check timed out — try again");
    case "powershell_error":
    case "parse_error":               return i18next.t("manage.upload.deviceCheckFailed", "Couldn't check device status");
    default:                          return i18next.t("manage.upload.deviceNotFound", "Device not found — plug in via USB");
  }
}

// "soon"/"in " are translated prose; the numeral+unit-letter suffix (h/d)
// stays a literal abbreviation — same "unit abbreviations don't translate"
// policy as bpm/kcal/spm elsewhere in this app.
export function fmtExpiry(unixSeconds: number): string {
  const diffH = (unixSeconds - Date.now() / 1000) / 3600;
  if (diffH <= 0) return i18next.t("manage.oauth.expirySoon", "soon");
  if (diffH < 24) return i18next.t("manage.oauth.expiryIn", `in ${Math.max(1, Math.round(diffH))}h`, { value: `${Math.max(1, Math.round(diffH))}h` });
  return i18next.t("manage.oauth.expiryIn", `in ${Math.round(diffH / 24)}d`, { value: `${Math.round(diffH / 24)}d` });
}
