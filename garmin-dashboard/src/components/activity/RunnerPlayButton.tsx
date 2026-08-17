export type PlayStatus = "idle" | "playing" | "paused" | "finished";

// One YouTube-style control: play↔pause while active, replay once the
// runner reaches the end. The icon alone communicates the current state —
// no separate rewind/stop button.
export function RunnerPlayButton({ status, onClick }: { status: PlayStatus; onClick: () => void }) {
  const label = status === "playing" ? "Pause" : status === "finished" ? "Replay" : "Play";
  return (
    <button type="button" className="hra-runner-playbtn" onClick={onClick} aria-label={label} title={label}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
        {status === "playing" ? (
          <><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></>
        ) : status === "finished" ? (
          <path d="M12 5V2L7.5 6 12 10V7a5 5 0 1 1-4.9 6H5.05A7 7 0 1 0 12 5z" />
        ) : (
          <path d="M7 5v14l12-7z" />
        )}
      </svg>
    </button>
  );
}
