import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUrlState } from "./useUrlState";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("useUrlState", () => {
  it("reads the initial value from the URL's query string", () => {
    window.history.replaceState(null, "", "/?tab=body");
    const { result } = renderHook(() => useUrlState("tab", "overview"));
    expect(result.current[0]).toBe("body");
  });

  it("falls back to the default when the param is absent", () => {
    window.history.replaceState(null, "", "/");
    const { result } = renderHook(() => useUrlState("tab", "overview"));
    expect(result.current[0]).toBe("overview");
  });

  it("updates the URL via replaceState without adding a history entry", () => {
    window.history.replaceState(null, "", "/");
    const lengthBefore = window.history.length;
    const { result } = renderHook(() => useUrlState("tab", "overview"));

    act(() => result.current[1]("body"));

    expect(result.current[0]).toBe("body");
    expect(window.location.search).toBe("?tab=body");
    expect(window.history.length).toBe(lengthBefore);
  });

  it("merges into existing query params instead of overwriting them", () => {
    window.history.replaceState(null, "", "/?other=1");
    const { result } = renderHook(() => useUrlState("tab", "overview"));

    act(() => result.current[1]("body"));

    const params = new URLSearchParams(window.location.search);
    expect(params.get("tab")).toBe("body");
    expect(params.get("other")).toBe("1");
  });

  it("keeps independent call sites from clobbering each other's keys", () => {
    window.history.replaceState(null, "", "/");
    const { result: tabResult } = renderHook(() => useUrlState("tab", "overview"));
    const { result: otherResult } = renderHook(() => useUrlState("other", "x"));

    act(() => tabResult.current[1]("body"));
    act(() => otherResult.current[1]("y"));

    const params = new URLSearchParams(window.location.search);
    expect(params.get("tab")).toBe("body");
    expect(params.get("other")).toBe("y");
  });
});
