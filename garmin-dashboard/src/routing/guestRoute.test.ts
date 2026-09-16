import { describe, expect, it } from "vitest";
import { DEFAULT_FOUNDER_SLUG, guestPath, parseGuestRoute } from "./guestRoute";

describe("parseGuestRoute", () => {
  it("resolves the bare root to the default founder journey", () => {
    expect(parseGuestRoute("/")).toEqual({ slug: DEFAULT_FOUNDER_SLUG, view: "journey", activityId: null, reportId: null });
  });

  it("parses the profile root", () => {
    expect(parseGuestRoute("/p/giorgio")).toEqual({ slug: "giorgio", view: "journey", activityId: null, reportId: null });
    expect(parseGuestRoute("/p/giorgio/")).toEqual({ slug: "giorgio", view: "journey", activityId: null, reportId: null });
  });

  it("parses the plan, activities, and progress list routes", () => {
    expect(parseGuestRoute("/p/giorgio/plan")).toEqual({ slug: "giorgio", view: "plan", activityId: null, reportId: null });
    expect(parseGuestRoute("/p/giorgio/activities")).toEqual({ slug: "giorgio", view: "activities", activityId: null, reportId: null });
    expect(parseGuestRoute("/p/giorgio/progress")).toEqual({ slug: "giorgio", view: "reports", activityId: null, reportId: null });
  });

  it("parses activity and report detail routes by their opaque public ID", () => {
    expect(parseGuestRoute("/p/giorgio/activities/activity-1")).toEqual({ slug: "giorgio", view: "activities", activityId: "activity-1", reportId: null });
    expect(parseGuestRoute("/p/giorgio/reports/report-1")).toEqual({ slug: "giorgio", view: "reports", activityId: null, reportId: "report-1" });
  });

  it("decodes a percent-encoded slug and public ID", () => {
    expect(parseGuestRoute("/p/giorgio%20p/activities/act%201")).toEqual({ slug: "giorgio p", view: "activities", activityId: "act 1", reportId: null });
  });

  it("falls back to that slug's journey view for an unrecognized sub-path, never guessing a different resource", () => {
    expect(parseGuestRoute("/p/giorgio/nonsense")).toEqual({ slug: "giorgio", view: "journey", activityId: null, reportId: null });
    expect(parseGuestRoute("/p/giorgio/activities/act-1/extra")).toEqual({ slug: "giorgio", view: "journey", activityId: null, reportId: null });
    expect(parseGuestRoute("/p/giorgio/reports")).toEqual({ slug: "giorgio", view: "journey", activityId: null, reportId: null });
  });

  it("never crashes or lets a malformed path escape the /p/ family", () => {
    expect(parseGuestRoute("/settings")).toEqual({ slug: DEFAULT_FOUNDER_SLUG, view: "journey", activityId: null, reportId: null });
    expect(parseGuestRoute("")).toEqual({ slug: DEFAULT_FOUNDER_SLUG, view: "journey", activityId: null, reportId: null });
  });
});

describe("guestPath", () => {
  it("builds the canonical path for every view, round-tripping through parseGuestRoute", () => {
    const cases: Array<[Parameters<typeof guestPath>, string]> = [
      [["giorgio", "journey"], "/p/giorgio"],
      [["giorgio", "plan"], "/p/giorgio/plan"],
      [["giorgio", "activities"], "/p/giorgio/activities"],
      [["giorgio", "activities", "activity-1"], "/p/giorgio/activities/activity-1"],
      [["giorgio", "reports"], "/p/giorgio/progress"],
      [["giorgio", "reports", "report-1"], "/p/giorgio/reports/report-1"],
    ];
    for (const [args, expected] of cases) {
      const path = guestPath(...args);
      expect(path).toBe(expected);
      expect(parseGuestRoute(path)).toEqual({
        slug: "giorgio",
        view: args[1],
        activityId: args[1] === "activities" ? (args[2] ?? null) : null,
        reportId: args[1] === "reports" ? (args[2] ?? null) : null,
      });
    }
  });

  it("percent-encodes a slug or public ID containing reserved characters", () => {
    expect(guestPath("gior gio", "activities", "act/1")).toBe("/p/gior%20gio/activities/act%2F1");
  });
});
