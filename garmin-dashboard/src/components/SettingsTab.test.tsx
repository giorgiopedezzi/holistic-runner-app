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

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("SettingsTab save flows", () => {
  it("saves the trend threshold to its own /settings/thresholds sub-resource", async () => {
    const fetchMock = installFetch({
      "GET /api/v1/settings": settings(),
      "PUT /api/v1/settings/thresholds": ({ body }: StubRequest) =>
        json(settings({ min_trend_group_size: (body as { min_trend_group_size: number }).min_trend_group_size })),
    });
    render(<SettingsTab appearance={fakeAppearance()} />);

    // Sections are accordion cards now (collapsed by default) — expand
    // "Overview & Trends" before its fields exist in the DOM.
    fireEvent.click(await screen.findByRole("button", { name: /Overview & Trends/ }));

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

    // Single-expand accordion: opening "Outlier detection" is enough — its
    // own fields are then the only spinbuttons in the DOM.
    fireEvent.click(await screen.findByRole("button", { name: /Outlier detection/ }));

    const inputs = await screen.findAllByRole("spinbutton");
    fireEvent.change(inputs[0], { target: { value: "4.5" } });

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

    fireEvent.click(await screen.findByRole("button", { name: /Activity details/ }));
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

    fireEvent.click(await screen.findByRole("button", { name: /^Units/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Imperial (mi, lb)" }));
    expect(appearance.setUnits).toHaveBeenCalledWith("imperial");
  });

  describe("expanded section URL persistence (HRA-194)", () => {
    it("writes the expanded section into the URL on click, and clears it on collapse", async () => {
      installFetch({ "GET /api/v1/settings": settings() });
      render(<SettingsTab appearance={fakeAppearance()} />);

      const toggle = await screen.findByRole("button", { name: /Outlier detection/ });
      fireEvent.click(toggle);
      expect(new URLSearchParams(window.location.search).get("settingsSection")).toBe("outliers");

      fireEvent.click(toggle);
      // useUrlState.set("") writes the param as an empty string rather than
      // removing it, matching the hook's documented merge-not-overwrite behavior.
      expect(new URLSearchParams(window.location.search).get("settingsSection")).toBe("");
    });

    it("hydrates the expanded section from an existing settingsSection URL param on mount", async () => {
      window.history.replaceState(null, "", "/?settingsSection=units");
      installFetch({ "GET /api/v1/settings": settings() });
      render(<SettingsTab appearance={fakeAppearance()} />);

      // Its fields are only in the DOM once the accordion is actually expanded.
      expect(await screen.findByRole("button", { name: "Imperial (mi, lb)" })).toBeInTheDocument();
    });
  });
});
