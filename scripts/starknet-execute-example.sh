#!/usr/bin/env bash
set -euo pipefail

# Example adapter for STARKNET_EXECUTE_COMMAND
# Placeholders supported by starknet_executeIntentGuarded:
#   {intent} {network} {amountUsd} {runId}
#
# Usage (manual):
#   bash scripts/starknet-execute-example.sh "rebalance btc privacy" sepolia 50 run-123

INTENT="${1:-}"
NETWORK="${2:-mainnet}"
AMOUNT_USD="${3:-0}"
RUN_ID="${4:-run-unknown}"

if [[ -z "$INTENT" ]]; then
  echo "missing intent"
  exit 1
fi

# NOTE:
# Replace this section with your actual Starknet broadcaster
# (sncast/starkli/custom signer). Keep stdout including tx hash for parser.
# For now we emit a structured dry output + fake tx-like marker placeholder.

TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "[starknet-exec-example] ts=$TIMESTAMP network=$NETWORK runId=$RUN_ID amountUsd=$AMOUNT_USD"
echo "[starknet-exec-example] intent=$INTENT"

# If you want strict no-op demo, keep no tx hash emitted.
# To test parser behavior, uncomment next line with a sample 0x64-hex string:
# echo "txHash=0x1111111111111111111111111111111111111111111111111111111111111111"

echo "ok"
