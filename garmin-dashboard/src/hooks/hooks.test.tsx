/**
 * hooks.test.tsx  (HRA-67)
 * Behaviour-level tests for the three hooks the epic touches:
 *  - useQuery: loading → success/error, and refetch re-runs the fn.
 *  - useDateRange: presets move `from` while `to` tracks today.
 *  - useAppearance: fetch-on-mount applies theme + unit system to the document
 *    / module state (the source of the load-bearing unit propagation).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { StrictMode, useState, type ReactNode } from "react";
import { renderHook, act, waitFor, render, screen } from "@testing-library/react";
import { useQuery } from "./useQuery";
import { useDateRange } from "./useDateRange";
import { useCompareRange } from "./useCompareRange";
import { ALL_SENTINEL, daysBetween } from "@/utils/date";
import { useAppearance } from "./useAppearance";
import { installFetch, json } from "@/test/api-stub";
import { settings } from "@/test/fixtures";
import { getUnitSystem, setUnitSystem } from "@/utils/units";
import { AppModeContext, GUEST_CAPABILITIES } from "@/hooks/useAppMode";
import { SettingsProvider } from "@/hooks/useSettings";
import i18next from "@/i18n";

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

    it("locks comparison off while All is selected — setEnabled(true) is a no-op, and it stays off across a later `to` edit", () => {
      const { result, rerender } = renderHook(
        ({ from, to }) => useCompareRange(from, to, URL_KEYS),
        { initialProps: { from: "2026-08-01", to: "2026-08-10" } },
      );
      rerender({ from: ALL_SENTINEL, to: "2026-08-10" });
      expect(result.current.enabled).toBe(false);

      // Comparison has no natural "previous period" while All is selected
      // (HRA-256) — manually re-enabling it is locked out entirely, not just
      // defaulted off once.
      act(() => result.current.setEnabled(true));
      expect(result.current.enabled).toBe(false);

      // `from` stays the sentinel — only `to` changes, still within All.
      rerender({ from: ALL_SENTINEL, to: "2026-08-11" });
      expect(result.current.enabled).toBe(false);

      // Leaving All restores normal enable/disable behavior.
      rerender({ from: "2026-08-01", to: "2026-08-10" });
      act(() => result.current.setEnabled(true));
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

// HRA-379: Guest language is a browser-local preference — never a Settings
// row (HRA-374, Guest never fetches/writes /api/v1/settings).
describe("useAppearance — Guest language (HRA-379)", () => {
  const GUEST_KEY = "hra-guest-language-v1";
  const setBrowserLang = (lang: string) =>
    Object.defineProperty(window.navigator, "language", { value: lang, configurable: true });
  // SettingsProvider (not just the AppModeContext) has to be mounted here —
  // it's what actually gates the GET /api/v1/settings fetch by canPersist;
  // useSettings()'s own standalone fallback (no SettingsProvider ancestor)
  // fetches unconditionally, same as any other component would if mounted
  // outside the real App tree.
  const guestWrapper = ({ children }: { children: ReactNode }) => (
    <AppModeContext value={GUEST_CAPABILITIES}><SettingsProvider>{children}</SettingsProvider></AppModeContext>
  );

  afterEach(async () => {
    localStorage.clear();
    await i18next.changeLanguage("en");
  });

  it("Guest saved preference wins over browser locale, and Settings is never fetched", async () => {
    const fetchMock = installFetch({});
    localStorage.setItem(GUEST_KEY, "it");
    setBrowserLang("en-US");

    const { result } = renderHook(() => useAppearance(), { wrapper: guestWrapper });

    await waitFor(() => expect(result.current.resolvedLanguage).toBe("it"));
    await waitFor(() => expect(i18next.language).toBe("it"));
    expect(fetchMock.mock.calls.some(([input]) => input.toString().includes("/api/v1/settings"))).toBe(false);
  });

  it("falls back to browser-locale detection with no saved Guest preference", async () => {
    installFetch({});
    setBrowserLang("fr-FR");

    const { result } = renderHook(() => useAppearance(), { wrapper: guestWrapper });

    await waitFor(() => expect(result.current.resolvedLanguage).toBe("fr"));
  });

  it("falls back to English for an unsupported browser locale", async () => {
    installFetch({});
    setBrowserLang("nl-NL");

    const { result } = renderHook(() => useAppearance(), { wrapper: guestWrapper });

    await waitFor(() => expect(result.current.resolvedLanguage).toBe("en"));
  });

  it("ignores an invalid stored value and falls back to browser locale, without crashing", async () => {
    installFetch({});
    localStorage.setItem(GUEST_KEY, "xx");
    setBrowserLang("de-DE");

    const { result } = renderHook(() => useAppearance(), { wrapper: guestWrapper });

    await waitFor(() => expect(result.current.resolvedLanguage).toBe("de"));
  });

  it("selecting a language persists it, applies immediately, and never calls the Settings API", async () => {
    const fetchMock = installFetch({});
    setBrowserLang("en-US");
    const { result } = renderHook(() => useAppearance(), { wrapper: guestWrapper });
    await waitFor(() => expect(result.current.resolvedLanguage).toBe("en"));

    await act(async () => { await result.current.setLanguage?.("ja"); });

    expect(result.current.resolvedLanguage).toBe("ja");
    expect(i18next.language).toBe("ja");
    expect(localStorage.getItem(GUEST_KEY)).toBe("ja");
    expect(fetchMock.mock.calls.some(([input]) => input.toString().includes("/api/v1/settings"))).toBe(false);
  });

  it("still applies the language for the running app when localStorage.setItem throws", async () => {
    installFetch({});
    setBrowserLang("en-US");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const { result } = renderHook(() => useAppearance(), { wrapper: guestWrapper });
    await waitFor(() => expect(result.current.resolvedLanguage).toBe("en"));

    await act(async () => { await result.current.setLanguage?.("es"); });

    expect(result.current.resolvedLanguage).toBe("es");
    expect(i18next.language).toBe("es");
    setItemSpy.mockRestore();
  });

  it("uses the browser-locale fallback and stays functional when localStorage.getItem throws", async () => {
    installFetch({});
    setBrowserLang("de-DE");
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });

    const { result } = renderHook(() => useAppearance(), { wrapper: guestWrapper });

    await waitFor(() => expect(result.current.resolvedLanguage).toBe("de"));
    getItemSpy.mockRestore();
  });

  it("an authenticated user's persisted language is unaffected by a Guest localStorage preference", async () => {
    localStorage.setItem(GUEST_KEY, "it");
    installFetch({ "GET /api/v1/settings": settings({ language: "fr" }) });

    const { result } = renderHook(() => useAppearance());

    await waitFor(() => expect(result.current.resolvedLanguage).toBe("fr"));
  });

  it("changing the authenticated user's language calls the Settings API and leaves the Guest preference untouched", async () => {
    localStorage.setItem(GUEST_KEY, "it");
    const fetchMock = installFetch({
      "GET /api/v1/settings": settings({ language: "en" }),
      "PUT /api/v1/settings/language": json(settings({ language: "de" })),
    });

    const { result } = renderHook(() => useAppearance());
    await waitFor(() => expect(result.current.settings).not.toBeNull());

    await act(async () => { await result.current.setLanguage?.("de"); });

    expect(fetchMock.mock.calls.some(([input, init]) =>
      new URL(input.toString(), "http://localhost").pathname === "/api/v1/settings/language" &&
      (init?.method ?? "GET").toUpperCase() === "PUT",
    )).toBe(true);
    expect(localStorage.getItem(GUEST_KEY)).toBe("it");
  });

  it("returning to Guest mode (e.g. after logout) re-applies the stored Guest preference", async () => {
    localStorage.setItem(GUEST_KEY, "it");
    installFetch({ "GET /api/v1/settings": settings({ language: "en" }) });

    function Display() {
      const appearance = useAppearance();
      return <div data-testid="lang">{appearance.resolvedLanguage}</div>;
    }
    function Harness() {
      const [mode, setMode] = useState<"authenticated" | "guest">("authenticated");
      const capabilities = mode === "guest" ? GUEST_CAPABILITIES : undefined;
      const body = <Display />;
      return (
        <>
          <button onClick={() => setMode("guest")}>Log out</button>
          {capabilities ? <AppModeContext value={capabilities}>{body}</AppModeContext> : body}
        </>
      );
    }
    // Renders authenticated first (settings resolve to "en"), then flips to
    // Guest — the [mode]-keyed effect in useAppearance re-runs and restores
    // the browser-local "it" preference.
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("lang").textContent).toBe("en"));

    act(() => screen.getByText("Log out").click());
    await waitFor(() => expect(screen.getByTestId("lang").textContent).toBe("it"));
  });
});
