# garmin-dashboard

Vite + React 18 + TypeScript frontend for Garmin Stats.

## Stack

- **Vite 5** — dev server + bundler
- **React 18** (strict mode)
- **TypeScript 5** (strict)
- **Recharts** — all charts
- No CSS framework — CSS variables only, easy to retheme

## Project structure

```
src/
├── main.tsx                  ← entry point
├── App.tsx                   ← layout, tab routing, server health check
├── index.css                 ← global reset + CSS design tokens
│
├── api/
│   └── client.ts             ← all API calls in one place
│
├── types/
│   └── api.ts                ← shared types mirroring the backend schema
│
├── hooks/
│   ├── useQuery.ts           ← generic data fetching hook
│   └── useDateRange.ts       ← date range state + presets
│
├── components/
│   ├── ui.tsx                ← Card, Stat, Badge, Empty, ErrorBanner, …
│   ├── DateRangeBar.tsx      ← preset buttons + date pickers
│   ├── OverviewTab.tsx       ← totals + sport breakdown
│   ├── TrendsTab.tsx         ← monthly/weekly bar + line charts
│   ├── ActivitiesTab.tsx     ← activity list with expandable HR chart
│   └── BodyTab.tsx           ← Withings weight/body-comp + correlation
│
└── utils/
    └── fmt.ts                ← formatting helpers (pace, duration, weight…)
```

## Setup

```bash
npm install
npm run dev      # starts at http://localhost:5173
```

The Vite dev server proxies `/api/*` to `http://0.0.0.0:3001`,
so the backend just needs to be running — no env vars or CORS config needed.

## Adding a new tab

1. Create `src/components/MyTab.tsx`
2. Add your API call in `src/api/client.ts`
3. Add the response type in `src/types/api.ts`
4. Add the tab to the `TABS` array in `App.tsx`
5. Render it in the `{tab === "…"}` block

## Production build

```bash
npm run build    # outputs to dist/
npm run preview  # preview the build locally
```

Set `VITE_API_BASE` env var to point the built app at a non-localhost server.
