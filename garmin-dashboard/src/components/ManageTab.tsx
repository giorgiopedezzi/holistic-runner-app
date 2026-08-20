/**
 * ManageTab.tsx
 * Sync Garmin/Withings/Strava data, and delete data ranges. Browsing
 * individual activities lives in ActivitiesTab now, not here.
 *
 * Sections moved to components/manage/ (HRA-72) — this file is wiring only.
 * Withings/Strava unified into one OAuthSyncSection (HRA-73).
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SectionTitle } from "@/components/ui";
import { isoToday, isoAgo } from "@/utils/date";
import { SyncAllBar } from "@/components/manage/SyncAllBar";
import { UploadSection } from "@/components/manage/UploadSection";
import { OAuthSyncSection } from "@/components/manage/OAuthSyncSection";
import { WITHINGS_PROVIDER, STRAVA_PROVIDER } from "@/components/manage/oauthProviders";
import { DateRangesSection } from "@/components/manage/DateRangesSection";
import { ClassifySection } from "@/components/manage/ClassifySection";
import { DeleteSection } from "@/components/manage/DeleteSection";
import { TrashSection } from "@/components/manage/TrashSection";

export function ManageTab() {
  const { t } = useTranslation();
  const [withingsFrom, setWithingsFrom] = useState(isoAgo(30));
  const [withingsTo,   setWithingsTo]   = useState(isoToday());
  const [stravaFrom,   setStravaFrom]   = useState(isoAgo(30));
  const [stravaTo,     setStravaTo]     = useState(isoToday());

  return (
    <>
      <SectionTitle>{t("manage.syncSectionTitle", "Sync")}</SectionTitle>
      <SyncAllBar withingsFrom={withingsFrom} withingsTo={withingsTo} stravaFrom={stravaFrom} stravaTo={stravaTo} />
      <UploadSection />
      <OAuthSyncSection provider={WITHINGS_PROVIDER} from={withingsFrom} to={withingsTo} onFromChange={setWithingsFrom} onToChange={setWithingsTo} />
      <OAuthSyncSection provider={STRAVA_PROVIDER} from={stravaFrom} to={stravaTo} onFromChange={setStravaFrom} onToChange={setStravaTo} />

      <SectionTitle>{t("manage.dateRangesSectionTitle", "Named date ranges")}</SectionTitle>
      <DateRangesSection />

      <SectionTitle>{t("manage.classifySectionTitle", "AI workout classification")}</SectionTitle>
      <ClassifySection />

      <SectionTitle>{t("manage.deleteSectionTitle", "Delete — local database only")}</SectionTitle>
      <DeleteSection />

      <SectionTitle>{t("manage.trashSectionTitle", "Trash")}</SectionTitle>
      <TrashSection />
    </>
  );
}
