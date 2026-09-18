import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { AccordionCard, ConfirmModal, ErrorBanner, Select } from "@/components/ui";
import { notify } from "@/utils/toast";
import { useDisplayName } from "@/components/AuthGate";

type Profile = { display_name: string | null; locale: string | null; unit_system: "metric" | "imperial" | null; timezone: string | null };

// HRA-385 AC5/AC6: replaces the old free-text timezone <input> with a
// selection of valid, canonical IANA identifiers — Intl.supportedValuesOf is
// the standard's own canonical-zone-name list (no bundled zone data, no new
// dependency), same "reach for a platform API before a library" approach
// utils/locale.ts already takes for date-fns locales. A never-explicitly-set
// profile.timezone (null) gets its own sentinel option since Radix Select
// items can't carry an empty-string value.
const TIMEZONE_UNSET = "__unset__";
const TIMEZONE_IDS: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

export function AccountPrivacySection() {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  // HRA-385 AC7: the sidebar's own identity chrome reads this same context,
  // so a saved display-name change shows there immediately, no reload.
  const [, setDisplayName] = useDisplayName();

  const timezoneOptions = useMemo(() => [
    { value: TIMEZONE_UNSET, label: t("account.timezoneNotSet", "Not set") },
    ...TIMEZONE_IDS.map(id => ({ value: id, label: id })),
  ], [t]);

  useEffect(() => {
    api.auth.session().then(session => setProfile(session.user)).catch(() => setError(t("account.loadFailed", "Could not load account details.")));
  }, []); // t is deliberately not a dependency; see frontend-i18n rule.

  async function saveProfile() {
    if (!profile) return;
    try {
      const updated = await api.account.updateProfile(profile);
      setProfile(updated);
      setDisplayName(updated.display_name);
      notify(t("account.profileSaved", "Account profile saved."));
    } catch (e) { setError(e instanceof Error ? e.message : t("account.saveFailed", "Could not save account details.")); }
  }
  async function revokeOthers() {
    if (!window.confirm(t("account.revokeOthersConfirm", "Sign out every other session? This cannot be undone on those devices."))) return;
    try { await api.account.revokeOtherSessions(); notify(t("account.sessionsRevoked", "Other sessions were signed out.")); }
    catch (e) { setError(e instanceof Error ? e.message : t("account.reauthRequired", "Sign in again within five minutes before this action.")); }
  }
  async function createExport() {
    try {
      const exportJob = await api.account.createExport();
      notify(t("account.exportReady", "Your personal-data export is ready. It expires in 24 hours."));
      window.location.assign(exportJob.download_url);
    } catch (e) { setError(e instanceof Error ? e.message : t("account.exportFailed", "Could not create your export.")); }
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
      <p className="hra-text-secondary text-label mt-0 mb-4">{t("account.description", "Manage your profile, sessions, connected services, personal-data export, and account deletion.")}</p>
      {error && <ErrorBanner message={error} />}
      {profile && <div className="hra-stack gap-3">
        <label className="hra-text-secondary text-meta">{t("account.displayName", "Display name")}<input className="hra-input w-full mt-1" value={profile.display_name ?? ""} onChange={e => setProfile({ ...profile, display_name: e.target.value || null })} /></label>
        <div>
          <div className="hra-text-secondary text-meta">{t("account.timezone", "Timezone")}</div>
          <Select
            triggerClassName="w-full mt-1"
            value={profile.timezone ?? TIMEZONE_UNSET}
            onValueChange={v => setProfile({ ...profile, timezone: v === TIMEZONE_UNSET ? null : v })}
            options={timezoneOptions}
            ariaLabel={t("account.timezone", "Timezone")}
          />
        </div>
        <button className="hra-btn" data-variant="cta" onClick={saveProfile}>{t("account.saveProfile", "Save profile")}</button>
      </div>}
      <div className="hra-stack gap-3 mt-5">
        <div><div className="text-label">{t("account.sessions", "Sessions")}</div><p className="hra-text-secondary text-meta mt-1">{t("account.sessionsDescription", "Sign out every other device. For safety, sign in again first if your session is older than five minutes.")}</p><button className="hra-btn" onClick={revokeOthers}>{t("account.revokeOthers", "Sign out other sessions")}</button></div>
        <div><div className="text-label">{t("account.export", "Personal-data export")}</div><p className="hra-text-secondary text-meta mt-1">{t("account.exportDescription", "Exports your profile, preferences, activities, body measurements and plans with a versioned manifest. Original uploaded FIT files and prior generated exports are unavailable.")}</p><button className="hra-btn" onClick={createExport}>{t("account.createExport", "Create export")}</button></div>
        <div><div className="text-label">{t("account.deletion", "Delete account")}</div><p className="hra-text-secondary text-meta mt-1">{t("account.deletionDescription", "Access and integrations are revoked immediately. Deletion is queued; retained backups expire on their normal recovery schedule and deletion cannot be cancelled.")}</p><button className="hra-btn" data-variant="danger" onClick={() => setDeletionOpen(true)}>{t("account.deleteAccount", "Delete account")}</button></div>
        <p className="hra-text-secondary text-meta">{t("account.privacyNotice", "Runs Free processes your training and health-adjacent measurements only to provide this service and connected integrations. Export and deletion controls are above. Publication is a separate, opt-in capability and is not changed by deleting private account data here.")}</p>
      </div>
      <ConfirmModal open={deletionOpen} onCancel={() => setDeletionOpen(false)} onConfirm={requestDeletion} variant="danger" confirmLabel={t("account.confirmDeletion", "Queue deletion")} title={<div><h2 className="text-heading">{t("account.deletionConfirmTitle", "Queue account deletion?")}</h2><p className="hra-text-secondary text-meta">{t("account.deletionConfirmDescription", "This immediately signs you out and disconnects integrations. Type DELETE MY ACCOUNT to continue.")}</p><input className="hra-input w-full" value={confirmation} onChange={e => setConfirmation(e.target.value)} aria-label={t("account.deletionConfirmationLabel", "Deletion confirmation")} /></div>} />
    </AccordionCard>
  );
}
