/**
 * src/utils/date.test.ts  (HRA-68)
 * Unit tests for the shared date helpers de-duplicated into utils/date.ts.
 */
import { describe, it, expect } from "vitest";
import { isoToday, isoAgo } from "./date";

const slice = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe("isoToday", () => {
  it("returns today's date as YYYY-MM-DD", () => {
    expect(isoToday()).toBe(slice(Date.now()));
    expect(isoToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isoAgo", () => {
  it("returns the date N days before today", () => {
    expect(isoAgo(30)).toBe(slice(Date.now() - 30 * 86_400_000));
    expect(isoAgo(7)).toBe(slice(Date.now() - 7 * 86_400_000));
  });
  it("isoAgo(0) is today", () => {
    expect(isoAgo(0)).toBe(isoToday());
  });
  it("does NOT itself apply the all-time '2000-01-01' sentinel", () => {
    // The days>=9999 → "2000-01-01" substitution is the CALLER's job
    // (useDateRange.setPreset), covered assertion-identically in
    // hooks/hooks.test.tsx. isoAgo(9999) just returns a real 9999-days-ago date.
    expect(isoAgo(9999)).toBe(slice(Date.now() - 9999 * 86_400_000));
    expect(isoAgo(9999)).not.toBe("2000-01-01");
  });
});
