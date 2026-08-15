/**
 * SettingsTab.tsx
 * Global app settings, persisted server-side (this app deliberately avoids
 * localStorage — see CLAUDE.md): outlier-detection thresholds used by
 * ActivityModal.tsx's chart, and appearance (theme + background picture).
 */

import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { Card, SectionTitle, ErrorBanner, LoadingSpinner, glowPillStyle } from "@/components/ui";
import type { Settings, Theme, StoredUnitSystem, AccentColor } from "@/types/api";
import { THEME_NAMES, ACCENT_COLOR_NAMES } from "@/types/api";
import { BUNDLED_BACKGROUNDS, BUNDLED_BACKGROUND_ORDER } from "@/utils/backgrounds";
import { ACCENT_PALETTE } from "@/utils/accent";
import type { AppearanceApi } from "@/hooks/useAppearance";
import { useSettings } from "@/hooks/useSettings";
// The non-converting m:ss formatter (HRA-68 dedup). Used here — not fmt.ts's
// self-converting fmtPace — because outlier_min_speed_kmh is a technical tuning
// parameter always stored/labeled in km/h regardless of the app's unit system,
// so its live pace preview must stay metric-only.
import { fmtMinSecRaw } from "@/utils/fmt";

// Small hardcoded preview swatches per theme, matching index.css's
// [data-theme="..."] blocks — duplicated here (not read from CSS) because a
// swatch needs to show a theme's colors while a DIFFERENT theme is active.
const THEME_PREVIEW: Record<Theme, { label: string; bg: string; card: string; text: string; accent: string }> = {
  "dark":       { label: "Dark",       bg: "#0f1117", card: "#1e2330", text: "#e8eaf0", accent: "#1db87a" },
  "light":      { label: "Light",      bg: "#f5f6f8", card: "#ffffff", text: "#1a1d27", accent: "#0e9f6a" },
  "dark-blue":  { label: "Dark Blue",  bg: "#0a0e1a", card: "#161d35", text: "#e6eaf5", accent: "#4d9dff" },
  "light-warm": { label: "Light Warm", bg: "#faf6f0", card: "#fffaf3", text: "#2b2118", accent: "#b8650a" },
};

// A single theme swatch: the "real system" preview is a small gradient pill
// (light→dark accent, same visual language as the app's own active-nav
// pill/hero ring — see index.css's --accent-strong) over a hairline border
// in that theme's own accent, rather than the earlier abstract two-bar
// mockup. Selected gets a corner check badge instead of relying on border
// color alone to read as "selected" at a glance (polish pass).
function ThemeSwatch({ label, preview, selected, onClick, title }: {
  label: string; preview: { bg: string; card: string; text: string; accent: string };
  selected: boolean; onClick: () => void; title?: string;
}) {
  return (
    <button
      className="hra-lift"
      onClick={onClick}
      title={title}
      style={{
        position: "relative", width: 96, padding: 0, borderRadius: 10, overflow: "hidden", cursor: "pointer",
        border: `1px solid ${selected ? preview.accent : "var(--border)"}`,
        background: "none",
      }}
    >
      <div style={{ background: preview.bg, padding: "16px 10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          width: 42, height: 10, borderRadius: 999,
          background: `linear-gradient(135deg, ${preview.accent}, color-mix(in srgb, ${preview.accent} 70%, black))`,
          boxShadow: `0 0 10px color-mix(in srgb, ${preview.accent} 55%, transparent)`,
        }} />
      </div>
      <div style={{ fontSize: 11, padding: "5px 0", background: preview.card, color: selected ? preview.accent : "var(--text-secondary)" }}>
        {label}
      </div>
      {selected && (
        <div style={{
          position: "absolute", top: 4, right: 4, width: 15, height: 15, borderRadius: "50%",
          background: preview.accent, color: "#000",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, lineHeight: 1,
        }}>✓</div>
      )}
    </button>
  );
}

export function ThemePicker({ appearance }: { appearance: AppearanceApi }) {
  const current = appearance.settings?.theme;
  const isAuto = current === "auto";
  // "Auto" shows the theme it currently resolves to (via prefers-color-scheme)
  // as its own live preview, rather than a fixed swatch — there's no single
  // "auto" color scheme, it's whichever concrete theme the OS picks.
  const autoPreview = THEME_PREVIEW[appearance.resolvedTheme ?? "dark"];

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <ThemeSwatch
        label={`Auto (${autoPreview.label})`}
        preview={autoPreview}
        selected={isAuto}
        onClick={() => appearance.setTheme("auto")}
        title={`Follows your OS's light/dark setting — currently: ${autoPreview.label}`}
      />
      {THEME_NAMES.map(t => (
        <ThemeSwatch
          key={t}
          label={THEME_PREVIEW[t].label}
          preview={THEME_PREVIEW[t]}
          selected={current === t}
          onClick={() => appearance.setTheme(t)}
        />
      ))}
    </div>
  );
}

// Accent picker (HRA-95): a swatch per curated accent, offering all 6.
// Keyboard-navigable for free — these are plain <button>s (Tab, Enter/Space),
// same as ThemePicker above; aria-pressed reflects selection for screen readers.
export function AccentPicker({ appearance }: { appearance: AppearanceApi }) {
  const current = appearance.settings?.accent_color;
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {ACCENT_COLOR_NAMES.map((name: AccentColor) => {
        const def = ACCENT_PALETTE[name];
        const selected = current === name;
        return (
          <button
            key={name}
            className="hra-swatch"
            onClick={() => appearance.setAccentColor?.(name)}
            aria-pressed={selected}
            aria-label={def.label}
            title={def.label}
            style={{
              // Feeds .hra-swatch's hover glow (index.css) with this
              // specific swatch's own color, not the app's currently-active
              // --accent — a swatch previews a color you may not have
              // picked yet.
              ["--swatch-color" as string]: def.hex,
              width: 44, height: 44, borderRadius: "50%", cursor: "pointer",
              border: `2px solid ${selected ? def.hex : "var(--border)"}`,
              outline: selected ? `2px solid ${def.hex}` : "none",
              outlineOffset: 2,
              // Gradient orb — light→base→dark radial, rather than a flat
              // fill, so the swatch itself reads as the same "chrome" look
              // the picked accent will actually produce elsewhere in the app.
              background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${def.hex} 55%, white), ${def.hex} 55%, color-mix(in srgb, ${def.hex} 70%, black))`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, color: def.onAccent, fontWeight: 700,
            }}
          >
            {selected ? "✓" : ""}
          </button>
        );
      })}
    </div>
  );
}

// Live chrome preview strip (polish pass) — shows the current --accent
// applied to the same real chrome elements used elsewhere in the app (a
// filled button, an active nav-style pill, a link, a focus ring), directly
// under the accent row, so picking a swatch shows its effect immediately
// without having to go find a button on another tab.
function ChromePreviewStrip() {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 20, marginTop: 16, padding: "12px 14px",
      borderRadius: "var(--radius-md)", border: "1px solid var(--border)",
      background: "color-mix(in srgb, var(--accent) 3%, var(--bg-surface))",
    }}>
      <button className="hra-lift" style={{
        fontSize: 12, padding: "6px 14px", borderRadius: 6, border: "none",
        background: "var(--accent)", color: "var(--on-accent)", fontWeight: 600,
      }}>
        Button
      </button>
      <span className="hra-pill" style={{ fontSize: 12, padding: "5px 14px", borderRadius: 999, fontWeight: 600, ...glowPillStyle(true) }}>
        Active pill
      </span>
      <a href="#" onClick={e => e.preventDefault()} style={{ fontSize: 12 }}>Link</a>
      <div style={{
        fontSize: 11, padding: "4px 10px", borderRadius: 6, color: "var(--text-secondary)",
        outline: "2px solid var(--accent)", outlineOffset: 2,
      }}>
        Focus ring
      </div>
    </div>
  );
}

const UNIT_SYSTEM_OPTIONS: { value: StoredUnitSystem; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "metric", label: "Metric (km, kg)" },
  { value: "imperial", label: "Imperial (mi, lb)" },
];

export function UnitsPicker({ appearance }: { appearance: AppearanceApi }) {
  const current = appearance.settings?.unit_system;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {UNIT_SYSTEM_OPTIONS.map(opt => {
        const selected = current === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => appearance.setUnits(opt.value)}
            style={{
              fontSize: 12, padding: "6px 14px", borderRadius: 999, cursor: "pointer",
              border: `1px solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
              background: selected ? "var(--accent)22" : "var(--bg-card)",
              color: selected ? "var(--accent)" : "var(--text-secondary)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
      {current === "auto" && appearance.resolvedUnitSystem && (
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          currently: {appearance.resolvedUnitSystem} (from your browser's locale — there's no direct way to read the OS's actual measurement-system setting)
        </span>
      )}
    </div>
  );
}

export function BackgroundPicker({ appearance }: { appearance: AppearanceApi }) {
  const settings = appearance.settings;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await appearance.uploadBackground(file);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (!settings) return null;
  const isNone = settings.background_kind === "none";
  const isCustom = settings.background_kind === "custom";

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <button
          onClick={() => appearance.setBackground("none")}
          style={{
            width: 72, height: 48, borderRadius: 8, cursor: "pointer",
            border: `2px solid ${isNone ? "var(--accent)" : "var(--border)"}`,
            background: "var(--bg-card)", color: "var(--text-muted)", fontSize: 10,
          }}
        >
          None
        </button>
        {BUNDLED_BACKGROUND_ORDER.map(id => {
          const preset = BUNDLED_BACKGROUNDS[id];
          const selected = settings.background_kind === "bundled" && settings.background_value === id;
          return (
            <button
              key={id}
              onClick={() => appearance.setBackground("bundled", id)}
              title={preset.label}
              style={{
                width: 72, height: 48, borderRadius: 8, cursor: "pointer",
                border: `2px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                backgroundImage: preset.css, backgroundColor: "var(--bg)",
              }}
            />
          );
        })}
        <label
          style={{
            width: 72, height: 48, borderRadius: 8, cursor: uploading ? "not-allowed" : "pointer",
            border: `2px solid ${isCustom ? "var(--accent)" : "var(--border)"}`,
            background: isCustom && settings.background_value
              ? `center/cover url("${api.settings.backgroundImageUrl(settings.background_value)}")`
              : "var(--bg-card)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, color: "var(--text-muted)", textAlign: "center",
          }}
        >
          {!(isCustom && settings.background_value) && (uploading ? "…" : "Upload")}
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleUpload} disabled={uploading} style={{ display: "none" }} />
        </label>
      </div>
      {uploadError && <ErrorBanner message={uploadError} />}
    </div>
  );
}

function SettingField({ label, current, value, onChange, min, step }: {
  label: string; current: number; value: number; onChange: (v: number) => void;
  min: number; step: number;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
        {label}
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="number" min={min} step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{ width: 120, fontSize: 13, padding: "5px 8px" }}
        />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          current: <strong style={{ color: "var(--text-secondary)" }}>{current}</strong>
        </span>
      </div>
    </div>
  );
}

interface Props {
  appearance: AppearanceApi;
}

export function SettingsTab({ appearance }: Props) {
  // Reads the shared settings singleton (useSettings, HRA-76) instead of
  // fetching its own copy. `saved` is the last-known-persisted value (what
  // "current: X" shows); `draft` is the editable form state — both still
  // local to this component (not lifted into the shared store) since they
  // track in-progress, per-card edits the rest of the app has no business
  // seeing until Save is clicked. Primed from the shared settings once, the
  // first time it becomes available — not re-synced on every later change,
  // so a click elsewhere (e.g. a theme swatch, which also flows through the
  // shared store) can't clobber an unsaved draft mid-edit.
  const { settings: sharedSettings, loading, error: sharedError, update: updateShared } = useSettings();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const primed = useRef(false);
  // Which card is mid-save / just-saved — one card = one sub-resource, so the two
  // explicit-save cards (Outlier detection, Overview & Trends) each save
  // independently, hitting their own PUT endpoint (HRA-40). Keyed rather than two
  // boolean pairs so only the clicked card shows its own "Saving…/Saved".
  type SaveKey = "outliers" | "trend";
  const [savingKey, setSavingKey] = useState<SaveKey | null>(null);
  const [justSavedKey, setJustSavedKey] = useState<SaveKey | null>(null);

  useEffect(() => {
    if (sharedSettings && !primed.current) {
      primed.current = true;
      setSaved(sharedSettings);
      setDraft(sharedSettings);
    }
  }, [sharedSettings]);

  useEffect(() => {
    if (sharedError) setError(sharedError);
  }, [sharedError]);

  const outliersDirty = !!draft && !!saved && (
    draft.outlier_speed_delta_per_sec !== saved.outlier_speed_delta_per_sec ||
    draft.outlier_cadence_delta_per_sec !== saved.outlier_cadence_delta_per_sec ||
    draft.outlier_min_speed_kmh !== saved.outlier_min_speed_kmh
  );
  const trendDirty = !!draft && !!saved && draft.min_trend_group_size !== saved.min_trend_group_size;

  // Each card persists ONLY its own sub-resource (no combined write). The backend
  // returns the whole settings row, so saved+draft stay fully in sync either way.
  async function saveCard(key: SaveKey, put: (s: Settings) => Promise<Settings>) {
    if (!draft) return;
    setSavingKey(key);
    setJustSavedKey(null);
    setError(null);
    try {
      const updated = await put(draft);
      setSaved(updated);
      setDraft(updated);
      updateShared(updated); // propagate to every other tab sharing the settings singleton
      setJustSavedKey(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSavingKey(null);
    }
  }
  const saveOutliers = () => saveCard("outliers", api.settings.updateOutliers);
  const saveThresholds = () => saveCard("trend", api.settings.updateThresholds);

  // Immediate-apply, like theme/units/background — a "how I browse
  // activities" preference reads as a click-and-done toggle, not a form
  // field to explicitly Save. Updates saved+draft together so it never shows
  // up as a pending, unsaved change in the outlier-detection form below.
  async function setDetailView(view: Settings["activity_detail_view"]) {
    const updated = await api.settings.setDetailView(view);
    setSaved(updated);
    setDraft(updated);
    updateShared(updated); // propagate to ActivitiesTab, which reads this from the shared store
  }

  // One SaveBar per explicit-save card (Outlier detection, Overview & Trends).
  // Each has its own dirty state and its own save handler → persists only that
  // card's sub-resource (one card = one sub-resource, HRA-40).
  function SaveBar({ cardKey, dirty, onSave }: { cardKey: SaveKey; dirty: boolean; onSave: () => void }) {
    const saving = savingKey === cardKey;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
        <button
          className="hra-lift"
          onClick={onSave}
          disabled={!dirty || saving}
          style={{
            fontSize: 13, padding: "6px 16px", borderRadius: 6, border: "none",
            background: dirty && !saving ? "var(--accent-green)" : "var(--border-strong)",
            color: dirty && !saving ? "var(--bg)" : "var(--text-muted)",
            cursor: dirty && !saving ? "pointer" : "not-allowed",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {justSavedKey === cardKey && !dirty && <span style={{ fontSize: 12, color: "var(--accent-green)" }}>Saved</span>}
      </div>
    );
  }

  return (
    <div>
      <SectionTitle>Appearance</SectionTitle>
      <Card style={{ maxWidth: 640, marginBottom: 24 }}>
        {/* Background picture picker removed (polish pass) — replaced by the
            app-wide automatic ambient glow layer (index.css's
            .hra-ambient-glow: two radial accent/accent-glow washes over the
            theme base), which needs no per-user picking. */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>Theme</div>
            <ThemePicker appearance={appearance} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>
              Accent color — governs buttons, active pills, links and focus rings only; never chart/data colors
            </div>
            <AccentPicker appearance={appearance} />
          </div>
        </div>
        <ChromePreviewStrip />
      </Card>

      <SectionTitle>Units</SectionTitle>
      <Card style={{ maxWidth: 480, marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 0, marginBottom: 12 }}>
          Applies to distance, pace, speed, elevation and weight everywhere in the app. "Auto"
          guesses from your browser's language/region (e.g. a US locale defaults to imperial) —
          there's no direct way for a web page to read the OS's actual measurement-system setting,
          so this is a best-effort default you can always override.
        </p>
        <UnitsPicker appearance={appearance} />
      </Card>

      <SectionTitle>Activity details</SectionTitle>
      <Card style={{ maxWidth: 480, marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 0, marginBottom: 12 }}>
          How clicking an activity in the Activities tab opens its detail — expand inline in the list, or open as a popup.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          {(["accordion", "modal"] as const).map(v => {
            const selected = saved?.activity_detail_view === v;
            return (
              <button
                key={v}
                onClick={() => setDetailView(v)}
                style={{
                  fontSize: 12, padding: "6px 14px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${selected ? "var(--accent)" : "var(--border-strong)"}`,
                  background: selected ? "var(--accent)22" : "var(--bg-card)",
                  color: selected ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                {v === "accordion" ? "Accordion (inline)" : "Popup"}
              </button>
            );
          })}
        </div>
      </Card>

      <SectionTitle>Overview & Trends</SectionTitle>
      <Card style={{ maxWidth: 480, marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 0, marginBottom: 16 }}>
          Minimum activities needed before a sport's trend chart is shown (in "Single" mode), or
          before "Week"/"Month" grouping is offered — below this, a "too few activities" message is
          shown instead of a chart that would only have a couple of bars.
        </p>
        {draft && saved && (
          <>
            <SettingField
              label="Minimum activities/groups for a trend"
              current={saved.min_trend_group_size}
              value={draft.min_trend_group_size}
              onChange={v => setDraft(d => d && { ...d, min_trend_group_size: Math.round(v) })}
              min={2} step={1}
            />
            <SaveBar cardKey="trend" dirty={trendDirty} onSave={saveThresholds} />
          </>
        )}
      </Card>

      <SectionTitle>Outlier detection</SectionTitle>
      <Card style={{ maxWidth: 480 }}>
        <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 0, marginBottom: 16 }}>
          Used by the activity chart's "Remove outliers" checkbox. Two independent rules: an
          isolated-spike filter (a point is flagged only when it jumps away <em>and</em> back from
          its neighbors faster than the rate below, so a genuine sustained change like a real
          sprint isn't affected), and an absolute floor for Speed/Pace — any sample slower than
          the walking-pace threshold is dropped outright, for a "running only" view.
        </p>

        {loading && <LoadingSpinner />}
        {error && <div style={{ marginBottom: 12 }}><ErrorBanner message={error} /></div>}

        {draft && saved && (
          <>
            <SettingField
              label="Max speed change (m/s per second)"
              current={saved.outlier_speed_delta_per_sec}
              value={draft.outlier_speed_delta_per_sec}
              onChange={v => setDraft(d => d && { ...d, outlier_speed_delta_per_sec: v })}
              min={0.1} step={0.1}
            />
            <div style={{ marginBottom: 4 }} />
            <SettingField
              label="Max cadence change (steps/min per second)"
              current={saved.outlier_cadence_delta_per_sec}
              value={draft.outlier_cadence_delta_per_sec}
              onChange={v => setDraft(d => d && { ...d, outlier_cadence_delta_per_sec: v })}
              min={1} step={1}
            />
            <div style={{ marginBottom: 4 }} />
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
                Min speed to count as running (km/h)
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="number" min={0} step={0.5}
                  value={draft.outlier_min_speed_kmh}
                  onChange={e => setDraft(d => d && { ...d, outlier_min_speed_kmh: Number(e.target.value) })}
                  style={{ width: 120, fontSize: 13, padding: "5px 8px" }}
                />
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {draft.outlier_min_speed_kmh > 0 ? `≈ ${fmtMinSecRaw(60 / draft.outlier_min_speed_kmh)} min/km` : "off"} · current: <strong style={{ color: "var(--text-secondary)" }}>{saved.outlier_min_speed_kmh}</strong>
                </span>
              </div>
            </div>

            <SaveBar cardKey="outliers" dirty={outliersDirty} onSave={saveOutliers} />
          </>
        )}
      </Card>
    </div>
  );
}
