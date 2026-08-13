/**
 * SettingsTab.test.tsx  (HRA-67)
 * Behaviour-level: the two explicit-save cards persist ONLY their own
 * sub-resource (HRA-40) — asserted by the PUT path the save actually hits;
 * the detail-view toggle immediate-saves; the units button is wired to the
 * appearance prop's setUnits.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsTab } from "./SettingsTab";
import { installFetch, json, type StubRequest } from "@/test/api-stub";
import { settings } from "@/test/fixtures";
import type { useAppearance } from "@/hooks/useAppearance";

// A minimal appearance prop — the Theme/Units/Background pickers read
// .settings and call the setters; the save-flow assertions below target the
// api-direct cards (trend / outliers / detail-view), so these setters are
// spies whose invocation is the observable behaviour.
function fakeAppearance() {
  return {
    settings: settings(),
    setTheme: vi.fn(),
    setBackground: vi.fn(),
    uploadBackground: vi.fn(),
    setUnits: vi.fn(),
    resolvedTheme: "dark",
    resolvedUnitSystem: "metric",
  } as unknown as ReturnType<typeof useAppearance>;
}

afterEach(() => vi.unstubAllGlobals());

describe("SettingsTab save flows", () => {
  it("saves the trend threshold to its own /settings/thresholds sub-resource", async () => {
    const fetchMock = installFetch({
      "GET /api/v1/settings": settings(),
      "PUT /api/v1/settings/thresholds": ({ body }: StubRequest) =>
        json(settings({ min_trend_group_size: (body as { min_trend_group_size: number }).min_trend_group_size })),
    });
    render(<SettingsTab appearance={fakeAppearance()} />);

    // Trend card is the first number field (outlier fields follow it).
    const trendInput = (await screen.findAllByRole("spinbutton"))[0];
    fireEvent.change(trendInput, { target: { value: "7" } });

    const saveBtn = screen.getAllByRole("button", { name: "Save" }).find((b) => !(b as HTMLButtonElement).disabled)!;
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/settings/thresholds"),
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("saves the outlier thresholds to its own /settings/outliers sub-resource", async () => {
    const fetchMock = installFetch({
      "GET /api/v1/settings": settings(),
      "PUT /api/v1/settings/outliers": json(settings()),
    });
    render(<SettingsTab appearance={fakeAppearance()} />);

    const inputs = await screen.findAllByRole("spinbutton");
    // Outlier "max speed change" is the 2nd number field (after the trend one).
    fireEvent.change(inputs[1], { target: { value: "4.5" } });

    const saveBtn = screen.getAllByRole("button", { name: "Save" }).find((b) => !(b as HTMLButtonElement).disabled)!;
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/settings/outliers"),
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });

  it("immediate-saves the activity detail view to /settings/detail-view", async () => {
    const fetchMock = installFetch({
      "GET /api/v1/settings": settings({ activity_detail_view: "accordion" }),
      "PUT /api/v1/settings/detail-view": json(settings({ activity_detail_view: "modal" })),
    });
    render(<SettingsTab appearance={fakeAppearance()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Popup" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/settings/detail-view"),
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });

  it("routes a units change through the appearance prop's setUnits", async () => {
    installFetch({ "GET /api/v1/settings": settings() });
    const appearance = fakeAppearance();
    render(<SettingsTab appearance={appearance} />);

    fireEvent.click(await screen.findByRole("button", { name: "Imperial (mi, lb)" }));
    expect(appearance.setUnits).toHaveBeenCalledWith("imperial");
  });
});
