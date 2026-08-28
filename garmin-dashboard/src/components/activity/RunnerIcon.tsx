import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { RunnerGlyph } from "./RunnerGlyph";
import { NEUTRAL_DYNAMICS, type RunnerDynamics } from "@/domain/runner-dynamics";

export interface RunnerIconHandle {
  // pauseDurationSec: null while actually running/striding; a number (the
  // pause's duration) whenever the runner is parked on a pause row —
  // >= LONG_PAUSE_SEC bends the runner over instead of just standing.
  // dynamics: the runner's motion at this point — how fast the legs turn
  // over (speed) and where it sits on the altitude profile. See
  // domain/runner-dynamics.ts.
  show(cx: number, color: string, pauseDurationSec: number | null, dwelling?: boolean, dynamics?: RunnerDynamics): void;
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
  const [state, setState] = useState<{ cx: number; color: string; pauseDurationSec: number | null; dwelling: boolean; dynamics: RunnerDynamics } | null>(null);
  const [stride, setStride] = useState(false);

  useImperativeHandle(ref, () => ({
    show: (cx, color, pauseDurationSec, dwelling = false, dynamics = NEUTRAL_DYNAMICS) =>
      setState({ cx, color, pauseDurationSec, dwelling, dynamics }),
    hide: () => setState(null),
  }), []);

  // Read by the stride timer below without re-arming it — see there.
  const strideScaleRef = useRef(1);
  strideScaleRef.current = state?.dynamics.strideScale ?? 1;

  // Pose alternation runs on its own timer, gated only by "visible and not
  // paused" — not on every mousemove/frame position update — so a stream of
  // updates doesn't reset the stride's phase on each call. Its rate tracks
  // the runner's actual speed (STRIDE_MS is the rate at this run's median
  // pace), so it is a self-rescheduling timeout reading the CURRENT scale off
  // a ref at each tick rather than a setInterval keyed on that scale:
  // re-arming an interval whenever the speed changed would restart the
  // stride's phase on every frame of autoplay, which reads as a stutter
  // rather than as a faster cadence.
  const striding = state != null && state.pauseDurationSec == null;
  useEffect(() => {
    if (!striding) return;
    let id = 0;
    const tick = () => {
      setStride(s => !s);
      id = window.setTimeout(tick, STRIDE_MS / strideScaleRef.current);
    };
    id = window.setTimeout(tick, STRIDE_MS / strideScaleRef.current);
    return () => clearTimeout(id);
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
      className={`hra-runner-icon absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none ${animClass ?? ""}`}
      style={{
        // The altitude ride (1m = 1px) goes on `top`, NOT on this element's
        // transform: `.hra-runner-hop` animates transform and would drop any
        // offset expressed there (the same reason its keyframes have to
        // repeat the centering translate). The row reserves
        // RUNNER_ELEVATION_MAX_PX above and below its center for this.
        "--runner-x": `${state.cx}px`,
        "--runner-elevation": `${state.dynamics.elevationPx}px`,
        "--runner-color": state.color,
      } as CSSProperties}
    >
      <RunnerGlyph pose={pose} color="var(--runner-color)" size={RUNNER_SIZE} />
    </div>
  );
});
