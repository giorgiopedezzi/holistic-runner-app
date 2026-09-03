/**
 * src/components/ui.test.tsx  (HRA-63)
 * RangeEmpty picks between two very different empty states: "nothing synced
 * yet" vs "data exists, just not in this window" (see CLAUDE.md's empty-states
 * note). Both branches are asserted.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RangeEmpty } from "./ui";
import type { DateRange } from "@/types/api";
import { fmtDate } from "@/utils/fmt";
import { ALL_SENTINEL } from "@/utils/date";

describe("RangeEmpty", () => {
  it("no data at all → prompts to sync", () => {
    render(<RangeEmpty range={null} from="2026-01-01" to="2026-02-01" entityLabel="activities" />);
    expect(screen.getByText(/no activities yet — sync some data/i)).toBeInTheDocument();
  });

  it("empty null-dated range → also treated as 'nothing yet'", () => {
    const range: DateRange = { min_date: null, max_date: null };
    render(<RangeEmpty range={range} from="2026-01-01" to="2026-02-01" entityLabel="body measurements" />);
    expect(screen.getByText(/no body measurements yet/i)).toBeInTheDocument();
  });

  it("data exists but not in range → points at the available window", () => {
    const range: DateRange = { min_date: "2026-03-01", max_date: "2026-08-04" };
    render(<RangeEmpty range={range} from="2026-01-01" to="2026-02-01" entityLabel="activities" />);
    expect(
      screen.getByText(
        `No activities in the selected range (${fmtDate("2026-01-01")} to ${fmtDate("2026-02-01")}). ` +
        `Data available from ${fmtDate("2026-03-01")} to ${fmtDate("2026-08-04")}.`,
      ),
    ).toBeInTheDocument();
  });

  // HRA-256: the useDateRange "All" preset's internal 2000-01-01 sentinel
  // must never render as a literal date.
  it("selecting All reads as 'All available data', not the 2000-01-01 sentinel", () => {
    const range: DateRange = { min_date: "2026-03-01", max_date: "2026-08-04" };
    render(<RangeEmpty range={range} from={ALL_SENTINEL} to="2026-02-01" entityLabel="activities" />);
    expect(screen.queryByText(/2000/)).not.toBeInTheDocument();
    expect(screen.getByText(/All available data/)).toBeInTheDocument();
  });
});
