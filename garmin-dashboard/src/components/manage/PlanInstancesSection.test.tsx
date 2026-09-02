/**
 * PlanInstancesSection.test.tsx (HRA-166)
 * Characterization net for PlanInstancesSection.tsx — extends FE-0.2's
 * (HRA-67) established pattern (installFetch keeping the real api/client.ts
 * in the loop, Vitest + RTL + jsdom) to this file, which postdates FE-0.2's
 * original audit. This baseline is what FE-4.2 through FE-4.6 (HRA-65's
 * internal component split) must hold assertion-identical.
 *
 * Every assertion targets observable behaviour (rendered text, button
 * enablement, API calls) — never internal state or a file location.
 *
 * Total test count: 17 — the baseline FE-4.2-FE-4.6 must hold
 * assertion-identical (Story AC).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PlanInstancesSection } from "./PlanInstancesSection";
import { installFetch, json, paginated, type Routes } from "@/test/api-stub";
import { planTemplate, planInstance, planInstanceDay } from "@/test/fixtures";
import { instanceDayDateLabel } from "@/utils/fmt";
import type { PlanInstanceDay } from "@/types/api";

// Radix Select (the Template picker) calls these during pointer interaction —
// jsdom implements neither, so an unstubbed click on the trigger throws.
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.releasePointerCapture ??= () => {};
  window.HTMLElement.prototype.scrollIntoView ??= () => {};
});

afterEach(() => vi.unstubAllGlobals());

const TEMPLATE = planTemplate();

function day1(overrides: Partial<PlanInstanceDay> = {}): PlanInstanceDay {
  return planInstanceDay({ id: 100, date: "2026-09-01", day: 1, ...overrides });
}
function day2(overrides: Partial<PlanInstanceDay> = {}): PlanInstanceDay {
  return planInstanceDay({
    id: 101, date: "2026-09-02", day: 2,
    segments: JSON.stringify([{ type: "continuous", target: { kind: "distance", distance_m: 3000, raw: "3km" }, resolved_pace_sec_per_km: 330, raw: "3km @ RG" }]),
    ...overrides,
  });
}
function week2Day1(overrides: Partial<PlanInstanceDay> = {}): PlanInstanceDay {
  return planInstanceDay({ id: 102, date: "2026-09-08", day: 1, week_number: 2, ...overrides });
}
function week2Day2(overrides: Partial<PlanInstanceDay> = {}): PlanInstanceDay {
  return planInstanceDay({
    id: 103, date: "2026-09-09", day: 2, week_number: 2,
    segments: JSON.stringify([{ type: "continuous", target: { kind: "distance", distance_m: 3000, raw: "3km" }, resolved_pace_sec_per_km: 330, raw: "3km @ RG" }]),
    ...overrides,
  });
}

// Every endpoint PlanInstancesSection hits on mount, with a benign default —
// `templates` is a prop (lifted to the parent tab, per CLAUDE.md's "sibling
// cards share data" rule), so this component never fetches plan-templates
// itself.
function mountRoutes(overrides: Routes = {}): Routes {
  return {
    "GET /api/v1/plan-instances": paginated([planInstance()]),
    ...overrides,
  };
}

// Field labels here are a plain sibling <span>, not a real <label htmlFor>,
// so getByLabelText can't find them — locate the label span, then its
// sibling control inside the same Field wrapper div.
function fieldControl(label: string): HTMLElement {
  const labelEl = screen.getByText(new RegExp(`^${label}`), { selector: ".hra-field-label" });
  const wrapper = labelEl.closest("div")!;
  const control = wrapper.querySelector("input, button, [role='combobox']");
  if (!control) throw new Error(`No control found for field "${label}"`);
  return control as HTMLElement;
}

// Every confirm modal shares the same "hra-bg-surface hra-border" content
// wrapper — scoping queries to it disambiguates a modal's own Confirm/Cancel
// button from an identically-labeled trigger button already on screen
// (e.g. "Reset to previous values", "Swap").
function modalFor(bodyText: string | RegExp): HTMLElement {
  return screen.getByText(bodyText).closest(".hra-bg-surface") as HTMLElement;
}

function fakeDataTransfer() {
  const data: Record<string, string> = {};
  return {
    setData: (k: string, v: string) => { data[k] = v; },
    getData: (k: string) => data[k] ?? "",
    effectAllowed: "",
    dropEffect: "",
  };
}

async function pickTemplate(name: string) {
  fireEvent.click(fieldControl("Plan template"));
  fireEvent.click(await screen.findByRole("option", { name }));
}

describe("PlanInstancesSection — row expand/collapse", () => {
  it("opening a row shows its editor fields; a CLEAN existing row reloads the persisted instance on reopen", async () => {
    let getByIdCalls = 0;
    installFetch(mountRoutes({
      "GET /api/v1/plan-instances/10": () => { getByIdCalls++; return json({ ...planInstance(), days: [day1(), day2()] }); },
    }));
    render(<PlanInstancesSection templates={[TEMPLATE]} />);

    const toggle = (await screen.findByText("My Plan")).closest('[role="button"]')!;
    fireEvent.click(toggle);
    expect(await screen.findByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(getByIdCalls).toBe(1);

    fireEvent.click(toggle); // collapse — clean, nothing to stash
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    fireEvent.click(toggle); // reopen
    await screen.findByRole("button", { name: "Save" });
    expect(getByIdCalls).toBe(2); // reloaded from the backend, not restored from a stash
  });

  it("collapsing and reopening a CLEAN 'new instance' row resets to fresh state", async () => {
    installFetch(mountRoutes());
    render(<PlanInstancesSection templates={[TEMPLATE]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Create race plan" }));
    await pickTemplate("5K Base");
    fireEvent.change(fieldControl("Name"), { target: { value: "Draft name" } });

    const newRowToggle = screen.getByText("Draft name").closest('[role="button"]')!;
    fireEvent.click(newRowToggle); // collapse — a "new" row is never dirty (fieldsLocked is false pre-creation)

    fireEvent.click(await screen.findByRole("button", { name: "Create race plan" })); // reopen
    expect(fieldControl("Name")).toHaveValue("");
  });
});

describe("PlanInstancesSection — draft stash-on-collapse / restore-on-reopen", () => {
  it("a DIRTY row's edits survive collapsing it and opening a different row, then reopening the original", async () => {
    const other = planInstance({ id: 11, name: "Other Plan" });
    let getByIdCalls = 0;
    installFetch(mountRoutes({
      "GET /api/v1/plan-instances": paginated([planInstance(), other]),
      "GET /api/v1/plan-instances/10": () => { getByIdCalls++; return json({ ...planInstance(), days: [day1(), day2()] }); },
      "GET /api/v1/plan-instances/11": () => json({ ...other, days: [] }),
    }));
    render(<PlanInstancesSection templates={[TEMPLATE]} />);

    const toggleA = (await screen.findByText("My Plan")).closest('[role="button"]')!;
    fireEvent.click(toggleA);
    await screen.findByRole("button", { name: "Save" });
    expect(getByIdCalls).toBe(1);

    fireEvent.change(fieldControl("Race name"), { target: { value: "Boston Marathon" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    fireEvent.click(toggleA); // collapse — dirty, stashes a draft for row 10
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByTitle("Unsaved changes")).toBeInTheDocument();

    const toggleB = screen.getByText("Other Plan").closest('[role="button"]')!;
    fireEvent.click(toggleB); // open a different row
    await waitFor(() => expect(fieldControl("Name")).toHaveValue("Other Plan"));

    fireEvent.click(toggleB); // collapse row B (clean — nothing stashed for it)
    fireEvent.click(toggleA); // reopen row A — restores its stash

    expect(await screen.findByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(fieldControl("Race name")).toHaveValue("Boston Marathon");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(getByIdCalls).toBe(1); // restored from the stash, not re-fetched
  });
});

describe("PlanInstancesSection — dirty-bucket-driven button enablement", () => {
  async function openInstanceRow() {
    installFetch(mountRoutes({
      "GET /api/v1/plan-instances/10": () => json({ ...planInstance(), days: [day1(), day2()] }),
    }));
    render(<PlanInstancesSection templates={[TEMPLATE]} />);
    fireEvent.click((await screen.findByText("My Plan")).closest('[role="button"]')!);
    await screen.findByRole("button", { name: "Save" });
  }

  it("editing Name only enables Save, leaves Regenerate disabled", async () => {
    await openInstanceRow();
    fireEvent.change(fieldControl("Name"), { target: { value: "Renamed" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Regenerate from/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("editing the race-pace anchor only enables Regenerate, leaves Save disabled", async () => {
    await openInstanceRow();
    fireEvent.click(screen.getByRole("button", { name: "RG" }));
    expect(screen.getByRole("button", { name: /Regenerate from/ })).toHaveAttribute("aria-disabled", "false");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("editing both Name and the race-pace anchor disables Save even though the save-bucket is also dirty", async () => {
    await openInstanceRow();
    fireEvent.change(fieldControl("Name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "RG" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Regenerate from/ })).toHaveAttribute("aria-disabled", "false");
  });

  it("a successful Regenerate force-enables Save even with nothing else dirty", async () => {
    const days = [day1(), day2()];
    installFetch(mountRoutes({
      "GET /api/v1/plan-instances/10": () => json({ ...planInstance(), days }),
      "POST /api/v1/plan-instances/10/regenerate": () => json({ ...planInstance(), days }),
    }));
    render(<PlanInstancesSection templates={[TEMPLATE]} />);
    fireEvent.click((await screen.findByText("My Plan")).closest('[role="button"]')!);
    await screen.findByRole("button", { name: "Save" });

    fireEvent.click(screen.getByRole("button", { name: "RG" })); // dirties the regenerate-bucket, no manual day edits -> no discard-count confirm
    fireEvent.click(screen.getByRole("button", { name: /Regenerate from/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
  });
});

describe("PlanInstancesSection — confirm-modal flows", () => {
  it("Name change: open, cancel, confirm", async () => {
    const days = [day1(), day2()];
    installFetch(mountRoutes({
      "GET /api/v1/plan-instances/10": () => json({ ...planInstance(), days }),
      "PATCH /api/v1/plan-instances/10": () => json({ ...planInstance({ name: "Renamed" }), days }),
    }));
    render(<PlanInstancesSection templates={[TEMPLATE]} />);
    fireEvent.click((await screen.findByText("My Plan")).closest('[role="button"]')!);
    await screen.findByRole("button", { name: "Save" });

    fireEvent.change(fieldControl("Name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const bodyText = "This will rename the current plan — it won't create a copy. Continue?";
    expect(await screen.findByText(bodyText)).toBeInTheDocument();
    fireEvent.click(within(modalFor(bodyText)).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(bodyText)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(); // still dirty, not discarded

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(bodyText);
    fireEvent.click(within(modalFor(bodyText)).getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(screen.queryByText(bodyText)).not.toBeInTheDocument());
  });

  it("Template switch: open, cancel, confirm", async () => {
    const templateB = planTemplate({ id: 2, name: "10K Build" });
    installFetch(mountRoutes({ "GET /api/v1/plan-instances": paginated([]) }));
    render(<PlanInstancesSection templates={[TEMPLATE, templateB]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Create race plan" }));
    await pickTemplate("5K Base");
    fireEvent.change(fieldControl("Name"), { target: { value: "Something" } }); // hasEnteredData() -> true

    await pickTemplate("10K Build");
    const title = "Discard current instance data?";
    expect(await screen.findByText(title)).toBeInTheDocument();
    fireEvent.click(within(modalFor(title)).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(title)).not.toBeInTheDocument();
    expect(fieldControl("Plan template")).toHaveTextContent("5K Base"); // switch was discarded

    await pickTemplate("10K Build");
    await screen.findByText(title);
    fireEvent.click(within(modalFor(title)).getByRole("button", { name: "Switch template" }));
    await waitFor(() => expect(screen.queryByText(title)).not.toBeInTheDocument());
    expect(fieldControl("Plan template")).toHaveTextContent("10K Build");
  });

  it("Regenerate discard-count: open, cancel, confirm", async () => {
    const days = [day1(), day2()];
    let regenerateCalls = 0;
    installFetch(mountRoutes({
      "GET /api/v1/plan-instances/10": () => json({ ...planInstance(), days }),
      "POST /api/v1/plan-instances/10/regenerate": () => { regenerateCalls++; return json({ ...planInstance(), days }); },
    }));
    render(<PlanInstancesSection templates={[TEMPLATE]} />);
    fireEvent.click((await screen.findByText("My Plan")).closest('[role="button"]')!);
    await screen.findByRole("button", { name: "Save" });

    fireEvent.click(screen.getByRole("button", { name: "RG" })); // dirty the regenerate-bucket
    fireEvent.click(await screen.findByRole("button", { name: /Week 1/ }));
    const dslInputs = await screen.findAllByLabelText("Workout (DSL)");
    fireEvent.change(dslInputs[0], { target: { value: "6km @ RG" } }); // 1 manual edit on/after the cutover

    fireEvent.click(screen.getByRole("button", { name: /Regenerate from/ }));
    const title = "Regenerating will discard 1 manual edit(s) — continue?";
    expect(await screen.findByText(title)).toBeInTheDocument();
    fireEvent.click(within(modalFor(title)).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(title)).not.toBeInTheDocument();
    expect(regenerateCalls).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: /Regenerate from/ }));
    await screen.findByText(title);
    fireEvent.click(within(modalFor(title)).getByRole("button", { name: "Regenerate" }));
    await waitFor(() => expect(regenerateCalls).toBe(1));
  });

  it("Restore: open, cancel, confirm", async () => {
    const days = [day1(), day2()];
    installFetch(mountRoutes({ "GET /api/v1/plan-instances/10": () => json({ ...planInstance(), days }) }));
    render(<PlanInstancesSection templates={[TEMPLATE]} />);
    fireEvent.click((await screen.findByText("My Plan")).closest('[role="button"]')!);
    await screen.findByRole("button", { name: "Save" });

    fireEvent.change(fieldControl("Race name"), { target: { value: "Boston" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset to previous values" }));

    const title = "You have unsaved changes — reset them to the previous values?";
    expect(await screen.findByText(title)).toBeInTheDocument();
    fireEvent.click(within(modalFor(title)).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(title)).not.toBeInTheDocument();
    expect(fieldControl("Race name")).toHaveValue("Boston"); // edits preserved after cancel

    fireEvent.click(screen.getByRole("button", { name: "Reset to previous values" }));
    await screen.findByText(title);
    fireEvent.click(within(modalFor(title)).getByRole("button", { name: "Reset to previous values" }));
    await waitFor(() => expect(screen.queryByText(title)).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument(); // row collapsed
  });

  it("Workout-type change: open, cancel, confirm", async () => {
    const days = [day1(), day2()];
    installFetch(mountRoutes({ "GET /api/v1/plan-instances/10": () => json({ ...planInstance(), days }) }));
    render(<PlanInstancesSection templates={[TEMPLATE]} />);
    fireEvent.click((await screen.findByText("My Plan")).closest('[role="button"]')!);
    await screen.findByRole("button", { name: "Save" });
    fireEvent.click(await screen.findByRole("button", { name: /Week 1/ }));

    const dayTypeGroups = screen.getAllByRole("group", { name: "Day type" });
    const dateLabel = instanceDayDateLabel(days[0].date);
    // Reconstructed client-side from the resolved segment (reconstructDslFromResolvedDay)
    // — the workout text shows the RESOLVED pace, not the anchor name.
    const title = `Set ${dateLabel} to Rest? This replaces the current workout text ("5km @ 5:30/km").`;

    fireEvent.click(within(dayTypeGroups[0]).getByRole("button", { name: "Rest" }));
    expect(await screen.findByText(title)).toBeInTheDocument();
    fireEvent.click(within(modalFor(title)).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(title)).not.toBeInTheDocument();
    expect(within(dayTypeGroups[0]).getByRole("button", { name: "Run" })).toHaveAttribute("data-active", "true");

    fireEvent.click(within(dayTypeGroups[0]).getByRole("button", { name: "Rest" }));
    await screen.findByText(title);
    fireEvent.click(within(modalFor(title)).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.queryByText(title)).not.toBeInTheDocument());
    expect(within(dayTypeGroups[0]).getByRole("button", { name: "Rest" })).toHaveAttribute("data-active", "true");
  });

  it("Day swap: open, cancel, confirm", async () => {
    const days = [day1(), day2()];
    installFetch(mountRoutes({ "GET /api/v1/plan-instances/10": () => json({ ...planInstance(), days }) }));
    render(<PlanInstancesSection templates={[TEMPLATE]} />);
    fireEvent.click((await screen.findByText("My Plan")).closest('[role="button"]')!);
    await screen.findByRole("button", { name: "Save" });
    fireEvent.click(await screen.findByRole("button", { name: /Week 1/ }));

    const dslInputs = await screen.findAllByLabelText("Workout (DSL)");
    const rowA = dslInputs[0].closest(".card")!;
    const rowB = dslInputs[1].closest(".card")!;
    const dt = fakeDataTransfer();

    // Reconstructed client-side from the resolved segment — the workout text
    // shows the RESOLVED pace ("5:30/km"), not the anchor name ("RG").
    const labelA = `${instanceDayDateLabel(days[0].date)} (5km @ 5:30/km)`;
    const labelB = `${instanceDayDateLabel(days[1].date)} (3km @ 5:30/km)`;
    const title = `Swap ${labelA} with ${labelB}?`;

    fireEvent.dragStart(rowA, { dataTransfer: dt });
    fireEvent.drop(rowB, { dataTransfer: dt });
    expect(await screen.findByText(title)).toBeInTheDocument();
    fireEvent.click(within(modalFor(title)).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(title)).not.toBeInTheDocument();
    expect(dslInputs[0]).toHaveValue("5km @ 5:30/km"); // unchanged after cancel

    fireEvent.dragStart(rowA, { dataTransfer: dt });
    fireEvent.drop(rowB, { dataTransfer: dt });
    await screen.findByText(title);
    fireEvent.click(within(modalFor(title)).getByRole("button", { name: "Swap" }));
    await waitFor(() => expect(screen.queryByText(title)).not.toBeInTheDocument());

    const dslInputsAfter = screen.getAllByLabelText("Workout (DSL)");
    expect(dslInputsAfter[0]).toHaveValue("3km @ 5:30/km");
    expect(dslInputsAfter[1]).toHaveValue("5km @ 5:30/km");
  });

  it("Week swap: open, cancel, confirm", async () => {
    const days = [day1(), day2(), week2Day1(), week2Day2()];
    installFetch(mountRoutes({ "GET /api/v1/plan-instances/10": () => json({ ...planInstance(), days }) }));
    render(<PlanInstancesSection templates={[TEMPLATE]} />);
    fireEvent.click((await screen.findByText("My Plan")).closest('[role="button"]')!);
    await screen.findByRole("button", { name: "Save" });

    const week1Btn = await screen.findByRole("button", { name: /Week 1/ });
    const week2Btn = screen.getByRole("button", { name: /Week 2/ });
    // The draggable wrapper is the AccordionCard's own PARENT div (WeekEditor
    // spreads useDragSwap's handlers there, not on the header button itself).
    const week1Row = week1Btn.parentElement!.parentElement!;
    const week2Row = week2Btn.parentElement!.parentElement!;
    const dt = fakeDataTransfer();

    const rangeA = `${instanceDayDateLabel(days[0].date)} → ${instanceDayDateLabel(days[1].date)}`;
    const rangeB = `${instanceDayDateLabel(days[2].date)} → ${instanceDayDateLabel(days[3].date)}`;
    const title = `Swap week ${rangeA} with week ${rangeB}?`;

    fireEvent.dragStart(week1Row, { dataTransfer: dt });
    fireEvent.drop(week2Row, { dataTransfer: dt });
    expect(await screen.findByText(title)).toBeInTheDocument();
    fireEvent.click(within(modalFor(title)).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(title)).not.toBeInTheDocument();

    fireEvent.dragStart(week1Row, { dataTransfer: dt });
    fireEvent.drop(week2Row, { dataTransfer: dt });
    await screen.findByText(title);
    fireEvent.click(within(modalFor(title)).getByRole("button", { name: "Swap" }));
    await waitFor(() => expect(screen.queryByText(title)).not.toBeInTheDocument());
  });

  it("Delete: open, cancel, confirm", async () => {
    let removed = false;
    installFetch(mountRoutes({
      "DELETE /api/v1/plan-instances/10": () => { removed = true; return json(null); },
    }));
    render(<PlanInstancesSection templates={[TEMPLATE]} />);
    await screen.findByText("My Plan");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const title = "Delete this instance?";
    expect(await screen.findByText(title)).toBeInTheDocument();
    fireEvent.click(within(modalFor(title)).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(title)).not.toBeInTheDocument();
    expect(removed).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText(title);
    fireEvent.click(within(modalFor(title)).getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(removed).toBe(true));
  });
});

describe("PlanInstancesSection — happy path", () => {
  it("instantiate → create instance → edit → save → approve (approval locks further edits)", async () => {
    let instancesList = [planInstance()];
    const created = { ...planInstance({ id: 20, name: "Marathon Block" }), days: [day1({ instance_id: 20 })] };

    installFetch({
      "GET /api/v1/plan-instances": () => json(paginated(instancesList)),
      "POST /api/v1/plan-templates/1/instantiate": () => {
        instancesList = [{ id: 20, template_id: 1, start_date: created.start_date, pace_overrides: null, target_activity_id: null, approved_at: null, name: "Marathon Block", event: "5k", race_name: null, race_date: null, race_url: null, created_at: created.created_at }];
        return json(created);
      },
      "PATCH /api/v1/plan-instances/20": () => {
        instancesList = [{ ...instancesList[0], race_name: "Boston" }];
        return json({ ...created, race_name: "Boston" });
      },
      "POST /api/v1/plan-instances/20/approve": () => {
        instancesList = [{ ...instancesList[0], approved_at: "2026-08-27T00:00:00Z" }];
        return json({ ...created, race_name: "Boston", approved_at: "2026-08-27T00:00:00Z" });
      },
    });
    render(<PlanInstancesSection templates={[TEMPLATE]} />);

    fireEvent.click(await screen.findByRole("button", { name: "Create race plan" }));
    await pickTemplate("5K Base");
    fireEvent.change(fieldControl("Name"), { target: { value: "Marathon Block" } });
    fireEvent.click(screen.getByRole("button", { name: "Create plan from template" }));

    expect(await screen.findByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activate" })).toBeEnabled();

    // Edit (Save-bucket dirty via Race name) then Save.
    fireEvent.change(fieldControl("Race name"), { target: { value: "Boston" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fieldControl("Race name")).toHaveValue("Boston"));

    // Activate — locks further edits.
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Activate" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Regenerate from/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByLabelText("Workout (DSL)")).not.toBeInTheDocument(); // day edits gone too
  });
});

describe("PlanInstancesSection — List/Agenda view toggle", () => {
  it("renders consistently from the same underlying sections data", async () => {
    const days = [day1(), day2()];
    installFetch(mountRoutes({ "GET /api/v1/plan-instances/10": () => json({ ...planInstance(), days }) }));
    const { container } = render(<PlanInstancesSection templates={[TEMPLATE]} />);
    fireEvent.click((await screen.findByText("My Plan")).closest('[role="button"]')!);
    await screen.findByRole("button", { name: "Save" });

    expect(await screen.findByRole("button", { name: /Week 1/ })).toBeInTheDocument(); // List view, default

    fireEvent.click(screen.getByRole("button", { name: "Agenda" }));
    expect(screen.queryByRole("button", { name: /Week 1/ })).not.toBeInTheDocument();
    await waitFor(() => {
      const summary = container.querySelector(".hra-agenda-summary");
      expect(summary?.textContent).toMatch(/2\s*workouts/);
      expect(summary?.textContent).toMatch(/2\s*runs/);
    });

    fireEvent.click(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByRole("button", { name: /Week 1/ })).toBeInTheDocument();
  });
});
