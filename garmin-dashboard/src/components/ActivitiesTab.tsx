import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@/hooks/useQuery";
import { useSettings } from "@/hooks/useSettings";
import { useUrlState } from "@/hooks/useUrlState";
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
  // Backed by the URL's `activityId` param (HRA-194) so a refresh leaves the
  // same row expanded instead of collapsing it.
  const [expandedIdParam, setExpandedIdParam] = useUrlState("activityId", "");
  const expandedId = expandedIdParam === "" ? null : Number(expandedIdParam);
  const setExpandedId = (id: number | null) => setExpandedIdParam(id === null ? "" : String(id));
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
  // Clears the expanded row on a genuine user-driven range change, but must
  // not fire on initial mount — an effect with [from, to] deps still runs
  // once after mount, which would immediately wipe a row just hydrated from
  // the URL (HRA-194).
  const isFirstRangeEffect = useRef(true);
  useEffect(() => {
    if (isFirstRangeEffect.current) {
      isFirstRangeEffect.current = false;
      return;
    }
    setExpandedIdParam("");
  }, [from, to, setExpandedIdParam]);

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

      <div className="hra-activity-list grid gap-1.5">
        {pageItems.map(a => {
          const isExpanded = detailView === "accordion" && expandedId === a.id;
          return (
            <ActivityRow
              key={a.id}
              activity={a}
              expanded={isExpanded}
              expandIndicator={detailView}
              onClick={() => detailView === "accordion"
                ? setExpandedId(expandedId === a.id ? null : a.id)
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
