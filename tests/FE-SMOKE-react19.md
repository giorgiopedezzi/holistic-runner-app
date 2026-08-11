# Manual smoke checklist — React 18 → 19 migration (HRA-64)

**Why this exists.** The bump is type-clean and the 29 automated tests pass, but **jsdom cannot lay out
Recharts** (the project has no `ResizeObserver`), so *every chart assertion in this migration is
necessarily manual*. This checklist is the real gate.

**Run before:** `cd garmin-stats && npm run server` (port 3001), then `cd garmin-dashboard && npm run dev`
(port 5173). Reference activity for chart checks: **id 200** (2026-08-04) — 50:35 duration, 35:59 moving
time, ascent 31 m / descent 24 m, **5 real pauses ≈ 14.6 min**, and a genuine ~20-sample deceleration into
a stop at km 3.80.

**Keep the browser console open for the whole pass.** A clean console is itself a pass criterion.

---

## 0. React-19-specific watch items (applies to every step below)

- [ ] **No React errors or warnings in the console** at any point — in particular nothing about removed
      APIs, `findDOMNode`, string refs, or "Cannot update a component while rendering".
- [ ] **No duplicated side effects.** React 19 StrictMode double-invokes effects *and* ref callbacks in
      dev. Watch that a sync does not fire twice, an OAuth popup does not open twice, and a classify run
      does not double-post.
- [ ] **Charts render every series they should** — see §9, the one migration-specific risk.

---

## 1. App shell / dashboard

- [ ] App loads at `http://localhost:5173` with no blank screen and no console error.
- [ ] Header shows the **green** connectivity dot (server up). Stop the backend → reload → dot turns red
      and the "API server unreachable" banner appears. Restart backend before continuing.
- [ ] All five tabs are present and switch cleanly: **Overview & Trends · Activities · Body · Data & Sync ·
      Settings**.
- [ ] The date-range bar appears on Overview / Activities / Body, and is **absent** on Data & Sync.
- [ ] Date presets (7d / 30d / 90d / 1y / All) each change the data shown.

## 2. Overview & Trends

- [ ] Summary stat cards render with real numbers (no `NaN`, no literal `0` where a value should be blank).
- [ ] One **trend chart per sport** renders; bars (distance) are visible and grey, not sport-coloured.
- [ ] **Pace line and HR line both draw**, pace axis on the **left** (reversed — faster reads toward the
      top), HR axis on the **right**, both with visible tick labels.
- [ ] The three reference lines per metric (avg dashed at higher opacity, min/max fainter) are visible.
- [ ] Grouping toggle **Single / Week / Month** switches; modes with too few groups are disabled with a
      tooltip explaining why.
- [ ] Legend renders and matches line colours.

## 3. Activities list

- [ ] The list renders rows with date, sport badge, distance, duration, HR, pace.
- [ ] **Pagination** works: per-page selector, « ‹ › », and the jump-to-page input (typing a page + Enter).
- [ ] Pagination appears both above and below the list and stays in sync.
- [ ] Changing the date range resets to page 1.

## 4. Activity detail — accordion mode *(Settings → Activity details → Accordion)*

- [ ] Clicking a row expands it **inline**, visually joined to the row; clicking another row collapses the
      first (single-expand).
- [ ] Stats grid renders: Distance, Moving time, Duration, Calories, **Avg speed/pace (one combined card)**,
      Cadence, Avg HR, Max HR, Ascent, Descent.
- [ ] A flat activity with **0 descent** shows either a proper `0` value card or nothing — but **never a
      stray floating "0"** in the layout.

## 5. Activity detail chart — the highest-risk area *(use activity 200)*

- [ ] Main overlay chart renders with a visible line.
- [ ] **Speed/Pace axis is visible on the LEFT and is never missing** — this has regressed before. Toggle
      every other metric on and off and confirm the Speed axis never disappears or slides off-screen.
- [ ] **Heart rate is active by default** and its axis renders on the **right**.
- [ ] Toggle each optional metric — **HR, altitude, cadence, power** — on and off, individually and all at
      once. Each draws its own line and its own right-side axis; Speed stays alone on the left throughout.
- [ ] **Speed ↔ Pace toggle** works; in Pace mode the axis is reversed and shows no negative ticks.
- [ ] **Distance ↔ Time X-axis toggle** works; in Time mode the last tick is close to the real elapsed
      duration (**~50:35**, not a small fraction of it).
- [ ] **Pause flags**: 5 flags render on the main chart, sitting at the **top** and **not clipped**, on a
      pale→deep yellow gradient by duration, with legible black text.
- [ ] Hovering a pause flag shows its tooltip; the tooltip tracks the cursor correctly.
- [ ] Pause flags appear on the **main chart only** — not on the standalone metric cards.
- [ ] **HR recovery flags** render on the Heart-rate card (and only there), same yellow gradient, not clipped.
- [ ] **"Remove outliers" checkbox** (default on): toggling it visibly changes the Speed/Pace line around
      **km 3.80**; with it off, the real deceleration to a stop is visible again.
- [ ] Tooltip on the main chart shows the correct values for the hovered X position.

## 6. Activity detail — modal mode *(Settings → Activity details → Popup)*

- [ ] Clicking a row opens the **popup**, with all of §5 rendering identically inside it.
- [ ] The **×** button closes it; clicking the backdrop does **not** close it (deliberate).

## 7. Classification card *(a running activity)*

- [ ] Both method cards render side by side: **AI** and **Statistical**.
- [ ] "Classify" on the **Statistical** card returns in ~0.1 s and shows a result + explanation.
- [ ] The elapsed-time counter ticks while running and leaves a "took N.Ns" note afterwards.
- [ ] Thumbs up/down records a verdict; the confirmed card gets the green ✓.
- [ ] The 1 km / 0.5 km split toggle is present and reclassifying with it changes the input.
- [ ] *(Only if Ollama is running)* the AI card completes a full round-trip without a 502.

## 8. Body tab

- [ ] **Primary chart** renders three series (Weight, Fat mass, Muscle mass) as **kg change since range
      start**, with a `0` reference line.
- [ ] All three checkboxes toggle their series independently.
- [ ] Each of the five single-metric cards (**Fat %, Bone mass, Hydration, BMI, Heart rate**) renders its
      own chart when enabled.
- [ ] The **Chart / Table** toggle on a card switches to a table showing the same series.
- [ ] The correlation chart (weekly km vs avg weight, dual axis) renders both series.

## 9. ⚠ Chart-completeness check — the one migration-specific risk

React 19 renames the element symbol to `react.transitional.element`; the installed `react-is@18` (a
Recharts peer that npm does **not** auto-upgrade) still matches `react.element`. Verified empirically:
`react-is@18.isFragment()` returns **false** for React 19 elements. Recharts uses `isFragment` in
`toArray()` to flatten fragment children, so *if* any chart child were wrapped in a fragment, those series
would silently vanish — **no error, just a missing line**. Static analysis found zero fragments inside
chart elements, so this should be nil-impact; this check confirms it empirically.

- [ ] **Count the series in every chart** and confirm none is missing versus React 18 behaviour:
      - [ ] Activity detail: Speed/Pace line + each enabled optional metric line + pause-flag scatter.
      - [ ] Overview per-sport chart: distance bars + pace line + HR line + 6 reference lines + legend.
      - [ ] Body primary chart: 3 series + reference line. Correlation chart: 2 series.
- [ ] No chart renders as an **empty axis frame with no data** while its table/stat equivalent shows data.

> If any series is missing, the fix is one line in `garmin-dashboard/package.json` —
> `"overrides": { "react-is": "^19.0.0" }` — then `npm install`. This was deliberately **not** applied
> (it is a transitive major bump; see HRA-64).

## 10. Settings

- [ ] **Theme**: each of the 4 themes + **Auto** applies immediately on click; the whole app restyles.
- [ ] **Background**: "None" and each of the 4 bundled presets apply immediately.
- [ ] **Custom background upload**: choosing an image uploads and applies it (this exercises the one
      `useRef` on a file input — the type most affected by the `@types/react@19` ref changes).
- [ ] **Units**: Metric / Imperial / Auto applies immediately, and **switching to another tab shows the new
      units** (this proves the tab unmount/remount behaviour still propagates module-level unit state).
- [ ] **Activity details**: Accordion / Popup switches and takes effect in the Activities tab.
- [ ] **Overview & Trends** threshold: edit → Save enables → save persists → "current:" updates.
- [ ] **Outlier detection**: edit all three values → Save → persists; the min-speed field shows its live
      min/km equivalent.
- [ ] Reload the page: every setting above survived.

## 11. Data & Sync

- [ ] Garmin device status line renders (connected or not) and the ⟳ recheck button works.
- [ ] Withings and Strava status lines render, each with its own date range.
- [ ] **"Login to …"** opens a real popup window (once, not twice — StrictMode check).
- [ ] *(If a device/token is available)* a sync runs and the **progress bar** animates and completes.
- [ ] **Delete card**: checking Activities / Withings measurements shows a live count for the range;
      "Show data" reveals matching rows.
- [ ] **Trash**: a soft-deleted item appears, **Restore** returns it, **Delete permanently** (with confirm)
      removes it from the list.
- [ ] **Classify section**: the running-only list renders with per-row pills (`AI: …` / `Stats: …`), bulk
      classify shows "Classifying N/M…", and bulk confirm flashes the confirmed rows green **without
      scrolling the list back to the top**.

---

## Result

- [ ] **All of the above pass, console clean → approve HRA-64.**
- [ ] Any failure → note the step number on the ticket. If it is a missing chart series, try the
      `react-is` override first (§9).
