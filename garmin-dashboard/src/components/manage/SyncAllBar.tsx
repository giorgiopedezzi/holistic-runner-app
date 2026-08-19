import { useState } from "react";
import type { CSSProperties } from "react";
import { api } from "@/api/client";
import { Card } from "@/components/ui";
import { runGarminSync } from "./shared";

// ── Sync all ──────────────────────────────────────────────────────────────
interface SyncAllBarProps {
  withingsFrom: string; withingsTo: string;
  stravaFrom:   string; stravaTo:   string;
}

export function SyncAllBar({ withingsFrom, withingsTo, stravaFrom, stravaTo }: SyncAllBarProps) {
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
          <div className="hra-block-title">Sync all</div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Runs every sync below in one go — skips whichever source isn't ready (device unplugged, not logged in).
          </div>
        </div>
        <button
          className="hra-btn"
          data-variant="cta"
          onClick={syncAll}
          disabled={status === "running"}
          style={{ "--btn-color": "var(--accent-green)", whiteSpace: "nowrap" } as CSSProperties}
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
