import { useTranslation } from "react-i18next";
import type { DateRange } from "@/types/api";
import { Empty } from "./Empty";
import { fmtDate } from "@/utils/fmt";
import { ALL_SENTINEL } from "@/utils/date";

// An empty-range result reads very differently depending on whether there's
// no data anywhere yet (first run, nothing synced) vs. real data exists but
// just not in the currently-selected window — the second case should point
// at the actual available range rather than a generic "nothing here."
// `range` is the entity's overall min/max date (e.g. GET /api/range), null
// while it's still loading.
interface RangeEmptyProps {
  range: DateRange | null;
  from: string;
  to: string;
  entityLabel: string; // e.g. "activities", "body measurements"
}

export function RangeEmpty({ range, from, to, entityLabel }: RangeEmptyProps) {
  const { t } = useTranslation();
  if (!range || !range.min_date || !range.max_date) {
    return <Empty message={t("common.rangeEmpty.noneYet", `No ${entityLabel} yet — sync some data from the Data & Sync tab.`, { entity: entityLabel })} />;
  }
  // "All available data" reads as an intentional range, not the useDateRange
  // "All" preset's internal 2000-01-01 sentinel (HRA-256).
  const fromLabel = from === ALL_SENTINEL ? t("dateRange.allAvailable", "All available data") : fmtDate(from);
  return (
    <Empty message={t("common.rangeEmpty.notInRange",
      `No ${entityLabel} in the selected range (${fromLabel} to ${fmtDate(to)}). Data available from ${fmtDate(range.min_date)} to ${fmtDate(range.max_date)}.`,
      { entity: entityLabel, from: fromLabel, to: fmtDate(to), minDate: fmtDate(range.min_date), maxDate: fmtDate(range.max_date) })} />
  );
}
