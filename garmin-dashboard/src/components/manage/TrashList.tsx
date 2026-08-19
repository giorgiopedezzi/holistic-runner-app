import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { ErrorBanner, Checkbox } from "@/components/ui";

// ── Trash ────────────────────────────────────────────────────────────────
// Both entity types (activities, body measurements) share one card/UI shape
// — a checkbox list plus Restore / Empty trash (permanent) actions — but
// stay two independent lists/selections/requests, matching how the Delete
// card above already treats them as two separate things.
export function TrashList<T extends { id: number; deleted_at: string }>({
  title, items, loading, error, renderRow, onRestore, onPurge,
}: {
  title: string;
  items: T[] | null;
  loading: boolean;
  error: string | null;
  renderRow: (item: T) => string;
  onRestore: (ids: number[]) => Promise<void>;
  onPurge: (ids: number[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSelected(new Set()); setConfirmPurge(false); }, [items]);

  function toggle(id: number) {
    setSelected(s => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleAll() {
    setSelected(s => (items && s.size === items.length ? new Set() : new Set(items?.map(i => i.id) ?? [])));
  }

  async function doRestore() {
    setBusy(true);
    try { await onRestore([...selected]); } finally { setBusy(false); }
  }
  async function doPurge() {
    setBusy(true);
    try { await onPurge([...selected]); setConfirmPurge(false); } finally { setBusy(false); }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="hra-block-title" style={{ fontSize: 13, marginBottom: 8 }}>{title}</div>
      {loading && <div className="hra-text-muted" style={{ fontSize: 12 }}>Loading…</div>}
      {error && <ErrorBanner message={error} />}
      {!loading && !error && items && items.length === 0 && (
        <div className="hra-text-muted" style={{ fontSize: 12 }}>Trash is empty.</div>
      )}
      {!loading && !error && items && items.length > 0 && (
        <>
          <div className="hra-border" style={{ maxHeight: 200, overflow: "auto", borderRadius: 6, padding: 8, marginBottom: 10 }}>
            <label className="hra-text-muted hra-border-bottom" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", marginBottom: 6, paddingBottom: 6 }}>
              <Checkbox checked={selected.size === items.length} onCheckedChange={toggleAll} />
              Select all ({items.length})
            </label>
            {items.map(item => (
              <label key={item.id} className="hra-text-secondary" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", padding: "3px 0" }}>
                <Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggle(item.id)} />
                {renderRow(item)}
              </label>
            ))}
          </div>

          <div className="hra-row-wrap">
            <button className="hra-btn" data-variant="cta" onClick={doRestore} disabled={selected.size === 0 || busy}>
              Restore selected
            </button>

            {!confirmPurge ? (
              <button
                className="hra-btn" data-variant="cta"
                style={{ "--btn-color": "var(--accent-red)" } as CSSProperties}
                onClick={() => setConfirmPurge(true)} disabled={selected.size === 0 || busy}
                title="Permanently deletes the selected item(s) — this can't be undone. The filename/date is still kept internally so a resync won't bring it back."
              >
                Delete permanently…
              </button>
            ) : (
              <>
                <span className="hra-text-danger" style={{ fontSize: 12 }}>Permanently delete {selected.size} item(s)? This can't be undone.</span>
                <button
                  className="hra-btn" data-variant="cta"
                  style={{ "--btn-color": "var(--accent-red)" } as CSSProperties}
                  onClick={doPurge} disabled={busy}
                >
                  {busy ? "…" : "Confirm"}
                </button>
                <button onClick={() => setConfirmPurge(false)}
                  className="hra-border-strong hra-text-secondary"
                  style={{ background: "none", borderRadius: 6, padding: "5px 14px", fontSize: 12, cursor: "pointer" }}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
