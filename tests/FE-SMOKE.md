# Manual smoke checklist — frontend chart visuals (HRA-67)

**Why this exists.** The characterization net (HRA-67: Vitest + RTL + jsdom) asserts *structure and
behaviour* — every tab's list/empty/error states, the OAuth section, the Settings save flows, the
hooks, and the load-bearing unit-propagation regression. What it deliberately **cannot** assert is
**how a chart looks**: jsdom lays out Recharts at 0×0 (the `ResizeObserver` stub only lets the
container mount — it does not give it a size), so no line, axis, tick, or flag has real geometry
under test. This checklist is that missing gate. It is the standing companion to the automated net,
not tied to any one change.

**Division of labour.** If a check here can be written as a text/DOM assertion instead, it belongs in
the automated net — move it there and delete it here. What stays here is only what needs human eyes
on rendered chart pixels.

**Run before:** `cd garmin-stats && npm run server` (port 3001), then
`cd garmin-dashboard && npm run dev` (port 5173). **Keep the browser console open** — a clean console
is itself a pass criterion.

**Reference activity: id 200** (2026-08-04) — 50:35 duration, 35:59 moving time, ascent 31 m /
descent 24 m, **5 real pauses ≈ 14.6 min**, and a genuine ~20-sample deceleration into a stop at
km 3.80. The automated fixtures key to the same id, so the two nets describe the same object.

---

## 1. Overview & Trends — per-sport chart

- [ ] One trend chart **per sport** renders; distance **bars are grey** (not sport-coloured).
- [ ] **Pace line and HR line both draw.** Pace axis on the **left**, reversed (faster reads toward
      the top); HR axis on the **right**. Both show tick labels.
- [ ] The three reference lines per metric render — avg dashed (bolder), min/max fainter.
- [ ] **Single / Week / Month** toggle switches; modes with too few groups are disabled with a
      tooltip.
- [ ] Legend colours match the lines. No chart is an **empty axis frame while its numbers exist**.

## 2. Activity detail chart — highest-risk area *(open activity 200)*

- [ ] Main overlay chart renders with a visible line.
- [ ] **Speed/Pace axis is visible on the LEFT and never disappears** — toggle every other metric on
      and off and confirm it stays put (this has regressed before).
- [ ] **Heart rate active by default**, its axis on the **right**.
- [ ] Toggle **HR, altitude, cadence, power** individually and all at once — each draws its own line
      and right-side axis; Speed stays alone on the left throughout.
- [ ] **Speed ↔ Pace** toggle: Pace mode reverses the axis and shows no negative ticks.
- [ ] **Distance ↔ Time** X-axis toggle: in Time mode the last tick is near the real elapsed
      duration (**~50:35**), not a small fraction of it.
- [ ] **Pause flags:** 5 flags render at the **top** of the main chart, **not clipped**, pale→deep
      yellow by duration, legible text. Hover shows a cursor-tracking tooltip.
- [ ] Pause flags appear on the **main chart only** — not on the standalone metric cards.
- [ ] **HR recovery flags** render on the Heart-rate card only, same gradient, not clipped.
- [ ] **"Remove outliers"** (default on): toggling visibly changes the Speed/Pace line around
      **km 3.80**; off shows the real deceleration to a stop again.

## 3. Body tab charts

- [ ] **Primary chart** renders three series (Weight, Fat mass, Muscle mass) as **kg change since
      range start**, with a `0` reference line; each checkbox toggles its series independently.
- [ ] Each enabled single-metric card (**Fat %, Bone mass, Hydration, BMI, Heart rate**) draws its
      own chart; the **Chart / Table** toggle shows the same series as a table.
- [ ] Correlation chart (weekly km vs avg weight, dual axis) renders **both** series.

## 4. Units on charts *(the visual half of the automated propagation test)*

- [ ] Switch **Settings → Units → Imperial**, return to Overview / Body: chart axis labels and
      tooltips read **mi / lb / min·mi⁻¹** (the automated test guards the text; confirm the charts
      followed).

---

## Result

- [ ] **All of the above pass, console clean.** Any failure → note the section number on the ticket,
      with a screenshot for chart-geometry regressions.
