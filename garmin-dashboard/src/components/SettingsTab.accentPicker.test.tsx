/**
 * SettingsTab.accentPicker.test.tsx  (HRA-95)
 * AccentPicker follows the same hand-written AppearanceApi-stub pattern as
 * SettingsTab.pickers.test.tsx (kept in its own new file rather than added
 * to that one, so the existing FE characterization suite stays unmodified).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccentPicker } from "./SettingsTab";
import type { AppearanceApi } from "@/hooks/useAppearance";
import { settings } from "@/test/fixtures";

function stubAppearance(overrides: Partial<AppearanceApi> = {}): AppearanceApi {
  return {
    settings: settings(),
    setTheme: vi.fn(),
    setUnits: vi.fn(),
    setAccentColor: vi.fn(),
    resolvedTheme: "dark",
    resolvedUnitSystem: "metric",
    ...overrides,
  };
}

describe("AccentPicker (hand-written AppearanceApi stub)", () => {
  it("renders all 6 curated accents as keyboard-focusable buttons", () => {
    render(<AccentPicker appearance={stubAppearance()} />);
    for (const label of ["Teal", "Violet", "Magenta", "Amber", "Sky", "Lime"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("calls setAccentColor with the clicked accent", () => {
    const appearance = stubAppearance();
    render(<AccentPicker appearance={appearance} />);

    fireEvent.click(screen.getByRole("button", { name: "Violet" }));

    expect(appearance.setAccentColor).toHaveBeenCalledWith("violet");
  });

  it("marks the currently selected accent via aria-pressed", () => {
    render(<AccentPicker appearance={stubAppearance({ settings: settings({ accent_color: "lime" }) })} />);

    expect(screen.getByRole("button", { name: "Lime" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Teal" })).toHaveAttribute("aria-pressed", "false");
  });
});
