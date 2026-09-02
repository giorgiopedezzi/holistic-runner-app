import { describe, it, expect } from "vitest";
import {
  recomposeDayLine, replaceSegmentInDayLine, replaceSpan, serializeSectionHeader, serializeWeekHeader, splitNote, swapDayContent,
} from "./runplan-patch";

describe("splitNote", () => {
  it("splits the trailing # comment off, trimming both sides", () => {
    expect(splitNote("WEEK 1 START 2026-09-01 # taper begins")).toEqual({ main: "WEEK 1 START 2026-09-01", note: "taper begins" });
  });
  it("returns no note when there's no #", () => {
    expect(splitNote("WEEK 1")).toEqual({ main: "WEEK 1" });
  });
});

describe("serializeSectionHeader", () => {
  it("changes only the name, preserving WEEKS spec and an existing note", () => {
    const result = serializeSectionHeader(`SECTION "Base" WEEKS 1-2 # early block`, { name: "Foundation" });
    expect(result).toBe(`SECTION "Foundation" WEEKS 1-2 # early block`);
  });
  it("changes only the note, preserving name and spec", () => {
    const result = serializeSectionHeader(`SECTION "Base" WEEKS 1-2`, { notes: "new note" });
    expect(result).toBe(`SECTION "Base" WEEKS 1-2 # new note`);
  });
  it("clearing the note (empty string) drops the trailing comment", () => {
    const result = serializeSectionHeader(`SECTION "Base" WEEKS 1-2 # old`, { notes: "" });
    expect(result).toBe(`SECTION "Base" WEEKS 1-2`);
  });
  it("normalizes a bare (unquoted) name to quoted form on any edit", () => {
    const result = serializeSectionHeader(`SECTION Base WEEKS 1-2`, { notes: "x" });
    expect(result).toBe(`SECTION "Base" WEEKS 1-2 # x`);
  });
  it("throws on text that isn't a SECTION header", () => {
    expect(() => serializeSectionHeader("WEEK 1", { name: "x" })).toThrow();
  });
});

describe("serializeWeekHeader", () => {
  it("changes only the note, preserving number and START date", () => {
    expect(serializeWeekHeader("WEEK 3 START 2026-09-15", { notes: "recovery" })).toBe("WEEK 3 START 2026-09-15 # recovery");
  });
  it("preserves a week with no START date", () => {
    expect(serializeWeekHeader("WEEK 1 # old note", { notes: "updated" })).toBe("WEEK 1 # updated");
  });
});

describe("recomposeDayLine", () => {
  it("a dsl edit replaces the whole line outright", () => {
    expect(recomposeDayLine("D1: 5km @ RG", { dsl: "D1: 8km @ RG" })).toBe("D1: 8km @ RG");
  });
  it("a notes-only edit re-composes onto the current line's main clause", () => {
    expect(recomposeDayLine("D1: 5km @ RG # easy", { notes: "hard effort" })).toBe("D1: 5km @ RG # hard effort");
  });
  it("clearing notes drops the trailing comment", () => {
    expect(recomposeDayLine("D1: 5km @ RG # easy", { notes: "" })).toBe("D1: 5km @ RG");
  });
});

describe("replaceSegmentInDayLine (HRA-234)", () => {
  it("replaces one segment in a multi-segment day, leaving the other segment and note untouched", () => {
    const result = replaceSegmentInDayLine("D3: 10km @ RG+20 ; 5km @ RG-5 # taper", 0, "10km @ RG+45");
    expect(result).toBe("D3: 10km @ RG+45 ; 5km @ RG-5 # taper");
  });
  it("replaces the second segment, leaving the first untouched", () => {
    const result = replaceSegmentInDayLine("D3: 10km @ RG+20 ; 5km @ RG-5", 1, "6km @ RG-5");
    expect(result).toBe("D3: 10km @ RG+20 ; 6km @ RG-5");
  });
  it("works on a single-segment day", () => {
    expect(replaceSegmentInDayLine("D1: 5km @ RG", 0, "8km @ RG")).toBe("D1: 8km @ RG");
  });
  it("preserves suffix/tag prefix", () => {
    expect(replaceSegmentInDayLine("D6a [long]: 12mi @ AEROBIC", 0, "14mi @ AEROBIC")).toBe("D6a [long]: 14mi @ AEROBIC");
  });
  it("returns the line unchanged for an out-of-range segment index", () => {
    expect(replaceSegmentInDayLine("D1: 5km @ RG", 1, "8km @ RG")).toBe("D1: 5km @ RG");
  });
  it("returns the line unchanged when it doesn't match the D-line grammar", () => {
    expect(replaceSegmentInDayLine("not a day line", 0, "x")).toBe("not a day line");
  });
});

describe("swapDayContent (HRA-127)", () => {
  it("swaps workout content, each day keeping its own D-number prefix", () => {
    expect(swapDayContent("D1: 5km @ RG", "D3: 4x1000m @ RG-20")).toEqual(["D1: 4x1000m @ RG-20", "D3: 5km @ RG"]);
  });
  it("preserves each side's own suffix/tag prefix, not the other side's", () => {
    expect(swapDayContent("D6a [long]: 12mi @ AEROBIC", "D2: REST")).toEqual(["D6a [long]: REST", "D2: 12mi @ AEROBIC"]);
  });
  it("swaps a trailing # note along with the workout text (the note travels with the content, not the day)", () => {
    expect(swapDayContent("D1: 5km @ RG # easy", "D4: REST # taper")).toEqual(["D1: REST # taper", "D4: 5km @ RG # easy"]);
  });
  it("leaves both lines unchanged when either doesn't match the D-line grammar", () => {
    expect(swapDayContent("not a day line", "D2: REST")).toEqual(["not a day line", "D2: REST"]);
  });
});

describe("replaceSpan — content-anchored, single-occurrence", () => {
  it("replaces the one occurrence", () => {
    const result = replaceSpan("A\nB\nC", "B", "B2");
    expect(result).toEqual({ ok: true, source: "A\nB2\nC" });
  });
  it("fails when the old text isn't found", () => {
    expect(replaceSpan("A\nB\nC", "Z", "Z2")).toEqual({ ok: false, reason: "not-found" });
  });
  it("fails when the old text appears more than once (refuses to guess)", () => {
    expect(replaceSpan("A\nB\nB\nC", "B", "B2")).toEqual({ ok: false, reason: "ambiguous" });
  });
  it("no-ops when old and new text are identical", () => {
    expect(replaceSpan("A\nB\nC", "B", "B")).toEqual({ ok: true, source: "A\nB\nC" });
  });
});

describe("multi-section/week/day fixture — patches touch only the intended lines (AC3)", () => {
  const original = [
    "PLAN",
    "NAME Boston Prep",
    "PACE RG=5:00/km",
    `SECTION "Base" WEEKS 1-2`,
    "WEEK 1 START 2026-09-01",
    "D1: 5km @ RG",
    "D3 [interval]: 4x1000m @ RG-20 r:1km @ RG+10",
    "WEEK 2",
    "D1: 6km @ RG",
    `SECTION "Peak" WEEKS 3-4 # sharpen`,
    "WEEK 3",
    "D1: 8km @ RG",
  ].join("\n");

  it("editing one section's name only changes that SECTION line", () => {
    const newHeader = serializeSectionHeader(`SECTION "Base" WEEKS 1-2`, { name: "Foundation" });
    const result = replaceSpan(original, `SECTION "Base" WEEKS 1-2`, newHeader);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changedLines = original.split("\n").map((line, i) => [line, result.source.split("\n")[i]] as const)
      .filter(([before, after]) => before !== after);
    expect(changedLines).toEqual([[`SECTION "Base" WEEKS 1-2`, `SECTION "Foundation" WEEKS 1-2`]]);
  });

  it("editing week 2's note only changes that WEEK line, not week 1's or week 3's", () => {
    const newHeader = serializeWeekHeader("WEEK 2", { notes: "cutback" });
    const result = replaceSpan(original, "WEEK 2", newHeader);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changedLines = original.split("\n").map((line, i) => [line, result.source.split("\n")[i]] as const)
      .filter(([before, after]) => before !== after);
    expect(changedLines).toEqual([["WEEK 2", "WEEK 2 # cutback"]]);
  });

  it("editing one day's dsl only changes that D-line, leaving an identical sibling day elsewhere untouched", () => {
    // "D1: 8km @ RG" (week 3) is a DIFFERENT day from week 1's "D1: 5km @ RG"
    // and week 2's "D1: 6km @ RG" — all three D1 lines have distinct text
    // here, so replaceSpan's uniqueness check is exercised meaningfully.
    const newLine = recomposeDayLine("D1: 8km @ RG", { dsl: "D1: 10km @ RG" });
    const result = replaceSpan(original, "D1: 8km @ RG", newLine);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const changedLines = original.split("\n").map((line, i) => [line, result.source.split("\n")[i]] as const)
      .filter(([before, after]) => before !== after);
    expect(changedLines).toEqual([["D1: 8km @ RG", "D1: 10km @ RG"]]);
  });

  it("chained edits to the same section (name, then note) each touch only their own line, applied in sequence", () => {
    let source = original;
    const step1 = replaceSpan(source, `SECTION "Peak" WEEKS 3-4 # sharpen`, serializeSectionHeader(`SECTION "Peak" WEEKS 3-4 # sharpen`, { name: "Taper" }));
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;
    source = step1.source;
    // The next edit must target the text this step just produced, not the original.
    const currentHeader = `SECTION "Taper" WEEKS 3-4 # sharpen`;
    const step2 = replaceSpan(source, currentHeader, serializeSectionHeader(currentHeader, { notes: "final push" }));
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;
    const changedLines = original.split("\n").map((line, i) => [line, step2.source.split("\n")[i]] as const)
      .filter(([before, after]) => before !== after);
    expect(changedLines).toEqual([[`SECTION "Peak" WEEKS 3-4 # sharpen`, `SECTION "Taper" WEEKS 3-4 # final push`]]);
  });
});
