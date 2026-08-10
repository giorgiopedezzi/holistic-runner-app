import { useEffect, useState } from "react";
import { useQuery } from "@/hooks/useQuery";
import { api } from "@/api/client";
import { Badge, ErrorBanner, LoadingSpinner, Pagination, RangeEmpty } from "@/components/ui";
import { ActivityModal, ActivityDetailBody } from "@/components/ActivityModal";
import { SPORT_COLOR } from "@/types/api";
import { fmtPace, fmtDuration, fmtKm } from "@/utils/fmt";
import { distanceUnitLabel } from "@/utils/units";

interface Props { from: string; to: string; }

const PER_PAGE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_DETAIL_VIEW = "accordion";

export function ActivitiesTab({ from, to }: Props) {
  const rangeQ = useQuery(() => api.garmin.range(), []);
  const settingsQ = useQuery(() => api.settings.get(), []);
  const detailView = settingsQ.state.status === "success" ? settingsQ.state.data.activity_detail_view : DEFAULT_DETAIL_VIEW;
  const [modalId, setModalId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  // Server-side paging (HRA-38): fetch only the current page's rows, and refetch
  // whenever the range, page, or page size changes.
  const { state, refetch } = useQuery(
    () => api.garmin.activitiesPage(from, to, perPage, (page - 1) * perPage),
    [from, to, page, perPage],
  );

  // A new range (or a perPage change) invalidates the current page number.
  useEffect(() => setPage(1), [from, to, perPage]);
  useEffect(() => setExpandedId(null), [from, to]);

  const total = state.status === "success" ? state.data.page.total : 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  // If the total shrank (e.g. after a delete) clamp the page back into range.
  useEffect(() => { setPage(p => Math.min(p, totalPages)); }, [totalPages]);

  if (state.status === "loading") return <LoadingSpinner />;
  if (state.status === "error")   return <ErrorBanner message={state.error} />;
  if (state.status !== "success") return null;

  if (total === 0) {
    const range = rangeQ.state.status === "success" ? rangeQ.state.data : null;
    return <RangeEmpty range={range} from={from} to={to} entityLabel="activities" />;
  }

  const pageItems = state.data.data; // already the server-sliced page

  const pagination = (
    <Pagination
      page={Math.min(page, totalPages)}
      totalPages={totalPages}
      onPageChange={setPage}
      perPage={perPage}
      perPageOptions={PER_PAGE_OPTIONS}
      onPerPageChange={setPerPage}
      totalItems={total}
    />
  );

  return (
    <div>
      {pagination}

      <div style={{ display: "grid", gap: 6, marginTop: 14 }}>
        {pageItems.map(a => {
          const color = SPORT_COLOR[a.sport ?? "other"] ?? "#888";
          const isExpanded = detailView === "accordion" && expandedId === a.id;
          return (
            <div key={a.id}>
              <button
                onClick={() => detailView === "accordion"
                  ? setExpandedId(id => id === a.id ? null : a.id)
                  : setModalId(a.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px",
                  background: "var(--bg-card)", border: "1px solid var(--border)",
                  borderRadius: isExpanded ? "10px 10px 0 0" : 10, textAlign: "left", fontSize: 14,
                  color: "var(--text-primary)", cursor: "pointer", width: "100%",
                  transition: "border-color 0.15s",
                }}
                onMouseOver={e => (e.currentTarget.style.borderColor = "var(--border-strong)")}
                onMouseOut={e  => (e.currentTarget.style.borderColor = "var(--border)")}
              >
                <span style={{ color: "var(--text-muted)", fontSize: 12, minWidth: 86 }}>
                  {a.date_only}
                </span>
                <Badge label={a.sport ?? "other"} color={color} />
                <span style={{ flex: 1, fontWeight: 600 }}>{fmtKm(a.distance_m)}</span>
                <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{fmtDuration(a.duration_sec)}</span>
                {a.avg_hr         && <span style={{ color: "var(--accent-red)",   fontSize: 13 }}>♥ {a.avg_hr}</span>}
                {a.avg_pace_minkm && <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{fmtPace(a.avg_pace_minkm)}/{distanceUnitLabel()}</span>}
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{detailView === "accordion" ? (isExpanded ? "▲" : "▼") : "→"}</span>
              </button>
              {isExpanded && (
                <div style={{
                  background: "var(--bg-card)", border: "1px solid var(--border)", borderTop: "none",
                  borderRadius: "0 0 10px 10px", padding: "16px 14px",
                }}>
                  <ActivityDetailBody
                    activityId={a.id}
                    onDelete={() => { setExpandedId(null); refetch(); }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pagination}

      {modalId !== null && (
        <ActivityModal
          activityId={modalId}
          onClose={() => setModalId(null)}
          onDelete={() => refetch()}
        />
      )}
    </div>
  );
}
