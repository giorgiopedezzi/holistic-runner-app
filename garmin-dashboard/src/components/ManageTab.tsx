/**
 * ManageTab.tsx
 * Sync Garmin/Withings/Strava data, and delete data ranges. Browsing
 * individual activities lives in ActivitiesTab now, not here.
 *
 * Sections moved to components/manage/ (HRA-72) — this file is wiring only.
 */

import { useState } from "react";
import { SectionTitle } from "@/components/ui";
import { isoToday, isoAgo } from "@/utils/date";
import { SyncAllBar } from "@/components/manage/SyncAllBar";
import { UploadSection } from "@/components/manage/UploadSection";
import { WithingsSyncSection } from "@/components/manage/WithingsSyncSection";
import { StravaSyncSection } from "@/components/manage/StravaSyncSection";
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
      <WithingsSyncSection from={withingsFrom} to={withingsTo} onFromChange={setWithingsFrom} onToChange={setWithingsTo} />
      <StravaSyncSection from={stravaFrom} to={stravaTo} onFromChange={setStravaFrom} onToChange={setStravaTo} />

      <SectionTitle>AI workout classification</SectionTitle>
      <ClassifySection />

      <SectionTitle>Delete — local database only</SectionTitle>
      <DeleteSection />

      <SectionTitle>Trash</SectionTitle>
      <TrashSection />
    </>
  );
}
