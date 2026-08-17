import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { CSSProperties } from "react";
import { RunnerGlyph } from "./RunnerGlyph";

export interface RunnerIconHandle {
  show(cx: number, color: string, inPause: boolean, dwelling?: boolean): void;
  hide(): void;
}

const RUNNER_SIZE = 25;
const STRIDE_MS = 180;

// Isolated local state, exposed via an imperative handle instead of props —
// a hover/playback update here re-renders only this tiny component, never
// the parent (and never the chart it sits above), so the icon can track the
// mouse (or the autoplay loop) at native event/frame frequency with zero
// cost to the chart. If this were a prop driven by parent state instead,
// every mousemove/animation frame would re-render the parent's whole JSX
// tree, including the ComposedChart.
export const RunnerIcon = forwardRef<RunnerIconHandle>(function RunnerIcon(_props, ref) {
  const [state, setState] = useState<{ cx: number; color: string; inPause: boolean; dwelling: boolean } | null>(null);
  const [stride, setStride] = useState(false);

  useImperativeHandle(ref, () => ({
    show: (cx, color, inPause, dwelling = false) => setState({ cx, color, inPause, dwelling }),
    hide: () => setState(null),
  }), []);

  // Pose alternation runs on its own timer, gated only by "visible and not
  // paused" — not on every mousemove/frame position update — so a stream of
  // updates doesn't reset the stride's phase on each call.
  const striding = state != null && !state.inPause;
  useEffect(() => {
    if (!striding) return;
    const id = setInterval(() => setStride(s => !s), STRIDE_MS);
    return () => clearInterval(id);
  }, [striding]);

  if (!state) return null;
  const pose = state.inPause ? "stand" : stride ? "a" : "b";
  return (
    <div
      // "dwelling" — autoplay parked on a pause for its 3s hold — fades the
      // icon in and out via a plain CSS animation (index.css) rather than
      // anything driven from JS, so the fade costs nothing extra per frame.
      className={state.dwelling ? "hra-runner-dwell" : undefined}
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
