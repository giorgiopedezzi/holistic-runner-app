#!/usr/bin/env bash
# Golden-master ("characterization") snapshot runner for the garmin-stats REST API.
#
# Captures the JSON responses of every DETERMINISTIC, read-only GET endpoint with
# FIXED params, so the same command can be run before and after the API refactor
# and the two output dirs diffed to prove behavior is unchanged.
#
# Usage:
#   tests/snapshot.sh [BASE_URL] [OUT_DIR]
#   tests/snapshot.sh http://127.0.0.1:3001 tests/baseline   # before
#   tests/snapshot.sh http://127.0.0.1:3001 tests/after      # after each US
#
# IMPORTANT: never runs any mutating route (no sync / POST / PUT / DELETE), so it
# cannot change DB state. The DB must be identical between before/after runs or the
# comparison is meaningless (do NOT re-sync Garmin/Withings/Strava in between).
set -u

BASE="${1:-http://127.0.0.1:3001}"
OUT="${2:-tests/baseline}"
mkdir -p "$OUT"

# ── FIXED, hardcoded params (deterministic; chosen to cover all data) ─────────
FULL="from=2024-01-01&to=2027-01-01"     # superset window: captures every activity + body row
NARROW="from=2026-07-01&to=2026-08-04"   # a recent activity-only window, to exercise range filtering
ACT_ID=200                                # reference activity (Garmin, documented in CLAUDE.md)
ACT_ID2=1                                 # oldest activity
TRACK_ID=200                              # track points for the reference activity

# pretty-print stdin as JSON preserving key order; pass through raw if not JSON
pp() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.stringify(JSON.parse(d),null,2)+"\n")}catch(e){process.stdout.write(d)}})'; }

STATUS_FILE="${OUT}/_status.txt"
: > "$STATUS_FILE"   # truncate; status codes matter (e.g. correlation 204 vs 200 []) — see README

fetch() { # name  path
  local name="$1" path="$2" tmp code
  tmp="$(mktemp)"
  code="$(curl -s -o "$tmp" -w '%{http_code}' --max-time 30 "${BASE}${path}")"
  pp < "$tmp" > "${OUT}/${name}.json"
  rm -f "$tmp"
  printf '%s  %-30s %s\n' "$code" "$name" "$path" >> "$STATUS_FILE"
  printf '  [%s] %-32s <- %s\n' "$code" "${name}.json" "${path}"
}

echo "Snapshotting ${BASE} -> ${OUT}"

# no-param endpoints
fetch range                 "/api/range"
fetch body_range            "/api/body/range"
fetch settings              "/api/settings"
fetch activities_trash      "/api/activities/trash"
fetch body_trash            "/api/body/trash"

# range endpoints @ FULL window
fetch activities_full       "/api/activities?${FULL}"
fetch activities_count_full "/api/activities/count?${FULL}"
fetch summary_full          "/api/summary?${FULL}"
fetch weekly_full           "/api/weekly?${FULL}"
fetch monthly_full          "/api/monthly?${FULL}"
fetch body_list_full        "/api/body/list?${FULL}"
fetch body_count_full       "/api/body/count?${FULL}"
fetch body_monthly_full     "/api/body/monthly?${FULL}"
fetch body_correlation_full "/api/body/correlation?${FULL}"

# range endpoints @ NARROW window (activity data present, body empty here — both are signal)
fetch activities_narrow     "/api/activities?${NARROW}"
fetch summary_narrow        "/api/summary?${NARROW}"
fetch weekly_narrow         "/api/weekly?${NARROW}"
fetch monthly_narrow        "/api/monthly?${NARROW}"
fetch body_list_narrow      "/api/body/list?${NARROW}"
fetch body_correlation_narrow "/api/body/correlation?${NARROW}"

# id endpoints
fetch activity_200          "/api/activities/${ACT_ID}"
fetch activity_1            "/api/activities/${ACT_ID2}"
fetch track_200            "/api/activities/${TRACK_ID}/track"

echo "Done. $(ls -1 "${OUT}"/*.json | wc -l) snapshot files in ${OUT}/"
