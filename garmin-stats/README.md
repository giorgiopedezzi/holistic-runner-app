# Garmin Stats

Personal health dashboard — Garmin Forerunner 965 + Withings scale.
All data stays on your machine. No cloud. No accounts beyond the initial OAuth.

## Project structure

```
garmin-stats/
├── config.json              ← paths, credentials
├── tsconfig.json
├── package.json
├── garmin.db                ← created automatically on first sync
└── src/
    ├── config.ts            ← config loader + CLI arg helpers
    ├── db.ts                ← schema, typed row interfaces, DB factory
    ├── fit-parser.ts        ← binary .FIT decoder
    ├── sync-garmin.ts       ← imports .FIT files → SQLite
    ├── auth-withings.ts     ← one-time OAuth2 flow
    ├── sync-withings.ts     ← fetches Withings measurements → SQLite
    └── server.ts            ← local REST API (port 3001)
```

## Setup

### 1. Install Node.js
Download from https://nodejs.org (LTS version).

### 2. Install dependencies
```bash
npm install
```

### 3. Configure Garmin path
Open `config.json` and find your device ID at:
```
C:\ProgramData\Garmin\CoreService\Devices\
```
You'll see a folder with a long number (e.g. `3876543210`). Update the config:
```json
"activities_path": "C:\\ProgramData\\Garmin\\CoreService\\Devices\\3876543210\\Activities"
```
> Use `\\` (double backslash) as path separator in JSON on Windows.

### 4. Configure Withings credentials
In `config.json`, fill in your credentials from developer.withings.com:
```json
"withings": {
  "client_id":     "your_client_id_here",
  "client_secret": "your_client_secret_here",
  "redirect_uri":  "http://localhost:3002/callback"
}
```

### 5. Import Garmin activities
```bash
npm run sync:garmin          # quiet mode
npm run sync:garmin:v        # verbose — shows every file
```

### 6. Authenticate with Withings (one-time)
```bash
npm run auth:withings
```
This opens your browser, you log in with your Withings account, and the tokens are saved to the DB automatically. You won't need to do this again unless you revoke access.

### 7. Import Withings measurements
```bash
npm run sync:withings
```
Fetches all historical body measurements (weight, fat %, muscle mass, etc.).

### 8. Start the API server
```bash
npm run server
```
The server runs at `http://127.0.0.1:3001` — keep it open while using the dashboard.

## Daily workflow

After syncing your Garmin via Garmin Express:
```bash
npm run sync:all   # syncs both Garmin + Withings
npm run server     # start the API if not already running
```

## API reference

### Garmin

| Endpoint | Description |
|---|---|
| `GET /api/range` | Min and max date in the DB |
| `GET /api/activities?from=YYYY-MM-DD&to=YYYY-MM-DD` | Activity list |
| `GET /api/summary?from=...&to=...` | Totals grouped by sport |
| `GET /api/weekly?from=...&to=...` | Weekly aggregates |
| `GET /api/monthly?from=...&to=...` | Monthly aggregates |
| `GET /api/track/:id` | Full GPS + HR track for one activity |

### Withings

| Endpoint | Description |
|---|---|
| `GET /api/body/range` | Min and max measurement date |
| `GET /api/body/list?from=...&to=...` | All measurements in range |
| `GET /api/body/monthly?from=...&to=...` | Monthly weight & body composition averages |
| `GET /api/body/correlation?from=...&to=...` | Weekly running km + avg weight (for correlation analysis) |

## Database schema

### `activities`
| Column | Type | Description |
|---|---|---|
| `activity_date` | TEXT | Full ISO 8601 timestamp |
| `date_only` | TEXT | `YYYY-MM-DD` — used for range filters |
| `sport` | TEXT | running, cycling, walking, hiking, swimming, other |
| `duration_sec` | REAL | |
| `distance_m` | REAL | |
| `avg_pace_minkm` | REAL | min/km |
| `calories` | INTEGER | |
| `avg_hr` / `max_hr` | INTEGER | bpm |
| `avg_cadence` | INTEGER | steps/min |
| `ascent_m` / `descent_m` | REAL | metres |

### `track_points`
| Column | Type |
|---|---|
| `elapsed_sec` / `distance_m` | REAL |
| `heart_rate` / `speed_ms` / `cadence` | number |
| `altitude_m` / `temperature` / `power` | number |
| `lat` / `lon` | REAL |

### `body_measurements`
| Column | Type |
|---|---|
| `measured_at` | TEXT (ISO 8601) |
| `weight_kg` | REAL |
| `fat_ratio` | REAL (%) |
| `fat_mass_kg` / `muscle_mass_kg` | REAL |
| `hydration_kg` / `bone_mass_kg` | REAL |
| `bmi` | REAL |
| `heart_rate` | INTEGER |

## Troubleshooting

**"Folder not found"**
→ Check `activities_path` in `config.json`. Use `\\` as separator.

**"No Withings token found"**
→ Run `npm run auth:withings` first.

**Token refresh fails**
→ Delete the `withings_tokens` row from the DB and re-run `auth:withings`.

**Server unreachable in dashboard**
→ Make sure `npm run server` is running in a terminal.

**Re-import everything**
→ Delete `garmin.db` and re-run `npm run sync:all`.
