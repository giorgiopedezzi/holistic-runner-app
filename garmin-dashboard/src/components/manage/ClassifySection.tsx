import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "@/api/client";
import { Card, ErrorBanner, LoadingSpinner, ProgressBar, Checkbox, DatePicker } from "@/components/ui";
import type { Activity, ClassificationMethod } from "@/types/api";
import { classificationStatus } from "@/types/api";
import { fmtKm } from "@/utils/fmt";
import { isoToday, isoAgo } from "@/utils/date";

// ── AI workout classification (bulk) ────────────────────────────────────
// Same date-range → checkbox-list → bulk-action shape as DeleteSection/
// TrashSection above, but with two distinct actions (classify/reclassify vs
// confirm) and live progress, since classifying is genuinely slow. No bulk
// backend endpoint for classify — this loops POST /api/activities/:id/classify
// sequentially so the "Classifying N/M…" counter is real, not simulated
// (see server.ts's note on why there's no bulk classify route). Confirm is
// fast/DB-only, so it does use the real bulk endpoint.
export function ClassifySection() {
  const [from, setFrom] = useState(isoAgo(30));
  const [to,   setTo]   = useState(isoToday());
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [splitMeters, setSplitMeters] = useState(1000);
  const [method, setMethod] = useState<ClassificationMethod>("ai");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // "Mark where you are" — briefly highlights whichever rows a bulk confirm
  // just touched. Selection itself gets cleared right after (activities
  // changing reference re-triggers the setSelected(new Set()) effect below),
  // so without this there'd be no visual trace of what just happened once
  // the checkboxes clear, especially now that scroll position is preserved
  // and the list doesn't visibly "jump" to draw the eye on its own.
  const [justConfirmed, setJustConfirmed] = useState<Set<number>>(new Set());
  const justConfirmedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function load() {
    setLoading(true);
    setLoadError(null);
    api.garmin.activities(from, to)
      // Scoped to running only — the six categories are running-specific
      // terminology, classifying e.g. a bike ride wouldn't be meaningful.
      .then(all => setActivities(all.filter(a => a.sport === "running")))
      .catch(e => setLoadError(e instanceof Error ? e.message : "Failed to load activities"))
      .finally(() => setLoading(false));
  }
  // Same fetch as load(), but never toggles `loading` — load() gates the
  // whole scrollable list behind {!loading && ...}, so calling it after an
  // in-place action (like bulk confirm) unmounts and remounts the list
  // container, resetting its scroll position to the top. This variant keeps
  // the container mounted the whole time, so the browser preserves scroll
  // offset the same way it would for any other in-place content update.
  function refresh() {
    api.garmin.activities(from, to)
      .then(all => setActivities(all.filter(a => a.sport === "running")))
      .catch(e => setActionError(e instanceof Error ? e.message : "Failed to refresh"));
  }
  useEffect(() => { load(); }, [from, to]);
  useEffect(() => setSelected(new Set()), [activities]);
  useEffect(() => () => { if (justConfirmedTimer.current) clearTimeout(justConfirmedTimer.current); }, []);

  function toggle(id: number) {
    setSelected(s => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleAll() {
    setSelected(s => (activities && s.size === activities.length ? new Set() : new Set(activities?.map(a => a.id) ?? [])));
  }
  function updateOne(id: number, updated: Activity) {
    setActivities(list => list ? list.map(a => (a.id === id ? updated : a)) : list);
  }

  async function classifySelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    setActionError(null);
    setProgress({ current: 0, total: ids.length });
    const errors: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      try {
        updateOne(ids[i], await api.garmin.classify(ids[i], splitMeters, method));
      } catch (e) {
        errors.push(`#${ids[i]}: ${e instanceof Error ? e.message : "failed"}`);
      }
      setProgress({ current: i + 1, total: ids.length });
    }
    if (errors.length) setActionError(errors.slice(0, 3).join("; ") + (errors.length > 3 ? ` (+${errors.length - 3} more)` : ""));
    setProgress(null);
    setBusy(false);
  }

  async function confirmSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.garmin.confirmBulk(ids, method);
      refresh(); // in-place refresh, not load() — see refresh()'s note on why (preserves scroll position)
      if (justConfirmedTimer.current) clearTimeout(justConfirmedTimer.current);
      setJustConfirmed(new Set(ids));
      justConfirmedTimer.current = setTimeout(() => setJustConfirmed(new Set()), 3000);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Confirm failed");
    }
    setBusy(false);
  }

  // Confirm always acts on the currently-selected method's slot (same
  // switch classify uses), not "either slot" — matches confirmActivityById's
  // $source-scoped WHERE clause in server.ts.
  const canConfirm = [...selected].some(id => {
    const a = activities?.find(a2 => a2.id === id);
    return method === "ai" ? a?.ai_classification : a?.statistical_classification;
  });

  return (
    <Card>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>AI workout classification</div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
        Classifies running activities (Recovery Run, Long Session, Repeats/Intervals, Progressive Run, Fartlek, Tapasciata /
        Light Maintenance) using either a local Ollama model or instant deterministic rules — nothing leaves this machine
        either way. Each batch run here uses one method (switch below); the single-activity detail view can run and compare
        both. Reclassifying is always allowed, even on an already-confirmed activity, and resets it back to pending review.
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <DatePicker value={from} onChange={setFrom} max={to} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>→</span>
        <DatePicker value={to} onChange={setTo} min={from} />
      </div>

      {loading && <LoadingSpinner />}
      {loadError && <ErrorBanner message={loadError} />}

      {!loading && !loadError && activities && (
        <>
          {activities.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>No running activities in this range.</div>
          ) : (
            <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: 8, marginBottom: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", cursor: "pointer", marginBottom: 6, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
                <Checkbox checked={selected.size === activities.length} onCheckedChange={toggleAll} />
                Select all ({activities.length})
              </label>
              {activities.map(a => {
                const status = classificationStatus(a);
                const pendingColor = "var(--accent-orange)";
                const confirmedColor = "var(--accent-green)";
                const mutedColor = "var(--text-muted)";
                const pill = (text: string, key: string, isConfirmedSource: boolean) => {
                  // Both slots always get their own pill, regardless of
                  // confirm state — collapsing to a single "Confirmed: X"
                  // pill (an earlier version) hid whichever result wasn't
                  // chosen as final, even though it's still stored and still
                  // useful to see for comparison. The confirmed slot (if
                  // any) is just colored/marked differently, not the only
                  // one shown.
                  const col = isConfirmedSource ? confirmedColor : status === "confirmed" ? mutedColor : pendingColor;
                  return (
                    <span key={key} style={{
                      fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 20,
                      border: `1px solid ${col}`, color: col, textTransform: "uppercase", letterSpacing: "0.03em",
                    }}>
                      {isConfirmedSource && "✓ "}{text}
                    </span>
                  );
                };
                const resultPills = [
                  a.ai_classification && pill(`AI: ${a.ai_classification}`, "ai", status === "confirmed" && a.classification_method === "ai"),
                  a.statistical_classification && pill(`Stats: ${a.statistical_classification}`, "stats", status === "confirmed" && a.classification_method === "statistical"),
                ].filter((x): x is React.ReactElement => Boolean(x));
                return (
                  <label key={a.id} style={{
                    display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)",
                    cursor: "pointer", padding: "3px 4px", borderRadius: 4,
                    // Flash-then-fade marker for whichever rows a bulk
                    // confirm just touched — background is set immediately,
                    // then justConfirmed clears on a timer (see
                    // confirmSelected), and the transition animates that
                    // change back to transparent instead of an instant cut.
                    background: justConfirmed.has(a.id) ? "color-mix(in srgb, var(--accent-green) 18%, transparent)" : "transparent",
                    transition: "background-color 2.5s ease-out",
                  }}>
                    <Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggle(a.id)} />
                    <span style={{ minWidth: 86 }}>{a.date_only}</span>
                    <span style={{ minWidth: 60 }}>{fmtKm(a.distance_m)}</span>
                    {resultPills.length > 0 ? resultPills : (
                      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>unclassified</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", borderRadius: 999, overflow: "hidden", border: "1px solid var(--border-strong)" }}
              title="Classification method: a local Ollama model, or instant deterministic rules over the same pace-variance/split/pause stats (no LLM, works even if Ollama isn't running)">
              {(["ai", "statistical"] as const).map(m => (
                <button key={m} onClick={() => setMethod(m)}
                  style={{
                    fontSize: 10, padding: "3px 8px", border: "none", cursor: "pointer",
                    background: method === m ? "var(--bg-card)" : "transparent",
                    color: method === m ? "var(--text-primary)" : "var(--text-muted)",
                  }}>
                  {m === "ai" ? "AI" : "Statistical"}
                </button>
              ))}
            </div>
            <div style={{ display: "inline-flex", borderRadius: 999, overflow: "hidden", border: "1px solid var(--border-strong)" }}
              title="Split granularity used to (re)classify — finer splits can surface short interval structure a coarser split smooths out">
              {([1000, 500] as const).map(m => (
                <button key={m} onClick={() => setSplitMeters(m)}
                  style={{
                    fontSize: 10, padding: "3px 8px", border: "none", cursor: "pointer",
                    background: splitMeters === m ? "var(--bg-card)" : "transparent",
                    color: splitMeters === m ? "var(--text-primary)" : "var(--text-muted)",
                  }}>
                  {m === 1000 ? "1km" : "0.5km"}
                </button>
              ))}cd
            </div>
            <button className="hra-btn" data-variant="cta" onClick={classifySelected} disabled={selected.size === 0 || busy}>
              Classify / Reclassify selected
            </button>
            <button
              className="hra-btn" data-variant="cta"
              style={{ "--btn-color": "var(--accent-green)" } as CSSProperties}
              onClick={confirmSelected} disabled={!canConfirm || busy}
              title={`Bulk-approves the ${(method === "ai" ? "AI" : "Statistical")} classification for already-classified selected activities, no reason needed — same as thumbs-up per activity`}
            >
              Confirm selected ({(method === "ai" ? "AI" : "Statistical")})
            </button>
          </div>

          {progress && (
            <div style={{ marginTop: 10 }}>
              <ProgressBar label={`Classifying ${progress.current}/${progress.total}…`} current={progress.current} total={progress.total} accent="var(--accent)" />
            </div>
          )}
          {actionError && <div style={{ marginTop: 10 }}><ErrorBanner message={actionError} /></div>}
        </>
      )}
    </Card>
  );
}
