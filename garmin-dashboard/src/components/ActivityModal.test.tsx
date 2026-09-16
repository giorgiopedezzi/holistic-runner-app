/**
 * ActivityModal.test.tsx  (HRA-67)
 * ActivityDetailBody — the detail content shared by the accordion and the
 * popup. Covers the loading→content transition, the soft-delete confirm flow
 * (DELETE + onDelete callback), and the error state. Uses a ≤5-point track so
 * the >5-point chart is skipped — assertions stay on the stat grid (Max HR is
 * the one HR badge left there; Avg HR moved inside the graph) plus the
 * "not enough data" message that stands in for the graph (and the
 * Distance/Speed-Pace/Avg HR KPIs that live inside it).
 *
 * Dashboard design-system rework ("keep every information at accordion
 * wrap-up level"): ActivityDetailBody's own header (and its Delete button)
 * now renders ONLY for the popup variant (onClose passed) — the accordion
 * case gets all of this from ActivityRow instead (see ActivityRow.test.tsx
 * for that flow). The soft-delete test below passes onClose to exercise the
 * still-real popup path.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ActivityDetailBody } from "./ActivityModal";
import { installFetch, json, paginated, problem } from "@/test/api-stub";
import { activity, shortTrack, longTrack, settings, REFERENCE_ACTIVITY_ID as ID } from "@/test/fixtures";
import { setUnitSystem } from "@/utils/units";
import { AppModeContext, GUEST_CAPABILITIES } from "@/hooks/useAppMode";

afterEach(() => {
  vi.unstubAllGlobals();
  setUnitSystem("metric");
});

describe("ActivityDetailBody", () => {
  it("renders the stat grid once the activity + track load", async () => {
    installFetch({
      [`GET /api/v1/activities/${ID}`]: activity(),
      [`GET /api/v1/activities/${ID}/track`]: shortTrack(),
      "GET /api/v1/settings": settings(),
    });
    render(<ActivityDetailBody activityId={ID} onDelete={vi.fn()} />);

    // Stat splits its value into a value div + a smaller inline unit span
    // (ui/Stat.tsx's splitUnit) — match on the div's full textContent rather
    // than a single text node.
    const byExactDivText = (text: string) => (_: string, node: Element | null) =>
      node?.tagName.toLowerCase() === "div" && node.textContent === text;
    expect(await screen.findByText(byExactDivText("171 bpm"))).toBeInTheDocument(); // Max HR
    // Distance/Speed-Pace/Avg HR moved inside the graph (dashboard
    // design-system rework) — shortTrack() is ≤5 points, so the graph
    // itself is skipped and this "not enough data" message is the one
    // place that stands in for them, not a StatGrid value.
    expect(screen.getByText("Not enough track data to plot a chart.")).toBeInTheDocument();
  });

  it("soft-deletes on confirm and calls onDelete with the id", async () => {
    const onDelete = vi.fn();
    installFetch({
      [`GET /api/v1/activities/${ID}`]: activity(),
      [`GET /api/v1/activities/${ID}/track`]: shortTrack(),
      "GET /api/v1/settings": settings(),
      [`DELETE /api/v1/activities/${ID}`]: json({ deleted: 1 }),
    });
    render(<ActivityDetailBody activityId={ID} onDelete={onDelete} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /Remove activity/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Yes, delete/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(ID));
  });

  it("Guest (cannot persist): the popup header's Delete button is disabled with sign-in messaging, not a raw protected-API failure (HRA-375)", async () => {
    installFetch({
      [`GET /api/v1/activities/${ID}`]: activity(),
      [`GET /api/v1/activities/${ID}/track`]: shortTrack(),
      "GET /api/v1/settings": settings(),
      "GET /api/v1/activity-types": paginated([]),
    });
    render(
      <AppModeContext.Provider value={GUEST_CAPABILITIES}>
        <ActivityDetailBody activityId={ID} onDelete={vi.fn()} onClose={vi.fn()} />
      </AppModeContext.Provider>,
    );

    const remove = await screen.findByRole("button", { name: /Remove activity/i });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute("title", "Sign in to save this to your account.");
  });

  it("surfaces the API error message when the activity fails to load", async () => {
    installFetch({
      [`GET /api/v1/activities/${ID}`]: () => problem(500, "activity load failed"),
      [`GET /api/v1/activities/${ID}/track`]: shortTrack(),
      "GET /api/v1/settings": settings(),
    });
    render(<ActivityDetailBody activityId={ID} onDelete={vi.fn()} />);

    expect(await screen.findByText("activity load failed")).toBeInTheDocument();
  });
});

function stubPhoneWidth(isPhone: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: isPhone,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("ActivityDetailBody phone-width KPI rows and overflow menu (HRA-291, revised HRA-303)", () => {
  it("renders metrics as a two-column grid with concise labels, not bordered mini-cards, at phone width", async () => {
    stubPhoneWidth(true);
    installFetch({
      [`GET /api/v1/activities/${ID}`]: activity(),
      [`GET /api/v1/activities/${ID}/track`]: shortTrack(),
      "GET /api/v1/settings": settings(),
    });
    const { container } = render(<ActivityDetailBody activityId={ID} onDelete={vi.fn()} />);

    await waitFor(() => expect(container.querySelector(".hra-activity-metrics-grid-mobile")).toBeInTheDocument());
    // HRA-303 corrective round section 3: a fixed 3-row/2-column grid (6
    // cells), value-first with a short trailing label on the same line —
    // not Stat's label-first row layout, and not the bordered StatGrid.
    const cells = container.querySelectorAll(".hra-activity-metrics-grid-cell");
    expect(cells).toHaveLength(6);
    const maxHrCell = screen.getByText("max HR").closest(".hra-activity-metrics-grid-cell");
    expect(maxHrCell).toHaveTextContent("171");
    expect(container.querySelector(".hra-stat-grid")).not.toBeInTheDocument();
    expect(container.querySelector(".hra-fact-row-stat")).not.toBeInTheDocument();
  });

  it("collapses the popup header's type/rename/delete controls into one overflow menu at phone width", async () => {
    stubPhoneWidth(true);
    const onDelete = vi.fn();
    const onClose = vi.fn();
    installFetch({
      [`GET /api/v1/activities/${ID}`]: activity(),
      [`GET /api/v1/activities/${ID}/track`]: shortTrack(),
      "GET /api/v1/settings": settings(),
      [`DELETE /api/v1/activities/${ID}`]: json({ deleted: 1 }),
    });
    render(<ActivityDetailBody activityId={ID} onDelete={onDelete} onClose={onClose} />);

    const trigger = await screen.findByRole("button", { name: "Activity actions" });
    expect(screen.queryByRole("button", { name: "Remove activity" })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Remove activity" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, delete" }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(ID));
    expect(onClose).toHaveBeenCalled();
  });
});

// HRA-357: the chart-card header's key-facts group. `longTrack()` fixture
// points all have `stamina: null` — mapping the last point's value is enough
// to exercise "a valid final sample exists" vs. "no valid sample at all"
// without needing a bespoke track fixture.
function trackWithFinalStamina(value: number | null) {
  const points = longTrack();
  return points.map((p, i) => (i === points.length - 1 ? { ...p, stamina: value } : p));
}

describe("ActivityChartSection key-facts group (HRA-357)", () => {
  it("orders Distance, selected Pace/Speed, Avg HR, then Final stamina, with Final stamina omitted when no valid Stamina sample exists", async () => {
    installFetch({
      [`GET /api/v1/activities/${ID}`]: activity(),
      [`GET /api/v1/activities/${ID}/track`]: longTrack(), // stamina: null throughout
      "GET /api/v1/settings": settings(),
    });
    const { container } = render(<ActivityDetailBody activityId={ID} onDelete={vi.fn()} />);

    await waitFor(() => expect(container.querySelector(".hra-activity-chart-kpis")).toBeInTheDocument());
    const labels = Array.from(container.querySelectorAll(".hra-activity-chart-kpis .hra-graph-kpi-label"))
      .map(el => el.textContent);
    expect(labels).toEqual(["Distance", "Speed", "Avg HR"]);
    expect(screen.queryByText("Final stamina")).not.toBeInTheDocument();
  });

  it("shows Final stamina immediately after Avg HR when a valid sample exists, including a genuine 0%", async () => {
    installFetch({
      [`GET /api/v1/activities/${ID}`]: activity(),
      [`GET /api/v1/activities/${ID}/track`]: trackWithFinalStamina(0),
      "GET /api/v1/settings": settings(),
    });
    const { container } = render(<ActivityDetailBody activityId={ID} onDelete={vi.fn()} />);

    await waitFor(() => expect(screen.queryByText("Final stamina")).toBeInTheDocument());
    const labels = Array.from(container.querySelectorAll(".hra-activity-chart-kpis .hra-graph-kpi-label"))
      .map(el => el.textContent);
    expect(labels).toEqual(["Distance", "Speed", "Avg HR", "Final stamina"]);
    const staminaCard = screen.getByText("Final stamina").closest(".hra-graph-kpi");
    expect(staminaCard).toHaveTextContent("0");
    expect(staminaCard).toHaveTextContent("%");
  });

  it("reflects the selected Pace/Speed mode in the key-facts group's second slot", async () => {
    installFetch({
      [`GET /api/v1/activities/${ID}`]: activity(),
      [`GET /api/v1/activities/${ID}/track`]: trackWithFinalStamina(55),
      "GET /api/v1/settings": settings(),
    });
    const { container } = render(<ActivityDetailBody activityId={ID} onDelete={vi.fn()} />);

    await waitFor(() => expect(container.querySelector(".hra-activity-chart-kpis")).toBeInTheDocument());
    expect(Array.from(container.querySelectorAll(".hra-activity-chart-kpis .hra-graph-kpi-label")).map(el => el.textContent))
      .toEqual(["Distance", "Speed", "Avg HR", "Final stamina"]);

    fireEvent.click(screen.getByRole("button", { name: "Pace (mm:ss)" }));

    await waitFor(() => expect(Array.from(container.querySelectorAll(".hra-activity-chart-kpis .hra-graph-kpi-label")).map(el => el.textContent))
      .toEqual(["Distance", "Pace", "Avg HR", "Final stamina"]));
  });

  it("wraps the key-facts group into a two-column grid at phone width", async () => {
    stubPhoneWidth(true);
    installFetch({
      [`GET /api/v1/activities/${ID}`]: activity(),
      [`GET /api/v1/activities/${ID}/track`]: trackWithFinalStamina(42),
      "GET /api/v1/settings": settings(),
    });
    const { container } = render(<ActivityDetailBody activityId={ID} onDelete={vi.fn()} />);

    await waitFor(() => expect(container.querySelector(".hra-activity-chart-kpis--wrap-grid")).toBeInTheDocument());
    const labels = Array.from(container.querySelectorAll(".hra-activity-chart-kpis--wrap-grid .hra-graph-kpi-label"))
      .map(el => el.textContent);
    expect(labels).toEqual(["Distance", "Speed", "Avg HR", "Final stamina"]);
  });
});

describe("ActivityChartSection pause-threshold input (fix: could not clear, no debounce)", () => {
  afterEach(() => vi.useRealTimers());

  it("can be cleared to an empty field instead of snapping back to 0, and debounces the expensive commit", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFetch({
      [`GET /api/v1/activities/${ID}`]: activity(),
      [`GET /api/v1/activities/${ID}/track`]: longTrack(),
      "GET /api/v1/settings": settings(),
    });
    render(<ActivityDetailBody activityId={ID} onDelete={vi.fn()} />);

    const input = await screen.findByDisplayValue("30") as HTMLInputElement;

    // The pre-fix input was `value={pauseThreshold}` with
    // `onChange={e => setPauseThreshold(Math.max(0, Number(e.target.value)))}`
    // — clearing it computed Number("") === 0, which the very next render
    // fed straight back in as the controlled value, so the field could never
    // actually go empty. It must now be able to.
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");

    // Typing continues to reflect immediately in the field...
    fireEvent.change(input, { target: { value: "45" } });
    expect(input.value).toBe("45");

    // ...but the expensive commit (ActivityDetailBody's `pauses` useMemo,
    // which re-scans the whole track) is debounced, not fired per keystroke
    // — advancing past the debounce window is what actually commits it.
    await act(() => vi.advanceTimersByTimeAsync(500));
    await waitFor(() => expect((screen.getByDisplayValue("45") as HTMLInputElement).value).toBe("45"));
  });
});
