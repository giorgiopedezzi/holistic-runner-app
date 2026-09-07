/**
 * PlanTemplatesSection.test.tsx (HRA-238)
 * Coverage for the Plan text -> Conversion prompt -> Workout DSL authoring
 * pipeline restructuring — default section expansion per scenario, direct
 * DSL entry with no source text, prompt generation preserving original
 * text, collapsing/reopening without content loss, an invalid-DSL error
 * forcing Workout DSL back open, existing action enablement, keyboard
 * expansion + aria-expanded, English/Italian label parity, and a
 * regression check that the parsed preview still renders below the
 * pipeline. No prior test file existed for this component (same
 * "characterization net" precedent PlanInstancesSection.test.tsx already
 * established for its sibling — see docs/frontend.md).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, it, expect } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { PlanTemplatesSection } from "./PlanTemplatesSection";
import { installFetch, json } from "@/test/api-stub";
import { planTemplate } from "@/test/fixtures";

const TEMPLATE = planTemplate();

// Read directly off disk (not a static import) — these locale files live
// outside this package's own root (garmin-stats/locales/, the single
// source per frontend-i18n.md), so a plain import would depend on Vite's
// project-root fs allowlist rather than plain Node module resolution.
const localesDir = path.resolve(process.cwd(), "../garmin-stats/locales");
const enLocale: Record<string, string> = JSON.parse(readFileSync(path.join(localesDir, "en.json"), "utf8"));
const itLocale: Record<string, string> = JSON.parse(readFileSync(path.join(localesDir, "it.json"), "utf8"));

function mountProps(overrides: Partial<ComponentProps<typeof PlanTemplatesSection>> = {}) {
  return { templates: [TEMPLATE], templatesError: null, refreshTemplates: async () => {}, ...overrides };
}

// Radix Select (the Event type picker) calls these during pointer
// interaction — jsdom implements neither (same stub PlanInstancesSection.test.tsx uses).
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.releasePointerCapture ??= () => {};
  window.HTMLElement.prototype.scrollIntoView ??= () => {};
});

function pipelineHeader(name: string | RegExp) {
  return screen.getByRole("button", { name });
}

describe("PlanTemplatesSection — default pipeline expansion", () => {
  it("a new empty template opens with Plan text expanded, the other two collapsed but visible", async () => {
    installFetch({});
    render(<PlanTemplatesSection {...mountProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "New template" }));

    expect(await screen.findByLabelText("Original text")).toBeInTheDocument(); // Plan text expanded
    expect(screen.queryByLabelText("Generated prompt")).not.toBeInTheDocument(); // Conversion prompt collapsed
    expect(screen.queryByLabelText("Workout plan text")).not.toBeInTheDocument(); // Workout DSL collapsed
    // All three headers stay visible regardless of expansion.
    expect(pipelineHeader(/Plan text/)).toBeInTheDocument();
    expect(pipelineHeader(/Conversion prompt/)).toBeInTheDocument();
    expect(pipelineHeader(/Workout DSL/)).toBeInTheDocument();
  });

  it("original text with a generated prompt: both Plan text and Conversion prompt reopen expanded on the stashed draft", async () => {
    installFetch({});
    render(<PlanTemplatesSection {...mountProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "New template" }));

    fireEvent.change(await screen.findByLabelText("Original text"), { target: { value: "Week 1: 5km easy" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate full prompt" }));
    // Conversion prompt opens on its own once generated — no manual expand.
    const promptField = await screen.findByLabelText("Generated prompt") as HTMLTextAreaElement;
    expect(promptField.value).toContain("Week 1: 5km easy"); // jest-dom's toHaveValue doesn't accept asymmetric matchers

    // Collapse the whole row (dirty -> stashed as a draft), then reopen it.
    // "New template" also matches the "+ New template" button, so scope to
    // the row title's own <span>.
    fireEvent.click(screen.getByText("New template", { selector: "span" }).closest('[role="button"]')!);
    expect(screen.queryByLabelText("Original text")).not.toBeInTheDocument();
    // Reopen via the row's own (still collapsed) header — the "+ New
    // template" trigger button also matches by accessible name, but stays
    // disabled while a "new" draft is pending, so it can't be the target.
    fireEvent.click(await screen.findByText("New template", { selector: "span" }));

    expect(await screen.findByLabelText("Original text")).toHaveValue("Week 1: 5km easy"); // Plan text expanded, content preserved
    expect(screen.getByLabelText("Generated prompt")).toBeInTheDocument(); // Conversion prompt also expanded (a prompt already exists)
  });

  it("an existing template (already has DSL) opens with Workout DSL expanded, Plan text/Conversion prompt collapsed", async () => {
    installFetch({ "POST /api/v1/plan-templates/generate": json({ plan: { metadata: { unit: "km", offset_unit: "s/km", default_rest: "jog", pace_policy: {} }, sections: [] }, warnings: [] }) });
    render(<PlanTemplatesSection {...mountProps()} />);

    fireEvent.click((await screen.findByText("5K Base")).closest('[role="button"]')!);

    expect(await screen.findByLabelText("Workout plan text")).toHaveValue(TEMPLATE.dsl_source); // Workout DSL expanded
    expect(screen.queryByLabelText("Original text")).not.toBeInTheDocument(); // Plan text collapsed
    expect(screen.queryByLabelText("Generated prompt")).not.toBeInTheDocument(); // Conversion prompt collapsed
    // Headers stay reachable — clicking one opens it without touching the others.
    fireEvent.click(pipelineHeader(/Plan text/));
    expect(await screen.findByLabelText("Original text")).toBeInTheDocument();
    expect(screen.getByLabelText("Workout plan text")).toBeInTheDocument(); // Workout DSL untouched — both can be open at once
  });
});

describe("PlanTemplatesSection — direct DSL path (AC2)", () => {
  it("Workout DSL can be opened, edited and previewed with no Plan text or Conversion prompt entered", async () => {
    installFetch({
      "POST /api/v1/plan-templates/generate": json({
        plan: {
          metadata: { unit: "km", offset_unit: "s/km", default_rest: "jog", pace_policy: {} },
          sections: [{
            name: "Plan", week_spec: "*", raw_dsl: "", pace_policy: {},
            weeks: [{ number: 1, raw_dsl: "WEEK 1", pace_policy: {}, days: [{ day: 1, workout_type: "run", needs_review: false, warnings: [], raw_dsl: "D1: 5km @ RG", segments: [{ type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "5km @ RG" }] }] }],
          }],
        },
        warnings: [],
      }),
    });
    render(<PlanTemplatesSection {...mountProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "New template" }));

    // Plan text is expanded by default (the "new empty template" rule) —
    // collapse it explicitly so this test genuinely demonstrates the DSL
    // path working with neither of the other two sections ever touched.
    await screen.findByLabelText("Original text");
    fireEvent.click(pipelineHeader(/Plan text/));
    expect(screen.queryByLabelText("Original text")).not.toBeInTheDocument();

    fireEvent.click(pipelineHeader(/Workout DSL/));
    const dslField = await screen.findByLabelText("Workout plan text");
    fireEvent.change(dslField, { target: { value: "D1: 5km @ RG" } });
    expect(screen.queryByLabelText("Original text")).not.toBeInTheDocument(); // never (re)opened
    expect(screen.queryByLabelText("Generated prompt")).not.toBeInTheDocument(); // never opened

    // No manual "Generate" button anymore — the preview is live, debounced
    // off editor.dslSource (700ms), so just wait past that for it to settle.
    await waitFor(() => expect(pipelineHeader(/Workout DSL/)).toHaveTextContent("Valid"), { timeout: 2000 }); // parsed successfully

    // Save also needs Name + Event type (unchanged, pre-existing rules) —
    // neither lives inside the pipeline, so filling them doesn't touch
    // Plan text or Conversion prompt either.
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Direct DSL plan" } });
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "5k" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    expect(screen.queryByLabelText("Original text")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Generated prompt")).not.toBeInTheDocument();
  });
});

describe("PlanTemplatesSection — prompt generation preserves original text", () => {
  it("generating the prompt leaves the source text field unchanged", async () => {
    installFetch({});
    render(<PlanTemplatesSection {...mountProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "New template" }));

    const textField = await screen.findByLabelText("Original text");
    fireEvent.change(textField, { target: { value: "Original plan text here" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate full prompt" }));
    // Conversion prompt opens on its own once generated — no manual expand needed.

    expect(textField).toHaveValue("Original plan text here");
    expect(await screen.findByLabelText("Generated prompt")).not.toHaveValue("");
  });

  it("the Generate action stays disabled while the source text is empty", async () => {
    installFetch({});
    render(<PlanTemplatesSection {...mountProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    await screen.findByLabelText("Original text");
    expect(screen.getByRole("button", { name: "Generate full prompt" })).toBeDisabled();
  });
});

describe("PlanTemplatesSection — structural edits highlight the touched row (HRA-140 follow-up)", () => {
  it("editing a Day's DSL via the structured view highlights that Day's own row, not others", async () => {
    installFetch({
      "POST /api/v1/plan-templates/generate": json({
        plan: {
          metadata: { unit: "km", offset_unit: "s/km", default_rest: "jog", pace_policy: {} },
          sections: [{
            name: "Plan", week_spec: "*", raw_dsl: "", pace_policy: {},
            weeks: [{ number: 1, raw_dsl: "WEEK 1", pace_policy: {}, days: [{ day: 1, workout_type: "run", needs_review: false, warnings: [], raw_dsl: "D1: 5km @ RG", segments: [{ type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "5km @ RG" }] }] }],
          }],
        },
        warnings: [],
      }),
    });
    render(<PlanTemplatesSection {...mountProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    fireEvent.click(pipelineHeader(/Workout DSL/));
    fireEvent.change(await screen.findByLabelText("Workout plan text"), { target: { value: "D1: 5km @ RG" } });
    // No manual "Generate" button anymore — the preview is live, debounced
    // off editor.dslSource (700ms), so just wait past that for it to settle.
    await waitFor(() => expect(pipelineHeader(/Workout DSL/)).toHaveTextContent("Valid"), { timeout: 2000 });

    expect(document.querySelector(".hra-edited-row-highlight")).not.toBeInTheDocument(); // nothing edited yet

    fireEvent.click(screen.getByText("Week 1").closest('[role="button"]') as HTMLElement); // expand the week to reveal its day
    // The raw DSL <textarea>'s own (undirtied) value also text-matches per
    // the HTML spec's textarea.value getter — filter it out.
    const dayTrigger = screen.getAllByText("D1: 5km @ RG").find(el => el.tagName !== "TEXTAREA") as HTMLElement;
    fireEvent.click(dayTrigger.closest('[role="button"]') as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "DSL" }));
    const dayDslField = await screen.findByLabelText("Workout plan text (DSL)");
    fireEvent.change(dayDslField, { target: { value: "D1: 8km @ RG" } });
    fireEvent.blur(dayDslField);

    const highlighted = document.querySelectorAll(".hra-edited-row-highlight");
    expect(highlighted).toHaveLength(1); // only the Day row, not the Week/Section rows too
    expect(highlighted[0]).toHaveTextContent("D1: 8km @ RG");
  });
});

describe("PlanTemplatesSection — collapsing and reopening a section preserves content (AC5)", () => {
  it("Workout DSL text survives collapsing and reopening just that section", async () => {
    installFetch({});
    render(<PlanTemplatesSection {...mountProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "New template" }));

    fireEvent.click(pipelineHeader(/Workout DSL/)); // open
    fireEvent.change(await screen.findByLabelText("Workout plan text"), { target: { value: "D1: 10km @ RG" } });

    fireEvent.click(pipelineHeader(/Workout DSL/)); // collapse
    expect(screen.queryByLabelText("Workout plan text")).not.toBeInTheDocument();

    fireEvent.click(pipelineHeader(/Workout DSL/)); // reopen
    expect(await screen.findByLabelText("Workout plan text")).toHaveValue("D1: 10km @ RG");
  });
});

describe("PlanTemplatesSection — invalid DSL surfaces the error inside an expanded Workout DSL", () => {
  it("a failed generate shows the parser diagnostic without discarding the entered DSL, section stays open", async () => {
    installFetch({
      "POST /api/v1/plan-templates/generate": () => new Response(JSON.stringify({ detail: "Unexpected token" }), { status: 400, headers: { "Content-Type": "application/problem+json" } }),
    });
    render(<PlanTemplatesSection {...mountProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "New template" }));

    fireEvent.click(pipelineHeader(/Workout DSL/));
    const dslField = await screen.findByLabelText("Workout plan text");
    fireEvent.change(dslField, { target: { value: "!!! not valid dsl" } });

    // No manual "Generate" button anymore — the preview is live, debounced
    // off editor.dslSource (700ms), so just wait past that for it to settle.
    expect(await screen.findByText("Unexpected token", {}, { timeout: 2000 })).toBeInTheDocument();
    expect(dslField).toHaveValue("!!! not valid dsl"); // entered text unchanged
    expect(screen.getByLabelText("Workout plan text")).toBeInTheDocument(); // section remains expanded
  });
});

describe("PlanTemplatesSection — keyboard expansion and aria-expanded", () => {
  it("Enter/Space on a section header toggles it, aria-expanded tracks state", async () => {
    installFetch({});
    render(<PlanTemplatesSection {...mountProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    await screen.findByLabelText("Original text");

    const dslHeader = pipelineHeader(/Workout DSL/);
    expect(dslHeader).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(dslHeader, { key: "Enter" });
    expect(dslHeader).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByLabelText("Workout plan text")).toBeInTheDocument();

    fireEvent.keyDown(dslHeader, { key: " " });
    expect(dslHeader).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Workout plan text")).not.toBeInTheDocument();
  });
});

describe("PlanTemplatesSection — existing action enablement is unchanged", () => {
  it("Save disabled until generated + named; Activate/Clear pending changes visible in the shared action bar, not inside a section", async () => {
    installFetch({
      "POST /api/v1/plan-templates/generate": json({
        plan: {
          metadata: { unit: "km", offset_unit: "s/km", default_rest: "jog", pace_policy: {} },
          sections: [{
            name: "Plan", week_spec: "*", raw_dsl: "", pace_policy: {},
            weeks: [{ number: 1, raw_dsl: "WEEK 1", pace_policy: {}, days: [{ day: 1, workout_type: "run", needs_review: false, warnings: [], raw_dsl: "D1: 5km @ RG", segments: [{ type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "5km @ RG" }] }] }],
          }],
        },
        warnings: [],
      }),
    });
    render(<PlanTemplatesSection {...mountProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    fireEvent.click(pipelineHeader(/Workout DSL/));
    const dslField = await screen.findByLabelText("Workout plan text");
    fireEvent.change(dslField, { target: { value: "D1: 5km @ RG" } });
    // No manual "Generate" button anymore — the preview is live, debounced
    // off editor.dslSource (700ms), so just wait past that for it to settle.
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(), { timeout: 2000 }); // no name yet

    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: "My Plan" } });
    // Event type is a custom Select (Radix), not a native <select> — pick it
    // via role. The not-ready `t()` stub in this harness renders each
    // option's raw EventType value ("5k"), not the real locale's "5K" —
    // same limitation the locale-parity tests below work around by reading
    // the JSON files directly instead of rendering through `t()`.
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "5k" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    // Save/Activate/Clear pending changes render once, outside any AccordionCard section.
    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear pending changes" })).toBeEnabled();
  });
});

describe("PlanTemplatesSection — regression: parsed preview still renders below the pipeline", () => {
  it("a successful generate still renders the Section/Week/Day accordion", async () => {
    installFetch({
      "POST /api/v1/plan-templates/generate": json({
        plan: {
          metadata: { unit: "km", offset_unit: "s/km", default_rest: "jog", pace_policy: {} },
          sections: [{
            name: "Base", week_spec: "1", raw_dsl: "SECTION \"Base\" WEEKS 1", pace_policy: {},
            weeks: [{ number: 1, raw_dsl: "WEEK 1", pace_policy: {}, days: [{ day: 1, workout_type: "run", needs_review: false, warnings: [], raw_dsl: "D1: 5km @ RG", segments: [{ type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "5km @ RG" }] }] }],
          }],
        },
        warnings: [],
      }),
    });
    render(<PlanTemplatesSection {...mountProps()} />);
    fireEvent.click((await screen.findByText("5K Base")).closest('[role="button"]')!);
    await screen.findByLabelText("Workout plan text");

    expect(await screen.findByText("Week 1")).toBeInTheDocument();
  });
});

describe("PlanTemplatesSection — Week view (HRA-283)", () => {
  const WEEK1_DSL = ["SECTION \"Base\" WEEKS 1", "WEEK 1", "D1: 5km @ RG", "D3: 4x1000m @ RG-20"].join("\n");
  function mockGenerate() {
    return json({
      plan: {
        metadata: { unit: "km", offset_unit: "s/km", default_rest: "jog", pace_policy: {} },
        sections: [{
          name: "Base", week_spec: "1", raw_dsl: "SECTION \"Base\" WEEKS 1", pace_policy: {},
          weeks: [{
            number: 1, raw_dsl: "WEEK 1", pace_policy: {},
            days: [
              { day: 1, workout_type: "run", needs_review: false, warnings: [], raw_dsl: "D1: 5km @ RG", segments: [{ type: "continuous", target: { kind: "distance", distance_m: 5000, raw: "5km" }, intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "5km @ RG" }] },
              { day: 3, workout_type: "run", needs_review: false, warnings: [], raw_dsl: "D3: 4x1000m @ RG-20", segments: [{ type: "interval", reps: 4, work_target: { kind: "distance", distance_m: 1000, raw: "1000m" }, work_intensity: { kind: "offset", anchor: "RG", offset_sec_per_km: -20, raw: "RG-20" }, raw: "4x1000m @ RG-20" }] },
            ],
          }],
        }],
      },
      warnings: [],
    });
  }

  async function openWeekView() {
    installFetch({ "POST /api/v1/plan-templates/generate": mockGenerate() });
    render(<PlanTemplatesSection {...mountProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    fireEvent.click(pipelineHeader(/Workout DSL/));
    const dslField = await screen.findByLabelText("Workout plan text");
    fireEvent.change(dslField, { target: { value: WEEK1_DSL } });
    await waitFor(() => expect(pipelineHeader(/Workout DSL/)).toHaveTextContent("Valid"), { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    return dslField as HTMLTextAreaElement;
  }

  it("defaults to List; switching to Week does not alter dslSource or the preview", async () => {
    installFetch({ "POST /api/v1/plan-templates/generate": mockGenerate() });
    render(<PlanTemplatesSection {...mountProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "New template" }));

    fireEvent.click(pipelineHeader(/Workout DSL/));
    const dslField = await screen.findByLabelText("Workout plan text");
    fireEvent.change(dslField, { target: { value: WEEK1_DSL } });
    await waitFor(() => expect(pipelineHeader(/Workout DSL/)).toHaveTextContent("Valid"), { timeout: 2000 });

    // The toggle only mounts once a preview exists — defaults to List.
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute("data-active", "false");
    expect(screen.getByText("Week 1")).toBeInTheDocument(); // the List view's own accordion

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    expect(dslField).toHaveValue(WEEK1_DSL); // untouched by the toggle itself
    expect(screen.getByText("Day 1")).toBeInTheDocument();
  });

  it("renders exactly 7 fixed Day columns regardless of how many D-numbers are declared", async () => {
    await openWeekView();
    for (let n = 1; n <= 7; n++) expect(screen.getByText(`Day ${n}`)).toBeInTheDocument();
  });

  it("a declared day reuses the List view's own TemplateDayRow — same collapsed title", async () => {
    await openWeekView();
    expect(screen.getByText("D1: 5km @ RG")).toBeInTheDocument();
    expect(screen.getByText("D3: 4x1000m @ RG-20")).toBeInTheDocument();
  });

  it("an undeclared D-number shows a Rest day summary, not a gap, and viewing it alone does not touch dsl_source", async () => {
    const dslField = await openWeekView();
    expect(screen.getAllByText("Rest day").length).toBeGreaterThan(0);
    expect(dslField).toHaveValue(WEEK1_DSL);
  });

  it("clicking an undeclared slot materializes a D<n>: REST line at the right position and becomes editable", async () => {
    await openWeekView();
    // Day 2 sits between the two declared days (D1, D3) — its own column is
    // the first "Rest day" placeholder in document order. Queries the raw
    // DSL textarea by its stable class rather than by label after the click:
    // materializing highlights the just-patched line (setLastPatchedLine),
    // which swaps the plain <textarea> for a wrapped highlighted variant
    // (renderDslTextarea in PlanTemplatesSection.tsx) that — a pre-existing,
    // out-of-scope gap this test exposed — carries no aria-label of its own,
    // unlike the plain variant (implicit <label> association breaks once the
    // control is wrapped in the highlight markup); flagged as a candidate,
    // not fixed here.
    fireEvent.click(screen.getAllByText("Rest day")[0]);

    await waitFor(() => {
      const field = document.querySelector(".hra-dsl-editor-textarea, textarea[aria-label='Workout plan text']") as HTMLTextAreaElement | null;
      expect(field).not.toBeNull();
      expect(field).toHaveValue(["SECTION \"Base\" WEEKS 1", "WEEK 1", "D1: 5km @ RG", "D2: REST", "D3: 4x1000m @ RG-20"].join("\n"));
    });
    // Materializing opens it pre-expanded (AC5's "one interaction") — its
    // Structured view's Rest-day state label is now visible.
    expect(await screen.findByText("D2: REST")).toBeInTheDocument();
  });

  // jsdom has no real DataTransfer — a plain object implementing the two
  // methods useDragSwap/UndeclaredDaySlot actually call is enough to drive
  // the native HTML5 DnD handlers under fireEvent.
  function fakeDataTransfer() {
    const store: Record<string, string> = {};
    return { setData: (t: string, v: string) => { store[t] = v; }, getData: (t: string) => store[t] ?? "", effectAllowed: "", dropEffect: "" };
  }

  // A day's title text also matches inside the raw-DSL textarea's own
  // highlight backdrop (a <mark> mirroring the same string, see
  // renderDslTextarea in PlanTemplatesSection.tsx) — scope to the real title
  // <span>, same collision this file's own earlier tests already work around.
  function dayTitle(text: string): HTMLElement {
    return screen.getAllByText(text).find(el => el.tagName === "SPAN")!;
  }

  it("dragging one declared day onto another swaps their content, keeping each D-number in place (AC6)", async () => {
    await openWeekView();
    const day1 = dayTitle("D1: 5km @ RG").closest('[data-swappable="true"]') as HTMLElement;
    const day3 = dayTitle("D3: 4x1000m @ RG-20").closest('[data-swappable="true"]') as HTMLElement;
    const dataTransfer = fakeDataTransfer();

    fireEvent.dragStart(day1, { dataTransfer });
    fireEvent.drop(day3, { dataTransfer });

    await waitFor(() => expect(dayTitle("D1: 4x1000m @ RG-20")).toBeInTheDocument());
    expect(dayTitle("D3: 5km @ RG")).toBeInTheDocument();
    const field = document.querySelector(".hra-dsl-editor-textarea, textarea[aria-label='Workout plan text']") as HTMLTextAreaElement | null;
    expect(field).toHaveValue(["SECTION \"Base\" WEEKS 1", "WEEK 1", "D1: 4x1000m @ RG-20", "D3: 5km @ RG"].join("\n"));
  });

  it("dropping a declared day onto an undeclared slot materializes it and moves the content there, leaving REST behind (AC5/AC6)", async () => {
    await openWeekView();
    const day1 = dayTitle("D1: 5km @ RG").closest('[data-swappable="true"]') as HTMLElement;
    const undeclaredDay2 = screen.getAllByText("Rest day")[0].closest('[role="button"]') as HTMLElement;
    const dataTransfer = fakeDataTransfer();

    fireEvent.dragStart(day1, { dataTransfer });
    fireEvent.drop(undeclaredDay2, { dataTransfer });

    await waitFor(() => expect(dayTitle("D2: 5km @ RG")).toBeInTheDocument()); // the dragged workout moved to D2
    expect(dayTitle("D1: REST")).toBeInTheDocument(); // origin left as REST
    const field = document.querySelector(".hra-dsl-editor-textarea, textarea[aria-label='Workout plan text']") as HTMLTextAreaElement | null;
    expect(field).toHaveValue(["SECTION \"Base\" WEEKS 1", "WEEK 1", "D1: REST", "D2: 5km @ RG", "D3: 4x1000m @ RG-20"].join("\n"));
  });
});

describe("PlanTemplatesSection — English/Italian label parity for the new pipeline keys", () => {
  it("every new manage.planTemplates.pipeline.* key exists with a non-empty value in both locale files", () => {
    const pipelineKeys = Object.keys(enLocale).filter(k => k.startsWith("manage.planTemplates.pipeline."));
    expect(pipelineKeys.length).toBeGreaterThan(0);
    for (const key of pipelineKeys) {
      expect(typeof enLocale[key]).toBe("string");
      expect(enLocale[key].length).toBeGreaterThan(0);
      expect(typeof itLocale[key]).toBe("string");
      expect(itLocale[key].length).toBeGreaterThan(0);
    }
  });

  it("the renamed Copy/Save-as prompt labels are present in both locales", () => {
    expect(enLocale["manage.planTemplates.aiPrompt.copyButton"]).toBe("Copy prompt");
    expect(enLocale["manage.planTemplates.aiPrompt.saveAsButton"]).toBe("Save prompt as…");
    expect(itLocale["manage.planTemplates.aiPrompt.copyButton"]).toBe("Copia prompt");
    expect(itLocale["manage.planTemplates.aiPrompt.saveAsButton"]).toBe("Salva prompt come…");
  });
});
