import { useReducer, type SetStateAction } from "react";
import type { SectionView } from "@/domain/runplan-aggregate";
import { isoToday } from "@/utils/date";

export const NONE_ANCHOR = "__none__";

export interface AnchorRowState {
  absoluteValue: string;
  relativeTo: string;
  sign: "+" | "-";
  seconds: string;
}

export interface PlanInstanceEditorBaseline {
  instName: string;
  raceName: string;
  raceDate: string;
  raceUrl: string;
  startDate: string;
  anchorRows: Record<string, AnchorRowState>;
  racePaceAnchor: string;
  paceMode: "anchor" | "goalTime";
  goalTimeDigits: string;
  distanceM: string;
  persistedDsl: Record<string, string>;
}

export interface PlanInstanceEditorState {
  templateId: string;
  instName: string;
  raceName: string;
  raceDate: string;
  raceUrl: string;
  startDate: string;
  daysBeforeRace: string;
  restDayLabel: string;
  racePaceAnchor: string;
  paceMode: "anchor" | "goalTime";
  goalTimeDigits: string;
  distanceM: string;
  anchorRows: Record<string, AnchorRowState>;
  sections: SectionView[];
  effectiveFrom: string;
  editApprovedAt: string | null;
  saveForcedEnabled: boolean;
  baseline: PlanInstanceEditorBaseline;
}

export type PlanInstanceDraft = PlanInstanceEditorState;

export function emptyAnchorRow(): AnchorRowState {
  return { absoluteValue: "", relativeTo: "", sign: "+", seconds: "" };
}

export function anchorRowIsEmpty(row: AnchorRowState): boolean {
  return row.absoluteValue.trim() === "" && row.relativeTo === "" && row.seconds.trim() === "";
}

export function createEmptyEditorState(): PlanInstanceEditorState {
  return {
    templateId: "",
    instName: "",
    raceName: "",
    raceDate: "",
    raceUrl: "",
    startDate: isoToday(),
    daysBeforeRace: "",
    restDayLabel: "",
    racePaceAnchor: NONE_ANCHOR,
    paceMode: "anchor",
    goalTimeDigits: "",
    distanceM: "",
    anchorRows: {},
    sections: [],
    effectiveFrom: isoToday(),
    editApprovedAt: null,
    saveForcedEnabled: false,
    baseline: {
      instName: "",
      raceName: "",
      raceDate: "",
      raceUrl: "",
      startDate: "",
      anchorRows: {},
      racePaceAnchor: NONE_ANCHOR,
      paceMode: "anchor",
      goalTimeDigits: "",
      distanceM: "",
      persistedDsl: {},
    },
  };
}

type StateKey = Exclude<keyof PlanInstanceEditorState, "baseline">;
type BaselineKey = keyof PlanInstanceEditorBaseline;

type Action =
  | { type: "replace"; state: PlanInstanceEditorState }
  | { type: "reset" }
  | { type: "set"; key: StateKey; value: unknown }
  | { type: "setBaseline"; key: BaselineKey; value: unknown };

function resolveUpdate<T>(current: T, next: SetStateAction<T>): T {
  return typeof next === "function" ? (next as (prev: T) => T)(current) : next;
}

function reducer(state: PlanInstanceEditorState, action: Action): PlanInstanceEditorState {
  switch (action.type) {
    case "replace":
      return action.state;
    case "reset":
      return createEmptyEditorState();
    case "set": {
      const key = action.key;
      const next = resolveUpdate(state[key], action.value as SetStateAction<(typeof state)[typeof key]>);
      return { ...state, [key]: next };
    }
    case "setBaseline": {
      const key = action.key;
      const next = resolveUpdate(
        state.baseline[key],
        action.value as SetStateAction<(typeof state.baseline)[typeof key]>,
      );
      return { ...state, baseline: { ...state.baseline, [key]: next } };
    }
  }
}

export interface PlanInstanceEditorStateController {
  state: PlanInstanceEditorState;
  reset: () => void;
  replace: (state: PlanInstanceEditorState) => void;
  snapshot: () => PlanInstanceDraft;
  setField: <K extends StateKey>(key: K, value: SetStateAction<PlanInstanceEditorState[K]>) => void;
  setBaselineField: <K extends BaselineKey>(key: K, value: SetStateAction<PlanInstanceEditorBaseline[K]>) => void;
  setter: <K extends StateKey>(key: K) => (value: SetStateAction<PlanInstanceEditorState[K]>) => void;
  baselineSetter: <K extends BaselineKey>(key: K) => (value: SetStateAction<PlanInstanceEditorBaseline[K]>) => void;
}

export function usePlanInstanceEditorState(): PlanInstanceEditorStateController {
  const [state, dispatch] = useReducer(reducer, undefined, createEmptyEditorState);

  return {
    state,
    reset: () => dispatch({ type: "reset" }),
    replace: stateToRestore => dispatch({ type: "replace", state: stateToRestore }),
    snapshot: () => state,
    setField: (key, value) => dispatch({ type: "set", key, value }),
    setBaselineField: (key, value) => dispatch({ type: "setBaseline", key, value }),
    setter: key => value => dispatch({ type: "set", key, value }),
    baselineSetter: key => value => dispatch({ type: "setBaseline", key, value }),
  };
}

