#!/usr/bin/env bash
# Sobe ambiente de E2E: Postgres limpo + gateway de teste + build de produção apontando para o gateway + vite preview (4173).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
scripts/db-up.sh reset
scripts/gateway.sh start
KEY=$(curl -s http://localhost:54321/__test/anon-key | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).anonKey))")
VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=$KEY npm run build --silent
[ -f /tmp/fio-preview.pid ] && kill "$(cat /tmp/fio-preview.pid)" 2>/dev/null || true
nohup npx vite preview --port 4173 --strictPort > /tmp/preview.log 2>&1 & echo $! > /tmp/fio-preview.pid
sleep 2; curl -sI http://localhost:4173/ | head -1
