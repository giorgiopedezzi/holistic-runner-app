/**
 * ManageTab.tsx
 * Sync Garmin/Withings/Strava data, and delete data ranges. Browsing
 * individual activities lives in ActivitiesTab now, not here.
 *
 * Sections moved to components/manage/ (HRA-72) — this file is wiring only.
 * Withings/Strava unified into one OAuthSyncSection (HRA-73).
 */

import { useState } from "react";
import { SectionTitle } from "@/components/ui";
import { isoToday, isoAgo } from "@/utils/date";
import { SyncAllBar } from "@/components/manage/SyncAllBar";
import { UploadSection } from "@/components/manage/UploadSection";
import { OAuthSyncSection } from "@/components/manage/OAuthSyncSection";
import { WITHINGS_PROVIDER, STRAVA_PROVIDER } from "@/components/manage/oauthProviders";
import { ClassifySection } from "@/components/manage/ClassifySection";
import { DeleteSection } from "@/components/manage/DeleteSection";
import { TrashSection } from "@/components/manage/TrashSection";

export function ManageTab() {
  const [withingsFrom, setWithingsFrom] = useState(isoAgo(30));
  const [withingsTo,   setWithingsTo]   = useState(isoToday());
  const [stravaFrom,   setStravaFrom]   = useState(isoAgo(30));
  const [stravaTo,     setStravaTo]     = useState(isoToday());

  return (
    <>
      <SectionTitle>Sync</SectionTitle>
      <SyncAllBar withingsFrom={withingsFrom} withingsTo={withingsTo} stravaFrom={stravaFrom} stravaTo={stravaTo} />
      <UploadSection />
      <OAuthSyncSection provider={WITHINGS_PROVIDER} from={withingsFrom} to={withingsTo} onFromChange={setWithingsFrom} onToChange={setWithingsTo} />
      <OAuthSyncSection provider={STRAVA_PROVIDER} from={stravaFrom} to={stravaTo} onFromChange={setStravaFrom} onToChange={setStravaTo} />

      <SectionTitle>AI workout classification</SectionTitle>
      <ClassifySection />

      <SectionTitle>Delete — local database only</SectionTitle>
      <DeleteSection />

      <SectionTitle>Trash</SectionTitle>
      <TrashSection />
    </>
  );
}
