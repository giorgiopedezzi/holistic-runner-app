#!/usr/bin/env bash
set -euo pipefail

echo "=== TYPECHECK ==="
npm run typecheck

echo "=== TESTS ==="
npm test

echo "=== LINT ==="
npm run lint

echo "=== STYLE INVARIANT ==="
npm run style:check

echo "=== BUILD ==="
npm run build

echo "=== ActivityModal LOC ==="
wc -l < src/components/ActivityModal.tsx
