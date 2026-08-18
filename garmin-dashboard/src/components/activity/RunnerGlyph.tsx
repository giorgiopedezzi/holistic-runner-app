import type { CSSProperties } from "react";

type Pose = "a" | "b" | "stand" | "bent";

// `color` stays a plain prop (not read from a CSS var internally) — the
// caller (RunnerIcon) passes a static `"var(--runner-color)"` string, which
// itself never changes across re-renders; only the custom property's actual
// value, mutated on an ancestor div, changes per hover update. That's what
// keeps hovering from ever re-rendering this component for a color change.
export function RunnerGlyph({
  pose = "a",
  color = "currentColor",
  size = 18,
  className,
  style,
}: {
  pose?: Pose;
  color?: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style}
    >
      {pose === "bent" ? (
        // Hands-on-knees, bent forward at the waist — a longer pause (>=
        // LONG_PAUSE_SEC in ActivityChartSection) reads as an actual rest,
        // not just a standing wait.
        <>
          <circle cx="18" cy="7.5" r="2.2" fill={color} stroke="none" />
          <path d="M17.2 9.8 12.8 12.8" />
          <path d="M16.8 10.2 19 12.4 18.2 14.8" />
          <path d="M16.8 10.2 14 12 13 14.4" />
          <path d="M12.8 12.8 15.6 15 16 18.8" />
          <path d="M12.8 12.8 10 15.2 6.4 16.2" />
        </>
      ) : pose === "stand" ? (
        <>
          <circle cx="12" cy="4" r="2.2" fill={color} stroke="none" />
          <path d="M12 7v6" />
          <path d="M12 8 8 11.5" /><path d="M12 8 16 11.5" />
          <path d="M12 13 9 19.5" /><path d="M12 13 15 19.5" />
        </>
      ) : pose === "a" ? (
        <>
          <circle cx="15" cy="4.2" r="2.2" fill={color} stroke="none" />
          <path d="M14.6 7 12.8 12.6" />
          <path d="M14.6 7.6 17.8 9.2 19.6 6.8" />
          <path d="M14.6 7.6 11.4 9.6 9.2 11.8" />
          <path d="M12.8 12.6 16.4 14.2 16.8 18.6" />
          <path d="M12.8 12.6 10.2 15.4 6.8 16.6" />
        </>
      ) : (
        <>
          <circle cx="15" cy="4.2" r="2.2" fill={color} stroke="none" />
          <path d="M14.6 7 12.8 12.6" />
          <path d="M14.6 7.6 17.2 10.4 18.6 13.2" />
          <path d="M14.6 7.6 11.6 8.6 9.4 7.2" />
          <path d="M12.8 12.6 15.2 15.6 13.8 19.2" />
          <path d="M12.8 12.6 9.8 14.2 7.6 12.4" />
        </>
      )}
      {/* Trailing speed lines — only while actually striding (poses "a"/
          "b"), never while standing/bent/idle. The runner always faces
          right (head at cx 15-19 across every pose), so these trail
          leftward, behind the legs. Staggered length/opacity, not three
          identical strokes, is what reads as motion rather than static
          decoration: the middle one (closest to the hips, the body's
          center of motion) runs longest, top/bottom shorter. */}
      {(pose === "a" || pose === "b") && (
        <g stroke={color} strokeWidth={1.2} strokeLinecap="round">
          <path d="M1.5 8h5.5" opacity={0.35} />
          <path d="M0 12.5h7.5" opacity={0.5} />
          <path d="M2 17h5" opacity={0.35} />
        </g>
      )}
    </svg>
  );
}
