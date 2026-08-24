import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@/hooks/useQuery";
import { useSettings } from "@/hooks/useSettings";
import { api } from "@/api/client";
import { ErrorBanner, LoadingSpinner, Pagination, RangeEmpty } from "@/components/ui";
import { ActivityModal, ActivityDetailBody } from "@/components/ActivityModal";
import { ActivityRow } from "@/components/activity/ActivityRow";

interface Props { from: string; to: string; }

const PER_PAGE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_DETAIL_VIEW = "accordion";

export function ActivitiesTab({ from, to }: Props) {
  const { t } = useTranslation();
  const rangeQ = useQuery(() => api.garmin.range(), []);
  const { settings } = useSettings();
  const detailView = settings?.activity_detail_view ?? DEFAULT_DETAIL_VIEW;
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

  if (state.status === "loading") return <LoadingSpinner label={t("activities.loading", "Loading activities…")} />;
  if (state.status === "error")   return <ErrorBanner message={state.error} />;
  if (state.status !== "success") return null;

  if (total === 0) {
    const range = rangeQ.state.status === "success" ? rangeQ.state.data : null;
    return <RangeEmpty range={range} from={from} to={to} entityLabel={t("common.entity.activities", "activities")} />;
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
          const isExpanded = detailView === "accordion" && expandedId === a.id;
          return (
            <ActivityRow
              key={a.id}
              activity={a}
              expanded={isExpanded}
              expandIndicator={detailView}
              onClick={() => detailView === "accordion"
                ? setExpandedId(id => id === a.id ? null : a.id)
                : setModalId(a.id)}
              onDelete={() => { setExpandedId(null); refetch(); }}
              expandedContent={
                <ActivityDetailBody
                  activityId={a.id}
                  onDelete={() => { setExpandedId(null); refetch(); }}
                />
              }
            />
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
