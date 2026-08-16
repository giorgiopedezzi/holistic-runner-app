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
import { ThemePicker, UnitsPicker } from "./SettingsTab";
import type { AppearanceApi } from "@/hooks/useAppearance";
import { settings } from "@/test/fixtures";

// A plain object literal, not a mock of the hook — TypeScript accepts it
// solely because it structurally satisfies AppearanceApi.
function stubAppearance(overrides: Partial<AppearanceApi> = {}): AppearanceApi {
  return {
    settings: settings(),
    setTheme: vi.fn(),
    setUnits: vi.fn(),
    resolvedTheme: "dark",
    resolvedUnitSystem: "metric",
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

  it("calls setTheme('auto') from the Auto swatch", () => {
    const appearance = stubAppearance();
    render(<ThemePicker appearance={appearance} />);

    fireEvent.click(screen.getByRole("button", { name: /^Auto/ }));

    expect(appearance.setTheme).toHaveBeenCalledWith("auto");
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
