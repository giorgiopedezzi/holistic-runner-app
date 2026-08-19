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
      {loading && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading…</div>}
      {error && <ErrorBanner message={error} />}
      {!loading && !error && items && items.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Trash is empty.</div>
      )}
      {!loading && !error && items && items.length > 0 && (
        <>
          <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: 8, marginBottom: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", cursor: "pointer", marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
              <Checkbox checked={selected.size === items.length} onCheckedChange={toggleAll} />
              Select all ({items.length})
            </label>
            {items.map(item => (
              <label key={item.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer", padding: "3px 0" }}>
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
                <span style={{ fontSize: 12, color: "var(--accent-red)" }}>Permanently delete {selected.size} item(s)? This can't be undone.</span>
                <button
                  className="hra-btn" data-variant="cta"
                  style={{ "--btn-color": "var(--accent-red)" } as CSSProperties}
                  onClick={doPurge} disabled={busy}
                >
                  {busy ? "…" : "Confirm"}
                </button>
                <button onClick={() => setConfirmPurge(false)}
                  style={{ background: "none", border: "1px solid var(--border-strong)", borderRadius: 6, padding: "5px 14px", fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
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
