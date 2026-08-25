/**
 * ManageTab.tsx
 * Sync Garmin/Withings/Strava data, and delete data ranges. Browsing
 * individual activities lives in ActivitiesTab now, not here.
 *
 * Sections moved to components/manage/ (HRA-72) — this file is wiring only.
 * Withings/Strava unified into one OAuthSyncSection (HRA-73).
 */

import { useTranslation } from "react-i18next";
import { SectionTitle } from "@/components/ui";
import { useDateRange } from "@/hooks/useDateRange";
import type { SavedDateRange } from "@/types/api";
import { SyncAllBar } from "@/components/manage/SyncAllBar";
import { UploadSection } from "@/components/manage/UploadSection";
import { OAuthSyncSection } from "@/components/manage/OAuthSyncSection";
import { WITHINGS_PROVIDER, STRAVA_PROVIDER } from "@/components/manage/oauthProviders";
import { DateRangesSection } from "@/components/manage/DateRangesSection";
import { ClassifySection } from "@/components/manage/ClassifySection";
import { DeleteSection } from "@/components/manage/DeleteSection";
import { TrashSection } from "@/components/manage/TrashSection";

interface Props {
  // Same list App.tsx shares with Activities/Body's bar and Overview & Trends
  // — feeds the named-range dropdown on each provider's DateRangeBar below.
  savedRanges: SavedDateRange[];
}

export function ManageTab({ savedRanges }: Props) {
  const { t } = useTranslation();
  const withingsRange = useDateRange(30);
  const stravaRange = useDateRange(30);

  return (
    <>
      <SectionTitle>{t("manage.syncSectionTitle", "Sync")}</SectionTitle>
      <SyncAllBar withingsFrom={withingsRange.from} withingsTo={withingsRange.to} stravaFrom={stravaRange.from} stravaTo={stravaRange.to} />
      <UploadSection />
      <OAuthSyncSection provider={WITHINGS_PROVIDER} range={withingsRange} savedRanges={savedRanges} />
      <OAuthSyncSection provider={STRAVA_PROVIDER} range={stravaRange} savedRanges={savedRanges} />

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
