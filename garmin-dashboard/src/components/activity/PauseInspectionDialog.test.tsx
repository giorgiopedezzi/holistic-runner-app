/**
 * PauseInspectionDialog.test.tsx (HRA-311)
 * Radix's own focus-trap/Escape/backdrop/focus-return dialog mechanics are
 * already pinned generically on the shared Sheet primitive
 * (ui-primitives.test.tsx) — this file only covers what's specific to this
 * dialog: count/order, complete vs. missing HR recovery ("unavailable", never
 * a fabricated 0/NaN), zero pauses (no trigger rendered at all), desktop
 * table vs. phone row layout, and metric/imperial distance formatting.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PauseInspectionDialog } from "./PauseInspectionDialog";
import type { PauseInspectionRow } from "@/domain/pauses";
import { setUnitSystem } from "@/utils/units";

function stubPhoneWidth(isPhone: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: isPhone,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function row(overrides: Partial<PauseInspectionRow> = {}): PauseInspectionRow {
  return {
    afterIndex: 0, elapsedSec: 600, durationSec: 60, distanceM: 1000, hrBefore: 150, hrAfter: 130, hrDelta: 20,
    staminaBefore: 70, staminaAfter: 68, recorded: true, ...overrides,
  };
}

afterEach(() => {
  setUnitSystem("metric");
  stubPhoneWidth(false);
});

describe("PauseInspectionDialog", () => {
  it("renders no trigger at all when there are no pauses (AC7)", () => {
    const { container } = render(<PauseInspectionDialog rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the trigger labelled with the pause count", () => {
    render(<PauseInspectionDialog rows={[row(), row({ afterIndex: 5 })]} />);
    expect(screen.getByRole("button", { name: "Pauses (2)" })).toBeInTheDocument();
  });

  it("desktop: opens a table listing every pause once, in order, with number/duration/distance/HR recovery", () => {
    stubPhoneWidth(false);
    const rows = [
      row({ afterIndex: 0, durationSec: 45, distanceM: 1000, hrBefore: 150, hrAfter: 130, hrDelta: 20 }),
      row({ afterIndex: 10, durationSec: 125, distanceM: 3000, hrBefore: 160, hrAfter: 170, hrDelta: -10 }),
    ];
    render(<PauseInspectionDialog rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Pauses (2)" }));

    const table = screen.getByRole("table");
    const dataRows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(dataRows).toHaveLength(2);
    expect(dataRows[0]).toHaveTextContent("1");
    expect(dataRows[0]).toHaveTextContent("45s");
    expect(dataRows[0]).toHaveTextContent("1.00 km");
    expect(dataRows[0]).toHaveTextContent("150 → 130 bpm · −20 bpm");
    expect(dataRows[1]).toHaveTextContent("2");
    expect(dataRows[1]).toHaveTextContent("2m5s");
    // A rising HR (delta negative — hrBefore < hrAfter) reads with a "+" sign.
    expect(dataRows[1]).toHaveTextContent("160 → 170 bpm · +10 bpm");
    expect(table).toBeInTheDocument();
  });

  it("announces missing HR recovery as unavailable, never a fabricated 0/NaN/Infinity", () => {
    stubPhoneWidth(false);
    render(<PauseInspectionDialog rows={[row({ hrBefore: null, hrAfter: null, hrDelta: null })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Pauses (1)" }));
    const cell = screen.getAllByRole("row")[1];
    expect(cell).toHaveTextContent("Unavailable");
    expect(cell).not.toHaveTextContent("NaN");
    expect(cell).not.toHaveTextContent("Infinity");
  });

  it("phone: reflows into plain labelled rows, not a table", () => {
    stubPhoneWidth(true);
    render(<PauseInspectionDialog rows={[row()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Pauses (1)" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("Pause 1")).toBeInTheDocument();
    expect(screen.getByText("HR recovery")).toBeInTheDocument();
    expect(screen.getByText("150 → 130 bpm · −20 bpm")).toBeInTheDocument();
  });

  it("formats distance per the current metric/imperial unit preference, same formatter the chart uses", () => {
    stubPhoneWidth(false);
    setUnitSystem("imperial");
    render(<PauseInspectionDialog rows={[row({ distanceM: 1609.344 })]} />);
    fireEvent.click(screen.getByRole("button", { name: "Pauses (1)" }));
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("1.00 mi");
  });

  it("shows elapsed position, stamina context, and recorded/inferred provenance per pause (HRA-337 AC7/AC8)", () => {
    stubPhoneWidth(false);
    render(<PauseInspectionDialog rows={[
      row({ elapsedSec: 615, staminaBefore: 70, staminaAfter: 68, recorded: true }),
      row({ afterIndex: 20, elapsedSec: 1900, staminaBefore: null, staminaAfter: null, recorded: false }),
    ]} />);
    fireEvent.click(screen.getByRole("button", { name: "Pauses (2)" }));
    const dataRows = screen.getAllByRole("row").slice(1);
    expect(dataRows[0]).toHaveTextContent("70 → 68");
    expect(dataRows[0]).toHaveTextContent("Recorded");
    expect(dataRows[1]).toHaveTextContent("Unavailable");
    expect(dataRows[1]).toHaveTextContent("Inferred");
  });

  it("dialog close returns to a plain closed state without any replay-control side effects (dialog has no play/stop of its own)", () => {
    render(<PauseInspectionDialog rows={[row()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Pauses (1)" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
