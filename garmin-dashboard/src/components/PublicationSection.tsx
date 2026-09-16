import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, type PublicationPreview, type PublicationStatus } from "@/api/client";
import { AccordionCard, ConfirmModal, ErrorBanner, LoadingSpinner } from "@/components/ui";
import { FounderJourneySummary } from "@/components/GuestOverview";
import { notify } from "@/utils/toast";
import { fmtDate } from "@/utils/fmt";

// Must match garmin-stats/src/db/founder.ts's PUBLISH_PROFILE_ENTITLEMENT —
// the two are separate packages with no shared constants module.
export const PUBLISH_PROFILE_ENTITLEMENT = "can_publish_profile";

const STATE_LABEL: Record<PublicationStatus["state"], string> = {
  draft: "Draft", published: "Published", suspended: "Suspended", unconfigured: "Not yet published",
};

type Busy = "preview" | "publish" | "refresh" | "suspend" | null;

export function PublicationSection() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<PublicationStatus | null>(null);
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  // Only a genuine 403 (no founder entitlement) hides the section entirely —
  // any other failure (network, 500) still shows the card with an error
  // banner, same as every other Settings card's load-failure handling.
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    api.publication.status().then(setStatus).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 403) { setHidden(true); return; }
      setError(e instanceof Error ? e.message : t("publication.loadFailed", "Could not load publication status."));
    });
  }, []); // t deliberately not a dependency; see frontend-i18n rule.

  async function doPreview() {
    setBusy("preview"); setError(null);
    try {
      const result = await api.publication.preview();
      setStatus(result);
      setPreview(result);
      setPreviewOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : t("publication.previewFailed", "Could not load the preview.")); }
    finally { setBusy(null); }
  }

  async function doPublish() {
    setBusy("publish"); setError(null);
    try { setStatus(await api.publication.publish()); notify(t("publication.published", "Published. Your journey is now live at the public URL.")); }
    catch (e) { setError(e instanceof Error ? e.message : t("publication.publishFailed", "Could not publish.")); }
    finally { setBusy(null); setPublishOpen(false); }
  }

  async function doRefresh() {
    setBusy("refresh"); setError(null);
    try {
      const updated = await api.publication.refresh();
      setStatus(updated);
      // Server-confirmed only: a refresh that recorded a retry-able failure
      // never gets a success toast — status still shows lastError/canRetry.
      if (updated.lastError) setError(t("publication.refreshFailedRetry", "The last refresh failed; the previously published data is still live. You can retry."));
      else notify(t("publication.refreshed", "Refreshed."));
    } catch (e) { setError(e instanceof Error ? e.message : t("publication.refreshFailed", "Could not refresh.")); }
    finally { setBusy(null); }
  }

  async function doSuspend() {
    setBusy("suspend"); setError(null);
    try { setStatus(await api.publication.suspend()); notify(t("publication.suspended", "Suspended. Your published journey is no longer publicly accessible.")); }
    catch (e) { setError(e instanceof Error ? e.message : t("publication.suspendFailed", "Could not suspend.")); }
    finally { setBusy(null); setSuspendOpen(false); }
  }

  async function copyUrl() {
    if (!status?.publicUrl) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${status.publicUrl}`);
      notify(t("publication.urlCopied", "Public URL copied."));
    } catch { setError(t("publication.copyFailed", "Could not copy the URL.")); }
  }

  if (hidden) return null;

  const canPublish = status ? status.state !== "published" : false;
  const canSuspend = status?.state === "published";
  const canRefresh = status ? status.state !== "unconfigured" : false;
  const busyAny = busy !== null;

  return (
    <AccordionCard title={t("publication.title", "Public journey")} expanded={expanded} onToggle={() => setExpanded(value => !value)}>
      <p className="hra-text-secondary text-label mt-0 mb-4">
        {t("publication.description", "Preview, publish, refresh, or suspend the public founder journey anonymous Guests see at your public URL.")}
      </p>
      {error && <ErrorBanner message={error} />}
      {!status ? <LoadingSpinner label={t("publication.loading", "Loading publication status…")} /> : <div className="hra-stack gap-3">
        <div className="hra-fact-row"><span>{t("publication.state", "State")}</span><strong>{t(`publication.state.${status.state}`, STATE_LABEL[status.state])}</strong></div>
        {status.projectedAt && <div className="hra-fact-row"><span>{t("publication.lastRefreshed", "Last refreshed")}</span><strong>{fmtDate(status.projectedAt)}</strong></div>}
        {status.publicUrl && <div className="hra-fact-row"><span>{t("publication.publicUrl", "Public URL")}</span><strong>{status.publicUrl}</strong></div>}
        {status.lastError && <p className="hra-text-secondary text-meta">{t("publication.lastErrorNotice", "The last refresh failed; the previously published data is still live. You can retry.")}</p>}
        <div className="hra-row-wrap gap-2.5">
          <button type="button" className="hra-btn" onClick={doPreview} disabled={busyAny}>
            {busy === "preview" ? t("settings.savingEllipsis", "Saving…") : t("publication.previewAsGuest", "Preview as Guest")}
          </button>
          {canPublish && <button type="button" className="hra-btn" data-variant="cta" onClick={() => setPublishOpen(true)} disabled={busyAny}>{t("publication.publish", "Publish")}</button>}
          {canRefresh && <button type="button" className="hra-btn" onClick={doRefresh} disabled={busyAny}>{status.canRetry ? t("publication.retry", "Retry") : t("publication.refresh", "Refresh published data")}</button>}
          {canSuspend && <button type="button" className="hra-btn" data-variant="danger" onClick={() => setSuspendOpen(true)} disabled={busyAny}>{t("publication.suspend", "Suspend")}</button>}
          {status.publicUrl && <button type="button" className="hra-btn" onClick={copyUrl} disabled={busyAny}>{t("publication.copyUrl", "Copy public URL")}</button>}
        </div>
      </div>}

      {previewOpen && preview && (
        <div className="hra-border-strong rounded-xl p-4 mt-4">
          <FounderJourneySummary
            profile={{ slug: preview.snapshot.slug, projectedAt: preview.snapshot.projectedAt, data: preview.snapshot.profile ?? { publicId: "", fields: {} } }}
            activities={{ slug: preview.snapshot.slug, projectedAt: preview.snapshot.projectedAt, data: preview.snapshot.activities }}
            plans={{ slug: preview.snapshot.slug, projectedAt: preview.snapshot.projectedAt, data: preview.snapshot.plans }}
            reports={{ slug: preview.snapshot.slug, projectedAt: preview.snapshot.projectedAt, data: preview.snapshot.reports }}
          />
          <button type="button" className="hra-btn mt-3" onClick={() => setPreviewOpen(false)}>{t("publication.closePreview", "Close preview")}</button>
        </div>
      )}

      <ConfirmModal
        open={publishOpen} onCancel={() => setPublishOpen(false)} onConfirm={doPublish}
        confirmLabel={t("publication.confirmPublish", "Publish")}
        title={<div><h2 className="text-heading">{t("publication.confirmPublishTitle", "Publish your journey?")}</h2><p className="hra-text-secondary text-meta">{t("publication.confirmPublishDescription", "The safe projected journey will become anonymously accessible at your public URL.")}</p></div>}
      />
      <ConfirmModal
        open={suspendOpen} onCancel={() => setSuspendOpen(false)} onConfirm={doSuspend} variant="danger"
        confirmLabel={t("publication.confirmSuspend", "Suspend")}
        title={<div><h2 className="text-heading">{t("publication.confirmSuspendTitle", "Suspend publication?")}</h2><p className="hra-text-secondary text-meta">{t("publication.confirmSuspendDescription", "Anonymous visitors immediately lose access to your public URL. Your private data is not changed.")}</p></div>}
      />
    </AccordionCard>
  );
}
