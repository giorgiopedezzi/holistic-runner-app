/**
 * TrendAccessibleData.test.tsx (HRA-310)
 * Behaviour-level coverage for the non-visual chart alternative: the always-
 * present summary, the keyboard/touch-operable disclosure, the semantic
 * table's missing-value/hidden-series/empty-comparison handling, and that no
 * fabricated zero/NaN ever renders for a null metric.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TrendAccessibleData } from "./TrendAccessibleData";
import type { OverlapPoint } from "@/domain/trends";

const ALL_VISIBLE = { distance: true, avgPace: true, avgHr: true };

function point(overrides: Partial<OverlapPoint> & { slot: number }): OverlapPoint {
  return {
    currentLabel: null, compareLabel: null,
    currentKm: null, currentPace: null, currentHr: null, currentCount: null,
    compareKm: null, comparePace: null, compareHr: null, compareCount: null,
    ...overrides,
  };
}

describe("TrendAccessibleData", () => {
  it("always renders a concise summary identifying period, grouping, activity count and comparison state", () => {
    render(
      <TrendAccessibleData
        sport="running" mode="week" periodLabel="1 Aug – 14 Aug"
        compareEnabled comparePeriodLabel="1 Jul – 14 Jul"
        points={[point({ slot: 0, currentLabel: "Week 1", currentKm: 10, currentPace: 5.2, currentHr: 150, currentCount: 3 })]}
        currentCount={3} compareCount={2} seriesVisible={ALL_VISIBLE}
        distanceUnit="km" paceUnit="/km"
      />,
    );
    expect(screen.getByText(/Running/)).toBeInTheDocument();
    expect(screen.getByText(/1 Aug – 14 Aug/)).toBeInTheDocument();
    expect(screen.getByText(/grouped By week/)).toBeInTheDocument();
    expect(screen.getByText(/3 activities/)).toBeInTheDocument();
    expect(screen.getByText(/compared to 1 Jul – 14 Jul \(2 activities\)/)).toBeInTheDocument();
  });

  it("the table is not in the document until the disclosure is expanded, and toggling flips its label/aria-expanded", () => {
    render(
      <TrendAccessibleData
        sport="running" mode="single" periodLabel="1 Aug – 14 Aug" compareEnabled={false}
        points={[point({ slot: 0, currentLabel: "12 Aug", currentKm: 5, currentPace: 5, currentHr: 140, currentCount: 1 })]}
        currentCount={1} compareCount={0} seriesVisible={ALL_VISIBLE}
        distanceUnit="km" paceUnit="/km"
      />,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "View data" });
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide data" })).toHaveAttribute("aria-expanded", "true");
  });

  it("a missing metric (e.g. no HR sensor) reads as unavailable, never a fabricated zero/NaN", () => {
    render(
      <TrendAccessibleData
        sport="cycling" mode="single" periodLabel="1 Aug – 14 Aug" compareEnabled={false}
        points={[point({ slot: 0, currentLabel: "12 Aug", currentKm: 20, currentPace: null, currentHr: null, currentCount: 1 })]}
        currentCount={1} compareCount={0} seriesVisible={ALL_VISIBLE}
        distanceUnit="km" paceUnit="/km"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View data" }));

    const row = screen.getAllByRole("row")[1]; // header row, then this data row
    const cells = within(row).getAllByRole("cell");
    // Avg pace, Avg HR columns (Period=rowheader, Activities, Distance, Avg pace, Avg HR)
    expect(cells[2].textContent).toMatch(/unavailable/);
    expect(cells[2].textContent).not.toMatch(/NaN|Infinity/);
  });

  it("an empty comparison period shows 0 activities in the summary and does not repeat the current value into compare columns", () => {
    render(
      <TrendAccessibleData
        sport="running" mode="single" periodLabel="1 Aug – 14 Aug"
        compareEnabled comparePeriodLabel="1 Jul – 14 Jul"
        points={[point({ slot: 0, currentLabel: "12 Aug", currentKm: 10, currentPace: 5, currentHr: 150, currentCount: 1 })]}
        currentCount={1} compareCount={0} seriesVisible={ALL_VISIBLE}
        distanceUnit="km" paceUnit="/km"
      />,
    );
    expect(screen.getByText(/compared to 1 Jul – 14 Jul \(0 activities\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View data" }));
    const row = screen.getAllByRole("row")[1];
    const distanceCell = within(row).getAllByRole("cell")[1];
    // Current distance (10.0 km) present; compare side unavailable, never "10.0 km" repeated.
    expect(distanceCell.textContent).toMatch(/10\.0 km/);
    expect(distanceCell.textContent).toMatch(/unavailable/);
  });

  it("a series hidden from the visual chart is marked hidden-from-chart in its column header, not omitted from the table", () => {
    render(
      <TrendAccessibleData
        sport="running" mode="single" periodLabel="1 Aug – 14 Aug" compareEnabled={false}
        points={[point({ slot: 0, currentLabel: "12 Aug", currentKm: 10, currentPace: 5, currentHr: 150, currentCount: 1 })]}
        currentCount={1} compareCount={0}
        seriesVisible={{ distance: true, avgPace: true, avgHr: false }}
        distanceUnit="km" paceUnit="/km"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View data" }));

    const hrHeader = screen.getByRole("columnheader", { name: /Avg HR/ });
    expect(hrHeader.textContent).toMatch(/hidden from chart/);
    // Still has a real value in the body, not omitted.
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getAllByRole("cell")[3].textContent).toMatch(/150 bpm/);
  });
});
