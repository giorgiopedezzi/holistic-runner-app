import { useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { api } from "@/api/client";
import { Badge } from "@/components/ui";
import { SPORT_COLOR, type Activity } from "@/types/api";
import { getResolvedTheme } from "@/utils/theme";
import { fmtPace, fmtDuration, fmtKm, fmtDate } from "@/utils/fmt";
import { distanceUnitLabel } from "@/utils/units";
import { ActivityTypePicker } from "./ActivityTypePicker";

// Fixed sizing for the type picker + Save/Rename + Delete cluster (dashboard
// design-system rework: "keep them at a fixed width... same height" — sized
// generously enough to fit the longest translated label across every
// supported language without jitter: Delete/Save-Rename's longest are French
// ("Supprimer l'activité"/"Enregistrer et nommer"); the type Select's longest
// option is "Half-Marathon" (activity_type names are plain, un-translated
// backend data, not locale-file strings — see garmin-stats/src/db.ts's seed).
const TYPE_SELECT_WIDTH = 130;
const ACTION_BUTTON_WIDTH = 177;
const ACTION_CONTROL_HEIGHT = 30;

interface ActivityRowProps {
  activity: Activity;
  expanded: boolean;
  // "accordion" shows a ▲/▼ chevron that flips with `expanded`; "modal" always
  // shows a plain → since clicking never expands this row in place.
  expandIndicator: "accordion" | "modal";
  onClick: () => void;
  // Row-level delete (dashboard design-system rework, "keep every
  // information at accordion wrap-up level") — same handler shape ActivityDetailBody
  // already took, now ALSO wired here since Delete lives on the row itself,
  // always visible, not gated behind expanding a row first ("even better if
  // you have to delete several activities" — explicit feedback).
  onDelete: (id: number) => void;
  // What to render below the row when `expanded` — ActivityDetailBody, ie.
  // caller-provided so this component stays presentational (no fetch of its
  // own). Ignored while collapsed.
  expandedContent?: ReactNode;
}

// One activity's summary row (sport/date/name/distance/via/the
// ActivityTypePicker/Delete, duration/HR/pace) plus its optional expanded
// detail panel — extracted out of ActivitiesTab.tsx (HRA date-ranges-part-2)
// so the exact same row can be reused wherever an activity needs to look "as
// if we were in the Activities tab" (e.g. Overview & Trends' linked-race
// display). Dashboard design-system rework ("keep every information at
// accordion wrap-up level"): this row now carries everything
// ActivityDetailBody's own header used to duplicate (via, the type picker,
// Delete) — that header is gone for the accordion case (ActivityDetailBody
// only still renders it for the standalone popup variant, which has no
// ActivityRow wrapping it).
//
// THREE fixed-proportion columns (42fr / 42fr / 16fr, a later correction —
// back to a single row after a "two stacked rows" pass, this time with
// EXPLICIT widths rather than natural/wrapping ones) so every row's column
// boundaries land at the exact same x position regardless of what any one
// row's own content looks like — "so all the summaries are aligned to each
// other". `fr`, not `%` — see the grid style's own comment on why. Column 1
// (42fr): sport/date/name/distance/via — read-only info at a glance, with
// activity_name ellipsized + a title tooltip rather than wrapped, so a long
// race name truncates within its own budget instead of pushing the row
// taller. Column 2 (42fr): the type picker + Save/Rename + Delete — the one
// interactive cluster. Column 3 (16fr): duration/HR/pace, right-aligned,
// untouched, still last.
export function ActivityRow({ activity: a, expanded, expandIndicator, onClick, onDelete, expandedContent }: ActivityRowProps) {
  const { t } = useTranslation();
  const color = SPORT_COLOR[getResolvedTheme()][a.sport ?? "other"] ?? "#888";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await api.garmin.deleteOne(a.id);
      onDelete(a.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("activity.detail.deleteFailed", "Delete failed"));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div>
      {/* A plain div, not a <button> — column 2 below holds real interactive
          controls (a <select>, buttons), and a button can't contain nested
          interactive elements. role="button"+tabIndex+onKeyDown restore the
          same click/keyboard-activate behavior the previous <button> gave
          for free. onClick here only fires for clicks OUTSIDE column 2,
          which stops its own propagation. */}
      <div
        className="card hra-text-primary"
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
        style={{
          // `fr`, not `%` — percentages don't account for `gap` (grid adds
          // gap ON TOP of percentage widths, not by shrinking them), which
          // was pushing the whole row ~24px past the card's own edge,
          // taking column 3's chevron with it. `fr` units divide up the
          // space that's ALREADY had the gaps subtracted, so 42/42/16 stays
          // the real proportion of what's actually left for content.
          display: "grid", gridTemplateColumns: "40fr 44fr 15fr", alignItems: "center", gap: 12,
          padding: "12px 14px",
          borderRadius: expanded ? "16px 16px 0 0" : "16px", fontSize: 14,
          cursor: "pointer",
        }}
      >
        {/* Column 1 (40%) — read-only info at a glance. minWidth:0 lets a
            long activity_name wrap within this column's own fixed width
            instead of forcing the column itself wider. */}
        <div className="hra-row-wrap" style={{ gap: 12, minWidth: 0 }}>
          <Badge label={a.sport ?? "other"} color={color} />
          <span className="hra-text-muted" style={{ fontSize: 12 }}>{fmtDate(a.date_only)}</span>
          {a.activity_name && (
            // Ellipsized, not wrapped — a long race name now truncates
            // within its own budget instead of pushing the row taller (or,
            // before the fr fix above, wider than the card). `title` is the
            // plain native tooltip so the full name is still one hover away.
            <span
              className="hra-text-secondary"
              title={a.activity_name}
              style={{
                fontStyle: "italic", fontSize: 13,
                maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {a.activity_name}
            </span>
          )}
          <span style={{ fontWeight: 600 }}>{fmtKm(a.distance_m)}</span>
          {a.source && (
            <span className="hra-text-muted" style={{ fontSize: 11 }}>{t("activity.detail.viaSource", `via ${a.source}`, { source: a.source })}</span>
          )}
        </div>

        {/* Column 2 (44%) — the type picker + Save/Rename + Delete, the
            row's one interactive cluster. stopPropagation — otherwise a
            click on the type picker's select/save or the Delete button
            would ALSO fire the row's own expand/collapse onClick above. */}
        <div className="hra-row-wrap" style={{ gap: 8, minWidth: 0 }} onClick={e => e.stopPropagation()}>
          {/* onUpdate is a no-op: nothing else in this row's own UI depends
              on activity_type_id (unlike ActivityDetailBody, which
              re-renders its classification section from it) — the picker
              already shows its own just-saved selection via its internal
              state. */}
          <ActivityTypePicker activity={a} onUpdate={() => {}}
            selectWidth={TYPE_SELECT_WIDTH} actionWidth={ACTION_BUTTON_WIDTH} height={ACTION_CONTROL_HEIGHT} />
          {!confirmDelete ? (
            <button
              className="hra-btn"
              data-variant="cta"
              style={{
                "--btn-color": "var(--accent-red)", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                width: ACTION_BUTTON_WIDTH, height: ACTION_CONTROL_HEIGHT, flexShrink: 0,
              } as CSSProperties}
              onClick={() => setConfirmDelete(true)}
              title={t("activity.detail.deleteTooltip", "Moves this activity to the local database's trash (Data & Sync tab) — it's not touched on your Garmin device, Strava, or Withings account, and you can restore it later. A resync won't bring it back on its own.")}
            >
              <Trash2 size={13} />
              {t("activity.detail.deleteButton", "Remove activity")}
            </button>
          ) : (
            <div className="hra-row" style={{ gap: 6 }}>
              <span className="hra-text-danger" style={{ fontSize: 12 }}>{t("activity.detail.moveToTrash", "Move to trash?")}</span>
              <button
                className="hra-btn" data-variant="cta"
                style={{ "--btn-color": "var(--accent-red)" } as CSSProperties}
                onClick={handleDelete} disabled={deleting}
              >
                {deleting ? "…" : t("common.yesDelete", "Yes, delete")}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="hra-border-strong hra-text-secondary"
                style={{ fontSize: 12, borderRadius: 6, padding: "4px 12px", background: "none", cursor: "pointer" }}>
                {t("common.cancel", "Cancel")}
              </button>
            </div>
          )}
          {error && <span className="hra-text-danger" style={{ fontSize: 11 }}>{error}</span>}
        </div>

        {/* Column 3 (15%) — duration/HR/pace, untouched, still right-aligned. */}
        <div className="hra-row-wrap" style={{ gap: 12, justifyContent: "flex-end", minWidth: 0 }}>
          <span className="hra-text-secondary" style={{ fontSize: 13 }}>{fmtDuration(a.duration_sec)}</span>
          {a.avg_hr         && <span className="hra-text-danger" style={{ fontSize: 13 }}>♥ {a.avg_hr}</span>}
          {a.avg_pace_minkm && <span className="hra-text-muted" style={{ fontSize: 13 }}>{fmtPace(a.avg_pace_minkm)}/{distanceUnitLabel()}</span>}
          <span className="hra-text-muted" style={{ fontSize: 11 }}>{expandIndicator === "accordion" ? (expanded ? "▲" : "▼") : "→"}</span>
        </div>
      </div>
      {expanded && expandedContent && (
        <div className="card hra-card-joined-bottom" style={{ padding: "16px 14px" }}>
          {expandedContent}
        </div>
      )}
    </div>
  );
}
