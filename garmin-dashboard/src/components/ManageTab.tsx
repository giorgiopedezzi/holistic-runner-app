/**
 * ManageTab.tsx
 * Sync Garmin/Withings/Strava data, and delete data ranges. Browsing
 * individual activities lives in ActivitiesTab now, not here.
 *
 * Sections moved to components/manage/ (HRA-72) — this file is wiring only.
 * Withings/Strava unified into one OAuthSyncSection (HRA-73).
 */

import { useTranslation } from "react-i18next";
import { AccordionCard, SectionTitle } from "@/components/ui";
import { useDateRange } from "@/hooks/useDateRange";
import { useIsPhone } from "@/hooks/useIsPhone";
import { useUrlState } from "@/hooks/useUrlState";
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

// Phone-only regrouping of the tab's 7 sections into 4 single-expand
// AccordionCards (HRA-278) — same accordion pattern SettingsTab.tsx/
// PlanTemplatesSection.tsx already use, not a new nav paradigm. This keeps
// routine sync actions (Sync sources) structurally apart from permanent-
// delete controls (Local data & Trash): the two live in different collapsed
// cards, never merely divided by a heading in one long scroll. Desktop keeps
// the original flat markup verbatim (below) — pixel-for-pixel unchanged.
type GroupKey = "sync" | "ranges" | "classify" | "local";

export function ManageTab({ savedRanges }: Props) {
  const { t } = useTranslation();
  const withingsRange = useDateRange(30);
  const stravaRange = useDateRange(30);
  const isPhone = useIsPhone();
  // Backed by the URL (same "settingsSection" pattern SettingsTab.tsx uses)
  // so a refresh leaves the same group expanded.
  const [expandedGroupParam, setExpandedGroupParam] = useUrlState("manageSection", "");
  const expandedGroup: GroupKey | null = expandedGroupParam === "" ? null : (expandedGroupParam as GroupKey);
  const toggleGroup = (key: GroupKey) => setExpandedGroupParam(expandedGroup === key ? "" : key);

  if (isPhone) {
    return (
      <>
        <AccordionCard
          title={t("manage.group.syncTitle", "Sync sources")}
          expanded={expandedGroup === "sync"}
          onToggle={() => toggleGroup("sync")}
        >
          <SectionTitle>{t("manage.syncSectionTitle", "Sync")}</SectionTitle>
          <SyncAllBar withingsFrom={withingsRange.from} withingsTo={withingsRange.to} stravaFrom={stravaRange.from} stravaTo={stravaRange.to} />
          <UploadSection />
          <OAuthSyncSection provider={WITHINGS_PROVIDER} range={withingsRange} savedRanges={savedRanges} />
          <OAuthSyncSection provider={STRAVA_PROVIDER} range={stravaRange} savedRanges={savedRanges} />
        </AccordionCard>

        <AccordionCard
          title={t("manage.group.rangesTitle", "Saved ranges")}
          expanded={expandedGroup === "ranges"}
          onToggle={() => toggleGroup("ranges")}
        >
          <SectionTitle>{t("manage.dateRangesSectionTitle", "Named date ranges")}</SectionTitle>
          <DateRangesSection />
        </AccordionCard>

        <AccordionCard
          title={t("manage.group.classifyTitle", "Classify")}
          expanded={expandedGroup === "classify"}
          onToggle={() => toggleGroup("classify")}
        >
          <SectionTitle>{t("manage.classifySectionTitle", "Identify workout types")}</SectionTitle>
          <ClassifySection />
        </AccordionCard>

        <AccordionCard
          title={t("manage.group.localTitle", "Local data & Trash")}
          expanded={expandedGroup === "local"}
          onToggle={() => toggleGroup("local")}
        >
          <SectionTitle>{t("manage.deleteSectionTitle", "Delete — local database only")}</SectionTitle>
          <DeleteSection />

          <SectionTitle>{t("manage.trashSectionTitle", "Trash")}</SectionTitle>
          <TrashSection />
        </AccordionCard>
      </>
    );
  }

  return (
    <>
      <SectionTitle>{t("manage.syncSectionTitle", "Sync")}</SectionTitle>
      <SyncAllBar withingsFrom={withingsRange.from} withingsTo={withingsRange.to} stravaFrom={stravaRange.from} stravaTo={stravaRange.to} />
      <UploadSection />
      <OAuthSyncSection provider={WITHINGS_PROVIDER} range={withingsRange} savedRanges={savedRanges} />
      <OAuthSyncSection provider={STRAVA_PROVIDER} range={stravaRange} savedRanges={savedRanges} />

      <SectionTitle>{t("manage.dateRangesSectionTitle", "Named date ranges")}</SectionTitle>
      <DateRangesSection />

      <SectionTitle>{t("manage.classifySectionTitle", "Identify workout types")}</SectionTitle>
      <ClassifySection />

      <SectionTitle>{t("manage.deleteSectionTitle", "Delete — local database only")}</SectionTitle>
      <DeleteSection />

      <SectionTitle>{t("manage.trashSectionTitle", "Trash")}</SectionTitle>
      <TrashSection />
    </>
  );
}
