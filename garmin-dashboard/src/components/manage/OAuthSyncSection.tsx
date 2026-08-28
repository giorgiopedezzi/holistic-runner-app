import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, StatusLine } from "@/components/ui";
import { DateRangeBar } from "@/components/DateRangeBar";
import type { DateRangeState } from "@/hooks/useDateRange";
import type { SyncResult } from "@/api/client";
import type { SavedDateRange } from "@/types/api";
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
  range: DateRangeState;
  savedRanges: SavedDateRange[];
}

export function OAuthSyncSection({ provider, range, savedRanges }: OAuthSyncSectionProps) {
  const { from, to } = range;
  const { t } = useTranslation();
  const { id, label, noun: nounRaw, description: descriptionRaw, api } = provider;
  const noun = t(`manage.oauth.${id}.noun`, nounRaw);
  const description = t(`manage.oauth.${id}.description`, descriptionRaw);

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
        setMsg(t("manage.oauth.popupBlocked", "Your browser blocked the popup — allow popups for this site and try again."));
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
      setMsg(e instanceof Error ? e.message : t("manage.oauth.loginStartFailed", "Could not start login"));
      setLoggingIn(false);
    }
  }

  async function triggerSync() {
    setStatus("running");
    setMsg(t("manage.oauth.fetching", `Fetching ${noun} from ${label}…`, { noun, label }));
    try {
      const data = await api.sync(from, to);
      setMsg(t("manage.sync.doneMessage", `Done — ${data.imported} imported, ${data.skipped} skipped, ${data.errors} errors.`,
        { imported: data.imported, skipped: data.skipped, errors: data.errors }));
      setStatus("done");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t("manage.sync.syncFailed", "Sync failed"));
      setStatus("error");
    }
  }

  const connected = token?.present === true && token?.valid === true;
  const canSync   = status !== "running" && connected;

  return (
    <Card className="mb-4">
      <div className="hra-block-title mb-1" >{t("manage.oauth.syncTitle", `Sync ${label} ${noun}`, { label, noun })}</div>
      <div className="hra-text-secondary text-meta mb-3" >
        {description}
      </div>

      <StatusLine
        state={checkingToken ? "checking" : connected ? "ok" : token?.present ? "error" : "warn"}
        message={
          checkingToken ? t("manage.oauth.checkingToken", "Checking token…")
          : connected   ? (token?.expiresAt
              ? t("manage.oauth.connectedWithExpiry", `Connected · expires ${fmtExpiry(token.expiresAt)}`, { expiry: fmtExpiry(token.expiresAt) })
              : t("manage.oauth.connected", "Connected"))
          : token?.present ? t("manage.oauth.sessionExpired", `${label} session expired — please log in again`, { label })
          : t("manage.oauth.notConnected", `Not connected to ${label}`, { label })
        }
        onRecheck={checkToken}
      />

      <div className="mb-3">
        <DateRangeBar {...range} savedRanges={savedRanges} />
      </div>

      <div className="hra-row-wrap">
        <button
          className="hra-btn"
          data-variant="cta"
          onClick={login}
          disabled={loggingIn}
        >
          {loggingIn ? t("manage.oauth.waitingForLogin", "Waiting for login…")
            : connected ? t("manage.oauth.reLogin", "Re-login")
            : t("manage.oauth.loginTo", `Login to ${label}`, { label })}
        </button>

        <button
          className="hra-btn"
          data-variant="cta"
          data-tone="green"
          onClick={triggerSync}
          disabled={!canSync}
          title={!canSync && status !== "running" ? t("manage.oauth.loginFirstTooltip", `Log in to ${label} first`, { label }) : undefined}
        >
          {status === "running" ? t("manage.sync.syncingEllipsis", "Syncing…") : t("manage.oauth.syncFromButton", `↓ Sync from ${label}`, { label })}
        </button>
      </div>

      {msg && (
        <div className="hra-status-msg mt-3" data-status={status === "error" ? "error" : undefined} >
          {msg}
        </div>
      )}
    </Card>
  );
}
