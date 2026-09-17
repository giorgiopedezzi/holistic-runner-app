import { describe, expect, it } from "vitest";
import { formatAthleteMetrics, parseAthleteMetrics } from "./athleteMetrics";

describe("athlete metric unit forms", () => {
  const canonical = {
    current_easy_pace_sec_per_km: 330,
    current_race_pace_sec_per_km: 270,
    current_long_run_target_m: 20000,
  };

  it("round-trips canonical values through metric and imperial display without drift", () => {
    expect(parseAthleteMetrics(formatAthleteMetrics(canonical, "metric"), "metric")).toEqual(canonical);
    expect(parseAthleteMetrics(formatAthleteMetrics(canonical, "imperial"), "imperial")).toEqual(canonical);
  });

  it("preserves nullable partial profiles and rejects invalid values", () => {
    const partial = { ...canonical, current_race_pace_sec_per_km: null };
    expect(parseAthleteMetrics(formatAthleteMetrics(partial, "metric"), "metric")).toEqual(partial);
    expect(parseAthleteMetrics({ easyPace: "0:00", racePace: "4:30", longRunTarget: "20" }, "metric")).toBeUndefined();
    expect(parseAthleteMetrics({ easyPace: "5:75", racePace: "4:30", longRunTarget: "20" }, "metric")).toBeUndefined();
    expect(parseAthleteMetrics({ easyPace: "5:30", racePace: "4:30", longRunTarget: "-1" }, "metric")).toBeUndefined();
  });
});
