/**
 * ActivitiesTab.test.tsx  (HRA-67)
 * Behaviour-level: paged list, range-empty, and error states.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ActivitiesTab } from "./ActivitiesTab";
import { installFetch, problem, paginated } from "@/test/api-stub";
import { activity, dateRange, settings, REFERENCE_ACTIVITY_ID as ID } from "@/test/fixtures";
import { setUnitSystem } from "@/utils/units";
import { fmtDate } from "@/utils/fmt";

afterEach(() => {
  vi.unstubAllGlobals();
  setUnitSystem("metric");
  window.history.replaceState(null, "", "/");
});

describe("ActivitiesTab", () => {
  it("renders a page of activities on success", async () => {
    installFetch({
      "GET /api/v1/activities": paginated([activity()], 1),
      "GET /api/v1/range": dateRange(),
      "GET /api/v1/settings": settings(),
    });
    render(<ActivitiesTab from="2026-07-15" to="2026-08-14" />);

    expect(await screen.findByText(fmtDate("2026-08-01"))).toBeInTheDocument();
    expect(screen.getByText("10.00 km")).toBeInTheDocument();
    // Pagination renders above and below the list, so the total appears twice.
    expect(screen.getAllByText(/1 total/).length).toBeGreaterThan(0);
  });

  it("shows the range-empty message when the page is empty", async () => {
    installFetch({
      "GET /api/v1/activities": paginated([], 0),
      "GET /api/v1/range": dateRange(),
      "GET /api/v1/settings": settings(),
    });
    render(<ActivitiesTab from="2026-07-15" to="2026-08-14" />);

    expect(await screen.findByText(/No activities in the selected range/i)).toBeInTheDocument();
  });

  it("surfaces the API error message on failure", async () => {
    installFetch({
      "GET /api/v1/activities": () => problem(503, "activities unavailable"),
      "GET /api/v1/range": dateRange(),
      "GET /api/v1/settings": settings(),
    });
    render(<ActivitiesTab from="2026-07-15" to="2026-08-14" />);

    // 503 is remapped to the gateway-busy message by the real client (HRA-43).
    expect(await screen.findByText(/Couldn't reach the API server/i)).toBeInTheDocument();
  });

  describe("expanded row URL persistence (HRA-194)", () => {
    it("writes the expanded row's id into the URL on click, and clears it on collapse", async () => {
      installFetch({
        "GET /api/v1/activities": paginated([activity()], 1),
        "GET /api/v1/range": dateRange(),
        "GET /api/v1/settings": settings(),
      });
      render(<ActivitiesTab from="2026-07-15" to="2026-08-14" />);
      await screen.findByText(fmtDate("2026-08-01"));

      const row = document.querySelector('[data-expanded="false"]')!;
      fireEvent.click(row);
      expect(new URLSearchParams(window.location.search).get("activityId")).toBe(String(ID));

      fireEvent.click(document.querySelector('[data-expanded="true"]')!);
      // useUrlState.set("") writes the param as an empty string rather than
      // removing it, matching the hook's documented merge-not-overwrite behavior.
      expect(new URLSearchParams(window.location.search).get("activityId")).toBe("");
    });

    it("hydrates the expanded row from an existing activityId URL param on mount", async () => {
      window.history.replaceState(null, "", `/?activityId=${ID}`);
      installFetch({
        "GET /api/v1/activities": paginated([activity()], 1),
        "GET /api/v1/range": dateRange(),
        "GET /api/v1/settings": settings(),
      });
      render(<ActivitiesTab from="2026-07-15" to="2026-08-14" />);
      await screen.findByText(fmtDate("2026-08-01"));

      expect(document.querySelector('[data-expanded="true"]')).toBeInTheDocument();
    });

    it("does not wipe a URL-hydrated expanded row on initial mount, but clears it on a later range change", async () => {
      window.history.replaceState(null, "", `/?activityId=${ID}`);
      installFetch({
        "GET /api/v1/activities": paginated([activity()], 1),
        "GET /api/v1/range": dateRange(),
        "GET /api/v1/settings": settings(),
      });
      const { rerender } = render(<ActivitiesTab from="2026-07-15" to="2026-08-14" />);
      await screen.findByText(fmtDate("2026-08-01"));

      // Survives the initial mount's own from/to effect run.
      expect(document.querySelector('[data-expanded="true"]')).toBeInTheDocument();

      // A genuine user-driven range change still clears it.
      rerender(<ActivitiesTab from="2026-07-01" to="2026-08-14" />);
      await screen.findByText(fmtDate("2026-08-01"));
      expect(document.querySelector('[data-expanded="false"]')).toBeInTheDocument();
      expect(new URLSearchParams(window.location.search).get("activityId")).toBe("");
    });
  });

  describe("page/perPage URL persistence (HRA-196)", () => {
    it("writes the page into the URL when the user navigates to the next page", async () => {
      installFetch({
        "GET /api/v1/activities": paginated([activity()], 30), // 30 total / 25 perPage = 2 pages
        "GET /api/v1/range": dateRange(),
        "GET /api/v1/settings": settings(),
      });
      render(<ActivitiesTab from="2026-07-15" to="2026-08-14" />);
      await screen.findByText(fmtDate("2026-08-01"));

      fireEvent.click(screen.getAllByRole("button", { name: "›" })[0]);
      // Clicking triggers a refetch for the new page (async), so wait for it
      // to settle rather than asserting synchronously.
      await waitFor(() => expect(new URLSearchParams(window.location.search).get("activitiesPage")).toBe("2"));
    });

    it("hydrates the page from an existing activitiesPage URL param on mount, requesting the matching offset", async () => {
      window.history.replaceState(null, "", "/?activitiesPage=2");
      const fetchMock = installFetch({
        "GET /api/v1/activities": paginated([activity()], 30),
        "GET /api/v1/range": dateRange(),
        "GET /api/v1/settings": settings(),
      });
      render(<ActivitiesTab from="2026-07-15" to="2026-08-14" />);
      await screen.findByText(fmtDate("2026-08-01"));

      const activitiesCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/v1/activities?"));
      const requestedUrl = new URL(String(activitiesCall![0]));
      expect(requestedUrl.searchParams.get("offset")).toBe("25"); // (page 2 - 1) * default perPage 25
    });

    it("does not wipe a URL-hydrated page on initial mount, but resets it to 1 on a later range change", async () => {
      window.history.replaceState(null, "", "/?activitiesPage=2");
      installFetch({
        "GET /api/v1/activities": paginated([activity()], 30),
        "GET /api/v1/range": dateRange(),
        "GET /api/v1/settings": settings(),
      });
      const { rerender } = render(<ActivitiesTab from="2026-07-15" to="2026-08-14" />);
      await screen.findByText(fmtDate("2026-08-01"));

      // Survives the initial mount's own from/to/perPage effect run.
      expect(new URLSearchParams(window.location.search).get("activitiesPage")).toBe("2");

      // A genuine user-driven range change still resets it.
      rerender(<ActivitiesTab from="2026-07-01" to="2026-08-14" />);
      await screen.findByText(fmtDate("2026-08-01"));
      expect(new URLSearchParams(window.location.search).get("activitiesPage")).toBe("1");
    });

    it("clamps a URL-hydrated page that's beyond the real total (existing clamp behavior)", async () => {
      window.history.replaceState(null, "", "/?activitiesPage=5");
      installFetch({
        "GET /api/v1/activities": paginated([activity()], 30), // only 2 real pages at 25/page
        "GET /api/v1/range": dateRange(),
        "GET /api/v1/settings": settings(),
      });
      render(<ActivitiesTab from="2026-07-15" to="2026-08-14" />);
      await screen.findByText(fmtDate("2026-08-01"));

      expect(new URLSearchParams(window.location.search).get("activitiesPage")).toBe("2");
    });
  });
});
