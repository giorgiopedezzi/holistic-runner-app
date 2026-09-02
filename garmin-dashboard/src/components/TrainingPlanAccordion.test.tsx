/**
 * TrainingPlanAccordion.test.tsx (HRA-237)
 * UI-level regression coverage for the structured/DSL editor's own stated
 * invariants (HRA-233's own comment on TemplateDayRow): repeated
 * Structured/DSL view toggling never loses an in-progress edit, and an
 * unsaved structured change survives navigating away from the day (its own
 * accordion collapsing and reopening) — because the actual edit buffer
 * (day.dsl) lives in the PARENT's state via onDayEdit, not in the per-day
 * view-toggle's local component state. Also covers the field editors'
 * keyboard interaction (Enter commits, same as blur).
 *
 * A thin stateful harness stands in for PlanTemplatesSection's own
 * editor.sections/onDayEdit wiring (that file's own API/save machinery is
 * out of this Story's scope) — it owns one Section/Week/Day tree in React
 * state and patches day.dsl the same way onDayEdit already does there.
 */
import { useState } from "react";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TrainingPlanAccordion } from "./TrainingPlanAccordion";
import { buildTemplateSectionView, type SectionView } from "@/domain/runplan-aggregate";
import { recomposeDayLine, splitNote } from "@/domain/runplan-patch";
import type { Section } from "@/types/runplan";

function baseSection(): Section {
  return {
    name: "Base", week_spec: "1", raw_dsl: "SECTION \"Base\" WEEKS 1", pace_policy: {},
    weeks: [{
      number: 1, raw_dsl: "WEEK 1", pace_policy: {},
      days: [
        {
          day: 1, workout_type: "run", needs_review: false, warnings: [],
          raw_dsl: "D1: 10km @ RG", notes: undefined,
          segments: [{ type: "continuous", target: { kind: "distance", distance_m: 10000, raw: "10km" }, intensity: { kind: "anchor", anchor: "RG", raw: "RG" }, raw: "10km @ RG" }],
        },
      ],
    }],
  };
}

// Mirrors PlanTemplatesSection.tsx's own onDayEdit — patches the touched
// day's dsl/notes in place, leaving day.segments (and therefore the
// Structured-view presentation) as a stale snapshot until a real reparse —
// exactly like the real app between an edit and its debounced backend
// regenerate, which this harness deliberately doesn't simulate (out of
// this Story's scope: it's testing the accordion's own view/state
// invariants, not the reparse round trip covered by
// runplan-editor-fixtures.test.ts).
function Harness() {
  const [sections, setSections] = useState<SectionView[]>([buildTemplateSectionView(baseSection(), {})]);
  function onDayEdit(sectionIndex: number, weekIndex: number, dayIndex: number, patch: { dsl?: string; notes?: string }) {
    setSections(prev => {
      const next = structuredClone(prev) as SectionView[];
      const day = next[sectionIndex].weeks[weekIndex].days[dayIndex];
      const newLine = recomposeDayLine(day.dsl, patch);
      day.dsl = newLine;
      day.notes = splitNote(newLine).note;
      return next;
    });
  }
  return (
    <TrainingPlanAccordion
      ownerName="Test plan"
      sections={sections}
      onSectionEdit={() => {}}
      onWeekEdit={() => {}}
      onDayEdit={onDayEdit}
      offsetUnit="s/km"
    />
  );
}

// The Day accordion's own title text changes as the DSL is edited
// ("D1: 10km @ RG" -> "D1: 10km @ RG+50"), so it can't be used as a stable
// locator across an edit — the 3rd accordion trigger in document order
// (Section, Week, Day) is stable regardless of what the day's title reads.
function dayToggle(): HTMLElement {
  return document.querySelectorAll(".hra-accordion-trigger")[2] as HTMLElement;
}
function expandDay() {
  fireEvent.click(screen.getByText("Week 1").closest('[role="button"]')!);
  fireEvent.click(dayToggle());
}
function viewToggle(name: "Structured" | "DSL") {
  return screen.getByRole("button", { name });
}

describe("TrainingPlanAccordion — repeated Structured/DSL toggling without data loss", () => {
  it("an in-progress DSL text edit survives switching to Structured and back to DSL", () => {
    render(<Harness />);
    expandDay();

    fireEvent.click(viewToggle("DSL"));
    const dslInput = screen.getByLabelText("Workout (DSL)");
    fireEvent.change(dslInput, { target: { value: "D1: 12km @ RG" } });
    expect(dslInput).toHaveValue("D1: 12km @ RG");

    fireEvent.click(viewToggle("Structured"));
    expect(screen.queryByLabelText("Workout (DSL)")).not.toBeInTheDocument(); // unmounted while Structured is active

    fireEvent.click(viewToggle("DSL"));
    expect(screen.getByLabelText("Workout (DSL)")).toHaveValue("D1: 12km @ RG"); // not reverted

    // A second full toggle cycle — repeated switching, not just once.
    fireEvent.click(viewToggle("Structured"));
    fireEvent.click(viewToggle("DSL"));
    expect(screen.getByLabelText("Workout (DSL)")).toHaveValue("D1: 12km @ RG");
  });
});

describe("TrainingPlanAccordion — unsaved structured change survives navigation away from the day", () => {
  it("a structured field edit survives collapsing and reopening the day's own accordion", () => {
    render(<Harness />);
    expandDay();

    const paceField = screen.getByLabelText("Pace");
    fireEvent.change(paceField, { target: { value: "RG+50" } });
    fireEvent.blur(paceField); // EditableValueField commits on blur

    // The commit already patched day.dsl in the parent (Harness) — verify via DSL view.
    fireEvent.click(viewToggle("DSL"));
    expect(screen.getByLabelText("Workout (DSL)")).toHaveValue("D1: 10km @ RG+50");

    // Navigate away: collapse the day's own AccordionCard, then reopen it.
    fireEvent.click(dayToggle());
    expect(screen.queryByLabelText("Workout (DSL)")).not.toBeInTheDocument(); // collapsed, unmounted

    fireEvent.click(dayToggle()); // reopen
    fireEvent.click(viewToggle("DSL"));
    expect(screen.getByLabelText("Workout (DSL)")).toHaveValue("D1: 10km @ RG+50"); // edit preserved
  });
});

describe("TrainingPlanAccordion — keyboard interaction", () => {
  it("Enter commits a structured field edit the same way blur does", () => {
    render(<Harness />);
    expandDay();

    const distanceField = screen.getByLabelText("Distance / Duration") as HTMLInputElement;
    distanceField.focus(); // real .blur() (which the Enter handler calls) is a no-op unless actually focused
    fireEvent.change(distanceField, { target: { value: "15km" } });
    fireEvent.keyDown(distanceField, { key: "Enter" });

    fireEvent.click(viewToggle("DSL"));
    expect(screen.getByLabelText("Workout (DSL)")).toHaveValue("D1: 15km @ RG");
  });

  it("the view-toggle group is keyboard-reachable and exposes its selection via aria-pressed", () => {
    render(<Harness />);
    expandDay();
    expect(viewToggle("Structured")).toHaveAttribute("aria-pressed", "true");
    expect(viewToggle("DSL")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(viewToggle("DSL"));
    expect(viewToggle("DSL")).toHaveAttribute("aria-pressed", "true");
  });
});
