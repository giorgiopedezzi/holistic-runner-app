import { Card } from "@/components/ui";
import { fmtPace, fmtSpeed } from "@/utils/fmt";
import { speedUnitLabel, paceUnitLabel } from "@/utils/units";

// Avg speed and avg pace are the same underlying measurement shown two
// ways, so they share one card instead of two, side by side in one row —
// each value uses the exact same size/weight as a normal single-value Stat
// (ui.tsx's Stat was reduced from 22px to 18px specifically so two of these
// values fit comfortably side by side without this card needing its own,
// inconsistent smaller size).
export function SpeedPaceStat({ avgSpeedMs, avgPaceMinKm }: { avgSpeedMs: number | null; avgPaceMinKm: number | null }) {
  return (
    <Card>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Avg speed / pace
      </div>
      <div style={{ display: "flex", gap: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.2 }}>{avgPaceMinKm != null ? fmtPace(avgPaceMinKm) : "—"}</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{paceUnitLabel()}</div>
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.2 }}>{fmtSpeed(avgSpeedMs)}</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{speedUnitLabel()}</div>
        </div>
      </div>
    </Card>
  );
}
