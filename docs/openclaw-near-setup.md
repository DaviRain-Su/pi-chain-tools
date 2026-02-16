# OpenClaw + pi-chain-tools (NEAR) Setup

This guide is the practical path to use **NEAR tools** from this repo inside OpenClaw.

## 1) Install plugin from local path

```bash
openclaw plugins install /absolute/path/to/pi-chain-tools
openclaw plugins enable pi-chain-tools
```

If the gateway is already running, reload/restart:

```bash
openclaw gateway restart
```

## 2) Configure NEAR env

Use the template at repo root:

```bash
cp .env.near.example .env.near.local
```

Set at minimum:

- `NEAR_ACCOUNT_ID`
- `NEAR_RPC_URL` (or rely on defaults)

For execute/sign flows, also set one of:

- `NEAR_PRIVATE_KEY`
- `NEAR_CREDENTIALS_DIR`

> Never commit private keys.

## 3) Smoke test (read-only first)

In OpenClaw, run a NEAR read tool (examples):

- `near_getBalance`
- `near_getPortfolio`
- `near_getLendingMarketsBurrow`

Suggested first request:

```text
Use near_getBalance for my configured account and show available + locked NEAR.
```

## 4) Execution safety checklist

Before any execute tools (`near_transferNear`, `near_swapRef`, `near_supplyBurrow`, etc.):

1. Confirm account/network are correct
2. Start with workflow `analysis` / `simulate`
3. Use small amounts first
4. Keep keys in env/credentials only (no plaintext in chat)

## 5) Common issues

### Plugin installed but tools not visible
- Check plugin list: `openclaw plugins list`
- Ensure `pi-chain-tools` is `loaded`
- Restart gateway

### Auth/key errors
- Verify `NEAR_ACCOUNT_ID`
- Verify signer source (`NEAR_PRIVATE_KEY` or `NEAR_CREDENTIALS_DIR`)
- Ensure key matches the account on selected network

### RPC/network mismatch
- Set explicit `NEAR_RPC_URL` for intended network
- Re-check contract ids if using non-default deployments
