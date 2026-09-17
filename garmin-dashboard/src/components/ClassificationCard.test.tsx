import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClassificationCard } from "./ClassificationCard";
import { installFetch, json } from "@/test/api-stub";
import { activity, settings, REFERENCE_ACTIVITY_ID as ID } from "@/test/fixtures";
import type { Activity } from "@/types/api";
import { AppModeContext, GUEST_CAPABILITIES } from "@/hooks/useAppMode";

function Harness({ initial }: { initial: Activity }) {
  const [current, setCurrent] = useState(initial);
  return <ClassificationCard activity={current} onUpdate={setCurrent} />;
}

afterEach(() => vi.unstubAllGlobals());

describe("ClassificationCard", () => {
  it("shows one effective system category with Runs Free provenance and no implementation method labels", async () => {
    const fetchMock = installFetch({ "GET /api/v1/settings": settings() });
    render(<Harness initial={activity({ system_classification: "Long Session", system_explanation: "steady endurance effort" })} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/settings"), expect.anything()));
    expect(screen.getAllByText("Long Session").length).toBeGreaterThan(0);
    expect(screen.getByText("Classified by Runs Free")).toBeInTheDocument();
    expect(screen.getByText("steady endurance effort")).toBeInTheDocument();
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
    expect(screen.queryByText("Statistical")).not.toBeInTheDocument();
  });

  it("persists a manual override and presents it as the effective category after rerender", async () => {
    const fetchMock = installFetch({
      "GET /api/v1/settings": settings(),
      [`PUT /api/v1/activities/${ID}/classification-override`]: json(activity({
        system_classification: "Recovery Run",
        manual_classification: "Fartlek",
      })),
    });
    render(<Harness initial={activity({ system_classification: "Recovery Run" })} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Classification override" }), { target: { value: "Fartlek" } });
    fireEvent.click(screen.getByRole("button", { name: "Override classification" }));

    expect(await screen.findByText("Classified by you")).toBeInTheDocument();
    expect(screen.getAllByText("Fartlek").length).toBeGreaterThan(0);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/activities/${ID}/classification-override`),
      expect.objectContaining({ method: "PUT" }),
    ));
  });

  it("restores the latest stored system result without reclassifying", async () => {
    const fetchMock = installFetch({
      "GET /api/v1/settings": settings(),
      [`DELETE /api/v1/activities/${ID}/classification-override`]: json(activity({
        system_classification: "Long Session",
        manual_classification: null,
      })),
    });
    render(<Harness initial={activity({ system_classification: "Long Session", manual_classification: "Fartlek" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Restore system classification" }));

    expect(await screen.findByText("Classified by Runs Free")).toBeInTheDocument();
    expect(screen.getAllByText("Long Session").length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/classify"), expect.anything());
  });

  it("warns that current metrics are used, names missing values, and reclassification preserves an override", async () => {
    const fetchMock = installFetch({
      "GET /api/v1/settings": settings({
        current_easy_pace_sec_per_km: 330,
        current_race_pace_sec_per_km: null,
        current_long_run_target_m: null,
      }),
      [`POST /api/v1/activities/${ID}/classify`]: json(activity({
        system_classification: "Progressive Run",
        manual_classification: "Fartlek",
      })),
    });
    render(<Harness initial={activity({ system_classification: "Recovery Run", manual_classification: "Fartlek" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Reclassify" }));
    expect(await screen.findByText(/current training metrics, not the metrics/)).toBeInTheDocument();
    expect(screen.getByText(/Current race pace, Current long-run target/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "?tab=settings");

    fireEvent.click(screen.getByRole("button", { name: "Run classification" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/activities/${ID}/classify`),
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText("Classified by you")).toBeInTheDocument();
    expect(screen.getAllByText("Fartlek").length).toBeGreaterThan(0);
  });

  it.each([
    [{ current_easy_pace_sec_per_km: null, current_race_pace_sec_per_km: 300, current_long_run_target_m: 15000 }, "Current easy pace"],
    [{ current_easy_pace_sec_per_km: 360, current_race_pace_sec_per_km: null, current_long_run_target_m: 15000 }, "Current race pace"],
    [{ current_easy_pace_sec_per_km: 360, current_race_pace_sec_per_km: 300, current_long_run_target_m: null }, "Current long-run target"],
  ] as const)("names each missing athlete metric before reclassification: %s", async (missing, label) => {
    installFetch({ "GET /api/v1/settings": settings(missing) });
    render(<Harness initial={activity({ system_classification: "Recovery Run" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Reclassify" }));

    expect(await screen.findByText(new RegExp(`Classification profile incomplete: ${label}`))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "?tab=settings");
  });

  it("does not offer a founder-data write to Guest", () => {
    installFetch({});
    render(
      <AppModeContext.Provider value={GUEST_CAPABILITIES}>
        <Harness initial={activity({ system_classification: "Long Session" })} />
      </AppModeContext.Provider>,
    );

    for (const button of [
      screen.getByRole("button", { name: "Reclassify" }),
      screen.getByRole("button", { name: "Override classification" }),
    ]) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "Sign in to save this to your account.");
    }
    expect(screen.getByRole("combobox", { name: "Classification override" })).toBeDisabled();
  });
});
