import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Card, StatusLine } from "@/components/ui";
import type { WithingsStatus } from "@/types/api";
import { fmtExpiry } from "./shared";

// ── Withings sync section ────────────────────────────────────────────────
interface WithingsSyncSectionProps {
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}

export function WithingsSyncSection({ from, to, onFromChange, onToChange }: WithingsSyncSectionProps) {
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
