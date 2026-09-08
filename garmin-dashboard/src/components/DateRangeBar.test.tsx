import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DateRangeBar } from "./DateRangeBar";
import { ALL_SENTINEL, isoAgo, isoToday } from "@/utils/date";

beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.setPointerCapture ??= () => undefined;
  window.HTMLElement.prototype.releasePointerCapture ??= () => undefined;
  window.HTMLElement.prototype.scrollIntoView ??= () => undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubPhoneWidth(isPhone: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: isPhone,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function baseProps() {
  return {
    from: isoAgo(30),
    to: isoToday(),
    setFrom: vi.fn(),
    setTo: vi.fn(),
    setPreset: vi.fn(),
  };
}

describe("DateRangeBar phone-width compaction (HRA-290)", () => {
  it("renders the full desktop row unchanged at desktop width", () => {
    stubPhoneWidth(false);
    render(<DateRangeBar {...baseProps()} />);
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0); // preset + named-range Selects inline
    expect(screen.queryByRole("button", { name: /Filters/ })).not.toBeInTheDocument();
  });

  it("collapses to a range summary + Filter trigger at phone width, opening a Sheet with the same controls", () => {
    stubPhoneWidth(true);
    render(<DateRangeBar {...baseProps()} />);
    const trigger = screen.getByRole("button", { name: "Filters" });
    expect(trigger).toHaveClass("hra-filter-trigger");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument(); // nothing inline until opened

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
  });

  it("shows an active-filter badge and count in the trigger's accessible name when off the default range", () => {
    stubPhoneWidth(true);
    render(<DateRangeBar {...baseProps()} from={ALL_SENTINEL} />);
    expect(screen.getByRole("button", { name: "Filters (1 active)" })).toBeInTheDocument();
  });

  it("shows the all-available-data label, never the raw sentinel date, when All is selected", () => {
    stubPhoneWidth(true);
    render(<DateRangeBar {...baseProps()} from={ALL_SENTINEL} />);
    expect(screen.getByText("All available data")).toBeInTheDocument();
    expect(screen.queryByText(ALL_SENTINEL)).not.toBeInTheDocument();
  });

  it("never compacts the Overview & Trends (compare) usage, even at phone width", () => {
    stubPhoneWidth(true);
    const compare = { from: isoAgo(60), to: isoAgo(31), setFrom: vi.fn(), setTo: vi.fn(), enabled: true, setEnabled: vi.fn() };
    render(<DateRangeBar {...baseProps()} compare={compare} />);
    expect(screen.queryByRole("button", { name: "Filters" })).not.toBeInTheDocument();
    expect(screen.getByText("Compared to")).toBeInTheDocument();
  });
});
