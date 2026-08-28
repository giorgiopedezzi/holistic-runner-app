# HRA-180 analytics styling inventory

Captured from Git `HEAD` at implementation start on 2026-08-28, before HRA-180 source edits.

## Scope and method

The approved slice covers overview analytics, body charts, activity summaries and details, activity chart controls/tooltips/runners, and the planned-pace visualization. The inventory includes `OverviewTab.tsx`, `BodyTab.tsx`, `PlannedPaceTargetChart.tsx`, and every non-test `components/activity/**/*.tsx` file recursively.

Every JSX `style=` site was located with `rg` and treated as a migration candidate until individually classified. Direct Recharts props (`contentStyle`, `wrapperStyle`, `tick`, `dot`, `activeDot`, `activeBar`, `stroke`, `fill`, axis/domain/margin geometry) and SVG presentation attributes were inventoried separately because those APIs do not consistently expose a DOM `className` boundary.

## Baseline JSX style-site counts

| File | Sites |
|---|---:|
| `garmin-dashboard/src/components/OverviewTab.tsx` | 45 |
| `garmin-dashboard/src/components/BodyTab.tsx` | 13 |
| `garmin-dashboard/src/components/PlannedPaceTargetChart.tsx` | 2 |
| `garmin-dashboard/src/components/activity/ActivityChartSection.tsx` | 17 |
| `garmin-dashboard/src/components/activity/ActivityDetailBody.tsx` | 13 |
| `garmin-dashboard/src/components/activity/ActivityModal.tsx` | 2 |
| `garmin-dashboard/src/components/activity/ActivityRow.tsx` | 19 |
| `garmin-dashboard/src/components/activity/ActivityTypePicker.tsx` | 8 |
| `garmin-dashboard/src/components/activity/MetricRow.tsx` | 3 |
| `garmin-dashboard/src/components/activity/RunnerGlyph.tsx` | 1 |
| `garmin-dashboard/src/components/activity/RunnerIcon.tsx` | 1 |
| `garmin-dashboard/src/components/activity/RunnerReadout.tsx` | 2 |
| `garmin-dashboard/src/components/activity/RunnerTerrain.tsx` | 1 |
| `garmin-dashboard/src/components/activity/TrackTooltip.tsx` | 6 |
| **Total** | **133** |

The remaining non-test activity files (`HrRecoveryFlagShape.tsx`, `MetricGradient.tsx`, `OverlayCharts.tsx`, `PauseFlagShape.tsx`, `RunnerPlayButton.tsx`, and `shared.ts`) have no JSX `style=` attribute at baseline, but do contain direct visualization-library or SVG presentation props covered below.

## Baseline site classification

| Area | Static migration candidates | Runtime/calculated candidates | Visualization API candidates |
|---|---|---|---|
| Overview trends | card spacing, header rows, legends, tooltips, title/KPI/sidebar grids, sport summaries | per-series legend color | chart heights/domains/margins; gradient stops; axis ticks; tooltip cursor/content; bar/line/dot/active-dot props; custom SVG ticks |
| Body metrics | card/table layout and typography, selector rows | active metric color/state | axes, reference line, tooltip/legend passthrough props, gradients, area/bar/line props |
| Planned pace | wrapper spacing and fixed chart-height wrapper | none | chart margin/domain/axis labels, tooltip `contentStyle`, gradient stops, band fill/stroke props |
| Activity summaries/details | modal/row/header/form layout and typography | optional control dimensions, finite selected/expanded states | badge/icon colors remain semantic component props |
| Activity chart controls | selector/header/runner-row/card layout and typography | chart header insets and calculated placeholder/runner heights | none in this orchestrator; chart APIs live in `OverlayCharts.tsx` |
| Runner/tooltip helpers | tooltip padding/spacing and terrain positioning | runner x/y/color, metric colors | runner/terrain SVG geometry and paint attributes |

## Direct Recharts and SVG exception inventory

These are expected direct-library boundaries, not ordinary DOM inline-style escape hatches. They remain only where the library API requires or clearly favors the direct prop.

### Recharts geometry and behavior

- `AreaChart` / `ComposedChart` `data`, `margin`, and fixed `ResponsiveContainer` dimensions define plot geometry and preserve current axes, hover, playback, and alignment behavior.
- `XAxis` / `YAxis` `domain`, `ticks`, `interval`, `width`, `orientation`, `reversed`, `hide`, `tickFormatter`, and `label` props are Recharts scale/layout inputs. `tick` objects remain direct where per-axis semantic color and compact 9px SVG text are required.
- `CartesianGrid` continues to receive the shared `chartGrid` object.
- `Tooltip` custom `content` renderers, `cursor`, and `contentStyle` remain direct library inputs. `contentStyle` is retained only for Recharts' generated wrapper; custom tooltip DOM uses classes.
- `Legend.wrapperStyle` remains direct because Recharts exposes no equivalent class hook for the generated legend wrapper.
- `Bar`, `Area`, `Line`, and `Scatter` keep data keys, radii, sizes, connect/animation flags, shape functions, and series paint props (`fill`, `stroke`, opacity, width, `dot`, `activeDot`, `activeBar`) where Recharts owns the generated SVG nodes.
- The hidden secondary X axis in Overview and hidden pause axis in the activity overlay remain direct, preserving exact bar overlap and the zero-width pause-axis invariant.

### SVG definitions and custom shapes

- Overview, Body, planned-pace, and activity metric gradients keep `<linearGradient>` / `<stop>` geometry and data-driven `stopColor` / opacity attributes inside each owning SVG so generated IDs remain collision-free.
- Overview's two-row tick renderer keeps SVG `<g>` transforms and `<text>` coordinates/paint.
- `PauseFlagShape` and `HrRecoveryFlagShape` keep calculated transforms, marker dimensions, radii, fill, and SVG text coordinates because Recharts supplies runtime chart coordinates and the marker width depends on rendered text.
- `RunnerTerrain` keeps its calculated `<path d>` and SVG gradient/path paint; DOM positioning moves to classes.
- `RunnerGlyph` and play/stop icons keep SVG geometry, stroke/fill, and caller-supplied size/color presentation props.

## Migration invariants

- Static layout, spacing, typography, borders, radii, and finite visual states move to common Tailwind utilities or named semantic classes.
- Runtime numbers and data colors cross the DOM boundary only through declared CSS custom properties.
- No runtime-generated Tailwind class name may be introduced.
- Axes, domains, margins, gradients, toggles, hover behavior, playback, tooltip behavior, and series colors must remain behaviorally unchanged.
- Every retained direct Recharts/SVG exception is documented above; its existence alone is not a violation.

## Post-migration JSX runtime-bridge inventory

The 133 baseline JSX style sites were reduced to **17 retained sites**. Every retained object contains only runtime CSS custom properties or unavoidable calculated CSS values; no retained object mixes in static layout, spacing, typography, border, shadow, or finite-state declarations.

| File | Retained sites | Bridge |
|---|---:|---|
| `OverviewTab.tsx` | 7 | runtime series legend color (`--legend-color`) and axis-derived header insets (`--overview-header-left` / `--overview-header-right`) |
| `BodyTab.tsx` | 2 | selected checkbox color (`--dyn-color`) and per-metric selector color (`--metric-color`) |
| `ActivityChartSection.tsx` | 3 | axis-derived controls insets, calculated runner-row height, and calculated deferred-chart placeholder height |
| `ActivityTypePicker.tsx` | 1 | optional caller-provided action width/height |
| `MetricRow.tsx` | 1 | per-metric selector color |
| `RunnerIcon.tsx` | 1 | runtime chart x-coordinate, elevation offset, and data-driven runner color |
| `RunnerReadout.tsx` | 1 | data-driven metric color |
| `TrackTooltip.tsx` | 1 | data-driven metric color |
| **Total** | **17** | |

`RunnerGlyph`'s unused generic `style` passthrough was removed; all of its callers already use its explicit `size`, `color`, and `className` API.
