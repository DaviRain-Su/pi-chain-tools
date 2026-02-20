#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/stable-yield-auto-migrate.log"
LOCK_FILE="/tmp/pct-stable-yield-auto-migrate.lock"

mkdir -p "$LOG_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date -Is)] skip: previous run still active" >> "$LOG_FILE"
  exit 0
fi

set -a
if [[ -f "$ROOT_DIR/.env.bsc.local" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env.bsc.local"
fi
set +a

{
  echo "[$(date -Is)] start: stable-yield auto-migrate v1"
  npm run stable-yield:auto-migrate:v1 -- \
    --execute true \
    --confirm I_ACKNOWLEDGE_AUTO_MIGRATE \
    --maxMoveUsd 5 \
    --minMoveUsd 1 \
    --minApyDeltaBps 20 \
    --allowSwap true
  echo "[$(date -Is)] done"
} >> "$LOG_FILE" 2>&1
