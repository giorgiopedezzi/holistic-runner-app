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
import { installFetch, paginated, json, type StubRequest, type Routes } from "@/test/api-stub";
import { settings, deviceStatus, withingsStatus, stravaStatus } from "@/test/fixtures";
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

    // HRA-384: Outlier detection now lives on the Data subpage.
    fireEvent.click(await screen.findByRole("button", { name: "Data" }));
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

  // HRA-385 AC3/AC4: Reset to default only repopulates the draft form from
  // Settings.outlier_defaults (never hardcoded here) — persisting still goes
  // through the same explicit Save button as any other outlier edit.
  it("Reset to default restores the effective defaults into the draft, then Save persists them", async () => {
    const custom = settings({ outlier_speed_delta_per_sec: 9, outlier_cadence_delta_per_sec: 99, outlier_min_speed_kmh: 9 });
    const fetchMock = installFetch({
      "GET /api/v1/settings": custom,
      "PUT /api/v1/settings/outliers": ({ body }: StubRequest) => json(settings(body as object)),
    });
    render(<SettingsTab appearance={fakeAppearance()} />);

    // HRA-384: Outlier detection now lives on the Data subpage.
    fireEvent.click(await screen.findByRole("button", { name: "Data" }));
    fireEvent.click(await screen.findByRole("button", { name: /Outlier detection/ }));
    const inputs = await screen.findAllByRole("spinbutton");
    expect(inputs[0]).toHaveValue(9);

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(inputs[0]).toHaveValue(custom.outlier_defaults.outlier_speed_delta_per_sec);

    const saveBtn = screen.getAllByRole("button", { name: "Save" }).find((b) => !(b as HTMLButtonElement).disabled)!;
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/settings/outliers"),
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify(custom.outlier_defaults),
        }),
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

  it("lists missing athlete metrics and persists a complete canonical profile", async () => {
    const fetchMock = installFetch({
      "GET /api/v1/settings": settings(),
      "PUT /api/v1/settings/athlete-metrics": ({ body }: StubRequest) => json(settings(body as Partial<ReturnType<typeof settings>>)),
    });
    render(<SettingsTab appearance={fakeAppearance()} />);

    // HRA-384 split Settings into General/Data/Sync; Training metrics is a
    // classification input, so it sits on Data alongside outlier detection.
    fireEvent.click(await screen.findByRole("button", { name: "Data" }));
    fireEvent.click(await screen.findByRole("button", { name: /Training metrics/ }));
    // Matched on the training-metrics banner's own tail, not the shared
    // "Classification profile incomplete:" prefix — the classify section on
    // this same Data subpage opens with that prefix too.
    expect(await screen.findByText(/Workout classification may be less precise/)).toHaveTextContent("Current easy pace, Current race pace, Current long-run target");

    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0], { target: { value: "5:30" } });
    fireEvent.change(inputs[1], { target: { value: "4:30" } });
    fireEvent.change(inputs[2], { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/settings/athlete-metrics"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          current_easy_pace_sec_per_km: 330,
          current_race_pace_sec_per_km: 270,
          current_long_run_target_m: 20000,
        }),
      }),
    ));
  });

  it("does not allow invalid athlete metrics to be saved", async () => {
    const fetchMock = installFetch({ "GET /api/v1/settings": settings() });
    render(<SettingsTab appearance={fakeAppearance()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Data" }));
    fireEvent.click(await screen.findByRole("button", { name: /Training metrics/ }));
    fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "0:00" } });
    expect(screen.getByText(/Use positive values/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/v1/settings/athlete-metrics"), expect.anything());
  });

  describe("expanded section URL persistence (HRA-194)", () => {
    it("writes the expanded section into the URL on click, and clears it on collapse", async () => {
      installFetch({ "GET /api/v1/settings": settings() });
      render(<SettingsTab appearance={fakeAppearance()} />);

      fireEvent.click(await screen.findByRole("button", { name: "Data" }));
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

// HRA-384: Data and Sync fold the former ManageTab into Settings, split by
// mental model (Data = imported/stored/processed training data, Sync =
// provider connection and synchronization). Every endpoint either subpage's
// sections hit on mount, with benign defaults — same shape ManageTab.test.tsx
// used before this Story folded it in.
function dataSyncRoutes(overrides: Routes = {}): Routes {
  return {
    "GET /api/v1/settings": settings(),
    "GET /api/v1/garmin/status": deviceStatus(),
    "GET /api/v1/withings/status": withingsStatus(),
    "GET /api/v1/strava/status": stravaStatus(),
    "GET /api/v1/activities/count": { count: 0 },
    "GET /api/v1/body-measurements/count": { count: 0 },
    "GET /api/v1/activities": paginated([]),
    "GET /api/v1/body-measurements": paginated([]),
    "GET /api/v1/activities/trash": paginated([]),
    "GET /api/v1/body-measurements/trash": paginated([]),
    ...overrides,
  };
}

describe("SettingsTab — Data and Sync subpages (HRA-384)", () => {
  it("defaults to the General subpage and keeps settingsPage out of the URL until a page is picked", async () => {
    installFetch({ "GET /api/v1/settings": settings() });
    render(<SettingsTab appearance={fakeAppearance()} />);

    expect(await screen.findByText("Appearance")).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("settingsPage")).toBeNull();
  });

  it("writes settingsPage into the URL on click and shows each subpage's own content", async () => {
    installFetch(dataSyncRoutes());
    render(<SettingsTab appearance={fakeAppearance()} savedRanges={[]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Data" }));
    expect(new URLSearchParams(window.location.search).get("settingsPage")).toBe("data");
    expect(await screen.findByRole("button", { name: /Outlier detection/ })).toBeInTheDocument();
    expect(screen.getByText("Delete — local database only")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trash" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(new URLSearchParams(window.location.search).get("settingsPage")).toBe("sync");
    expect(await screen.findByText("Not connected to Strava")).toBeInTheDocument();
    // Sync never pulls in Data's own content.
    expect(screen.queryByText("Delete — local database only")).not.toBeInTheDocument();
  });

  it("hydrates the active subpage from an existing settingsPage URL param on mount", async () => {
    window.history.replaceState(null, "", "/?settingsPage=sync");
    installFetch(dataSyncRoutes());
    render(<SettingsTab appearance={fakeAppearance()} savedRanges={[]} />);

    expect(await screen.findByText("Not connected to Strava")).toBeInTheDocument();
    expect(screen.queryByText("Appearance")).not.toBeInTheDocument();
  });
});

describe("AccountPrivacySection — Data Export removed from the visible UI (HRA-384)", () => {
  it("no longer offers a personal-data export control, while deletion stays available", async () => {
    installFetch({
      "GET /api/v1/settings": settings(),
      "GET /api/v1/auth/session": {
        user: { id: "u1", display_name: "Founder", locale: "en", unit_system: "metric", timezone: "Europe/Rome", role: "admin" },
        entitlements: [], csrfToken: "test-csrf",
      },
    });
    render(<SettingsTab appearance={fakeAppearance()} />);

    await screen.findByText("Appearance");
    fireEvent.click(screen.getByRole("button", { name: "Account & privacy" }));

    expect(await screen.findByRole("button", { name: "Delete account" })).toBeInTheDocument();
    expect(screen.queryByText("Personal-data export")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create export" })).not.toBeInTheDocument();
  });
});
