#!/usr/bin/env bash
# start.sh — place in project-root/
# Checks what's running, starts what isn't.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/garmin-stats"
FRONTEND="$ROOT/garmin-dashboard"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC}  $1"; }
warn() { echo -e "  ${YELLOW}▶${NC}  $1"; }
err()  { echo -e "  ${RED}✗${NC}  $1"; }

echo ""
echo "=== Garmin Stats ==="
echo ""

# ── check if a port is listening ─────────────────────────────────────────
port_open() {
  powershell.exe -NoProfile -Command \
    "(New-Object Net.Sockets.TcpClient).Connect('127.0.0.1', $1)" 2>/dev/null \
  && return 0 || return 1
}

SERVER_UP=false
UI_UP=false

# Use curl if available (Git Bash has it), otherwise fall back to powershell
check_port() {
  curl -s --connect-timeout 1 "http://127.0.0.1:$1" > /dev/null 2>&1
}

echo "Checking services…"

if check_port 3001; then
  SERVER_UP=true
  ok "API server is running  (localhost:3001)"
else
  warn "API server not running"
fi

if check_port 5173; then
  UI_UP=true
  ok "Dashboard is running   (localhost:5173)"
else
  warn "Dashboard not running"
fi

echo ""

# ── start what's missing ──────────────────────────────────────────────────
if $SERVER_UP && $UI_UP; then
  ok "Everything is already running."
  echo ""
  echo "  Dashboard → http://localhost:5173"
  echo ""
  # open browser
  start "" "http://localhost:5173" 2>/dev/null || true
  exit 0
fi

if ! $SERVER_UP; then
  warn "Starting API server…"
  cd "$BACKEND" || exit 1
  node src/server.ts &
  SERVER_PID=$!
  echo "  PID: $SERVER_PID"
fi

if ! $UI_UP; then
  warn "Starting dashboard…"
  cd "$FRONTEND" || exit 1
  npm run dev &
  UI_PID=$!
  echo "  PID: $UI_PID"
fi

echo ""
echo "  Waiting for services to come up…"
sleep 4

# open browser
start "" "http://localhost:5173" 2>/dev/null || true

echo ""
echo "  API       → http://localhost:3001"
echo "  Dashboard → http://localhost:5173"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

# ── cleanup ───────────────────────────────────────────────────────────────
trap "echo ''; echo 'Stopping…'; kill ${SERVER_PID:-} ${UI_PID:-} 2>/dev/null; exit 0" SIGINT SIGTERM

wait
