/**
 * src/test/setup.ts  (HRA-62)
 * Vitest global setup: registers @testing-library/jest-dom matchers (adds
 * toBeInTheDocument, toHaveTextContent, … and their type augmentation) and
 * auto-cleans the DOM between tests.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Recharts' <ResponsiveContainer> measures its parent via ResizeObserver,
// which jsdom does not implement — without this stub any chart container
// throws "ResizeObserver is not defined" on mount and takes its whole tab
// down with it (HRA-67). A no-op observer is enough: the container still
// mounts (its children just render at 0×0, which the tests never assert on —
// chart visuals are covered by tests/FE-SMOKE.md instead).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// jsdom does not implement window.matchMedia either — App.tsx's header
// (useWideHeader, polish pass) and useAppearance's 'auto' theme/unit
// resolution both call it. Stub reports "no match" (narrow viewport) by
// default, with addEventListener/removeEventListener as no-ops since no
// test in this suite exercises a live breakpoint change.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
});
