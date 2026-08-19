import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { SPORT_COLOR, type Activity } from "@/types/api";
import { fmtPace, fmtDuration, fmtKm, fmtDate } from "@/utils/fmt";
import { distanceUnitLabel } from "@/utils/units";

interface ActivityRowProps {
  activity: Activity;
  expanded: boolean;
  // "accordion" shows a ▲/▼ chevron that flips with `expanded`; "modal" always
  // shows a plain → since clicking never expands this row in place.
  expandIndicator: "accordion" | "modal";
  onClick: () => void;
  // What to render below the row when `expanded` — ActivityDetailBody, ie.
  // caller-provided so this component stays presentational (no fetch of its
  // own). Ignored while collapsed.
  expandedContent?: ReactNode;
}

// One activity's summary row (date, sport, optional name, distance,
// duration, HR, pace) plus its optional expanded detail panel — extracted
// out of ActivitiesTab.tsx (HRA date-ranges-part-2) so the exact same row
// can be reused wherever an activity needs to look "as if we were in the
// Activities tab" (e.g. Overview & Trends' linked-race display).
export function ActivityRow({ activity: a, expanded, expandIndicator, onClick, expandedContent }: ActivityRowProps) {
  const color = SPORT_COLOR[a.sport ?? "other"] ?? "#888";
  return (
    <div>
      <button
        className="card"
        onClick={onClick}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 14px",
          borderRadius: expanded ? "16px 16px 0 0" : "16px", textAlign: "left", fontSize: 14,
          color: "var(--text-primary)", cursor: "pointer", width: "100%",
        }}
      >
        <span style={{ color: "var(--text-muted)", fontSize: 12, minWidth: 86 }}>
          {fmtDate(a.date_only)}
        </span>
        <Badge label={a.sport ?? "other"} color={color} />
        {a.activity_name && (
          <span style={{ fontStyle: "italic", color: "var(--text-secondary)", fontSize: 13 }}>{a.activity_name}</span>
        )}
        <span style={{ flex: 1, fontWeight: 600 }}>{fmtKm(a.distance_m)}</span>
        <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{fmtDuration(a.duration_sec)}</span>
        {a.avg_hr         && <span style={{ color: "var(--accent-red)",   fontSize: 13 }}>♥ {a.avg_hr}</span>}
        {a.avg_pace_minkm && <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{fmtPace(a.avg_pace_minkm)}/{distanceUnitLabel()}</span>}
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{expandIndicator === "accordion" ? (expanded ? "▲" : "▼") : "→"}</span>
      </button>
      {expanded && expandedContent && (
        <div className="card hra-card-joined-bottom" style={{ padding: "16px 14px" }}>
          {expandedContent}
        </div>
      )}
    </div>
  );
}
