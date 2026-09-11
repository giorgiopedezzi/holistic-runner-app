import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DateRangeBar } from "./DateRangeBar";
import { defaultCompareRange } from "@/hooks/useCompareRange";
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

// A comparison range matching the default the "Current" range above would
// produce (useCompareRange's own defaultCompareRange) — represents the
// no-deviation baseline for the non-default-badge tests.
function baseCompare(overrides: Partial<{ from: string; to: string; enabled: boolean }> = {}) {
  const { from, to } = baseProps();
  const def = defaultCompareRange(from, to);
  return {
    from: def.from, to: def.to, enabled: true,
    setFrom: vi.fn(), setTo: vi.fn(), setEnabled: vi.fn(),
    ...overrides,
  };
}

describe("DateRangeBar phone-width compaction (HRA-290)", () => {
  it("renders the full desktop row unchanged at desktop width", () => {
    stubPhoneWidth(false);
    render(<DateRangeBar {...baseProps()} />);
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0); // preset + named-range Selects inline
    expect(screen.queryByRole("button", { name: /Filters/ })).not.toBeInTheDocument();
  });

  it("renders the full desktop two-row Current/Compared-to form unchanged at desktop width", () => {
    stubPhoneWidth(false);
    render(<DateRangeBar {...baseProps()} compare={baseCompare()} />);
    expect(screen.queryByRole("button", { name: /Filters/ })).not.toBeInTheDocument();
    expect(screen.getByText("Compared to")).toBeInTheDocument();
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

  it("appends the activity count to the phone summary only when passed (Overview & Trends)", () => {
    stubPhoneWidth(true);
    render(<DateRangeBar {...baseProps()} currentActivityCount={12} />);
    expect(screen.getByText(/12 activities/)).toBeInTheDocument();
  });

  it("shows the actual observation span alongside the All-available-data label, never the sentinel", () => {
    stubPhoneWidth(true);
    render(<DateRangeBar {...baseProps()} from={ALL_SENTINEL} allRangeSpan={{ min_date: "2019-03-01", max_date: "2026-09-01" }} />);
    // Exact formatting is locale-dependent (fmtDate) — just assert the span
    // is present (the plain label text alone is no longer the whole string)
    // and the sentinel never leaks through raw.
    expect(screen.queryByText("All available data", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText(/All available data \(.*→.*\)/)).toBeInTheDocument();
    expect(screen.queryByText(ALL_SENTINEL)).not.toBeInTheDocument();
  });
});

describe("DateRangeBar phone-width comparison branch (HRA-306)", () => {
  it("extends compaction to the compare branch instead of forcing the desktop two-row form", () => {
    stubPhoneWidth(true);
    render(<DateRangeBar {...baseProps()} compare={baseCompare()} />);
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument(); // nothing inline until the sheet opens
  });

  it("shows one 'Compare with another period' action and no comparison form when comparison is off", () => {
    stubPhoneWidth(true);
    render(<DateRangeBar {...baseProps()} compare={baseCompare({ enabled: false })} />);
    expect(screen.getByRole("button", { name: "Compare with another period" })).toBeInTheDocument();
    expect(screen.queryByText("Compared to", { exact: false })).not.toBeInTheDocument();
  });

  it("shows a compact comparison summary with dates, activity count, and edit/close actions when comparison is active", () => {
    stubPhoneWidth(true);
    const compare = baseCompare();
    render(<DateRangeBar {...baseProps()} compare={compare} compareActivityCount={7} />);
    expect(screen.getByText(/Compared to/)).toBeInTheDocument();
    expect(screen.getByText(/7 activities/)).toBeInTheDocument();
    const closeBtn = screen.getByRole("button", { name: "Close comparison" });
    fireEvent.click(closeBtn);
    expect(compare.setEnabled).toHaveBeenCalledWith(false);
  });

  it("identifies an empty comparison period as 0 activities, never substituting the current-period value", () => {
    stubPhoneWidth(true);
    render(<DateRangeBar {...baseProps()} compare={baseCompare()} compareActivityCount={0} />);
    expect(screen.getByText(/\b0 activities\b/)).toBeInTheDocument();
  });

  it("counts a non-default comparison state (disabled off its expected-enabled default) in the active-filter badge", () => {
    stubPhoneWidth(true);
    render(<DateRangeBar {...baseProps()} compare={baseCompare({ enabled: false })} />);
    expect(screen.getByRole("button", { name: "Filters (1 active)" })).toBeInTheDocument();
  });

  it("Cancel closes the sheet without committing any change", () => {
    stubPhoneWidth(true);
    const props = baseProps();
    render(<DateRangeBar {...props} compare={baseCompare()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const comboboxes = screen.getAllByRole("combobox");
    fireEvent.keyDown(comboboxes[0], { key: "ArrowDown" }); // open the preset Select
    fireEvent.click(screen.getByRole("option", { name: "7d" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(props.setFrom).not.toHaveBeenCalled();
    expect(props.setTo).not.toHaveBeenCalled();
  });

  it("Apply commits exactly the staged range and closes the sheet", () => {
    stubPhoneWidth(true);
    const props = baseProps();
    render(<DateRangeBar {...props} compare={baseCompare()} />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const comboboxes = screen.getAllByRole("combobox");
    fireEvent.keyDown(comboboxes[0], { key: "ArrowDown" }); // preset Select
    fireEvent.click(screen.getByRole("option", { name: "7d" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(props.setFrom).toHaveBeenCalledWith(isoAgo(7));
    expect(props.setTo).toHaveBeenCalledWith(isoToday());
  });

  it("opens the sheet with comparison pre-enabled from the 'Compare with another period' action", () => {
    stubPhoneWidth(true);
    const compare = baseCompare({ enabled: false });
    render(<DateRangeBar {...baseProps()} compare={compare} />);
    fireEvent.click(screen.getByRole("button", { name: "Compare with another period" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });
});
