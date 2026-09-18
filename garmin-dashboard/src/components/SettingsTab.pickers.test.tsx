/**
 * SettingsTab.pickers.test.tsx  (HRA-77)
 * Proves the AppearanceApi interface is genuinely stubbable: ThemePicker and
 * UnitsPicker are rendered against a hand-written object literal that
 * satisfies AppearanceApi by structure alone — no useAppearance() hook, no
 * useSettings()/context, no network call. This is the whole point of
 * declaring the interface instead of typing props as
 * `ReturnType<typeof useAppearance>` (which only a real hook invocation can
 * produce), so it's the test that proves the Story, not incidental coverage.
 * BackgroundPicker's own describe block was removed with the component
 * (2026-08-16 correction pass — background picture replaced by the
 * automatic ambient glow, see frontend.md).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemePicker, PalettePicker, UnitsPicker } from "./SettingsTab";
import type { AppearanceApi } from "@/hooks/useAppearance";
import { settings } from "@/test/fixtures";

// A plain object literal, not a mock of the hook — TypeScript accepts it
// solely because it structurally satisfies AppearanceApi.
function stubAppearance(overrides: Partial<AppearanceApi> = {}): AppearanceApi {
  return {
    settings: settings(),
    setTheme: vi.fn(),
    setUnits: vi.fn(),
    setPalette: vi.fn(),
    resolvedTheme: "dark",
    resolvedUnitSystem: "metric",
    resolvedPalette: "metal",
    ...overrides,
  };
}

describe("ThemePicker (hand-written AppearanceApi stub)", () => {
  it("calls setTheme with the clicked theme", () => {
    const appearance = stubAppearance();
    render(<ThemePicker appearance={appearance} />);

    fireEvent.click(screen.getByRole("button", { name: /Light$/ }));

    expect(appearance.setTheme).toHaveBeenCalledWith("light");
  });

  // No Auto swatch (removed) — highlights the swatch matching resolvedTheme
  // instead, whenever the stored theme isn't an explicit "dark"/"light".
  it("highlights the swatch matching resolvedTheme when no explicit choice is stored", () => {
    const appearance = stubAppearance({ settings: settings({ theme: "auto" }), resolvedTheme: "light" });
    render(<ThemePicker appearance={appearance} />);

    expect(screen.getByRole("button", { name: /^Light/ })).toHaveAttribute("data-selected", "true");
    expect(screen.getByRole("button", { name: /^Dark/ })).toHaveAttribute("data-selected", "false");
  });

  // HRA-385 AC2: switching to Light while Graphite is active must stay
  // clickable — it's exactly the action that triggers the backend's atomic
  // normalization (settings.controller.ts's updateTheme). Both swatches were
  // disabled here before this Story; neither is now.
  it("stays enabled for both swatches even while Graphite is the active palette", () => {
    const appearance = stubAppearance({ settings: settings({ theme: "dark", palette: "graphite" }), resolvedPalette: "graphite" });
    render(<ThemePicker appearance={appearance} />);

    expect(screen.getByRole("button", { name: /^Light/ })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /^Dark/ })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /^Light/ }));
    expect(appearance.setTheme).toHaveBeenCalledWith("light");
  });
});

describe("PalettePicker (hand-written AppearanceApi stub)", () => {
  it("calls setPalette with the clicked palette", () => {
    const appearance = stubAppearance({ settings: settings({ theme: "dark", palette: "metal" }), resolvedTheme: "dark" });
    render(<PalettePicker appearance={appearance} />);

    fireEvent.click(screen.getByRole("button", { name: /^Warm/ }));

    expect(appearance.setPalette).toHaveBeenCalledWith("warm");
  });

  // HRA-385 AC1: the one truly invalid direction — Graphite is dark-only, so
  // its own swatch (not Theme's) is what disables itself while Light is the
  // resolved theme.
  it("disables the Graphite swatch while Light is the resolved theme", () => {
    const appearance = stubAppearance({ settings: settings({ theme: "light", palette: "metal" }), resolvedTheme: "light" });
    render(<PalettePicker appearance={appearance} />);

    expect(screen.getByRole("button", { name: /^Graphite/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Metal/ })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /^Warm/ })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /^Graphite/ }));
    expect(appearance.setPalette).not.toHaveBeenCalled();
  });

  it("keeps the Graphite swatch enabled while Dark is the resolved theme", () => {
    const appearance = stubAppearance({ settings: settings({ theme: "dark", palette: "metal" }), resolvedTheme: "dark" });
    render(<PalettePicker appearance={appearance} />);

    expect(screen.getByRole("button", { name: /^Graphite/ })).not.toBeDisabled();
  });
});

describe("UnitsPicker (hand-written AppearanceApi stub)", () => {
  it("calls setUnits with the clicked unit system", () => {
    const appearance = stubAppearance({ settings: settings({ unit_system: "metric" }) });
    render(<UnitsPicker appearance={appearance} />);

    fireEvent.click(screen.getByRole("button", { name: "Imperial (mi, lb)" }));

    expect(appearance.setUnits).toHaveBeenCalledWith("imperial");
  });

  it("shows the resolved unit system only when the stored value is 'auto'", () => {
    const { rerender } = render(<UnitsPicker appearance={stubAppearance({ settings: settings({ unit_system: "metric" }) })} />);
    expect(screen.queryByText(/currently:/)).not.toBeInTheDocument();

    rerender(<UnitsPicker appearance={stubAppearance({ settings: settings({ unit_system: "auto" }), resolvedUnitSystem: "imperial" })} />);
    expect(screen.getByText(/currently: imperial/)).toBeInTheDocument();
  });
});
