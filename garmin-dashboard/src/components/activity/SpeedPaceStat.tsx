import { Card, Label } from "@/components/ui";
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
      <Label style={{ marginBottom: 6 }}>Avg speed / pace</Label>
      <div style={{ display: "flex", gap: 14 }}>
        <div>
          <div className="hra-stat-value">{avgPaceMinKm != null ? fmtPace(avgPaceMinKm) : "—"}</div>
          <div className="hra-text-secondary" style={{ fontSize: 11 }}>{paceUnitLabel()}</div>
        </div>
        <div>
          <div className="hra-stat-value">{fmtSpeed(avgSpeedMs)}</div>
          <div className="hra-text-secondary" style={{ fontSize: 11 }}>{speedUnitLabel()}</div>
        </div>
      </div>
    </Card>
  );
}
