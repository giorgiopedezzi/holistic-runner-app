import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Card, StatusLine, DatePicker } from "@/components/ui";
import type { SyncResult } from "@/api/client";
import { fmtExpiry } from "./shared";

// ── OAuth sync section ───────────────────────────────────────────────────
// Unifies WithingsSyncSection/StravaSyncSection (HRA-73) via an explicit
// provider descriptor, not an isWithings/isStrava boolean.
interface OAuthTokenStatus { present: boolean; valid: boolean; expiresAt?: number; scope?: string; error?: string; }

// id: used as the login popup's window name. label: display name (e.g.
// "Withings"). noun: "measurements" / "activities". description: the
// paragraph shown under the section title.
export interface OAuthProvider {
  id:          string;
  label:       string;
  noun:        string;
  description: string;
  api: {
    tokenStatus: () => Promise<OAuthTokenStatus>;
    loginUrl:    () => Promise<{ url: string }>;
    sync:        (from?: string, to?: string) => Promise<SyncResult>;
  };
}

interface OAuthSyncSectionProps {
  provider: OAuthProvider;
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}

export function OAuthSyncSection({ provider, from, to, onFromChange, onToChange }: OAuthSyncSectionProps) {
  const { id, label, noun, description, api } = provider;

  const [status, setStatus] = useState<"idle"|"running"|"done"|"error">("idle");
  const [msg,    setMsg]    = useState("");

  const [token, setToken] = useState<OAuthTokenStatus | null>(null);
  const [checkingToken, setCheckingToken] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  async function checkToken() {
    setCheckingToken(true);
    try {
      setToken(await api.tokenStatus());
    } catch {
      setToken({ present: false, valid: false });
    }
    setCheckingToken(false);
  }

  // Run once on mount — checkToken closes over provider.api, a stable const.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { checkToken(); }, []);

  async function login() {
    setLoggingIn(true);
    setMsg("");
    try {
      const { url } = await api.loginUrl();
      const popup = window.open(url, `${id}-login`, "width=480,height=720");
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
          const s = await api.tokenStatus();
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
    setMsg(`Fetching ${noun} from ${label}…`);
    try {
      const data = await api.sync(from, to);
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
    <Card style={{ marginBottom: 16 }}>
      <div className="hra-block-title" style={{ marginBottom: 4 }}>Sync {label} {noun}</div>
      <div className="hra-text-secondary" style={{ fontSize: 12, marginBottom: 12 }}>
        {description}
      </div>

      <StatusLine
        state={checkingToken ? "checking" : connected ? "ok" : token?.present ? "error" : "warn"}
        message={
          checkingToken ? "Checking token…"
          : connected   ? `Connected${token?.expiresAt ? ` · expires ${fmtExpiry(token.expiresAt)}` : ""}`
          : token?.present ? `${label} session expired — please log in again`
          : `Not connected to ${label}`
        }
        onRecheck={checkToken}
      />

      <div className="hra-control-row" style={{ gap: 8, marginBottom: 12 }}>
        <label className="hra-text-muted" style={{ fontSize: 12 }}>Date range:</label>
        <DatePicker value={from} onChange={onFromChange} max={to} />
        <span className="hra-text-muted" style={{ fontSize: 12 }}>→</span>
        <DatePicker value={to} onChange={onToChange} min={from} />
      </div>

      <div className="hra-row-wrap">
        <button
          className="hra-btn"
          data-variant="cta"
          onClick={login}
          disabled={loggingIn}
        >
          {loggingIn ? "Waiting for login…" : connected ? "Re-login" : `Login to ${label}`}
        </button>

        <button
          className="hra-btn"
          data-variant="cta"
          style={{ "--btn-color": "var(--accent-green)" } as CSSProperties}
          onClick={triggerSync}
          disabled={!canSync}
          title={!canSync && status !== "running" ? `Log in to ${label} first` : undefined}
        >
          {status === "running" ? "Syncing…" : `↓ Sync from ${label}`}
        </button>
      </div>

      {msg && (
        <div className="hra-status-msg" data-status={status === "error" ? "error" : undefined} style={{ marginTop: 12 }}>
          {msg}
        </div>
      )}
    </Card>
  );
}
