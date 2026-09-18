import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { AccordionCard, ConfirmModal, ErrorBanner } from "@/components/ui";
import { notify } from "@/utils/toast";

type Profile = { display_name: string | null; locale: string | null; unit_system: "metric" | "imperial" | null; timezone: string | null };

export function AccountPrivacySection() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    api.auth.session().then(session => setProfile(session.user)).catch(() => setError(t("account.loadFailed", "Could not load account details.")));
  }, []); // t is deliberately not a dependency; see frontend-i18n rule.

  async function saveProfile() {
    if (!profile) return;
    try { setProfile(await api.account.updateProfile(profile)); notify(t("account.profileSaved", "Account profile saved.")); }
    catch (e) { setError(e instanceof Error ? e.message : t("account.saveFailed", "Could not save account details.")); }
  }
  async function revokeOthers() {
    if (!window.confirm(t("account.revokeOthersConfirm", "Sign out every other session? This cannot be undone on those devices."))) return;
    try { await api.account.revokeOtherSessions(); notify(t("account.sessionsRevoked", "Other sessions were signed out.")); }
    catch (e) { setError(e instanceof Error ? e.message : t("account.reauthRequired", "Sign in again within five minutes before this action.")); }
  }
  async function requestDeletion() {
    if (confirmation !== "DELETE MY ACCOUNT") return;
    try {
      await api.account.requestDeletion();
      window.location.assign("/");
    } catch (e) { setError(e instanceof Error ? e.message : t("account.deletionFailed", "Could not queue account deletion.")); }
    finally { setDeletionOpen(false); }
  }

  return (
    <AccordionCard title={t("account.title", "Account & privacy")} expanded={expanded} onToggle={() => setExpanded(value => !value)}>
      <p className="hra-text-secondary text-label mt-0 mb-4">{t("account.description", "Manage your profile, sessions, connected services, and account deletion.")}</p>
      {error && <ErrorBanner message={error} />}
      {profile && <div className="hra-stack gap-3">
        <label className="hra-text-secondary text-meta">{t("account.displayName", "Display name")}<input className="hra-input w-full mt-1" value={profile.display_name ?? ""} onChange={e => setProfile({ ...profile, display_name: e.target.value || null })} /></label>
        <label className="hra-text-secondary text-meta">{t("account.timezone", "Timezone")}<input className="hra-input w-full mt-1" value={profile.timezone ?? ""} onChange={e => setProfile({ ...profile, timezone: e.target.value || null })} /></label>
        <button className="hra-btn" data-variant="cta" onClick={saveProfile}>{t("account.saveProfile", "Save profile")}</button>
      </div>}
      <div className="hra-stack gap-3 mt-5">
        <div><div className="text-label">{t("account.sessions", "Sessions")}</div><p className="hra-text-secondary text-meta mt-1">{t("account.sessionsDescription", "Sign out every other device. For safety, sign in again first if your session is older than five minutes.")}</p><button className="hra-btn" onClick={revokeOthers}>{t("account.revokeOthers", "Sign out other sessions")}</button></div>
        <div><div className="text-label">{t("account.deletion", "Delete account")}</div><p className="hra-text-secondary text-meta mt-1">{t("account.deletionDescription", "Access and integrations are revoked immediately. Deletion is queued; retained backups expire on their normal recovery schedule and deletion cannot be cancelled.")}</p><button className="hra-btn" data-variant="danger" onClick={() => setDeletionOpen(true)}>{t("account.deleteAccount", "Delete account")}</button></div>
        <p className="hra-text-secondary text-meta">{t("account.privacyNotice", "Runs Free processes your training and health-adjacent measurements only to provide this service and connected integrations. Deletion controls are above. Publication is a separate, opt-in capability and is not changed by deleting private account data here.")}</p>
      </div>
      <ConfirmModal open={deletionOpen} onCancel={() => setDeletionOpen(false)} onConfirm={requestDeletion} variant="danger" confirmLabel={t("account.confirmDeletion", "Queue deletion")} title={<div><h2 className="text-heading">{t("account.deletionConfirmTitle", "Queue account deletion?")}</h2><p className="hra-text-secondary text-meta">{t("account.deletionConfirmDescription", "This immediately signs you out and disconnects integrations. Type DELETE MY ACCOUNT to continue.")}</p><input className="hra-input w-full" value={confirmation} onChange={e => setConfirmation(e.target.value)} aria-label={t("account.deletionConfirmationLabel", "Deletion confirmation")} /></div>} />
    </AccordionCard>
  );
}
