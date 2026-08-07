import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { DateRange } from "@/types/api";

// ── Card ─────────────────────────────────────────────────────────────────
interface CardProps {
  children: ReactNode;
  style?:   CSSProperties;
  className?: string;
}

export function Card({ children, style, className }: CardProps) {
  return (
    <div
      className={className}
      style={{
        background:   "var(--bg-card)",
        border:       "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding:      "16px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Stat ─────────────────────────────────────────────────────────────────
interface StatProps {
  label:  string;
  value:  string | number;
  sub?:   string;
  accent?: string;
}

export function Stat({ label, value, sub, accent }: StatProps) {
  return (
    <Card>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: accent ?? "var(--text-primary)", lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
          {sub}
        </div>
      )}
    </Card>
  );
}

// ── StatGrid ─────────────────────────────────────────────────────────────
export function StatGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
      gap: 10,
    }}>
      {children}
    </div>
  );
}

// ── Badge (sport pill) ────────────────────────────────────────────────────
interface BadgeProps { label: string; color: string; }

export function Badge({ label, color }: BadgeProps) {
  return (
    <span style={{
      display:       "inline-block",
      fontSize:      11,
      fontWeight:    600,
      padding:       "2px 9px",
      borderRadius:  20,
      background:    `${color}22`,
      color,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
    }}>
      {label}
    </span>
  );
}

// ── SectionTitle ──────────────────────────────────────────────────────────
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 style={{
      fontSize:      13,
      fontWeight:    600,
      color:         "var(--text-secondary)",
      textTransform: "uppercase",
      letterSpacing: "0.07em",
      margin:        "24px 0 12px",
    }}>
      {children}
    </h3>
  );
}

// ── Empty ─────────────────────────────────────────────────────────────────
export function Empty({ message = "No data in this range." }: { message?: string }) {
  return (
    <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
      {message}
    </div>
  );
}

// ── RangeEmpty ────────────────────────────────────────────────────────────
// An empty-range result reads very differently depending on whether there's
// no data anywhere yet (first run, nothing synced) vs. real data exists but
// just not in the currently-selected window — the second case should point
// at the actual available range rather than a generic "nothing here."
// `range` is the entity's overall min/max date (e.g. GET /api/range), null
// while it's still loading.
interface RangeEmptyProps {
  range: DateRange | null;
  from: string;
  to: string;
  entityLabel: string; // e.g. "activities", "body measurements"
}

export function RangeEmpty({ range, from, to, entityLabel }: RangeEmptyProps) {
  if (!range || !range.min_date || !range.max_date) {
    return <Empty message={`No ${entityLabel} yet — sync some data from the Data & Sync tab.`} />;
  }
  return (
    <Empty message={`No ${entityLabel} in the selected range (${from} to ${to}). Data available from ${range.min_date} to ${range.max_date}.`} />
  );
}

// ── ErrorBanner ───────────────────────────────────────────────────────────
export function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{
      background:   "#e85a2a18",
      border:       "1px solid #e85a2a44",
      borderRadius: "var(--radius-md)",
      padding:      "14px 16px",
      color:        "#e85a2a",
      fontSize:     13,
    }}>
      {message}
    </div>
  );
}

// ── LoadingSpinner ────────────────────────────────────────────────────────
export function LoadingSpinner() {
  return (
    <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
      Loading…
    </div>
  );
}

// ── StatusLine ───────────────────────────────────────────────────────────
// "● connected" / "○ not connected" indicator with an optional manual
// recheck button. Used for capability checks (device plugged in, auth token
// valid) that are checked once on mount rather than polled in the
// background — the recheck button covers state changes since then (watch
// plugged in later, token re-authorized elsewhere).
interface StatusLineProps {
  state:      "checking" | "ok" | "warn" | "error";
  message:    string;
  onRecheck?: () => void;
  checking?:  boolean;
}

const STATUS_COLOR: Record<StatusLineProps["state"], string> = {
  checking: "var(--text-muted)",
  ok:       "var(--accent-green)",
  warn:     "var(--text-muted)",
  error:    "var(--accent-red)",
};

export function StatusLine({ state, message, onRecheck, checking }: StatusLineProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12, color: "var(--text-secondary)" }}>
      <span style={{ color: STATUS_COLOR[state], fontSize: 10 }}>{state === "checking" ? "⏳" : "●"}</span>
      <span>{message}</span>
      {onRecheck && (
        <button
          onClick={onRecheck}
          disabled={checking}
          title="Recheck"
          style={{
            background: "none", border: "none", color: "var(--text-muted)",
            cursor: checking ? "not-allowed" : "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1,
          }}
        >
          ⟳
        </button>
      )}
    </div>
  );
}

// ── Pagination ───────────────────────────────────────────────────────────
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
  const [jumpTo, setJumpTo] = useState(String(page));
  useEffect(() => setJumpTo(String(page)), [page]);

  function commitJump() {
    const n = Math.max(1, Math.min(totalPages, Math.round(Number(jumpTo)) || 1));
    onPageChange(n);
    setJumpTo(String(n));
  }

  const btnStyle = (disabled: boolean): CSSProperties => ({
    fontSize: 12, padding: "4px 9px", borderRadius: 6,
    border: "1px solid var(--border-strong)", background: "var(--bg-card)",
    color: disabled ? "var(--text-muted)" : "var(--text-primary)",
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
  });

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginTop: 14, fontSize: 12, color: "var(--text-secondary)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span>Per page</span>
        <select
          value={perPage}
          onChange={e => onPerPageChange(Number(e.target.value))}
          style={{ fontSize: 12, padding: "3px 6px" }}
        >
          {perPageOptions.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span style={{ color: "var(--text-muted)" }}>· {totalItems} total</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button onClick={() => onPageChange(1)} disabled={page <= 1} style={btnStyle(page <= 1)}>«</button>
        <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} style={btnStyle(page <= 1)}>‹</button>
        <span style={{ display: "flex", alignItems: "center", gap: 6, margin: "0 6px" }}>
          Page
          <input
            type="number" min={1} max={totalPages} value={jumpTo}
            onChange={e => setJumpTo(e.target.value)}
            onBlur={commitJump}
            onKeyDown={e => e.key === "Enter" && commitJump()}
            style={{ width: 48, fontSize: 12, padding: "3px 6px", textAlign: "center" }}
          />
          of {totalPages}
        </span>
        <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} style={btnStyle(page >= totalPages)}>›</button>
        <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages} style={btnStyle(page >= totalPages)}>»</button>
      </div>
    </div>
  );
}

// ── ProgressBar ──────────────────────────────────────────────────────────
// Determinate when total > 0 (fills to current/total); indeterminate
// (animated stripe) when total is 0 — e.g. before a device enumeration
// reports back how many files there are to sync.
interface ProgressBarProps {
  label:    string;
  current?: number;
  total?:   number;
  accent?:  string;
}

export function ProgressBar({ label, current = 0, total = 0, accent = "var(--accent-green)" }: ProgressBarProps) {
  const determinate = total > 0;
  const pct = determinate ? Math.min(100, Math.round((current / total) * 100)) : 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
        <span>{label}</span>
        {determinate && <span>{current} / {total}</span>}
      </div>
      <div style={{ position: "relative", overflow: "hidden", height: 6, borderRadius: 999, background: "var(--border)" }}>
        {determinate ? (
          <div style={{ height: "100%", width: `${pct}%`, background: accent, borderRadius: 999, transition: "width 0.2s ease" }} />
        ) : (
          <div style={{
            position: "absolute", top: 0, bottom: 0, width: "40%", borderRadius: 999,
            background: accent, animation: "progress-indeterminate 1.1s ease-in-out infinite",
          }} />
        )}
      </div>
    </div>
  );
}
