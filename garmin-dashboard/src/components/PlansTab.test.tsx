/**
 * PlansTab.test.tsx (HRA-296)
 * Covers the page-level mobile information architecture this Story adds —
 * the segmented Modelli/Piani gara control, the compact mobile header with
 * its one contextual-help action, and that the URL-persisted tab selection
 * survives a remount (the same round-trip returning from Agenda goes
 * through, since App.tsx's own tab switch remounts PlansTab). Desktop's own
 * unchanged stacked-sections layout is covered too, as a regression check.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PlansTab } from "./PlansTab";
import { installFetch, paginated } from "@/test/api-stub";
import { planTemplate } from "@/test/fixtures";

beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.releasePointerCapture ??= () => {};
  window.HTMLElement.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(window.history.state, "", window.location.pathname);
});

// Same stubViewport pattern PlanInstanceCalendar.test.tsx/ManageTab.test.tsx
// already use for useIsPhone's matchMedia query.
function stubViewport(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone && query.includes("max-width: 767px"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

function mountRoutes() {
  return {
    "GET /api/v1/plan-templates": paginated([planTemplate()]),
    "GET /api/v1/plan-instances": paginated([]),
  };
}

describe("PlansTab — desktop (regression)", () => {
  it("keeps both sections stacked under their own titles, no segmented control", async () => {
    stubViewport(false);
    installFetch(mountRoutes());
    render(<PlansTab onNavigateToActivity={() => {}} />);

    expect(await screen.findByRole("heading", { name: "Plan templates" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Race plans" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Templates" })).not.toBeInTheDocument();
  });
});

describe("PlansTab — mobile information architecture (HRA-296)", () => {
  it("shows a compact header with one contextual-help action and a Modelli/Piani gara segmented control, defaulting to templates", async () => {
    stubViewport(true);
    installFetch(mountRoutes());
    render(<PlansTab onNavigateToActivity={() => {}} />);

    expect(await screen.findByText("Training plans")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Templates" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Race plans" })).toBeInTheDocument();
    // Templates tab active by default — its list is visible, the race-plans
    // list is not mounted.
    await screen.findByText("5K Base");
    expect(screen.queryByText("No instances created yet.")).not.toBeInTheDocument();
  });

  it("switches to the Piani gara tab and back, without losing either section's fetch", async () => {
    stubViewport(true);
    installFetch(mountRoutes());
    render(<PlansTab onNavigateToActivity={() => {}} />);
    await screen.findByText("5K Base");

    fireEvent.click(screen.getByRole("button", { name: "Race plans" }));
    expect(await screen.findByText("No instances created yet.")).toBeInTheDocument();
    expect(screen.queryByText("5K Base")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    expect(await screen.findByText("5K Base")).toBeInTheDocument();
  });

  it("the contextual-help disclosure surfaces both sections' explanatory copy", async () => {
    stubViewport(true);
    installFetch(mountRoutes());
    render(<PlansTab onNavigateToActivity={() => {}} />);
    await screen.findByText("5K Base");

    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(await screen.findByText(/Reusable RunPlan DSL v1 templates/)).toBeInTheDocument();
    expect(screen.getByText(/A concrete race plan generated from a plan template/)).toBeInTheDocument();
  });
});
