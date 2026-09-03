/**
 * hooks.test.tsx  (HRA-67)
 * Behaviour-level tests for the three hooks the epic touches:
 *  - useQuery: loading → success/error, and refetch re-runs the fn.
 *  - useDateRange: presets move `from` while `to` tracks today.
 *  - useAppearance: fetch-on-mount applies theme + unit system to the document
 *    / module state (the source of the load-bearing unit propagation).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { StrictMode } from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useQuery } from "./useQuery";
import { useDateRange } from "./useDateRange";
import { useCompareRange } from "./useCompareRange";
import { ALL_SENTINEL, daysBetween } from "@/utils/date";
import { useAppearance } from "./useAppearance";
import { installFetch, json } from "@/test/api-stub";
import { settings } from "@/test/fixtures";
import { getUnitSystem, setUnitSystem } from "@/utils/units";

afterEach(() => {
  vi.unstubAllGlobals();
  setUnitSystem("metric");
  // HRA-196: useDateRange/useCompareRange's opt-in URL persistence uses
  // history.replaceState, which persists across tests sharing this jsdom
  // window — reset it so a later test doesn't inherit an earlier one's params.
  window.history.replaceState(null, "", "/");
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

  describe("URL persistence (HRA-196, opt-in via urlKeys)", () => {
    const URL_KEYS = { from: "from", to: "to" };

    it("hydrates from/to from existing URL params instead of the default window", () => {
      window.history.replaceState(null, "", "/?from=2026-01-01&to=2026-01-15");
      const { result } = renderHook(() => useDateRange(30, URL_KEYS));

      expect(result.current.from).toBe("2026-01-01");
      expect(result.current.to).toBe("2026-01-15");
    });

    it("falls back to the default 30-day window when no params are present", () => {
      const { result } = renderHook(() => useDateRange(30, URL_KEYS));

      expect(result.current.from).toBe(isoAgo(30));
      expect(result.current.to).toBe(isoToday());
    });

    it("writes setPreset/setFrom/setTo into the URL", () => {
      const { result } = renderHook(() => useDateRange(30, URL_KEYS));

      act(() => result.current.setPreset(7));
      const params = new URLSearchParams(window.location.search);
      expect(params.get("from")).toBe(isoAgo(7));
      expect(params.get("to")).toBe(isoToday());
    });

    it("does not touch the URL when urlKeys is omitted (ManageTab's local ranges)", () => {
      const { result } = renderHook(() => useDateRange(30));

      act(() => result.current.setPreset(7));
      expect(window.location.search).toBe("");
    });
  });
});

describe("useCompareRange", () => {
  it("defaults to the same-length window ending the day before `from`, enabled", () => {
    const { result } = renderHook(() => useCompareRange("2026-08-01", "2026-08-10"));
    expect(result.current.from).toBe("2026-07-23");
    expect(result.current.to).toBe("2026-07-31");
    expect(result.current.enabled).toBe(true);
  });

  describe("URL persistence (HRA-196, opt-in via urlKeys)", () => {
    const URL_KEYS = { from: "compareFrom", to: "compareTo", enabled: "compareEnabled" };

    it("hydrates from/to/enabled from existing URL params", () => {
      window.history.replaceState(null, "", "/?compareFrom=2026-01-01&compareTo=2026-01-10&compareEnabled=0");
      const { result } = renderHook(() => useCompareRange("2026-08-01", "2026-08-10", URL_KEYS));

      expect(result.current.from).toBe("2026-01-01");
      expect(result.current.to).toBe("2026-01-10");
      expect(result.current.enabled).toBe(false);
    });

    it("does not wipe a URL-hydrated compare range on initial mount, but resets it on a later current-range change", () => {
      window.history.replaceState(null, "", "/?compareFrom=2026-01-01&compareTo=2026-01-10");
      const { result, rerender } = renderHook(
        ({ from, to }) => useCompareRange(from, to, URL_KEYS),
        { initialProps: { from: "2026-08-01", to: "2026-08-10" } },
      );

      // Survives the initial mount's own from/to effect run.
      expect(result.current.from).toBe("2026-01-01");
      expect(result.current.to).toBe("2026-01-10");

      // A genuine user-driven change to the CURRENT range resets it to the default.
      rerender({ from: "2026-09-01", to: "2026-09-10" });
      expect(result.current.from).toBe("2026-08-23");
      expect(result.current.to).toBe("2026-08-31");
    });

    it("writes setEnabled into the URL as 1/0", () => {
      const { result } = renderHook(() => useCompareRange("2026-08-01", "2026-08-10", URL_KEYS));

      act(() => result.current.setEnabled(false));
      expect(new URLSearchParams(window.location.search).get("compareEnabled")).toBe("0");
    });

    // HRA-256: selecting "All" must not manufacture an automatic multi-decade
    // "previous period" comparison off the useDateRange sentinel.
    it("selecting All disables comparison and does not derive a compare range from the sentinel", () => {
      const { result, rerender } = renderHook(
        ({ from, to }) => useCompareRange(from, to, URL_KEYS),
        { initialProps: { from: "2026-08-01", to: "2026-08-10" } },
      );
      expect(result.current.enabled).toBe(true);

      rerender({ from: ALL_SENTINEL, to: "2026-08-10" });

      expect(result.current.enabled).toBe(false);
      expect(result.current.from).not.toBe("1999-12-31");
      expect(daysBetween(result.current.from, result.current.to)).toBeLessThan(365);
    });

    it("mounting directly into All (e.g. a bookmarked URL) starts with comparison disabled", () => {
      const { result } = renderHook(() => useCompareRange(ALL_SENTINEL, "2026-08-10", URL_KEYS));

      expect(result.current.enabled).toBe(false);
      expect(daysBetween(result.current.from, result.current.to)).toBeLessThan(365);
    });

    it("manually re-enabling comparison while All stays selected is not overridden by a later `to` edit", () => {
      const { result, rerender } = renderHook(
        ({ from, to }) => useCompareRange(from, to, URL_KEYS),
        { initialProps: { from: "2026-08-01", to: "2026-08-10" } },
      );
      rerender({ from: ALL_SENTINEL, to: "2026-08-10" });
      expect(result.current.enabled).toBe(false);

      act(() => result.current.setEnabled(true));
      expect(result.current.enabled).toBe(true);

      // `from` stays the sentinel — only `to` changes, still within All.
      rerender({ from: ALL_SENTINEL, to: "2026-08-11" });
      expect(result.current.enabled).toBe(true);
    });

    // main.tsx wraps the real app in <StrictMode>, which in dev mode
    // double-invokes every effect on mount (mount -> cleanup -> mount again)
    // to surface non-idempotent effects. No other test in this describe
    // block exercises that, which is exactly how the original "isFirst"
    // boolean-ref guard's flaw passed every test while still wiping a
    // URL-hydrated compare range on every real dev-mode page load.
    it("does not wipe a URL-hydrated compare range under StrictMode's double-invoke", async () => {
      window.history.replaceState(null, "", "/?compareFrom=2026-01-01&compareTo=2026-01-10");
      const { result } = renderHook(() => useCompareRange("2026-08-01", "2026-08-10", URL_KEYS), {
        wrapper: StrictMode,
      });

      expect(result.current.from).toBe("2026-01-01");
      expect(result.current.to).toBe("2026-01-10");
    });
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

  // HRA-78: the matchMedia subscription used to depend on the whole
  // `settings` object, so any unrelated settings change (units, background)
  // tore down and re-subscribed the OS-theme listener. It should only
  // re-subscribe when theme itself starts/stops being 'auto'.
  it("does not re-subscribe the OS-theme listener when an unrelated setting changes", async () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: false,
      addEventListener,
      removeEventListener,
    }));

    installFetch({
      "GET /api/v1/settings": settings({ theme: "auto", unit_system: "metric" }),
      "PUT /api/v1/settings/units": json(settings({ theme: "auto", unit_system: "imperial" })),
    });
    const { result } = renderHook(() => useAppearance());

    await waitFor(() => expect(result.current.settings).not.toBeNull());
    expect(addEventListener).toHaveBeenCalledTimes(1);

    await act(async () => { await result.current.setUnits("imperial"); });

    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(removeEventListener).not.toHaveBeenCalled();
  });
});
