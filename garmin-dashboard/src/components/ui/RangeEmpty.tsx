import type { DateRange } from "@/types/api";
import { Empty } from "./Empty";

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
  if (!range || !range.min_date || !range.max_date) {
    return <Empty message={`No ${entityLabel} yet — sync some data from the Data & Sync tab.`} />;
  }
  return (
    <Empty message={`No ${entityLabel} in the selected range (${from} to ${to}). Data available from ${range.min_date} to ${range.max_date}.`} />
  );
}
