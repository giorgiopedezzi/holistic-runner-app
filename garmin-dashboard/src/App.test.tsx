/**
 * App.test.tsx  (HRA-67)
 * Tab switching across all five tabs, and the LOAD-BEARING unit-propagation
 * regression: a unit-system change made on the Settings tab must be reflected
 * on another tab after switching to it. This guards the conditional-render /
 * unmount-remount contract in App.tsx together with utils/units.ts's
 * module-scope unit system — see Epic HRA-65's load-bearing constraint and
 * CLAUDE.md ("tabs are conditionally rendered, not hidden"). If someone
 * "optimises" tabs to stay mounted, THIS test is what fails.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import App from "./App";
import { installFetch, paginated, json, problem, type Routes } from "@/test/api-stub";
import {
  activity, sportSummary, bodyMeasurement, settings, dateRange,
  deviceStatus, withingsStatus, stravaStatus, planTemplate,
} from "@/test/fixtures";
import { getUnitSystem, setUnitSystem } from "@/utils/units";
import { fmtDate } from "@/utils/fmt";

// A broad stub covering every endpoint any tab hits on mount, so tab switches
// render real content. `settingsBody` lets a test control the persisted units;
// a PUT to /settings/units flips it (used by the propagation test).
function appRoutes(settingsBody = settings()): Routes {
  return {
    "GET /api/v1/settings": settingsBody,
    "GET /api/v1/range": dateRange(),
    "GET /api/v1/summary": paginated([sportSummary({ sport: "running" })]),
    "GET /api/v1/activities": paginated([activity()], 1),
    "GET /api/v1/body-measurements": paginated([bodyMeasurement()]),
    "GET /api/v1/body-measurements/correlation": paginated([]),
    "GET /api/v1/body-measurements/range": dateRange(),
    "GET /api/v1/garmin/status": deviceStatus(),
    "GET /api/v1/withings/status": withingsStatus(),
    "GET /api/v1/strava/status": stravaStatus(),
    "GET /api/v1/activities/count": { count: 1 },
    "GET /api/v1/body-measurements/count": { count: 1 },
    "GET /api/v1/activities/trash": paginated([]),
    "GET /api/v1/body-measurements/trash": paginated([]),
    // HRA-248: "Your agenda" is now the default tab, so every mount fetches
    // this on render — a benign "no active plan today" default, same
    // reasoning as every other benign stub above.
    "GET /api/v1/plan-instances/active": problem(404, "no active plan"),
  };
}

// HRA-267: the sidebar's viewport tier is read from window.innerWidth at
// mount (desktop >=1024, tablet 768-1023, phone <768) and re-resolved on a
// "resize" event — jsdom doesn't lay pages out, so this is how tests drive
// each tier deterministically. jsdom's own default innerWidth (1024) is
// exactly the desktop threshold, which is why every pre-existing test above
// keeps passing unmodified.
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
  fireEvent(window, new Event("resize"));
}

afterEach(() => {
  vi.unstubAllGlobals();
  setUnitSystem("metric");
  // HRA-193: tab state now lives in the URL (history.replaceState), which
  // persists across tests sharing this jsdom window — reset it so a later
  // test doesn't inherit an earlier test's tab.
  window.history.replaceState(null, "", "/");
  // The sidebar collapse toggle persists to localStorage (direct feedback,
  // post-HRA-253) — reset it so a later test doesn't inherit an earlier
  // test's collapsed state.
  localStorage.removeItem("hra-sidebar-collapsed");
  // HRA-303: same reasoning — the feedback banner's dismissal choice
  // persists to localStorage too, and must not leak into a later test.
  localStorage.removeItem("hra-feedback-banner-dismissed-v1");
  // HRA-267: restore jsdom's own default viewport so a test that changed it
  // doesn't leak a non-desktop tier into the next test's initial mount.
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true, writable: true });
});

describe("App tab switching", () => {
  it("loads on the default 'Your agenda' tab, first in nav order, then mounts each other tab when clicked", async () => {
    installFetch(appRoutes());
    render(<App />);

    // HRA-248 AC1 (still true post-HRA-253): no tab URL param -> "Your
    // agenda" selected, first in the sidebar's Primary group.
    const nav = screen.getByRole("navigation");
    const navButtons = within(nav).getAllByRole("button");
    expect(navButtons[0]).toHaveTextContent("Your agenda");
    expect(navButtons[1]).toHaveTextContent("Training plans");
    expect(await screen.findByText("There is no active plan today.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Overview & Trends" }));
    // Longer timeout than the default 1000ms — the graph-first layout (main
    // graph + sidebar) now renders through a few more nested components
    // before settling, confirmed correct via manual inspection, just slower
    // to converge in this test environment.
    await waitFor(() => expect(document.body).toHaveTextContent("Avg distance"), { timeout: 5000 });

    fireEvent.click(screen.getByRole("button", { name: "Activities" }));
    expect(await screen.findByText(fmtDate("2026-08-01"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Body" }));
    expect(await screen.findByText(/Latest measurement/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Data & Sync" }));
    expect(await screen.findByText("Not connected to Strava")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByText("Appearance")).toBeInTheDocument();
  });

  it("renders exactly one nav landmark, grouped Primary/Review/Manage/utility, with the old horizontal header gone (HRA-253)", async () => {
    installFetch(appRoutes());
    const { container } = render(<App />);
    await screen.findByText("There is no active plan today.");

    // Exactly one nav landmark for the whole sidebar.
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    const nav = screen.getByRole("navigation");
    const navButtons = within(nav).getAllByRole("button");
    expect(navButtons.map(b => b.textContent)).toEqual([
      "Your agenda", "Training plans",
      "Overview & Trends", "Activities", "Body",
      "Data & Sync",
      "Settings", "Feedback",
    ]);

    // Review/Manage group headings are present and precede their items in
    // document order (Primary has no heading, per scope).
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("Manage")).toBeInTheDocument();

    // The old horizontal header/nav bar no longer renders anywhere.
    expect(container.querySelector(".hra-header")).not.toBeInTheDocument();
    expect(container.querySelector(".hra-nav")).not.toBeInTheDocument();
    expect(screen.queryByText("Garmin Stats")).not.toBeInTheDocument();
    // Scoped to the sidebar specifically — SplashScreen (HRA-223 follow-up)
    // also renders its own "Dreams run free" brand lockup, and both are in the DOM
    // simultaneously in this test environment (the splash never gets real
    // track data to autoplay/self-dismiss here), so an unscoped query would
    // match two elements.
    const sidebar = container.querySelector(".hra-sidebar");
    expect(sidebar).not.toBeNull();
    expect(within(sidebar as HTMLElement).getByText((_, el) => el?.textContent === "Dreams run free")).toBeInTheDocument();

    // Post-review feedback: the server-status dot was removed from the
    // sidebar entirely (no role="status" indicator renders anywhere), and
    // the language picker sits next to the brand instead of in a footer.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.querySelector(".hra-status-dot")).not.toBeInTheDocument();
  });

  it("collapses the sidebar to an icon-only rail on toggle, keeps each item's accessible name, and persists the choice across a remount", async () => {
    installFetch(appRoutes());
    const { container, unmount } = render(<App />);
    await screen.findByText("There is no active plan today.");

    const sidebar = () => container.querySelector(".hra-sidebar");
    expect(sidebar()).toHaveAttribute("data-collapsed", "false");
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    // A nav item's accessible name (from its visually-hidden label, not the
    // aria-hidden icon) is unaffected by collapse — same button, same name.
    const agendaButton = screen.getByRole("button", { name: "Your agenda" });

    fireEvent.click(toggle);

    expect(sidebar()).toHaveAttribute("data-collapsed", "true");
    expect(agendaButton).toHaveAccessibleName("Your agenda");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(localStorage.getItem("hra-sidebar-collapsed")).toBe("1");

    unmount();
    installFetch(appRoutes());
    const remounted = render(<App />);
    await screen.findByText("There is no active plan today.");

    // Remounting (a fresh page load, in effect) reads the persisted choice.
    expect(remounted.container.querySelector(".hra-sidebar")).toHaveAttribute("data-collapsed", "true");
  });

  it("marks exactly one sidebar item aria-current='page', matching the active tab, and updates it on click", async () => {
    installFetch(appRoutes());
    render(<App />);
    await screen.findByText("There is no active plan today.");

    const nav = screen.getByRole("navigation");
    const current = () => within(nav).getAllByRole("button").filter(b => b.getAttribute("aria-current") === "page");

    expect(current()).toHaveLength(1);
    expect(current()[0]).toHaveTextContent("Your agenda");

    fireEvent.click(screen.getByRole("button", { name: "Data & Sync" }));
    await screen.findByText("Not connected to Strava");

    expect(current()).toHaveLength(1);
    expect(current()[0]).toHaveTextContent("Data & Sync");
  });

  it("selects the matching sidebar item as current when a tab is opened directly via URL (?tab=body)", async () => {
    installFetch(appRoutes());
    window.history.replaceState(null, "", "/?tab=body");
    render(<App />);
    await screen.findByText(/Latest measurement/);

    const nav = screen.getByRole("navigation");
    const bodyButton = within(nav).getByRole("button", { name: "Body" });
    expect(bodyButton).toHaveAttribute("aria-current", "page");
  });

  it("preserves existing from/to/compareFrom/compareTo/compareEnabled query params on a sidebar navigation click", async () => {
    installFetch(appRoutes());
    window.history.replaceState(null, "", "/?from=2026-07-01&to=2026-07-31&compareFrom=2026-06-01&compareTo=2026-06-30&compareEnabled=true");
    render(<App />);
    await screen.findByText("There is no active plan today.");

    fireEvent.click(screen.getByRole("button", { name: "Data & Sync" }));
    await screen.findByText("Not connected to Strava");

    const params = new URLSearchParams(window.location.search);
    expect(params.get("tab")).toBe("manage");
    expect(params.get("from")).toBe("2026-07-01");
    expect(params.get("to")).toBe("2026-07-31");
    expect(params.get("compareFrom")).toBe("2026-06-01");
    expect(params.get("compareTo")).toBe("2026-06-30");
    expect(params.get("compareEnabled")).toBe("true");
  });
});

describe("responsive 3-state sidebar (HRA-267)", () => {
  it("AC1: at >=1024px the sidebar is open by default", async () => {
    setViewportWidth(1280);
    installFetch(appRoutes());
    const { container } = render(<App />);
    await screen.findByText("There is no active plan today.");

    expect(container.querySelector(".hra-sidebar")).toHaveAttribute("data-collapsed", "false");
  });

  it("AC2: at 768-1023px the sidebar defaults to icon-only, ignoring a persisted desktop 'open' choice", async () => {
    // Desktop's own persisted key explicitly says "not collapsed" (open) —
    // the tablet default must not read it (Story scope: no manual "open"
    // persistence carried over from desktop).
    localStorage.setItem("hra-sidebar-collapsed", "0");
    setViewportWidth(900);
    installFetch(appRoutes());
    const { container } = render(<App />);
    await screen.findByText("There is no active plan today.");

    const sidebar = container.querySelector(".hra-sidebar");
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(sidebar).toHaveAttribute("data-tier", "tablet");
  });

  it("AC3: at <768px the sidebar is hidden by default, opens via the hamburger as an overlay, and closes on outside-tap or nav pick", async () => {
    setViewportWidth(500);
    installFetch(appRoutes());
    const { container } = render(<App />);
    await screen.findByText("There is no active plan today.");

    const sidebar = () => container.querySelector(".hra-sidebar");
    expect(sidebar()).toHaveAttribute("data-collapsed", "hidden");
    expect(sidebar()).toHaveAttribute("data-tier", "phone");
    // No icon-only rail toggle at the phone tier.
    expect(screen.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument();

    const hamburger = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(hamburger);
    expect(sidebar()).toHaveAttribute("data-collapsed", "false");
    const backdrop = container.querySelector(".hra-sidebar-backdrop");
    expect(backdrop).not.toBeNull();

    // Outside-tap (the backdrop) closes it again.
    fireEvent.click(backdrop as Element);
    expect(sidebar()).toHaveAttribute("data-collapsed", "hidden");
    // HRA-303 AC4: focus returns to the trigger once the drawer closes.
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus();

    // Picking a nav item closes it too.
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(sidebar()).toHaveAttribute("data-collapsed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Data & Sync" }));
    await screen.findByText("Not connected to Strava");
    expect(sidebar()).toHaveAttribute("data-collapsed", "hidden");
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus();
  });

  it("AC4: crossing a tier boundary re-resolves to the new tier's default, discarding a manual choice made in the old tier", async () => {
    setViewportWidth(1280);
    installFetch(appRoutes());
    const { container } = render(<App />);
    await screen.findByText("There is no active plan today.");
    const sidebar = () => container.querySelector(".hra-sidebar");

    // Manually collapse on desktop.
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(sidebar()).toHaveAttribute("data-collapsed", "true");

    // Rotating down to phone width must not leave it obscuring content —
    // it re-resolves to phone's own hidden default, not desktop's icon choice.
    setViewportWidth(500);
    expect(sidebar()).toHaveAttribute("data-collapsed", "hidden");
    expect(sidebar()).toHaveAttribute("data-tier", "phone");

    // Crossing back up to desktop re-resolves from the persisted desktop
    // choice (still collapsed), not phone's hidden state.
    setViewportWidth(1280);
    expect(sidebar()).toHaveAttribute("data-collapsed", "true");
    expect(sidebar()).toHaveAttribute("data-tier", "desktop");
  });
});

describe("feedback banner (HRA-303)", () => {
  it("dismisses and stays dismissed across a remount, leaving no residual element", async () => {
    installFetch(appRoutes());
    const { container, unmount } = render(<App />);
    await screen.findByText("There is no active plan today.");

    expect(screen.getByRole("button", { name: "Close feedback message" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close feedback message" }));
    expect(screen.queryByRole("button", { name: "Close feedback message" })).not.toBeInTheDocument();
    // No residual empty spacer once dismissed — the banner element itself
    // is gone, not just visually hidden.
    expect(container.querySelector(".hra-feedback-banner")).toBeNull();

    unmount();
    installFetch(appRoutes());
    render(<App />);
    await screen.findByText("There is no active plan today.");
    expect(screen.queryByRole("button", { name: "Close feedback message" })).not.toBeInTheDocument();
  });

  it("at phone width, is not sticky and renders below the in-flow mobile header carrying the nav trigger", async () => {
    setViewportWidth(500);
    installFetch(appRoutes());
    const { container } = render(<App />);
    await screen.findByText("There is no active plan today.");

    const header = container.querySelector(".hra-mobile-header");
    const banner = container.querySelector(".hra-feedback-banner");
    expect(header).not.toBeNull();
    expect(banner).not.toBeNull();
    // The header carries the nav trigger and comes first in document order,
    // directly above the banner — normal flow, not an overlapping layer.
    expect(header?.contains(screen.getByRole("button", { name: "Open navigation" }))).toBe(true);
    expect(header?.compareDocumentPosition(banner as Element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe("unit-system propagation across tabs (load-bearing)", () => {
  it("reflects a metric→imperial change on another tab after switching to it", async () => {
    const fetchMock = installFetch({
      ...appRoutes(settings({ unit_system: "metric" })),
      // Flipping units returns the imperial settings; useAppearance applies it
      // to the module-scope unit system via setUnitSystem.
      "PUT /api/v1/settings/units": json(settings({ unit_system: "imperial" })),
    });
    render(<App />);

    // HRA-248: "Your agenda", not Overview, is the default tab now — switch
    // to Overview first to exercise the same propagation path as before.
    fireEvent.click(await screen.findByRole("button", { name: "Overview & Trends" }));
    // Overview shows the running avg-pace unit label in metric. Longer
    // timeout — see the same note above.
    await waitFor(() => expect(document.body).toHaveTextContent("min/km"), { timeout: 5000 });
    expect(screen.queryByText("min/mi")).not.toBeInTheDocument();

    // Switch to Settings and choose Imperial. The save is async, so wait until
    // the (module-scope) unit system has actually flipped before switching
    // tabs — otherwise Overview would remount while units were still metric.
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    // Settings sections are accordion cards now — expand "Units" first.
    fireEvent.click(await screen.findByRole("button", { name: /^Units/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Imperial (mi, lb)" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/settings/units"), expect.objectContaining({ method: "PUT" })),
    );
    await waitFor(() => expect(getUnitSystem()).toBe("imperial"));

    // Switch back to Overview — the tab remounts and re-reads the (now
    // imperial) module unit system.
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Overview & Trends" }));
    await waitFor(() => expect(screen.getByText("min/mi")).toBeInTheDocument());
    expect(screen.queryByText("min/km")).not.toBeInTheDocument();
  });
});

// Field labels here are a plain sibling <span>, not a real <label htmlFor>
// (same PlanInstancesSection.test.tsx helper, reused here since this is the
// one place App.test.tsx reaches inside that editor's own form fields).
function fieldControl(label: string): HTMLElement {
  const labelEl = screen.getByText(new RegExp(`^${label}`), { selector: ".hra-field-label" });
  const wrapper = labelEl.closest("div")!;
  const control = wrapper.querySelector("input, button, [role='combobox']");
  if (!control) throw new Error(`No control found for field "${label}"`);
  return control as HTMLElement;
}

describe("in-app navigation guard for an unsaved race-plan instance (HRA-281 AC2)", () => {
  it("blocks a sidebar tab switch while the new-instance draft is dirty, then navigates once confirmed", async () => {
    installFetch({
      ...appRoutes(),
      "GET /api/v1/plan-templates": paginated([planTemplate()]),
      "GET /api/v1/plan-instances": paginated([]),
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Training plans" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create race plan" }));
    fireEvent.change(fieldControl("Name"), { target: { value: "My race plan" } });

    // Clicking away to a different tab must NOT navigate yet — it opens the
    // unsaved-work confirmation instead.
    fireEvent.click(screen.getByRole("button", { name: "Your agenda" }));
    expect(await screen.findByText("You have unsaved changes. Leave and discard them?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Training plans" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(screen.getByRole("button", { name: "Discard and leave" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Your agenda" })).toHaveAttribute("aria-current", "page"));
  });

  it("does not block navigation once the draft is clean again", async () => {
    installFetch({
      ...appRoutes(),
      "GET /api/v1/plan-templates": paginated([planTemplate()]),
      "GET /api/v1/plan-instances": paginated([]),
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Training plans" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create race plan" }));
    fireEvent.change(fieldControl("Name"), { target: { value: "My race plan" } });
    fireEvent.change(fieldControl("Name"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Your agenda" }));
    expect(screen.queryByText("You have unsaved changes. Leave and discard them?")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Your agenda" })).toHaveAttribute("aria-current", "page"));
  });
});
