#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/stable-yield-auto-migrate-v2.log"
LAST_JSON="$LOG_DIR/stable-yield-auto-migrate-v2-last.json"
LOCK_FILE="/tmp/pct-stable-yield-auto-migrate-v2.lock"

mkdir -p "$LOG_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -Is)] skip: previous v2 run active" >> "$LOG_FILE"
  exit 0
fi

set -a
if [[ -f "$ROOT_DIR/.env.bsc.local" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.bsc.local"
fi
set +a

CMD=(
  node scripts/stable-yield-auto-migrate-v2.mjs
  --maxMoveUsd 5
  --minMoveUsd 1
  --minApyDeltaBps 20
  --allowSwap true
)

{
  echo "[$(date -Is)] start v2"
  "${CMD[@]}" | tee "$LAST_JSON"
  echo "[$(date -Is)] done v2"
} >> "$LOG_FILE" 2>&1
