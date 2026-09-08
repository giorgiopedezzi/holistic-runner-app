/**
 * PlanInstanceAnchorTable.test.tsx (HRA-281 AC1/AC4)
 * Exercised directly against the component with hand-built props — no
 * PlanInstancesSection/api wiring needed, since every mutation already goes
 * back up through flat callback props.
 *
 * AC1: at phone width, each anchor renders as its own labeled fieldset, not
 * a table row, with no horizontally-scrolling table in the DOM at all.
 * AC4: the desktop `<table>` branch is unaffected by the phone-width branch
 * existing at all — asserted by rendering the exact same props at desktop
 * width and confirming the table (and its column headers) still render.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { PlanInstanceAnchorTable } from "./PlanInstanceAnchorTable";
import type { AnchorRowState } from "./PlanInstancesSection";

beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.releasePointerCapture ??= () => {};
  window.HTMLElement.prototype.scrollIntoView ??= () => {};
});

afterEach(() => vi.unstubAllGlobals());

function stubPhoneViewport() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width: 767px"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function emptyRow(): AnchorRowState {
  return { absoluteValue: "", relativeTo: "", sign: "+", seconds: "" };
}

function baseProps(overrides: Partial<Parameters<typeof PlanInstanceAnchorTable>[0]> = {}) {
  return {
    templateAnchors: ["RG", "RA"],
    anchorRows: { RG: emptyRow(), RA: { ...emptyRow(), absoluteValue: "5:10/km" } },
    resolution: [{ anchor: "RG", secPerKm: null }, { anchor: "RA", secPerKm: 310 }],
    racePaceAnchor: "__none__",
    paceMode: "anchor" as const,
    derivedPaceSecPerKm: null,
    fieldDisabled: false,
    unresolvedAnchors: ["RG"],
    formEnabled: true,
    setAnchorAbsolute: vi.fn(),
    setAnchorRelativeTo: vi.fn(),
    setAnchorSign: vi.fn(),
    setAnchorSeconds: vi.fn(),
    clearAnchorRow: vi.fn(),
    ...overrides,
  };
}

describe("PlanInstanceAnchorTable — desktop (AC4: unchanged)", () => {
  it("renders the anchor table with its column headers, not a per-anchor card", () => {
    render(<PlanInstanceAnchorTable {...baseProps()} />);
    expect(document.querySelector("table.hra-anchor-table")).toBeInTheDocument();
    expect(screen.getByText("Absolute", { selector: "th" })).toBeInTheDocument();
    expect(document.querySelector(".hra-anchor-mobile-card")).not.toBeInTheDocument();
  });
});

describe("PlanInstanceAnchorTable — phone width (AC1)", () => {
  it("renders one labeled fieldset per anchor instead of a table, with no horizontal-scroll table present", () => {
    stubPhoneViewport();
    render(<PlanInstanceAnchorTable {...baseProps()} />);
    expect(document.querySelector("table")).not.toBeInTheDocument();
    const cards = document.querySelectorAll<HTMLElement>("fieldset.hra-anchor-mobile-card");
    expect(cards).toHaveLength(2);
    // Each card shows its own anchor name and Resolved/Unresolved status.
    expect(within(cards[0]).getByText("RG")).toBeInTheDocument();
    expect(within(cards[0]).getByText("Unresolved")).toBeInTheDocument();
    expect(within(cards[1]).getByText("RA")).toBeInTheDocument();
    expect(within(cards[1]).getByText("Resolved")).toBeInTheDocument();
  });

  it("still wires Absolute input and Clear through the same callbacks as desktop", () => {
    stubPhoneViewport();
    const props = baseProps();
    render(<PlanInstanceAnchorTable {...props} />);
    const cards = document.querySelectorAll("fieldset.hra-anchor-mobile-card");
    const rgInput = within(cards[0] as HTMLElement).getByPlaceholderText("e.g. 5:10/km");
    fireEvent.change(rgInput, { target: { value: "4:50/km" } });
    expect(props.setAnchorAbsolute).toHaveBeenCalledWith("RG", "4:50/km");

    const raClear = within(cards[1] as HTMLElement).getByText("Clear");
    fireEvent.click(raClear);
    expect(props.clearAnchorRow).toHaveBeenCalledWith("RA");
  });
});
