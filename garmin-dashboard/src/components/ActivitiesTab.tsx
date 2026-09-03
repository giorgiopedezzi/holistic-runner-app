import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@/hooks/useQuery";
import { useSettings } from "@/hooks/useSettings";
import { useUrlState } from "@/hooks/useUrlState";
import { api } from "@/api/client";
import { ErrorBanner, LoadingSpinner, Pagination, RangeEmpty } from "@/components/ui";
import { ActivityModal, ActivityDetailBody } from "@/components/ActivityModal";
import { ActivityRow } from "@/components/activity/ActivityRow";
import type { Activity } from "@/types/api";

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
  // Backed by the URL's `activitiesPage`/`activitiesPerPage` params (HRA-196)
  // so a refresh reproduces the same page. Invalid/garbage URL values fall
  // back to the same defaults a fresh visit gets.
  const [pageParam, setPageParam] = useUrlState("activitiesPage", "1");
  const parsedPage = Number(pageParam);
  const page = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
  const setPage = (next: number) => setPageParam(String(next));
  const [perPageParam, setPerPageParam] = useUrlState("activitiesPerPage", "25");
  const parsedPerPage = Number(perPageParam);
  const perPage = PER_PAGE_OPTIONS.includes(parsedPerPage as typeof PER_PAGE_OPTIONS[number]) ? parsedPerPage : 25;
  const setPerPage = (next: number) => setPerPageParam(String(next));

  // Server-side paging (HRA-38): fetch only the current page's rows, and refetch
  // whenever the range, page, or page size changes.
  const { state, refetch } = useQuery(
    () => api.garmin.activitiesPage(from, to, perPage, (page - 1) * perPage),
    [from, to, page, perPage],
  );
  // Renaming/retyping an activity (ActivityRow's own picker, or the expanded
  // ActivityDetailBody underneath it) returns the fresh Activity straight
  // from the PUT — folded in here instead of a full refetch so the row's own
  // header updates immediately ("keep current data in sync, without the need
  // to refresh"). Keyed by id and merged over the fetched page at render;
  // reset whenever the page itself changes so a stale override never
  // outlives the fetch it was patching.
  const [updatedActivities, setUpdatedActivities] = useState<Record<number, Activity>>({});
  useEffect(() => { setUpdatedActivities({}); }, [from, to, page, perPage]);
  function applyActivityUpdate(a: Activity) {
    setUpdatedActivities(prev => ({ ...prev, [a.id]: a }));
  }

  // A new range (or a perPage change) invalidates the current page number,
  // but must not fire on initial mount. A boolean "isFirst" ref guard (the
  // original HRA-196 fix here) is defeated by React 19 StrictMode's dev-only
  // double-invoke of effects (mount -> cleanup -> mount again, see
  // ActivityDetailBody.tsx's identical note): the ref's mutation from the
  // first synthetic invocation survives into the second, which then
  // incorrectly reads as "not the first run" and fires for real — wiping a
  // page number just hydrated from the URL on every dev-mode page load.
  // Comparing against the PREVIOUS actual from/to/perPage instead survives
  // the replay, since both synthetic invocations see identical values.
  const prevPageDepsRef = useRef<{ from: string; to: string; perPage: number } | null>(null);
  useEffect(() => {
    const prevDeps = prevPageDepsRef.current;
    prevPageDepsRef.current = { from, to, perPage };
    if (prevDeps && (prevDeps.from !== from || prevDeps.to !== to || prevDeps.perPage !== perPage)) {
      setPageParam("1");
    }
  }, [from, to, perPage, setPageParam]);
  // Clears the expanded row on a genuine user-driven range change, but must
  // not fire on initial mount — same StrictMode double-invoke hazard as the
  // page-reset effect above (HRA-194's original guard here had the same
  // flaw), fixed the same way.
  const prevExpandedRangeRef = useRef<{ from: string; to: string } | null>(null);
  useEffect(() => {
    const prevRange = prevExpandedRangeRef.current;
    prevExpandedRangeRef.current = { from, to };
    if (prevRange && (prevRange.from !== from || prevRange.to !== to)) {
      setExpandedIdParam("");
    }
  }, [from, to, setExpandedIdParam]);

  const total = state.status === "success" ? state.data.page.total : 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  // If the total shrank (e.g. after a delete) clamp the page back into range.
  // Gated on a resolved "success" state (HRA-196) — while idle/loading,
  // `total` is a placeholder 0 (totalPages 1), and clamping against that
  // would immediately overwrite a page number just hydrated from the URL,
  // or a page still in flight during a normal navigation refetch.
  useEffect(() => {
    if (state.status !== "success") return;
    if (page > totalPages) setPageParam(String(totalPages));
  }, [state.status, totalPages, page, setPageParam]);

  if (state.status === "loading") return <LoadingSpinner label={t("activities.loading", "Loading activities…")} />;
  if (state.status === "error")   return <ErrorBanner message={state.error} />;
  if (state.status !== "success") return null;

  if (total === 0) {
    const range = rangeQ.state.status === "success" ? rangeQ.state.data : null;
    return <RangeEmpty range={range} from={from} to={to} entityLabel={t("common.entity.activities", "activities")} />;
  }

  // already the server-sliced page, patched with any locally-applied renames/retypes
  const pageItems = state.data.data.map(a => updatedActivities[a.id] ?? a);

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
              onUpdate={applyActivityUpdate}
              expandedContent={
                <ActivityDetailBody
                  activityId={a.id}
                  onDelete={() => { setExpandedId(null); refetch(); }}
                  onActivityUpdate={applyActivityUpdate}
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
          onActivityUpdate={applyActivityUpdate}
        />
      )}
    </div>
  );
}
