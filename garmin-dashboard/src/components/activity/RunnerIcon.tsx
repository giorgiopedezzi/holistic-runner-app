import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { CSSProperties } from "react";
import { RunnerGlyph } from "./RunnerGlyph";

export interface RunnerIconHandle {
  // pauseDurationSec: null while actually running/striding; a number (the
  // pause's duration) whenever the runner is parked on a pause row —
  // >= LONG_PAUSE_SEC bends the runner over instead of just standing.
  show(cx: number, color: string, pauseDurationSec: number | null, dwelling?: boolean): void;
  hide(): void;
}

const RUNNER_SIZE = 25;
const STRIDE_MS = 180;
const LONG_PAUSE_SEC = 60; // >= this, "bent" instead of "stand"

// Isolated local state, exposed via an imperative handle instead of props —
// a hover/playback update here re-renders only this tiny component, never
// the parent (and never the chart it sits above), so the icon can track the
// mouse (or the autoplay loop) at native event/frame frequency with zero
// cost to the chart. If this were a prop driven by parent state instead,
// every mousemove/animation frame would re-render the parent's whole JSX
// tree, including the ComposedChart.
export const RunnerIcon = forwardRef<RunnerIconHandle>(function RunnerIcon(_props, ref) {
  const [state, setState] = useState<{ cx: number; color: string; pauseDurationSec: number | null; dwelling: boolean } | null>(null);
  const [stride, setStride] = useState(false);

  useImperativeHandle(ref, () => ({
    show: (cx, color, pauseDurationSec, dwelling = false) => setState({ cx, color, pauseDurationSec, dwelling }),
    hide: () => setState(null),
  }), []);

  // Pose alternation runs on its own timer, gated only by "visible and not
  // paused" — not on every mousemove/frame position update — so a stream of
  // updates doesn't reset the stride's phase on each call.
  const striding = state != null && state.pauseDurationSec == null;
  useEffect(() => {
    if (!striding) return;
    const id = setInterval(() => setStride(s => !s), STRIDE_MS);
    return () => clearInterval(id);
  }, [striding]);

  if (!state) return null;
  const pose = state.pauseDurationSec == null
    ? (stride ? "a" : "b")
    : state.pauseDurationSec >= LONG_PAUSE_SEC ? "bent" : "stand";
  // "stand" (a pause under a minute) hops in place — a short pause reads as
  // "still moving, just waiting," unlike "bent" (a minute+), which is an
  // actual rest and stays still except for autoplay's dwelling fade below.
  const animClass = pose === "stand" ? "hra-runner-hop" : state.dwelling ? "hra-runner-dwell" : undefined;
  return (
    <div
      className={animClass}
      style={{
        position: "absolute", left: state.cx, top: "50%",
        transform: "translate(-50%, -50%)", pointerEvents: "none",
        "--runner-color": state.color,
      } as CSSProperties}
    >
      <RunnerGlyph pose={pose} color="var(--runner-color)" size={RUNNER_SIZE} />
    </div>
  );
});
