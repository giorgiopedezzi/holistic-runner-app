import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, Footprints, Bike, PersonStanding, WavesHorizontal, Mountain, Dumbbell, Activity as ActivityIcon, type LucideIcon } from "lucide-react";
import { api } from "@/api/client";
import { Badge, HelpDisclosure } from "@/components/ui";
import { SPORT_COLOR, type Activity } from "@/types/api";
import { getResolvedTheme } from "@/utils/theme";
import { fmtPace, fmtDuration, fmtKm, fmtDate, fmtSource } from "@/utils/fmt";
import { distanceUnitLabel } from "@/utils/units";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useIsPhone } from "@/hooks/useIsPhone";
import { ActivityTypePicker } from "./ActivityTypePicker";
import { ActivityActionsMenu } from "./ActivityActionsMenu";

// Compact per-sport glyph (HRA-280, "compact type icon + accessible short
// name") — purely decorative next to the Badge's own text label, which
// remains the accessible name; keyed the same way SPORT_COLOR is (a
// superset of the `Sport` union — `fitness_equipment` is a real backend
// value the stricter FE type doesn't list, see SPORT_COLOR's own comment).
// `other` also serves as the fallback for any future/unmapped sport value.
const SPORT_ICON: Record<string, LucideIcon> = {
  running: Footprints,
  walking: PersonStanding,
  cycling: Bike,
  swimming: WavesHorizontal,
  hiking: Mountain,
  fitness_equipment: Dumbbell,
  other: ActivityIcon,
};

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
  // Fired with the freshly saved Activity whenever this row's own
  // ActivityTypePicker renames/retypes it (HRA — "keep current data in sync,
  // without the need to refresh it"). The picker's PUT response already
  // carries the new activity_name/activity_type_id; the caller is expected
  // to fold that straight into whatever list state `activity` came from
  // (this row has no state of its own — see the comment further down)
  // rather than the previous behavior of silently discarding it and leaving
  // the row's own header showing the old name until the next full refetch.
  onUpdate: (a: Activity) => void;
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
//
// HRA-280 — the outer grid is now a plain, non-interactive container. It
// used to be a `role="button"` div that also CONTAINED column 2's real
// interactive controls (a <select>, buttons), with stopPropagation on
// column 2 papering over the resulting nested-interactive-control
// accessibility violation (a listbox/button living inside another
// button/clickable ancestor is invalid and confuses assistive tech
// regardless of the click behavior working out visually). Column 1 is now
// itself a real `<button>` — the row's one "open detail" action — so
// column 2 is a genuine, non-nested sibling area instead of a
// propagation-gated pocket inside a bigger clickable region; no
// stopPropagation is needed any more since there's no ancestor onClick left
// to escape.
export function ActivityRow({ activity: a, expanded, expandIndicator, onClick, onDelete, onUpdate, expandedContent }: ActivityRowProps) {
  const { t } = useTranslation();
  const demoMode = useDemoMode();
  const isPhone = useIsPhone();
  const color = SPORT_COLOR[getResolvedTheme()][a.sport ?? "other"] ?? "#888";
  const SportIcon = SPORT_ICON[a.sport ?? "other"] ?? ActivityIcon;
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
      <div
        className="hra-activity-row card hra-text-primary grid items-center gap-3 py-3 px-3.5 text-label"
        data-expanded={expanded}
      >
        {/* Column 1 (40%) — the row's one "open detail" action, real
            <button> semantics (independently focusable/activatable, no
            role/tabIndex/onKeyDown hand-rolling needed). Its accessible name
            comes from its own text content (sport/date/name/distance/via),
            which already differs row to row — no separate aria-label
            needed. minWidth:0 lets a long activity_name wrap within this
            column's own fixed width instead of forcing the column wider. */}
        <button
          type="button"
          className="hra-activity-row-open hra-activity-row-info hra-row-wrap gap-3 min-w-0 w-full text-left bg-transparent border-0 p-0 cursor-pointer"
          onClick={onClick}
          aria-expanded={expandIndicator === "accordion" ? expanded : undefined}
        >
          {isPhone ? (
            // HRA-303 section 3 — the expanded/list identity hierarchy: type·date
            // (with room reserved on the right for the absolutely-positioned
            // overflow menu, see .hra-activity-row-mobile-top), distance as the
            // primary value, duration/pace/HR combined into one secondary line,
            // source as tertiary metadata. Replaces the flat single-line wrap
            // desktop still uses (else branch) — folding column 3's own
            // duration/HR/pace content in here too, so phone renders no
            // separate metrics row (see the !isPhone gate around column 3 below).
            <span className="flex flex-col gap-1 min-w-0 w-full">
              <span className="hra-row-wrap gap-2 items-center hra-activity-row-mobile-top">
                <Badge label={a.sport ?? "other"} color={color} icon={<SportIcon size={12} aria-hidden="true" />} />
                <span className="hra-text-muted text-meta">{fmtDate(a.date_only)}</span>
              </span>
              <span className="text-display">{fmtKm(a.distance_m)}</span>
              <span className="hra-text-secondary text-label">
                {[
                  fmtDuration(a.duration_sec),
                  a.avg_pace_minkm != null ? `${fmtPace(a.avg_pace_minkm)}/${distanceUnitLabel()}` : null,
                  a.avg_hr != null ? `${a.avg_hr} bpm` : null,
                ].filter(Boolean).join(" · ")}
              </span>
              {a.activity_name && (
                <span className="hra-text-secondary italic text-label truncate" title={a.activity_name}>
                  {a.activity_name}
                </span>
              )}
              {a.source && <span className="hra-text-muted text-meta">{fmtSource(a.source)}</span>}
            </span>
          ) : (
            <>
              <Badge label={a.sport ?? "other"} color={color} icon={<SportIcon size={12} aria-hidden="true" />} />
              <span className="hra-text-muted text-meta">{fmtDate(a.date_only)}</span>
              {a.activity_name && (
                // Ellipsized, not wrapped — a long race name now truncates
                // within its own budget instead of pushing the row taller (or,
                // before the fr fix above, wider than the card). `title` is the
                // plain native tooltip so the full name is still one hover away.
                <span
                  className="hra-text-secondary italic text-label max-w-40 truncate"
                  title={a.activity_name}
                >
                  {a.activity_name}
                </span>
              )}
              <span className="font-semibold">{fmtKm(a.distance_m)}</span>
              {a.source && (
                <span className="hra-text-muted text-meta">{t("activity.detail.viaSource", `via ${fmtSource(a.source)}`, { source: fmtSource(a.source) })}</span>
              )}
            </>
          )}
        </button>

        {/* Column 2 (44%) — the type picker + Save/Rename + Delete, the
            row's one interactive cluster. A genuine sibling of column 1's
            button now, not nested inside any clickable ancestor, so it
            needs no stopPropagation to keep its own clicks/keydowns from
            also triggering the row's open-detail action. */}
        <div className="hra-activity-row-actions hra-row-wrap gap-2 min-w-0">
          {isPhone ? (
            // HRA-291 (type change/rename/delete collapsed into one overflow
            // menu at phone width) + HRA-303 (that menu is now the row's one
            // top-right overflow action, per section 3 — absolutely positioned
            // over column 1's identity block via this same class's phone media
            // rule, rather than rendered as its own near-empty full-width row
            // the way the earlier reordering-only fix left it).
            <ActivityActionsMenu activity={a} onUpdate={onUpdate} onDelete={onDelete} />
          ) : (
            <>
              <ActivityTypePicker activity={a} onUpdate={onUpdate}
                selectWidth={TYPE_SELECT_WIDTH} actionWidth={ACTION_BUTTON_WIDTH} height={ACTION_CONTROL_HEIGHT} />
              {!confirmDelete ? (
                <button
                  className="hra-activity-row-action hra-btn flex items-center justify-center gap-1.5 shrink-0"
                  data-variant="cta"
                  data-tone="red"
                  onClick={() => setConfirmDelete(true)}
                  disabled={demoMode}
                  title={demoMode
                    ? t("common.demoModeHint", "Not available for demo")
                    : t("activity.detail.deleteTooltip", "Moves this activity to the local database's trash (Data & Sync tab) — it's not touched on your Garmin device, Strava, or Withings account, and you can restore it later. A resync won't bring it back on its own.")}
                >
                  <Trash2 size={13} />
                  {t("activity.detail.deleteButton", "Remove activity")}
                </button>
              ) : (
                <div className="hra-row gap-1.5">
                  <span className="hra-text-danger text-meta">{t("activity.detail.moveToTrash", "Move to trash?")}</span>
                  <button
                    className="hra-btn" data-variant="cta"
                    data-tone="red"
                    onClick={handleDelete} disabled={deleting}
                  >
                    {deleting ? "…" : t("common.yesDelete", "Yes, delete")}
                  </button>
                  <button onClick={() => setConfirmDelete(false)}
                    className="hra-border-strong hra-text-secondary text-meta rounded-md py-1 px-3 bg-transparent cursor-pointer">
                    {t("common.cancel", "Cancel")}
                  </button>
                </div>
              )}
              {error && <span className="hra-text-danger text-meta">{error}</span>}
            </>
          )}
        </div>

        {/* Column 3 (15%) — duration/HR/pace, untouched, still right-aligned.
            Plain, non-interactive text; the actual "open detail" control is
            column 1's button. The trailing glyph is a decorative expand/
            open-in-modal status marker, not its own control — its state is
            already exposed to assistive tech via column 1's aria-expanded,
            so it's aria-hidden here to avoid announcing a redundant symbol.
            Desktop only (HRA-303) — this same duration/pace/HR data is
            already folded into column 1's own secondary hierarchy line on
            phone (see the isPhone branch above), so repeating it here would
            just duplicate it in a second, now-empty-looking row. */}
        {!isPhone && (
          <div className="hra-activity-row-metrics hra-row-wrap gap-3 justify-end min-w-0">
            <span className="hra-text-secondary text-label">{fmtDuration(a.duration_sec)}</span>
            {a.avg_hr         && <span className="hra-text-danger text-label">♥ {a.avg_hr}</span>}
            {a.avg_pace_minkm && <span className="hra-text-muted text-label">{fmtPace(a.avg_pace_minkm)}/{distanceUnitLabel()}</span>}
            <span className="hra-text-muted text-meta" aria-hidden="true">{expandIndicator === "accordion" ? (expanded ? "▲" : "▼") : "→"}</span>
          </div>
        )}
      </div>
      {expanded && expandedContent && (
        <div className="card hra-card-joined-bottom py-4 px-3.5">
          {expandedContent}
        </div>
      )}
    </div>
  );
}

// HRA-280 — the icon/color mapping's own explanation, once per list of
// ActivityRows rather than repeated on every row's Badge (which already
// carries its own text label, so the legend isn't the ONLY place color has
// a text alternative — it's the one place the full set is spelled out
// together). Mounted once by the caller (ActivitiesTab), not by ActivityRow
// itself, since a legend belongs to the list, not to each row in it.
export function ActivitySportLegend() {
  const { t } = useTranslation();
  const theme = getResolvedTheme();
  return (
    <HelpDisclosure
      label={t("activity.legend.trigger", "Workout type legend")}
      heading={t("activity.legend.heading", "Workout types")}
    >
      <ul className="flex flex-col gap-1.5">
        {Object.keys(SPORT_ICON).map(sport => {
          const LegendIcon = SPORT_ICON[sport];
          const legendColor = SPORT_COLOR[theme][sport] ?? "#888";
          return (
            <li key={sport}>
              <Badge label={sport} color={legendColor} icon={<LegendIcon size={12} aria-hidden="true" />} />
            </li>
          );
        })}
      </ul>
    </HelpDisclosure>
  );
}
