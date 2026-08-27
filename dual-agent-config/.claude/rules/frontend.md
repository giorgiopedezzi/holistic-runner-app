---
paths:
  - "garmin-dashboard/src/**/*.{ts,tsx,css}"
  - "garmin-dashboard/package*.json"
  - "garmin-dashboard/vite.config.*"
  - "garmin-dashboard/tsconfig*.json"
---

# Frontend invariants (`garmin-dashboard/`)

## Stack

- Vite 8 + `@vitejs/plugin-react` v6 (Oxc; no Babel).
- React 19 strict mode.
- TypeScript 6 strict.
- Recharts 3 for charts.
- Tailwind + shadcn/ui.
- `@/` aliases `src/` in both Vite and TypeScript config.
- `import.meta.env` is typed through Vite client types.

## Styling and layout

- Theme colors, spacing, typography, gradients, borders, and shadows are governed by tokens; no ad-hoc hex values or arbitrary one-off Tailwind color/size values.
- **Theme-related styling belongs in `index.css`, not component-local theme literals.**
- In TSX, do not use inline `style={{ color/background/border/boxShadow/filter: ... }}` for theme values.
- Allowed component-side styling:
  1. class names whose visuals are defined centrally;
  2. CSS custom-property hooks such as `style={{ "--x-color": value }}` for shared parameterized classes;
  3. `var(--token)` passed directly to SVG/component props such as `stroke` or `fill`.
- Structural layout values (`display`, `gap`, dimensions, padding, fontSize, letterSpacing, etc.) are not theme values and may remain inline when appropriate.
- **No moving UI:** when a conditionally displayed field joins a row, stable siblings must not visibly shift/resize. Give stable siblings fixed sizing; the conditional field should extend or wrap the row instead of redistributing existing siblings.

## React behavior — load-bearing

- `App.tsx` intentionally conditionally renders tabs (`{tab === "x" && <XTab/>}`), causing real unmount/remount.
- **Do not keep tabs mounted, hide them with CSS, or memoize them across tab switches.** `utils/units.ts` uses module-scope resolved unit state and relies on remounting to propagate unit-system changes. This optimization would silently break behavior.
- `useQuery` fires on every dependency change via ordinary `useEffect`; do not invent an auto/manual-load mode that is not present.
- **Do not use `localStorage` or other browser storage APIs.**
- **Sibling components that both consume data one of them mutates must share that data at their nearest common parent.** Do not let siblings keep independent stale fetch/state copies of the same mutable list.

## User feedback

- **A CTA with no obvious immediate visual effect must notify success/failure** via `utils/toast.ts`'s `notify(...)` / app-root `ToastContainer`.
- A CTA whose effect is already unmistakably visible may omit a success toast, but notifications are preferred when uncertain.
- Apply this rule when touching CTAs; do not mass-retrofit unrelated code without a Story.

Before working on React/components/charts/theme/units, read `docs/frontend.md`.
