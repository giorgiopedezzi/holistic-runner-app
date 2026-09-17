import { describe, it, expect, afterEach, vi } from "vitest";
import { readGuestLanguage, writeGuestLanguage } from "./guestLanguage";

const KEY = "hra-guest-language-v1";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("guestLanguage", () => {
  it("reads a valid stored language", () => {
    localStorage.setItem(KEY, "it");
    expect(readGuestLanguage()).toBe("it");
  });

  it("returns null when nothing is stored", () => {
    expect(readGuestLanguage()).toBeNull();
  });

  it("ignores and removes an invalid/stale stored value", () => {
    localStorage.setItem(KEY, "xx");
    expect(readGuestLanguage()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("writes a valid language under the versioned key", () => {
    writeGuestLanguage("ja");
    expect(localStorage.getItem(KEY)).toBe("ja");
  });

  it("fails soft when getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readGuestLanguage()).toBeNull();
  });

  it("fails soft when setItem throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => writeGuestLanguage("de")).not.toThrow();
  });
});
