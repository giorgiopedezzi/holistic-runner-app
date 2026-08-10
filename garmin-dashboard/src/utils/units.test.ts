/**
 * src/utils/units.test.ts  (HRA-63)
 * Pure conversion + label logic — permanent foundation, unaffected by HRA-36.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  kmToMi, mToFt, kgToLb, paceKmToMi, kmhToMph,
  setUnitSystem, getUnitSystem, detectUnitSystemFromLocale,
  distanceUnitLabel, paceUnitLabel, speedUnitLabel, weightUnitLabel, elevationUnitLabel,
} from "./units";

describe("unit conversions (exact constants)", () => {
  it("converts distance/elevation/weight against known factors", () => {
    expect(kmToMi(1.609344)).toBeCloseTo(1, 10);
    expect(mToFt(0.3048)).toBeCloseTo(1, 10);
    expect(kgToLb(0.45359237)).toBeCloseTo(1, 10);
  });

  it("converts pace and speed", () => {
    // min/km → min/mi scales UP by km-per-mile (a mile takes longer).
    expect(paceKmToMi(5)).toBeCloseTo(5 * 1.609344, 10);
    expect(kmhToMph(1.609344)).toBeCloseTo(1, 10);
  });

  it("reproduces the documented reference-activity conversions", () => {
    expect(kmToMi(6205.29 / 1000).toFixed(2)).toBe("3.86"); // distance
    expect(Math.round(mToFt(31))).toBe(102);                // ascent
    expect(kgToLb(78.8).toFixed(1)).toBe("173.7");          // body weight
    expect((2.873 * 3.6 / 1.609344).toFixed(1)).toBe("6.4"); // avg speed m/s → mph
  });
});

describe("unit-system state + labels", () => {
  afterEach(() => setUnitSystem("metric")); // module-global; reset between tests

  it("get/set round-trips and drives the labels", () => {
    setUnitSystem("metric");
    expect(getUnitSystem()).toBe("metric");
    expect([distanceUnitLabel(), paceUnitLabel(), speedUnitLabel(), weightUnitLabel(), elevationUnitLabel()])
      .toEqual(["km", "min/km", "km/h", "kg", "m"]);

    setUnitSystem("imperial");
    expect([distanceUnitLabel(), paceUnitLabel(), speedUnitLabel(), weightUnitLabel(), elevationUnitLabel()])
      .toEqual(["mi", "min/mi", "mph", "lb", "ft"]);
  });
});

describe("detectUnitSystemFromLocale (best-effort locale heuristic)", () => {
  const setLang = (lang: string) =>
    Object.defineProperty(window.navigator, "language", { value: lang, configurable: true });

  it("maps imperial regions to imperial, everything else to metric", () => {
    setLang("en-US");
    expect(detectUnitSystemFromLocale()).toBe("imperial");
    setLang("fr-FR");
    expect(detectUnitSystemFromLocale()).toBe("metric");
    setLang("it-IT");
    expect(detectUnitSystemFromLocale()).toBe("metric");
  });
});
