import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
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

  const btnStyle = (disabled: boolean): CSSProperties => ({
    fontSize: 12, padding: "4px 9px", borderRadius: 6,
    "--dyn-color": disabled ? "var(--text-muted)" : "var(--text-primary)",
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
  } as CSSProperties);
  const btnClass = "hra-border-strong hra-bg-card hra-dyn-color";

  return (
    <div className="hra-text-secondary" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginTop: 14, fontSize: 12 }}>
      <div className="hra-row" style={{ gap: 6 }}>
        <span>{t("common.perPage", "Per page")}</span>
        <Select
          value={String(perPage)}
          onValueChange={v => onPerPageChange(Number(v))}
          options={perPageOptions.map(n => ({ value: String(n), label: String(n) }))}
          triggerStyle={{ fontSize: 12, padding: "3px 8px" }}
        />
        <span className="hra-text-muted">{t("common.totalCount", `· ${totalItems} total`, { n: totalItems })}</span>
      </div>

      <div className="hra-row" style={{ gap: 4 }}>
        <button className={btnClass} onClick={() => onPageChange(1)} disabled={page <= 1} style={btnStyle(page <= 1)}>«</button>
        <button className={btnClass} onClick={() => onPageChange(page - 1)} disabled={page <= 1} style={btnStyle(page <= 1)}>‹</button>
        <span className="hra-row" style={{ gap: 6, margin: "0 6px" }}>
          {t("common.pageLabel", "Page")}
          <input
            type="number" min={1} max={totalPages} value={jumpTo}
            onChange={e => setJumpTo(e.target.value)}
            onBlur={commitJump}
            onKeyDown={e => e.key === "Enter" && commitJump()}
            style={{ width: 48, fontSize: 12, padding: "3px 6px", textAlign: "center" }}
          />
          {t("common.ofTotalPages", `of ${totalPages}`, { n: totalPages })}
        </span>
        <button className={btnClass} onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} style={btnStyle(page >= totalPages)}>›</button>
        <button className={btnClass} onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} style={btnStyle(page >= totalPages)}>»</button>
      </div>
    </div>
  );
}
