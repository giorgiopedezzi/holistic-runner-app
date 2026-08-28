import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api } from "@/api/client";
import { Card } from "@/components/ui";
import { runGarminSync } from "./shared";

// ── Sync all ──────────────────────────────────────────────────────────────
interface SyncAllBarProps {
  withingsFrom: string; withingsTo: string;
  stravaFrom:   string; stravaTo:   string;
}

// Shared per-source result/skip/failure lines (Garmin/Withings/Strava all
// use the same three sentence shapes) — the source name is interpolated raw
// (a brand name, never translated) into an otherwise-translated sentence.
function pushSyncing(t: TFunction, push: (s: string) => void, source: string) {
  push(t("manage.syncAll.syncing", `Syncing ${source}…`, { source }));
}
function pushResult(t: TFunction, push: (s: string) => void, source: string, r: { imported: number; skipped: number; errors: number }) {
  push(t("manage.syncAll.resultLine", `${source}: ${r.imported} imported, ${r.skipped} skipped, ${r.errors} errors.`,
    { source, imported: r.imported, skipped: r.skipped, errors: r.errors }));
}
function pushSkipped(t: TFunction, push: (s: string) => void, source: string, reasonKey: "device" | "login") {
  const reason = reasonKey === "device"
    ? t("manage.syncAll.skipReasonDevice", "device not connected")
    : t("manage.syncAll.skipReasonLogin", "not logged in");
  push(t("manage.syncAll.skipped", `${source}: skipped — ${reason}.`, { source, reason }));
}
function pushFailed(t: TFunction, push: (s: string) => void, source: string, e: unknown) {
  const msg = e instanceof Error ? e.message : t("manage.syncAll.genericError", "sync error");
  push(t("manage.syncAll.failed", `${source}: failed — ${msg}`, { source, msg }));
}

export function SyncAllBar({ withingsFrom, withingsTo, stravaFrom, stravaTo }: SyncAllBarProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [log, setLog] = useState<string[]>([]);

  async function syncAll() {
    setStatus("running");
    const lines: string[] = [];
    const push = (s: string) => { lines.push(s); setLog([...lines]); };

    try {
      const device = await api.garmin.deviceStatus();
      if (device.connected) {
        pushSyncing(t, push, "Garmin");
        const r = await runGarminSync();
        pushResult(t, push, "Garmin", r);
      } else {
        pushSkipped(t, push, "Garmin", "device");
      }
    } catch (e) {
      pushFailed(t, push, "Garmin", e);
    }

    try {
      const token = await api.body.tokenStatus();
      if (token.present && token.valid) {
        pushSyncing(t, push, "Withings");
        const r = await api.body.sync(withingsFrom, withingsTo);
        pushResult(t, push, "Withings", r);
      } else {
        pushSkipped(t, push, "Withings", "login");
      }
    } catch (e) {
      pushFailed(t, push, "Withings", e);
    }

    try {
      const token = await api.strava.tokenStatus();
      if (token.present && token.valid) {
        pushSyncing(t, push, "Strava");
        const r = await api.strava.sync(stravaFrom, stravaTo);
        pushResult(t, push, "Strava", r);
      } else {
        pushSkipped(t, push, "Strava", "login");
      }
    } catch (e) {
      pushFailed(t, push, "Strava", e);
    }

    setStatus("done");
  }

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="hra-block-title">{t("manage.syncAll.title", "Sync all")}</div>
          <div className="hra-text-secondary text-meta" >
            {t("manage.syncAll.description", "Runs every sync below in one go — skips whichever source isn't ready (device unplugged, not logged in).")}
          </div>
        </div>
        <button
          className="hra-btn whitespace-nowrap"
          data-variant="cta"
          onClick={syncAll}
          disabled={status === "running"}
          data-tone="green"
        >
          {status === "running" ? t("manage.sync.syncingEllipsis", "Syncing…") : t("manage.syncAll.button", "⚡ Sync all")}
        </button>
      </div>
      {log.length > 0 && (
        <div className="hra-text-secondary mt-2.5 text-meta flex flex-col gap-0.5" >
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </Card>
  );
}
