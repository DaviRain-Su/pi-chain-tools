#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env.bsc.local}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[run-bsc-live] missing env file: $ENV_FILE"
  echo "Copy $ROOT_DIR/.env.bsc.example -> $ROOT_DIR/.env.bsc.local and fill secrets."
  exit 1
fi

cd "$ROOT_DIR"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

npm run dashboard:restart

# Start worker in LIVE mode (dryRun=false)
curl -sS -X POST http://127.0.0.1:4173/api/bsc/yield/worker/start \
  -H 'Content-Type: application/json' \
  -d '{"confirm":true,"dryRun":false}' | jq
