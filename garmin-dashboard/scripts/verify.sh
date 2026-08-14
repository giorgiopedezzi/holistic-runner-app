#!/usr/bin/env bash
set -uo pipefail

echo "=== TYPECHECK ==="
npm run typecheck 2>&1 | tail -1
echo "TC:${PIPESTATUS[0]}"

echo "=== TESTS ==="
npx vitest run 2>&1 | grep -E "Test Files|Tests "

echo "=== LINT ==="
npm run lint 2>&1 | tail -3
echo "LINT:${PIPESTATUS[0]}"

echo "=== BUILD ==="
npm run build 2>&1 | grep -E 'index-.*\.js|built in'

echo "=== ActivityModal LOC ==="
wc -l < src/components/ActivityModal.tsx
