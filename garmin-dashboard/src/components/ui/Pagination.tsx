import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "./Select";

// Classical pagination: per-page selector, first/prev/next/last arrows, and
// a "jump to page" number input — all client-side (the caller slices its
// own already-fetched array), since this app's per-range activity counts
// are small enough that a server-side paged endpoint isn't warranted.
interface PaginationProps {
  page: number;          // 1-indexed
  totalPages: number;
  onPageChange: (page: number) => void;
  perPage: number;
  perPageOptions: number[];
  onPerPageChange: (n: number) => void;
  totalItems: number;
}

export function Pagination({ page, totalPages, onPageChange, perPage, perPageOptions, onPerPageChange, totalItems }: PaginationProps) {
  const { t } = useTranslation();
  const [jumpTo, setJumpTo] = useState(String(page));
  useEffect(() => setJumpTo(String(page)), [page]);

  function commitJump() {
    const n = Math.max(1, Math.min(totalPages, Math.round(Number(jumpTo)) || 1));
    onPageChange(n);
    setJumpTo(String(n));
  }

  return (
    <div className="hra-pagination">
      <div className="hra-pagination-size">
        <span>{t("common.perPage", "Per page")}</span>
        <Select
          value={String(perPage)}
          onValueChange={v => onPerPageChange(Number(v))}
          options={perPageOptions.map(n => ({ value: String(n), label: String(n) }))}
          triggerClassName="hra-pagination-select"
        />
        <span className="hra-text-muted">{t("common.totalCount", `· ${totalItems} total`, { n: totalItems })}</span>
      </div>

      <div className="hra-pagination-controls">
        <button type="button" className="hra-pagination-button" onClick={() => onPageChange(1)} disabled={page <= 1}>«</button>
        <button type="button" className="hra-pagination-button" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>‹</button>
        <span className="hra-pagination-page">
          {t("common.pageLabel", "Page")}
          <input
            type="number" min={1} max={totalPages} value={jumpTo}
            onChange={e => setJumpTo(e.target.value)}
            onBlur={commitJump}
            onKeyDown={e => e.key === "Enter" && commitJump()}
            className="hra-pagination-input"
          />
          {t("common.ofTotalPages", `of ${totalPages}`, { n: totalPages })}
        </span>
        <button type="button" className="hra-pagination-button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>›</button>
        <button type="button" className="hra-pagination-button" onClick={() => onPageChange(totalPages)} disabled={page >= totalPages}>»</button>
      </div>
    </div>
  );
}
