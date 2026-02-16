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

### Recommended CLI

Use **near-cli-rs** as the default local credential manager.
If credentials are already present under `~/.near-credentials/<network>/`, runtime auto-discovers them.

Common near-cli-rs setup commands:

```bash
# import/sign in via web wallet
near account import-account using-web-wallet

# or import an existing private key
near account import-account using-private-key ed25519:... --account-id <your-account>.near
```

### Credential/account resolution order (important)

`pi-chain-tools` NEAR runtime **can auto-read near-cli credentials by default**.
Environment variables are optional in many local setups.

Resolution priority:

1. Explicit tool param `accountId`
2. Environment variables (`NEAR_ACCOUNT_ID`, `NEAR_CREDENTIALS_DIR`, etc.)
3. Auto-discovery from near-cli default credentials directory (for example `~/.near-credentials/`, with legacy path compatibility)
4. If none available, runtime throws a configuration hint

Use the template at repo root when you want explicit control:

```bash
cp .env.near.example .env.near.local
```

Recommended minimum explicit settings:

- `NEAR_ACCOUNT_ID` (optional if auto-discovery already resolves correctly)
- `NEAR_RPC_URL` or `NEAR_RPC_URLS` (optional; defaults exist)

For RPC stability under public endpoint throttling, prefer a fallback list:

- `NEAR_MAINNET_RPC_URLS=https://1rpc.io/near,https://rpc.mainnet.near.org,https://near-mainnet.public.blastapi.io`

For execute/sign flows, set one signer source explicitly when possible:

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

### RPC/network mismatch / 429 throttling
- Set explicit `NEAR_RPC_URL` for intended network, or preferably `NEAR_RPC_URLS`
- For network-specific priority use `NEAR_MAINNET_RPC_URLS` / `NEAR_TESTNET_RPC_URLS`
- Re-check contract ids if using non-default deployments
