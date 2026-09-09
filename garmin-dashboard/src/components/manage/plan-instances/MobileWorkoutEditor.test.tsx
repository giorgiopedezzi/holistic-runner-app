/**
 * MobileWorkoutEditor.test.tsx (HRA-300)
 * Characterization/behavior net for the mobile full-screen workout editor —
 * mounted standalone (not through PlanInstanceCalendar) since its own
 * contract (type-switch confirm, live validation/preview, Save/Cancel,
 * unsaved-change guards) doesn't depend on the calendar around it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MobileWorkoutEditor } from "./MobileWorkoutEditor";
import { apiDaysToSections } from "./planInstanceEditor.mappers";
import { installFetch, json, problem } from "@/test/api-stub";
import { planInstanceDay } from "@/test/fixtures";
import type { PlanInstanceDay } from "@/types/api";

const INSTANCE_ID = 10;

function dayViewFor(overrides: Partial<PlanInstanceDay> = {}) {
  return apiDaysToSections([planInstanceDay(overrides)])[0].weeks[0].days[0];
}

async function advanceDebounce() {
  await act(() => vi.advanceTimersByTimeAsync(500));
}

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(window.history.state, "", window.location.pathname);
});

describe("MobileWorkoutEditor", () => {
  it("renders full-screen (a dialog, not a small textarea in a card) with the day's date and current DSL", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFetch({});
    render(<MobileWorkoutEditor day={dayViewFor()} instanceId={INSTANCE_ID} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Instance days carry only resolved (concrete-pace) DSL, never the
    // template's own symbolic anchor text (docs/runplan-dsl.md) — the
    // fixture's continuous segment (RG @ 330 sec/km) reconstructs as this.
    expect(screen.getByDisplayValue(/5km @ 5:30\/km/)).toBeInTheDocument();
  });

  it("shows a resolved-pace preview once the initial DSL validates", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFetch({
      [`POST /api/v1/plan-instances/${INSTANCE_ID}/days/100/validate`]: json({
        needs_review: false, warnings: [], workout_type: "run",
        segments: [{ type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, resolved_pace_sec_per_km: 330, raw: "5km @ RG" }],
      }),
    });
    render(<MobileWorkoutEditor day={dayViewFor()} instanceId={INSTANCE_ID} onClose={vi.fn()} onSaved={vi.fn()} />);
    await advanceDebounce();
    await waitFor(() => expect(screen.getByText("Preview").nextElementSibling).toHaveTextContent("5km @ 5:30/km"));
    expect(screen.getByRole("button", { name: /^Save/ })).toBeEnabled();
  });

  it("blocks Save on invalid syntax and shows the parser's own warning", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFetch({
      [`POST /api/v1/plan-instances/${INSTANCE_ID}/days/100/validate`]: json({
        needs_review: true, warnings: [{ line: 1, content: "5km @ ???", message: "Unrecognized intensity token." }],
      }),
    });
    render(<MobileWorkoutEditor day={dayViewFor()} instanceId={INSTANCE_ID} onClose={vi.fn()} onSaved={vi.fn()} />);
    const textarea = screen.getByLabelText("Workout plan text (DSL)");
    fireEvent.change(textarea, { target: { value: "5km @ ???" } });
    await advanceDebounce();
    expect(await screen.findByText("Unrecognized intensity token.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Save/ })).toBeDisabled();
  });

  it("rejects an unresolved symbolic pace anchor the same way (needs_review, no silent resolution) — Save stays blocked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFetch({
      [`POST /api/v1/plan-instances/${INSTANCE_ID}/days/100/validate`]: json({
        needs_review: true, warnings: [{ line: 1, content: "5km @ MP", message: "Unresolved pace anchor: MP" }],
      }),
    });
    render(<MobileWorkoutEditor day={dayViewFor()} instanceId={INSTANCE_ID} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Workout plan text (DSL)"), { target: { value: "5km @ MP" } });
    await advanceDebounce();
    expect(await screen.findByText("Unresolved pace anchor: MP")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Save/ })).toBeDisabled();
  });

  it("blocks Save on an empty RUN workout before ever calling the API", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const validate = installFetch({});
    render(<MobileWorkoutEditor day={dayViewFor()} instanceId={INSTANCE_ID} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Workout plan text (DSL)"), { target: { value: "   " } });
    await advanceDebounce();
    expect(await screen.findByText("Enter a workout, or switch to Rest/Other.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Save/ })).toBeDisabled();
    expect(validate).not.toHaveBeenCalled();
  });

  it("switching to Rest asks for confirmation, then replaces the body with the bare REST token, local-only", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFetch({
      [`POST /api/v1/plan-instances/${INSTANCE_ID}/days/100/validate`]: json({
        needs_review: false, warnings: [], workout_type: "rest", segments: [],
      }),
    });
    render(<MobileWorkoutEditor day={dayViewFor()} instanceId={INSTANCE_ID} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Rest" }));
    expect(await screen.findByText(/Set.*Rest.*replaces the current workout text/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const textarea = screen.getByLabelText("Workout plan text (DSL)") as HTMLTextAreaElement;
    expect(textarea.value).toBe("REST");
    await advanceDebounce();
  });

  it("saves through the per-day PATCH pipeline and reports the persisted result", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const saved = planInstanceDay({ customized_at: "2026-09-10T00:00:00Z" });
    installFetch({
      [`POST /api/v1/plan-instances/${INSTANCE_ID}/days/100/validate`]: json({
        needs_review: false, warnings: [], workout_type: "run",
        segments: [{ type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, resolved_pace_sec_per_km: 330, raw: "5km @ RG" }],
      }),
      [`PATCH /api/v1/plan-instances/${INSTANCE_ID}/days/100`]: (req: { body: unknown }) => {
        expect(req.body).toEqual({ dsl: "D1: 5km @ 5:30/km" });
        return json(saved);
      },
    });
    render(<MobileWorkoutEditor day={dayViewFor()} instanceId={INSTANCE_ID} onClose={onClose} onSaved={onSaved} />);
    await advanceDebounce();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Save/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(onClose).toHaveBeenCalled();
  });

  it("on a persistence failure, keeps the draft open and reports the error instead of a false saved state", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onSaved = vi.fn();
    const onClose = vi.fn();
    installFetch({
      [`POST /api/v1/plan-instances/${INSTANCE_ID}/days/100/validate`]: json({
        needs_review: false, warnings: [], workout_type: "run",
        segments: [{ type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, resolved_pace_sec_per_km: 330, raw: "5km @ RG" }],
      }),
      [`PATCH /api/v1/plan-instances/${INSTANCE_ID}/days/100`]: () => problem(422, "dsl must not be blank."),
    });
    render(<MobileWorkoutEditor day={dayViewFor()} instanceId={INSTANCE_ID} onClose={onClose} onSaved={onSaved} />);
    await advanceDebounce();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Save/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    expect(await screen.findByText("dsl must not be blank.")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Cancel with no unsaved change closes immediately, no confirmation", () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();
    installFetch({});
    render(<MobileWorkoutEditor day={dayViewFor()} instanceId={INSTANCE_ID} onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Cancel with an unsaved change requires an explicit discard decision", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();
    installFetch({
      [`POST /api/v1/plan-instances/${INSTANCE_ID}/days/100/validate`]: json({ needs_review: true, warnings: [] }),
    });
    render(<MobileWorkoutEditor day={dayViewFor()} instanceId={INSTANCE_ID} onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Workout plan text (DSL)"), { target: { value: "5km @ RG # long" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText("Discard your changes?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();
    await advanceDebounce();
  });

  it("an accidental browser/hardware back while dirty is intercepted and asks to discard, rather than exiting silently", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();
    installFetch({
      [`POST /api/v1/plan-instances/${INSTANCE_ID}/days/100/validate`]: json({ needs_review: true, warnings: [] }),
    });
    render(<MobileWorkoutEditor day={dayViewFor()} instanceId={INSTANCE_ID} onClose={onClose} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Workout plan text (DSL)"), { target: { value: "5km @ RG # long" } });

    act(() => window.history.back());
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText("Discard your changes?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();
    await advanceDebounce();
  });
});
