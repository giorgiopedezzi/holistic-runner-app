/**
 * hooks.test.tsx  (HRA-67)
 * Behaviour-level tests for the three hooks the epic touches:
 *  - useQuery: loading → success/error, and refetch re-runs the fn.
 *  - useDateRange: presets move `from` while `to` tracks today.
 *  - useAppearance: fetch-on-mount applies theme + unit system to the document
 *    / module state (the source of the load-bearing unit propagation).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useQuery } from "./useQuery";
import { useDateRange } from "./useDateRange";
import { useAppearance } from "./useAppearance";
import { installFetch } from "@/test/api-stub";
import { settings } from "@/test/fixtures";
import { getUnitSystem, setUnitSystem } from "@/utils/units";

afterEach(() => {
  vi.unstubAllGlobals();
  setUnitSystem("metric");
});

describe("useQuery", () => {
  it("transitions loading → success and exposes the data", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const { result } = renderHook(() => useQuery(fn, []));

    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(result.current.state.status).toBe("success"));
    expect(result.current.state).toMatchObject({ status: "success", data: 42 });
  });

  it("transitions loading → error with the message", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useQuery(fn, []));

    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state).toMatchObject({ status: "error", error: "boom" });
  });

  it("refetch re-runs the fn", async () => {
    const fn = vi.fn().mockResolvedValue(1);
    const { result } = renderHook(() => useQuery(fn, []));
    await waitFor(() => expect(result.current.state.status).toBe("success"));

    await act(async () => result.current.refetch());
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("useDateRange", () => {
  const isoAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
  const isoToday = () => new Date().toISOString().slice(0, 10);

  it("defaults `from` to N days ago and `to` to today", () => {
    const { result } = renderHook(() => useDateRange(30));
    expect(result.current.from).toBe(isoAgo(30));
    expect(result.current.to).toBe(isoToday());
  });

  it("applies a day preset and the all-time preset", () => {
    const { result } = renderHook(() => useDateRange(30));

    act(() => result.current.setPreset(7));
    expect(result.current.from).toBe(isoAgo(7));

    act(() => result.current.setPreset(9999));
    expect(result.current.from).toBe("2000-01-01");
    expect(result.current.to).toBe(isoToday());
  });
});

describe("useAppearance", () => {
  it("applies the persisted theme and unit system on mount", async () => {
    installFetch({ "GET /api/v1/settings": settings({ theme: "light", unit_system: "imperial" }) });
    const { result } = renderHook(() => useAppearance());

    await waitFor(() => expect(result.current.settings).not.toBeNull());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(getUnitSystem()).toBe("imperial");
    expect(result.current.resolvedUnitSystem).toBe("imperial");
  });
});
