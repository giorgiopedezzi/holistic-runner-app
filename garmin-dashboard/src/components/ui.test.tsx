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
      screen.getByText(/no activities in the selected range \(2026-01-01 to 2026-02-01\)\. data available from 2026-03-01 to 2026-08-04/i),
    ).toBeInTheDocument();
  });
});
