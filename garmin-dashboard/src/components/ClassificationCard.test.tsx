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

async function openAndPick(label: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "Classification override" }));
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

afterEach(() => vi.unstubAllGlobals());

describe("ClassificationCard", () => {
  it("shows the effective system category with icon+label and Runs Free provenance", async () => {
    const fetchMock = installFetch({ "GET /api/v1/settings": settings() });
    render(<Harness initial={activity({ system_classification: "long_run", system_explanation: "steady endurance effort" })} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/settings"), expect.anything()));
    expect(screen.getAllByText("Long run").length).toBeGreaterThan(0);
    expect(screen.getByText("Classified by Runs Free")).toBeInTheDocument();
    expect(screen.getByText("steady endurance effort")).toBeInTheDocument();
  });

  it("selecting a category in the dropdown persists it as a manual override immediately", async () => {
    const fetchMock = installFetch({
      "GET /api/v1/settings": settings(),
      [`PUT /api/v1/activities/${ID}/classification-override`]: json(activity({
        system_classification: "easy_recovery",
        manual_classification: "tempo",
      })),
    });
    render(<Harness initial={activity({ system_classification: "easy_recovery" })} />);

    await openAndPick("Tempo");

    expect(await screen.findByText("Classified by you")).toBeInTheDocument();
    expect(screen.getAllByText("Tempo").length).toBeGreaterThan(0);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/activities/${ID}/classification-override`),
      expect.objectContaining({ method: "PUT" }),
    ));
  });

  it("the dropdown lists exactly the seven canonical actual-running categories", async () => {
    installFetch({ "GET /api/v1/settings": settings() });
    render(<Harness initial={activity({ system_classification: "easy_recovery" })} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Classification override" }));
    const options = await screen.findAllByRole("option");
    expect(options.map(o => o.textContent)).toEqual([
      "Easy/Recovery", "Long run", "Intervals", "Progressive", "Threshold", "Tempo", "Tapasciata / Light Maintenance",
    ]);
  });

  it("a compact 'Use automatic classification' action restores the latest stored system result without reclassifying", async () => {
    const fetchMock = installFetch({
      "GET /api/v1/settings": settings(),
      [`DELETE /api/v1/activities/${ID}/classification-override`]: json(activity({
        system_classification: "long_run",
        manual_classification: null,
      })),
    });
    render(<Harness initial={activity({ system_classification: "long_run", manual_classification: "tempo" })} />);

    fireEvent.click(screen.getByRole("button", { name: "Use automatic classification" }));

    expect(await screen.findByText("Classified by Runs Free")).toBeInTheDocument();
    expect(screen.getAllByText("Long run").length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/classify"), expect.anything());
  });

  it("explicit recalculation preserves an existing manual override and states it uses current settings", async () => {
    const fetchMock = installFetch({
      "GET /api/v1/settings": settings(),
      [`POST /api/v1/activities/${ID}/classify`]: json(activity({
        system_classification: "progressive",
        manual_classification: "tempo",
      })),
    });
    render(<Harness initial={activity({ system_classification: "easy_recovery", manual_classification: "tempo" })} />);

    const recalc = screen.getByRole("button", { name: "Recalculate automatic classification" });
    expect(recalc).toHaveAttribute("title", expect.stringContaining("current training settings"));
    fireEvent.click(recalc);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/activities/${ID}/classify`),
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText("Classified by you")).toBeInTheDocument();
    expect(screen.getAllByText("Tempo").length).toBeGreaterThan(0);
  });

  it("names each missing athlete metric", async () => {
    installFetch({ "GET /api/v1/settings": settings({
      current_easy_pace_sec_per_km: null,
      current_race_pace_sec_per_km: 300,
      current_long_run_target_m: 15000,
    }) });
    render(<Harness initial={activity({ system_classification: "easy_recovery" })} />);

    expect(await screen.findByText(/Classification profile incomplete: Current easy pace/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings" })).toHaveAttribute("href", "?tab=settings");
  });

  it("does not offer a founder-data write to Guest", () => {
    installFetch({});
    render(
      <AppModeContext.Provider value={GUEST_CAPABILITIES}>
        <Harness initial={activity({ system_classification: "long_run" })} />
      </AppModeContext.Provider>,
    );

    expect(screen.getByRole("button", { name: "Recalculate automatic classification" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Classification override" })).toBeDisabled();
  });
});
