import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorBanner, Checkbox } from "@/components/ui";
import { useDemoMode } from "@/hooks/useDemoMode";

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
  const { t } = useTranslation();
  const demoMode = useDemoMode();
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
    <div className="mb-4">
      <div className="hra-block-title text-label mb-2" >{title}</div>
      {loading && <div className="hra-text-muted text-meta" >{t("common.loading", "Loading…")}</div>}
      {error && <ErrorBanner message={error} />}
      {!loading && !error && items && items.length === 0 && (
        <div className="hra-text-muted text-meta" >{t("manage.trash.empty", "Trash is empty.")}</div>
      )}
      {!loading && !error && items && items.length > 0 && (
        <>
          <div className="hra-border max-h-50 overflow-auto rounded-md p-2 mb-2.5" >
            <label className="hra-text-muted hra-border-bottom flex items-center gap-1.5 text-meta cursor-pointer mb-1.5 pb-1.5" >
              <Checkbox checked={selected.size === items.length} onCheckedChange={toggleAll} />
              {t("manage.trash.selectAll", `Select all (${items.length})`, { n: items.length })}
            </label>
            {items.map(item => (
              <label key={item.id} className="hra-list-row hra-text-secondary flex items-center gap-1.5 text-meta cursor-pointer">
                <Checkbox checked={selected.has(item.id)} onCheckedChange={() => toggle(item.id)} />
                {renderRow(item)}
              </label>
            ))}
          </div>

          <div className="hra-row-wrap">
            <button
              className="hra-btn" data-variant="cta" onClick={doRestore} disabled={selected.size === 0 || busy || demoMode}
              title={demoMode ? t("common.demoModeHint", "Not available for demo") : undefined}
            >
              {t("manage.trash.restoreSelected", "Restore selected")}
            </button>

            {!confirmPurge ? (
              <button
                className="hra-btn" data-variant="cta"
                data-tone="red"
                onClick={() => setConfirmPurge(true)} disabled={selected.size === 0 || busy || demoMode}
                title={demoMode
                  ? t("common.demoModeHint", "Not available for demo")
                  : t("manage.trash.purgeTooltip", "Permanently deletes the selected item(s) — this can't be undone. The filename/date is still kept internally so a resync won't bring it back.")}
              >
                {t("manage.trash.deletePermanently", "Delete permanently…")}
              </button>
            ) : (
              <>
                <span className="hra-text-danger text-meta" >{t("manage.trash.confirmPurge", `Permanently delete ${selected.size} item(s)? This can't be undone.`, { n: selected.size })}</span>
                <button
                  className="hra-btn" data-variant="cta"
                  data-tone="red"
                  onClick={doPurge} disabled={busy}
                >
                  {busy ? "…" : t("common.confirm", "Confirm")}
                </button>
                <button onClick={() => setConfirmPurge(false)}
                  className="hra-control-action hra-border-strong hra-text-secondary bg-transparent rounded-md text-meta cursor-pointer">
                  {t("common.cancel", "Cancel")}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
