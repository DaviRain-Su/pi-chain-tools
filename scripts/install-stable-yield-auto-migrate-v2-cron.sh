#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CRON_SCRIPT="$ROOT_DIR/scripts/stable-yield-auto-migrate-v2-cron.sh"

chmod +x "$CRON_SCRIPT"

ENTRY="*/30 * * * * cd $ROOT_DIR && $CRON_SCRIPT"
TMP_FILE="$(mktemp)"
(crontab -l 2>/dev/null | grep -v "stable-yield-auto-migrate-v2-cron.sh" || true) > "$TMP_FILE"
echo "$ENTRY" >> "$TMP_FILE"
crontab "$TMP_FILE"
rm -f "$TMP_FILE"

echo "installed v2 cron entry:"
echo "$ENTRY"
