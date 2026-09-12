import { describe, expect, it } from "vitest";
import { agendaWorkoutLabel } from "./PlanTemplateAgendaView";

describe("agendaWorkoutLabel", () => {
  it.each([
    ["D1: 15km @ FL; 5km @ RG", "15km @ FL; 5km @ RG"],
    ["  D12: 8km @ RG:10", "8km @ RG:10"],
    ["Tempo: 5km @ RG", "Tempo: 5km @ RG"],
    ["D1: REST", "REST"],
  ])("strips only an initial persisted day prefix: %s", (raw, expected) => {
    expect(agendaWorkoutLabel(raw)).toBe(expected);
  });
});
