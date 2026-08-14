/**
 * domain/activity-chart.test.ts  (HRA-69)
 * Pure chart-data logic. Unit-dependent functions are asserted under both
 * metric and imperial; setUnitSystem is reset after each test.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { TrackPoint } from "@/types/api";
import { setUnitSystem } from "@/utils/units";
import {
  metricValue, metricUnit, fmtMetricValue, percentile,
  axisDomainCentered, axisDomainMinMax, magnitudeColor, fmtElapsedClock,
  buildChartData, xTickFormatter,
} from "./activity-chart";

afterEach(() => setUnitSystem("metric"));

function pt(o: Partial<TrackPoint>): TrackPoint {
  return {
    elapsed_sec: null, timestamp_unix: null, distance_m: null, heart_rate: null,
    speed_ms: null, cadence: null, altitude_m: null, temperature: null, power: null, ...o,
  };
}

describe("percentile", () => {
  it("interpolates linearly and handles the ends", () => {
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5], 1)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([10, 20], 0.5)).toBe(15);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("metricValue", () => {
  it("speed: m/s → km/h (metric) or mph (imperial)", () => {
    setUnitSystem("metric");
    expect(metricValue(pt({ speed_ms: 3 }), "speed", "speed")).toBeCloseTo(10.8, 5);
    setUnitSystem("imperial");
    expect(metricValue(pt({ speed_ms: 3 }), "speed", "speed")).toBeCloseTo(6.7108, 3);
  });
  it("pace: min/km (metric) or min/mi (imperial); undefined near zero speed", () => {
    setUnitSystem("metric");
    expect(metricValue(pt({ speed_ms: 3 }), "speed", "pace")).toBeCloseTo(5.5556, 3);
    expect(metricValue(pt({ speed_ms: 0.05 }), "speed", "pace")).toBeNull();
    setUnitSystem("imperial");
    expect(metricValue(pt({ speed_ms: 3 }), "speed", "pace")).toBeCloseTo(8.9407, 3);
  });
  it("altitude converts to feet in imperial; hr/cadence/power pass through", () => {
    setUnitSystem("imperial");
    expect(metricValue(pt({ altitude_m: 100 }), "altitude_m", "speed")).toBeCloseTo(328.084, 2);
    expect(metricValue(pt({ heart_rate: 150 }), "heart_rate", "speed")).toBe(150);
    expect(metricValue(pt({ cadence: 170 }), "cadence", "speed")).toBe(170);
    expect(metricValue(pt({ power: 220 }), "power", "speed")).toBe(220);
  });
  it("returns null for a missing speed sample", () => {
    expect(metricValue(pt({ speed_ms: null }), "speed", "speed")).toBeNull();
  });
});

describe("metricUnit", () => {
  it("resolves per metric and unit system", () => {
    setUnitSystem("metric");
    expect(metricUnit("speed", "speed")).toBe("km/h");
    expect(metricUnit("speed", "pace")).toBe("min/km");
    setUnitSystem("imperial");
    expect(metricUnit("speed", "speed")).toBe("mph");
    expect(metricUnit("speed", "pace")).toBe("min/mi");
    expect(metricUnit("heart_rate", "speed")).toBe("bpm");
    expect(metricUnit("cadence", "speed")).toBe("spm");
    expect(metricUnit("power", "speed")).toBe("W");
  });
});

describe("fmtMetricValue", () => {
  it("renders pace as m:ss, everything else as 1dp", () => {
    expect(fmtMetricValue("speed", 5.5, "pace")).toBe("5:30");
    expect(fmtMetricValue("speed", 10.84, "speed")).toBe("10.8");
    expect(fmtMetricValue("heart_rate", 152.4, "speed")).toBe("152.4");
  });
});

describe("axis domains", () => {
  it("centered returns [0,1] when empty, else a mean-centered band", () => {
    expect(axisDomainCentered([], "heart_rate", "speed")).toEqual([0, 1]);
    const [lo, hi] = axisDomainCentered([pt({ heart_rate: 140 }), pt({ heart_rate: 160 })], "heart_rate", "speed");
    expect(lo).toBeLessThan(150);
    expect(hi).toBeGreaterThan(150);
  });
  it("minMax returns a padded real range", () => {
    const [lo, hi] = axisDomainMinMax([pt({ heart_rate: 100 }), pt({ heart_rate: 200 })], "heart_rate", "speed");
    expect(lo).toBeLessThan(100);
    expect(hi).toBeGreaterThan(200);
  });
});

describe("magnitudeColor", () => {
  it("interpolates pale→deep yellow, clamped", () => {
    expect(magnitudeColor(0, 300)).toBe("rgb(254,249,195)");
    expect(magnitudeColor(300, 300)).toBe("rgb(234,179,8)");
    expect(magnitudeColor(600, 300)).toBe("rgb(234,179,8)"); // clamped at cap
  });
});

describe("fmtElapsedClock", () => {
  it("formats m:ss and h:mm:ss", () => {
    expect(fmtElapsedClock(605)).toBe("10:05");
    expect(fmtElapsedClock(3661)).toBe("1:01:01");
  });
});

describe("buildChartData", () => {
  const three = [pt({ distance_m: 0, speed_ms: 3 }), pt({ distance_m: 10, speed_ms: 3 }), pt({ distance_m: 20, speed_ms: 3 })];

  it("distance mode: realX tracks distance, x is cumulative", () => {
    const rows = buildChartData(three, [], "distance", ["speed"], "speed");
    expect(rows.map(r => r.realX)).toEqual([0, 10, 20]);
    expect(rows[0].x).toBe(0);
    expect(rows[2].x).toBeGreaterThan(rows[1].x);
  });

  it("inserts a null-value break row for a pause, carrying its duration", () => {
    const rows = buildChartData(three.slice(0, 2), [{ afterIndex: 0, durationSec: 360 }], "distance", ["speed"], "speed");
    const brk = rows.find(r => r.realX === null);
    expect(brk).toBeDefined();
    expect(brk!.pauseDurationSec).toBe(360);
    expect(brk!.speed).toBeNull();
  });

  it("gives an outlier step zero width (x does not advance across it)", () => {
    const rows = buildChartData(three, [], "distance", ["speed"], "speed", [false, false, true]);
    // step p1→p2 is an outlier step → contributes 0, so x[2] === x[1]
    expect(rows[2].x).toBe(rows[1].x);
  });

  it("time mode uses timestamp_unix elapsed, not elapsed_sec", () => {
    const pts = [pt({ timestamp_unix: 1000, elapsed_sec: 0, speed_ms: 3 }), pt({ timestamp_unix: 1060, elapsed_sec: 5, speed_ms: 3 })];
    const rows = buildChartData(pts, [], "time", ["speed"], "speed");
    expect(rows.map(r => r.realX)).toEqual([0, 60]); // 1060-1000, not elapsed_sec's 5
  });
});

describe("xTickFormatter", () => {
  it("maps a tick to the nearest row's formatted realX", () => {
    const rows = buildChartData([pt({ distance_m: 0, speed_ms: 3 }), pt({ distance_m: 2000, speed_ms: 3 })], [], "distance", ["speed"], "speed");
    const fmt = xTickFormatter(rows, "distance");
    expect(fmt(rows[1].x)).toBe("2.00 km");
    const fmtT = xTickFormatter(
      buildChartData([pt({ timestamp_unix: 0, speed_ms: 3 }), pt({ timestamp_unix: 605, speed_ms: 3 })], [], "time", ["speed"], "speed"),
      "time",
    );
    expect(fmtT(605)).toBe("10:05");
  });
});
