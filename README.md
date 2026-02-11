# pi-chain-tools

Multi-chain-ready toolset library for Pi extensions. Solana is implemented, Sui has a minimal read/execute vertical slice, and EVM skeleton is scaffolded, with a chain-agnostic grouping model:

- `read`
- `compose`
- `execute`
- `rpc`

## Structure

- `src/core`: common toolset abstractions and registration helpers
- `src/chains/solana`: Solana runtime + grouped tools
- `src/chains/sui`: Sui runtime + grouped tools
- `src/chains/evm`: EVM runtime + grouped tool skeleton
- `src/pi`: Pi-specific adapter entrypoints

## Solana Tool Groups

- `read`: balance, account info, multiple accounts, blockhash, rent exemption minimum, transaction, signatures, token accounts, token balance, portfolio, DeFi positions (token protocol tags + native stake scan + Orca/Meteora LP), Kamino lending positions + market catalog, Orca Whirlpool positions, Meteora DLMM positions, Jupiter/Raydium quote + meta APIs
- `compose`: unsigned transfer transaction builders (SOL/SPL, legacy + v0), native staking builders (create+delegate/delegate/authorize/deactivate/withdraw), Jupiter & Raydium swap builders
- `execute`: simulate, send, sign+send, confirm, airdrop, SOL transfer, SPL transfer, native stake actions (create+delegate/delegate/authorize/deactivate/withdraw), one-shot Jupiter & Raydium swap
- `rpc`: raw Solana JSON-RPC with safety guard for dangerous methods

## Solana DeFi Coverage (Current)

- Jupiter routing/quote/swap API integration
- DEX/AMM route discovery via Jupiter program-id labels
- Priority fee / Jito tip / dynamic CU options in Jupiter swap compose & execute
- Orca/Meteora scoped swap workflow support (via Jupiter dex filters)
- Orca/Meteora scoped compose/execute tools (`build*SwapTransaction` / `*Swap`)
- Orca LP lifecycle compose/execute/workflow support (open/close/harvest/increase/decrease)
- Orca LP decrease supports ratio-based input (`liquidityBps`, intentText like `decrease 50%`)
- Meteora DLMM LP lifecycle compose/execute/workflow support (add/remove)
- Meteora add-liquidity supports UI amount inputs (`totalXAmountUi`/`totalYAmountUi`) and natural-language x/y token amounts
- Workflow can auto-resolve Orca/Meteora position ids for LP intents when the owner has a single matching position (fewer structured params needed)
- Native stake operation tools: create+delegate/delegate/authorize/deactivate/withdraw
- Workflow/read support for `solana.read.defiPositions` + `solana_getDefiPositions`
- Workflow/read support for `solana.read.lendingMarkets` / `solana.read.lendingPositions`
- Raydium Trade API quote/serialize integration (swap-base-in/out)
- Raydium auto-priority-fee integration and multi-transaction swap execution

## EVM Skeleton

- `read/compose/execute/rpc` group files are created
- no concrete EVM tools are implemented yet
- use `createEvmToolset()` as the extension point for future chains/rpcs/wallets

## Sui (Minimal)

- `read`: `sui_getBalance` (SUI or custom `coinType`)
- `read`: `sui_getDefiPositions` (aggregated wallet + Cetus farms/vault positions snapshot)
- `read`: `sui_getPortfolio` (multi-asset balances with optional metadata)
- `read`: `sui_getSwapQuote` (Cetus aggregator quote + route details on mainnet/testnet)
- `read`: `sui_getStableLayerSupply` (Stable Layer total supply + optional per-coin supply on mainnet/testnet)
- `read`: `sui_getCetusFarmsPools` / `sui_getCetusFarmsPositions` / `sui_getCetusVaultsBalances` (Cetus v2 farms + vaults read primitives on mainnet/testnet)
- `compose`: `sui_buildTransferSuiTransaction` / `sui_buildTransferCoinTransaction` (unsigned tx payload builders)
- `compose`: `sui_buildSwapCetusTransaction` (quote + unsigned swap tx build)
- `compose`: `sui_buildCetusAddLiquidityTransaction` / `sui_buildCetusRemoveLiquidityTransaction` (official Cetus CLMM SDK unsigned LP tx build)
- `compose`: `sui_buildCetusFarmsStakeTransaction` / `sui_buildCetusFarmsUnstakeTransaction` / `sui_buildCetusFarmsHarvestTransaction` (Cetus v2 farms unsigned tx build)
- `compose`: `sui_buildStableLayerMintTransaction` / `sui_buildStableLayerBurnTransaction` / `sui_buildStableLayerClaimTransaction` (stable-layer-sdk unsigned tx build)
- `execute`: `sui_swapCetus` (Cetus aggregator route + on-chain swap execution on mainnet/testnet)
- `execute`: `sui_cetusAddLiquidity` / `sui_cetusRemoveLiquidity` (official Cetus CLMM SDK LP primitives)
- `execute`: `sui_cetusFarmsStake` / `sui_cetusFarmsUnstake` / `sui_cetusFarmsHarvest` (Cetus v2 farms execute tools)
- `execute`: `sui_stableLayerMint` / `sui_stableLayerBurn` / `sui_stableLayerClaim` (stable-layer-sdk execute tools)
- `execute`: `sui_transferSui` (amount in `amountMist` or `amountSui`, with mainnet safety gate `confirmMainnet=true`)
- `execute`: `sui_transferCoin` (non-SUI transfer, auto-merge coin objects, with mainnet safety gate)
- `workflow`: `w3rt_run_sui_workflow_v0` (analysis/simulate/execute with deterministic mainnet confirmToken)
- `workflow`: `w3rt_run_sui_stablelayer_workflow_v0` (analysis/simulate/execute for stable-layer mint/burn/claim with deterministic mainnet confirmToken)
- `workflow`: `w3rt_run_sui_cetus_farms_workflow_v0` (analysis/simulate/execute for Cetus v2 farms stake/unstake/harvest with deterministic mainnet confirmToken)
- `workflow`: `w3rt_run_sui_defi_workflow_v0` (unified DeFi router workflow; auto-routes to core/stablelayer/cetus-farms flows)
- `rpc`: `sui_rpc` (generic Sui JSON-RPC passthrough with dangerous method safety guard)

### Sui DeFi NL Examples (Pi)

Use unified router tool `w3rt_run_sui_defi_workflow_v0`:

- Swap (analysis):
  - `intentText: "swap 1000000 from 0x2::sui::SUI to 0x...::usdc::USDC"`
- LP Add (analysis, less structured):
  - `intentText: "provide liquidity pool: 0xabc position: 0xdef 0x2::sui::SUI 0x2::usdc::USDC tick: -5 to 5 a: 10 b: 20"`
- Cetus Farms Harvest (analysis):
  - `intentText: "claim farm rewards pool: 0xabc nft: 0xdef"`
- StableLayer Mint (analysis):
  - `intentText: "mint stable coin 0x...::btc_usdc::BtcUSDC amount 1000000"`

Recommended execution flow on mainnet:
1. `runMode=analysis` -> capture `confirmToken`
2. `runMode=simulate` -> verify artifacts/status
3. `runMode=execute` with `confirmMainnet=true` and `confirmToken=<token>`

## Use In Pi (Recommended)

You do **not** need `pi-mono`. Install this project as a normal Pi extension source.

### 1) Install once

Local repository source:

```bash
pi install /Users/davirian/dev/pi-chain-tools
```

After npm publish:

```bash
pi install npm:pi-chain-tools
```

The package auto-loads one bundled extension (`src/pi/default-extension.ts`) that registers:

- Solana workflow toolset
- Sui full toolset (read/compose/execute/workflow/rpc)

### 2) Reload Pi and smoke test

Run in Pi:

```text
/reload
```

Then ask naturally:

```text
帮我查一下 Sui 主网余额
```

### 3) Sui signer config (no `fromPrivateKey` needed)

Sui execute/workflow tools now auto-load signer in this order:

1. `SUI_PRIVATE_KEY` (optional env override)
2. `SUI_KEYSTORE_PATH` + `SUI_CLIENT_CONFIG_PATH` (optional custom paths)
3. default local Sui CLI config:
   - `~/.sui/sui_config/sui.keystore`
   - `~/.sui/sui_config/client.yaml` (`active_address`)

Useful checks:

```bash
sui client active-address
ls ~/.sui/sui_config/sui.keystore
```

### 4) Execution allow/safety config

- Mainnet execute is guarded. You must explicitly confirm (internally `confirmMainnet=true`).
- Workflow execute on mainnet also requires the matching `confirmToken` from prior analysis/simulate.
- `sui_rpc` blocks dangerous methods by default; only use `allowDangerous=true` when you know exactly what you are doing.

Natural language confirmation example:

```text
继续执行刚才这笔，确认主网执行
```

### 5) Natural language examples (Sui)

- Swap simulate:
  - `把 0.01 SUI 换成 USDC，先模拟。`
- Swap execute (after simulate):
  - `继续执行刚才这笔，确认主网执行。`
- Cetus farms pools:
  - `帮我查一下 Sui 主网 Cetus farms 的池子列表。`
- StableLayer:
  - `在 Sui 主网把 1000000 raw USDC mint 成 stable，先模拟。`

### 6) Troubleshooting

- `Cannot find module ...`: run `npm install` (or `bun install`), then `/reload`.
- Extension conflicts in Pi: ensure duplicated tool providers are not loaded at the same time.
- Wallet/signing issues: verify `sui client active-address` and keystore path, then restart Pi once.

Useful extension management commands:

```bash
pi list
pi update
pi remove /Users/davirian/dev/pi-chain-tools
```

### 7) Optional: `pi-mono` development wiring

Only needed if you intentionally develop extensions inside `pi-mono`.
The bundled default extension already reuses the same Solana/Sui dedupe guards, so mixed loading is safer, but keeping a single source of truth is still recommended.

## Development

Local workflow (Bun):

```bash
bun install
bun run check
bun run test
```

CI workflow (npm, via GitHub Actions):

```bash
npm ci
npm run check
npm test
```

- Local default package manager: Bun
- CI package manager: npm (`npm ci` + lockfile)
- npm peer strategy: project-level `.npmrc` sets `legacy-peer-deps=true` to allow mixed SDK peer ranges (Sui + Solana ecosystems).

## PR Required Checks

To enforce CI as merge-gate on `main`:

1. Go to GitHub repository `Settings` -> `Branches`.
2. Add/Edit branch protection rule for `main`.
3. Enable `Require status checks to pass before merging`.
4. Add required checks:
   - `validate (Node 20)`
   - `validate (Node 22)`

## Future Chains

Add a new chain under `src/chains/<chain>/` and expose a `create<Chain>Toolset()` function.
