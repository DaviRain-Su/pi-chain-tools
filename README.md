# Gradience

Gradience is a multi-chain AI agent runtime — 44 NEAR tools, 30+ EVM tools, full Solana/Sui coverage — that turns blockchain capabilities into structured, safe, composable MCP services.

**Featured: [Autonomous Stablecoin Yield Agent on NEAR](docs/near-hackathon.md)** — an AI agent that continuously monitors Burrow lending markets and autonomously rebalances stablecoin positions to maximize yield. Starts with one command, keeps working after you close the tab.

## EVM Security Watch (Quickstart)

Read-only drift monitor for watched EVM contracts (code hash / proxy impl / owner / paused / optional approval spikes).

```bash
cp apps/dashboard/config/security-watchlist.example.json apps/dashboard/config/security-watchlist.json
# set envs referenced by chains[].rpcUrlEnv, e.g. ETHEREUM_RPC_URL / BSC_RPC_URL

# notifier provider (safe default is noop)
export EVM_SECURITY_NOTIFY_PROVIDER=telegram
export TELEGRAM_BOT_TOKEN=123456:abc...
export TELEGRAM_CHAT_ID=-1001234567890
# optional: include info level alerts (default false)
# export EVM_SECURITY_NOTIFY_INFO=true

npm run security:scan:once
npm run security:watch
# dry test notifier payload dispatch (uses latest report or built-in sample)
npm run security:watch:notify:test
# compact posture snapshot (security + stale + last successful check)
npm run ops:posture

# noise controls (optional, local time)
export EVM_SECURITY_NOTIFY_QUIET_HOURS=23-08
export EVM_SECURITY_NOTIFY_WARN_AGG_WINDOW_SEC=900
export EVM_SECURITY_NOTIFY_CRITICAL_COOLDOWN_SEC=900
export EVM_SECURITY_NOTIFY_DAILY_SUMMARY_AT=08:30

# service deployment helper (prints systemd/pm2 next steps)
npm run security:watch:service:help
```

Reports are written to:
`apps/dashboard/data/security-reports/YYYY-MM-DD/latest.json`

Notify behavior:
- `critical`: immediate, deduped by fingerprint + cooldown.
- `warn/info`: aggregated and flushed by window (`EVM_SECURITY_NOTIFY_WARN_AGG_WINDOW_SEC`).
- quiet hours (`EVM_SECURITY_NOTIFY_QUIET_HOURS`) suppress non-critical pushes; critical still sends as urgent.
- aggregation/dedupe state persists in `apps/dashboard/data/security-state.json`, so restart keeps cooldown + pending summary continuity.

Dashboard security watch APIs/UI:
- `GET /api/security/watch/status`
- `GET /api/security/watch/latest`
- Open `http://127.0.0.1:4173/` and check **Security Watch** card.

## 🏆 BSC Hackathon Focus (Good Vibes Only)

> This repo is currently submission-focused for the BSC hackathon track.

### What is highlighted for judges
- **Live BSC execution (not only simulation)**: direct swap endpoint `POST /api/bsc/swap` with `confirm=true` gate.
- **Real on-chain proofs captured**: recent successful tx examples:
  - `0x03dab3f59e2d377ddfaa177e9bdbf5c7605670e5c219f6e94a8e0583c95c611a` (BNB -> USDT)
  - `0xe189d380f67e560412485c213f15541512864674e8184cc040728417b4ddbff8` (USDC -> USDT)
  - `0x45b46f361cf4ac0bc2659271c97f8e6b5cb3cef7733295bf528a97dc5891dddd` (BNB -> USDT)
- **BSC yield worker in live mode**: periodic plan/execute with guardrails (`confirm/policy/reconcile`).
- **Submission artifact workflow ready**:
  - `npm run execute:proof:bsc`
  - `npm run submission:evidence`

### Submission docs (BSC)
- Primary submission: `docs/hackathon-goodvibes-submission.md`
- Final checklist: `docs/hackathon-final-submission-checklist.md`
- Evidence output: `docs/submission-evidence.md`

Multi-chain toolset library for Pi extensions with a chain-agnostic grouping model:

- `read`
- `compose`
- `execute`
- `rpc`

## MCP Integration (provider-pluggable)

This repo now uses a provider-pluggable MCP architecture:

`provider layer -> unified MCP adapter -> OpenClaw skill`

- Provider layer (`src/mcp/*`): provider interface + registry resolver.
- Unified adapter (`src/core/mcp-adapter.ts`): normalized `mcp.search`, `mcp.quote`, `mcp.plan`.
- Skill entrypoint (`skills/mcp-unified-adapter/SKILL.md`): usage examples via adapter, not provider-specific calls.

### Providers: DFlow + Breeze + Mock (proof of decoupling)

- `dflow` (default): real MCP endpoint, search capability
- `breeze` (read/plan): inferred strategy/info API integration for `search` + yield `plan` proposals (no execute)
- `mock` (read-only stub): deterministic local provider for non-lock-in wiring tests (`search` + `plan`)

DFlow details:
- Provider id: `dflow`
- MCP URL: `https://pond.dflow.net/mcp`
- Docs page: `https://pond.dflow.net/build/mcp`

Configuration (optional overrides):

- `PI_MCP_PROVIDER=dflow` (default resolver target)
- switch providers: `PI_MCP_PROVIDER=breeze` (or `mock`)
- `DFLOW_MCP_URL=https://pond.dflow.net/mcp`
- `BREEZE_API_BASE_URL=<required_if_using_breeze>`
- `BREEZE_API_KEY=<optional_or_required_by_your_breeze_deployment>`

Quick DFlow test (if `mcporter` is installed):

```bash
mcporter call https://pond.dflow.net/mcp.fetch query="imperative trade"
```

> If your MCP client expects named servers, use the included `.mcp.json` with server name `DFlow`.

### Breeze integration (read/plan only)

Current integrated abilities:
- `search`: attempts Breeze MCP/strategy/info read endpoints and normalizes strategy-like items.
- `plan`: builds read-only yield action proposals from strategy data + optional wallet balances input.

Environment setup:

```bash
export PI_MCP_PROVIDER=breeze
export BREEZE_API_BASE_URL="https://<your-breeze-api>"
# optional when Breeze deployment requires auth
export BREEZE_API_KEY="<your-api-key>"
```

Limitations:
- Breeze flow is **read + plan only** in unified adapter path.
- Endpoint mapping is inferred unless your Breeze deployment exposes a stable MCP/search route.
- If endpoint or env is missing, provider returns normalized errors/warnings (no execute bypass).

### Why this avoids vendor lock-in

The app consumes a single normalized adapter contract. DFlow is just one provider implementation behind the registry, so adding/replacing providers does not require rewriting skill usage or upstream orchestration.

### Add a new provider (minimal steps)

1. Implement `McpProvider` under `src/mcp/providers/<id>.ts` (support one or more: `search/quote/plan`).
2. Register it in `createMcpAdapter({ providers: [...] })` or your own `createMcpProviderRegistry(...)` wiring.
3. Keep returning normalized `McpProviderResult` so adapter output stays stable for skills.

## Architecture Core

- **Core architecture principles**: [`docs/core-architecture-principles.md`](docs/core-architecture-principles.md)
  - AI-native boundary design (Intent/Policy/Execution/Settlement/Observability)
  - Schema-first constrained strategy model
  - Async job lifecycle and deterministic execution expectations
  - Marketplace monetization and fee-split baseline
- **PI SDK-first MCP adapter boundary (Phase 1 scaffold)**: [`docs/pi-mcp-adapter-architecture.md`](docs/pi-mcp-adapter-architecture.md)
  - Orchestration ergonomics (read/plan discovery + envelope normalization)
  - Hard boundary: mutating actions remain in PI SDK confirm/risk/policy/reconcile path
- **LI.FI integration hardening runbook**: [`docs/lifi-integration-hardening.md`](docs/lifi-integration-hardening.md)
  - Deterministic route scoring + fallback behavior + error normalization
  - Enforced planning-vs-execution boundary (PI SDK remains mutation authority)

## SDK Replacement Completion Summary (Item 5)

Final consolidation status across **Morpho / Venus / Lista / Wombat** is tracked in:
- `docs/sdk-coverage-report.md` (human-readable matrix)
- `docs/sdk-coverage-report.json` (machine-readable source of truth)

Current split: **🟩 3 / 🟨 10 / 🟥 0**.
All non-green actions include explicit blocker, next action, and code marker alignment.

## Structure

- `src/core`: common toolset abstractions, registration helpers, and unified MCP adapter facade
- `src/mcp`: provider interface, registry resolver, and provider implementations (e.g., DFlow)
- `src/chains/solana`: Solana runtime + grouped tools
- `src/chains/sui`: Sui runtime + grouped tools
- `src/chains/near`: NEAR runtime + grouped tools
- `src/chains/starknet`: Starknet runtime + grouped tools (Re{define} privacy+bitcoin phase-2 scaffold: read/compose/guarded-execute)
  - BTC-on-Starknet adapter tools:
    - read quote: `starknet_getBtcRouteQuote` (provider API via `STARKNET_BTC_QUOTE_API_URL`, deterministic fallback when unset)
    - compose plan: `starknet_planBtcBridgeAction` (quote + guardrail plan)
    - guarded execute: `starknet_executeIntentGuarded` with `actionType=btc_bridge_swap`
  - execute adapter mode selection:
    - `mode=native-sepolia` via `STARKNET_NATIVE_EXECUTE_COMMAND_SEPOLIA`
    - `mode=native-mainnet` via `STARKNET_NATIVE_EXECUTE_COMMAND_MAINNET`
    - fallback `mode=command` via `STARKNET_EXECUTE_COMMAND`
    - adapter seam preference: `STARKNET_EXECUTE_ADAPTER=command|signer-native` (`signer-native` currently falls back to command with explicit marker)
  - execute result markers (ops/audit proof):
    - `execution.adapterPreference`
    - `execution.executeMode`
    - `execution.executePath` (`command` / `command-fallback` / `not-executed`)
    - `execution.resultMarker` (`guardrail_blocked` / `simulate_only` / `execute_ready` / `execute_success`)
  - placeholders: `{intent}` `{network}` `{amountUsd}` `{runId}` `{actionType}` `{routeId}` `{amount}` `{minAmountOut}` `{maxFeeBps}`
  - env setup:
    - `STARKNET_BTC_QUOTE_API_URL` (optional, live quote endpoint)
    - `STARKNET_BTC_QUOTE_API_KEY` (optional, sent as Bearer + x-api-key)
  - quick start examples:
    - `export STARKNET_NATIVE_EXECUTE_COMMAND_SEPOLIA='bash scripts/starknet-execute-example.sh "{intent}" "sepolia" "{amountUsd}" "{runId}" "{actionType}" "{routeId}" "{amount}" "{minAmountOut}" "{maxFeeBps}"'`
    - `export STARKNET_NATIVE_EXECUTE_COMMAND_MAINNET='bash scripts/starknet-execute-example.sh "{intent}" "mainnet" "{amountUsd}" "{runId}" "{actionType}" "{routeId}" "{amount}" "{minAmountOut}" "{maxFeeBps}"'`
    - `export STARKNET_EXECUTE_COMMAND='bash scripts/starknet-execute-example.sh "{intent}" "{network}" "{amountUsd}" "{runId}" "{actionType}" "{routeId}" "{amount}" "{minAmountOut}" "{maxFeeBps}"'`
  - proof artifact command: `npm run execute:proof:starknet -- --tx 0x...`
- `src/chains/evm`: shared EVM runtime/tool stack (Polymarket BTC 5m + transfer/read/compose/execute), with configurable multi-network support (including `bsc`) and mainnet-guard policy reuse
- `src/pi`: Pi-specific adapter entrypoints
- Workflow artifact summaries use a stable schema: `summaryLine` (string) + `summary` (`schema = w3rt.workflow.summary.v1`)
- Pi extension registration now prefers workflow `summary.line` as first response line for `w3rt_run_*` tools.

### Hackathon Submissions

- **`docs/near-hackathon.md`：NEAR Innovation Sandbox — Autonomous Stablecoin Yield Agent**
- `docs/monad-ai-hackathon.md`：Monad AI Hackathon 参赛文档（赛道选择、架构优势、展示脚本与评审话术）
- `docs/monad-agent-identity-v1.4-notes.md`：Monad agent v1.4 productization notes（profile/name/delegation gate）
- `docs/dflow-mcp-integration.md`：DFlow MCP 接入与快速验证

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
- workflow phase summary: Solana analysis/simulate/execute artifacts include `summaryLine` for concise one-line replay
- workflow execute summary: Solana execute artifacts now include `summaryLine` for one-line replay (`intent + signature + confirmation/guard`)
- Native stake operation tools: create+delegate/delegate/authorize/deactivate/withdraw
- Workflow/read support for `solana.read.defiPositions` + `solana_getDefiPositions`
- Workflow/read support for `solana.read.lendingMarkets` / `solana.read.lendingPositions`
- Raydium Trade API quote/serialize integration (swap-base-in/out)
- Raydium auto-priority-fee integration and multi-transaction swap execution

## EVM (Polymarket BTC 5m)

> Architecture note: Polymarket is currently implemented as an EVM application capability under the shared `evm` toolset, not a separate chain module. BSC has been added to shared EVM network support so cross-network expansion stays centralized.
> See [`docs/evm-integration-architecture-notes.md`](docs/evm-integration-architecture-notes.md) for the design rationale.

- `read`: `evm_polymarketSearchMarkets` (Gamma public-search event/market scan)
- `read`: `evm_polymarketGetMarket` (market detail by slug: outcomes/price/tokenId)
- `read`: `evm_polymarketGetBtc5mMarkets` (active BTC 5m Up/Down market list)
- `read`: `evm_polymarketGetOrderbook` (CLOB orderbook snapshot by tokenId)
- `read`: `evm_polymarketGetBtc5mAdvice` (AI-style explainable side recommendation)
- `read`: `evm_polymarketGetGeoblock` (geoblock status check)
- `read`: `evm_dexscreenerPairs` (DexScreener query by keyword, filter by network/dex; BSC PancakeSwap pairs included when `chainId=bsc`)
- `read`: `evm_dexscreenerTokenPairs` (DexScreener token endpoint lookup for token pair discovery)
- `read`: `evm_getTransferTokenMap` (inspect effective transfer token symbol mapping/decimals including env overrides)
- `compose`: `evm_polymarketBuildBtc5mOrder` (unsigned order intent builder)
- `execute`: `evm_polymarketPlaceOrder` (CLOB order submit, default `dryRun=true`)
- `execute`: `evm_polymarketGetOpenOrders` (authenticated open-order list)
- `execute`: `evm_polymarketGetOrderStatus` (authenticated order status/fill snapshot by `orderId`, optional associated trade details)
- `execute`: `evm_polymarketCancelOrder` (cancel by orderId(s)/token scope/cancel-all, supports stale filters `maxAgeMinutes` / `maxFillRatio`, default `dryRun=true`)
- `execute`: `evm_transferNative` (native token transfer, default `dryRun=true`, execute requires `confirmMainnet=true`)
- `execute`: `evm_transferErc20` (ERC20 transfer by `tokenAddress + amountRaw`, default `dryRun=true`, execute requires `confirmMainnet=true`)
- `execute`: `evm_pancakeV2Swap` (PancakeSwap V2 exact-input swap quote + unsigned/sign execution; defaults configured for BSC; non-BSC requires per-network env config, still supports direct pair swaps with raw amounts)
- `workflow`: `w3rt_run_evm_polymarket_workflow_v0` (analysis/simulate/execute + deterministic mainnet confirmToken)
- `workflow`: `w3rt_run_evm_swap_workflow_v0` (PancakeSwap V2 swap workflow with analysis/simulate/execute + deterministic mainnet confirmToken; network config is resolved from `EVM_PANCAKE_V2_*` env vars when set)
- `workflow`: `w3rt_run_evm_transfer_workflow_v0` (native/ERC20 transfer workflow with analysis/simulate/execute + deterministic mainnet confirmToken; supports `tokenSymbol + amountToken` for mapped tokens)
- `workflow cancel intent`: supports `evm.polymarket.btc5m.cancel` (analysis/simulate/execute + deterministic mainnet confirmToken)
- `mainnet guard`: workflow execute on polygon requires `confirmMainnet=true` + correct `confirmToken`
- `trade safety rails`: Polymarket trade compose/execute/workflow support optional guard params `maxSpreadBps` / `minDepthUsd` / `maxStakeUsd` / `minConfidence`; simulate can return `status=guard_blocked`, and execute is blocked when guards fail
- `readable risk hint`: workflow `analysis/simulate/execute` now attaches a Chinese `riskHint` in phase summaries (e.g. `风险提示：风险画像：保守...风控未通过`) for non-JSON-first readability
- `trade status loop`: workflow execute now attempts to attach order-status snapshot (state/fill/trade summary) when submit response contains `orderId/orderID`
- `trade stale requote`: workflow trade supports `requoteStaleOrders=true` + stale filters (`maxAgeMinutes` / `maxFillRatio`) to run cancel-stale then repost in execute mode; supports pricing strategy `requotePriceStrategy=aggressive|passive|follow_mid`, fallback mode `requoteFallbackMode=none|retry_aggressive`, and limits `requoteMinIntervalSeconds` / `requoteMaxAttempts` / `requoteMaxPriceDriftBps` (volatility guard)
- `natural-language workflow parsing`: intent text now supports richer phrasing for run mode (`先分析/先模拟/直接执行`), trade guards (`maxEntryPrice` / `maxSpreadBps` / `minDepthUsd` / `maxStakeUsd` / `minConfidence`), risk profiles (`保守/平衡/激进`), AI toggle (`不用AI`), and stale-requote controls (stale age, interval, attempts, fallback, drift `bps/%`)
- `stale cancel intent`: workflow cancel supports stale-filter params (`maxAgeMinutes`/`maxFillRatio`) and can parse natural language like "取消超过 30 分钟未成交挂单"
- `transfer symbol map`: workflow can resolve `USDC/USDT/DAI/WETH/WBTC` addresses on `ethereum/polygon/arbitrum/optimism` and `USDC/DAI/WETH` on `base` (otherwise provide `tokenAddress`)
- `transfer symbol map override`: configurable via `EVM_TRANSFER_TOKEN_MAP` (global JSON by symbol->network->address) and `EVM_TRANSFER_TOKEN_MAP_<NETWORK>` (per-network JSON by symbol->address, e.g. `EVM_TRANSFER_TOKEN_MAP_BASE`)
- `transfer symbol decimals override`: configurable via `EVM_TRANSFER_TOKEN_DECIMALS` (JSON by symbol->decimals, used when converting `amountToken` to `amountRaw`)
- `ai assist`: workflow/read can auto-pick side (`up/down`) with explainable reasons, confidence, and risk-aware fallback (`avoid`)

### EVM Swap (PancakeV2) OpenClaw-ready config

To use `evm_pancakeV2Swap` / `w3rt_run_evm_swap_workflow_v0` on non-BSC chains, set these env vars:

```bash
export EVM_PANCAKE_V2_FACTORY_<NETWORK_UPPER>=<factory-address>
export EVM_PANCAKE_V2_ROUTER_<NETWORK_UPPER>=<router-address>
export EVM_PANCAKE_V2_WRAPPED_NATIVE_<NETWORK_UPPER>=<wrapped-native-address>
# optional
export EVM_PANCAKE_V2_CHAIN_ID_<NETWORK_UPPER>=<chain-id>
```

Example for Polygon:

```bash
export EVM_PANCAKE_V2_FACTORY_POLYGON=0x...factory
export EVM_PANCAKE_V2_ROUTER_POLYGON=0x...router
export EVM_PANCAKE_V2_WRAPPED_NATIVE_POLYGON=0x...WETH
export EVM_PANCAKE_V2_CHAIN_ID_POLYGON=137
```

Before first run, OpenClaw can preflight this with:
`evm_getPancakeV2Config` (read tool, optional `network` or `all: true`).

Run with `runMode=analysis -> simulate -> execute` and pass back `confirmToken` exactly like transfer workflows.

### EVM Polymarket NL Examples (Pi/OpenClaw)

- `帮我查一下 Polymarket BTC 5分钟的可交易市场`
- `帮我分析 BTC 5m，建议买涨还是买跌`
- `买 BTC 5分钟涨 20 USDC，先分析`
- `买 BTC 5分钟涨 20 USDC，保守，先模拟`
- `买 BTC 5分钟涨 20 USDC，更保守一点，先模拟`
- `buy BTC 5m up 20 USDC conservative, simulate`
- `继续上一笔，先模拟`
- `继续刚才这笔，确认主网执行，confirmToken EVM-XXXX`
- `查一下我 BTC 5分钟的挂单`
- `取消我所有 BTC 5m 挂单，先模拟`
- `继续撤单，确认主网执行，confirmToken EVM-XXXX`
- `给 0x... 转 0.001 MATIC，先预览`
- `把 1000000 raw USDC（Polygon）转到 0x...，确认主网执行`
- `在 base 把 2.5 USDC 转给 0x...，先模拟`
- `帮我查一下 EVM 转账 token symbol 映射（base）`
- `给 0x... 转 0.001 MATIC，先分析`
- `继续执行刚才这笔转账，确认主网执行，confirmToken EVM-XXXX`

### Stablecoin Yield AI Agent (Plan-first Examples)

- `检查我在 Solana 的 USDC/USDT/DAI 持仓，给我一版风险分级的稳定币收益再平衡计划。`
- `先分析：把我可用 USDC 的 30% 转到收益更高但风险较低的稳定币借贷池，剩余保留 70% 现金。`
- `对比当前 DeFi 稳定币利率，给我一版自动化再平衡的执行建议（含风险提示）。`
- `继续上一条，先模拟迁移步骤，并输出清算与波动风险说明。`

EVM symbol-map override example:

```bash
export EVM_TRANSFER_TOKEN_MAP_BASE='{"USDT":"0x1111111111111111111111111111111111111111"}'
export EVM_TRANSFER_TOKEN_DECIMALS='{"USDC":6,"USDT":6}'
```

## NEAR (Current) — 44 tools, 194 tests

### 🔥 Autonomous Yield Worker

- `execute`: `near_yieldWorkerStart` — start autonomous stablecoin yield optimization loop (scans Burrow markets, compares APR, decides rebalance/hold/supply, executes, notifies via webhook, repeats on interval; `dryRun=true` default)
- `execute`: `near_yieldWorkerStop` — stop a running yield worker
- `execute`: `near_yieldWorkerStatus` — get worker state + recent decision audit logs (last 50 cycles)

### Full Tool List

- `read`: `near_getBalance` (native NEAR balance, available + locked)
- `read`: `near_getAccount` (view account state)
- `read`: `near_getFtBalance` (NEP-141 FT balance by contract id, with metadata fallback)
- `read`: `near_getPortfolio` (native + common FT portfolio snapshot, readable output)
- `portfolio DeFi visibility`: when `near_getPortfolio` auto-discovers tokens from Ref/Burrow, discovered tokens are kept in output even if wallet FT balance is zero (with source tags) so DeFi-held assets are still visible
- `portfolio DeFi summary`: `near_getPortfolio` now adds a readable exposure line for Ref deposits and Burrow supplied/collateral/borrowed token sets
- `portfolio grouped readability`: `near_getPortfolio` text output is grouped into `Wallet assets (>0)` / `DeFi tracked tokens` / `Asset details`
- `portfolio USD valuation`: `near_getPortfolio` now estimates wallet USD value (best-effort via NEAR Intents token prices) and returns structured `details.valuation`
- `portfolio valuation cache`: valuation price feed is cached in-process (default 30s TTL, configurable via `valuationCacheTtlMs` or `NEAR_PORTFOLIO_VALUATION_CACHE_TTL_MS`)
- `portfolio value ranking`: wallet/display sections now prioritize higher USD-estimated assets and include `Top wallet assets by USD`
- `portfolio valuation freshness`: output includes latest valuation price timestamp and structured `priceUpdatedAtLatest/Oldest`
- `portfolio defi panel`: `near_getPortfolio` now includes Ref/Burrow quantity rows and USD totals (`wallet/ref/burrowSupplied/burrowBorrowed/net`) in both readable text and structured `details.defiBreakdown`
- `read`: `near_getLendingMarketsBurrow` (Burrow lending market list with capability flags + supply/borrow APR + readable amounts)
- `read`: `near_getStableYieldPlan` (multi-symbol stablecoin supply APR planner on Burrow, ranked candidates + recommended allocation target)
- `read`: `near_getLendingPositionsBurrow` (Burrow account supplied/collateral/borrowed snapshot with readable token rows + risk summary + USD valuation/borrow-collateral ratio + configurable warning/critical thresholds)
- `workflow`: Burrow borrow/withdraw `analysis/simulate` summary line now includes risk policy + risk band (`safe/warning/critical/unknown`) + `riskEngine`/`hf` fields for faster natural-language follow-up decisions
- `workflow`: Burrow borrow/withdraw simulate/execute summaries now include a short readable risk hint (e.g. `风险提示：高风险（critical）...`) to reduce pure-JSON style output
- `read`: `near_getRefDeposits` (Ref exchange deposited balances, readable token symbols + raw/ui amounts)
- `read`: `near_getRefLpPositions` (Ref LP share positions, pool pair labels + remove hints)
- `read`: `near_getSwapQuoteRef` (Ref/Rhea quote: explicit pool/direct/two-hop route; supports token symbols like `NEAR`/`USDC`)
- `read`: `near_getIntentsTokens` (NEAR Intents 1Click `/v0/tokens`, filterable supported-asset list)
- `read`: `near_getIntentsQuote` (NEAR Intents 1Click `/v0/quote`, defaults to `dry=true` for safe preview)
- `read`: `near_getIntentsExplorerTransactions` (NEAR Intents Explorer `/api/v0/transactions-pages` or cursor `/api/v0/transactions`, supports status/chain/time filters, includes `quickView=abnormal` preset, returns business-readable summary: status counts + USD in/out + top routes; requires JWT)
- `read`: `near_getIntentsStatus` (NEAR Intents 1Click `/v0/status` by `depositAddress`/`depositMemo` or `correlationId`)
- `read`: `near_getIntentsAnyInputWithdrawals` (NEAR Intents 1Click `/v0/any-input/withdrawals` for ANY_INPUT withdrawal records)
- `compose`: `near_buildTransferNearTransaction` (unsigned native transfer payload, local signing)
- `compose`: `near_buildTransferFtTransaction` (unsigned NEP-141 `ft_transfer` payload, local signing)
- `compose`: `near_buildIntentsSwapDepositTransaction` (unsigned NEAR Intents deposit tx from `/v0/quote`, local signing)
- `compose`: `near_buildSwapRefTransaction` (unsigned Ref swap payload(s), can include output-token `storage_deposit` pre-tx)
- `compose`: `near_buildAddLiquidityRefTransaction` (unsigned Ref add-liquidity tx set, optional pre-registration/deposit steps)
- `compose`: `near_buildRemoveLiquidityRefTransaction` (unsigned Ref remove-liquidity tx, supports shares/shareBps; when `autoWithdraw=true` returns post-remove withdraw compose templates)
- `compose`: `near_buildRefWithdrawTransaction` (unsigned Ref withdraw payload(s), can include `storage_deposit` pre-tx when needed)
- `compose`: `near_buildSupplyBurrowTransaction` (unsigned Burrow supply `ft_transfer_call`, supports `asCollateral`)
- `compose`: `near_buildBorrowBurrowTransaction` (unsigned Burrow borrow `execute`, supports `withdrawToWallet`)
- `compose`: `near_buildRepayBurrowTransaction` (unsigned Burrow repay `ft_transfer_call` with `OnlyRepay`)
- `compose`: `near_buildWithdrawBurrowTransaction` (unsigned Burrow `simple_withdraw`, supports recipient + raw->inner conversion)
- `execute`: `near_transferNear` (local credentials/env signer, mainnet safety gate)
- `execute`: `near_transferFt` (NEP-141 `ft_transfer`, supports custom gas/deposit, mainnet safety gate)
- `execute`: `near_swapRef` (Ref/Rhea swap via `ft_transfer_call`, supports multi-hop actions, mainnet safety gate, auto output-token `storage_deposit`)
- `execute`: `near_supplyBurrow` (Burrow supply via `ft_transfer_call`, supports `asCollateral=true` one-step collateralization)
- `execute`: `near_borrowBurrow` (Burrow `execute` borrow path, optional auto-withdraw borrowed amount to wallet)
- `execute`: `near_repayBurrow` (Burrow repay via token `ft_transfer_call` + `OnlyRepay`)
- `execute`: `near_withdrawBurrow` (Burrow `simple_withdraw`, supports recipient and raw->inner amount conversion by market `extra_decimals`)
- `burrow NL amount parsing`: workflow now treats plain token amounts like `在 Burrow 存入 1 USDC` as UI amounts and auto-converts to raw by token decimals (explicit `amountRaw` still takes priority)
- `execute`: `near_submitIntentsDeposit` (NEAR Intents `/v0/deposit/submit`, submit deposit `txHash` + `depositAddress`/`depositMemo`, mainnet safety gate)
- `execute`: `near_broadcastSignedTransaction` (broadcast base64 signed NEAR tx via `broadcast_tx_commit`, returns `txHash`)
- `execute`: `near_withdrawRefToken` (withdraw deposited token from Ref exchange back to wallet, optional full-balance withdraw)
- `execute`: `near_addLiquidityRef` (Ref LP add-liquidity, includes optional auto register + token deposit to Ref exchange; supports auto pool selection by token pair when `poolId` is omitted)
- `execute`: `near_removeLiquidityRef` (Ref LP remove-liquidity; supports auto pool selection by token pair when `poolId` is omitted, plus `autoWithdraw=true` to auto-withdraw pool tokens)
- `workflow`: `w3rt_run_near_workflow_v0` (analysis/compose/simulate/execute + deterministic mainnet confirmToken; compose/workflow intents include `near.transfer.near` / `near.transfer.ft` / `near.swap.ref` / `near.ref.withdraw` / `near.swap.intents` / `near.lp.ref.add` / `near.lp.ref.remove` / `near.lend.burrow.supply` / `near.lend.burrow.borrow` / `near.lend.burrow.repay` / `near.lend.burrow.withdraw`; simulate includes balance + storage-registration prechecks plus Burrow market/position prechecks and conservative risk statuses like `insufficient_collateral` / `risk_check_required`; mainnet Burrow borrow/withdraw execute now runs a risk precheck and blocks `warning/critical` unless `confirmRisk=true` or intent text includes risk confirmation phrases like `我接受风险继续执行` / `accept risk`; execute summary now includes `riskEngine/hf/liqDistance` for quick risk readability; intents execute accepts either `txHash` or `signedTxBase64` and can auto-broadcast first; `swapType=ANY_INPUT` execute also attempts `/v0/any-input/withdrawals` and returns readable withdrawal artifacts)
- `workflow:stable-yield`: `near.defi.stableYieldPlan` now uses a proposal-first execute handoff (simulate `→` stable-yield execution artifacts). `runMode=simulate` must return `executionApproval` with `stableYieldPlanId` + `stableYieldApprovalToken`; `runMode=execute` must pass the exact same fields (plus optional `stableYieldActionId`) and receives `near.defi.stableYieldProposalExecution.v1` with `status=ready/no-op` and `requiredApprovals.type=agent-wallet`.
- `workflow phase summary`: NEAR workflow analysis/simulate/execute artifacts include `summaryLine` for concise one-line replay in PI/OpenClaw
- `workflow execute summary`: NEAR workflow execute artifacts include `summaryLine` for concise one-line replay in PI/OpenClaw (all intents)
- `intents execute summary`: `near.swap.intents` execute artifact now includes `summaryLine` for one-line natural-language replay in PI/OpenClaw
- `intents execute tracking`: `near.swap.intents` execute now polls `/v0/status` by default after submit (until terminal status or timeout, and includes `correlationId` when available). Tunables: `waitForFinalStatus`, `statusPollIntervalMs`, `statusTimeoutMs`.
- `intents failure attribution`: `near.swap.intents` execute now emits `intentsOutcome` (category/reason/remediation) and human-readable `Outcome/Reason/Next` lines for failed/refunded/incomplete/pending states.
- `LP auto-selection UX`: when pair-based selection has multiple candidate pools, simulate returns concise alternatives (`poolCandidates`) and text summary (`alternatives=...`)
- `LP follow-up execute`: after simulate, execute can reuse the session and switch pool by natural language (`继续执行，用第2个池子`) or structured `poolCandidateIndex`
- `swap safety rails`: `slippageBps` is safety-limited (default max `1000` bps via `NEAR_SWAP_MAX_SLIPPAGE_BPS`), and custom `minAmountOutRaw` cannot be lower than quote-safe minimum
- `rpc`: `near_rpc` (generic NEAR JSON-RPC passthrough; blocks `broadcast_tx_*` by default)
- `Ref defaults`: mainnet `v2.ref-finance.near`, testnet `ref-finance-101.testnet` (env override supported)
- `Token symbol map`: configurable via `NEAR_REF_TOKEN_MAP(_MAINNET/_TESTNET)` and decimals via `NEAR_REF_TOKEN_DECIMALS(_MAINNET/_TESTNET)`

### NEAR DeFi NL Examples (Pi)

- Swap (simulate):
  - `intentText: "把 0.01 NEAR 换成 USDC，先模拟"`
- LP Add (analysis):
  - `intentText: "在 Ref 添加 LP，pool 7，tokenA NEAR amountA 0.01，tokenB USDC amountB 1.2，先分析"`
- LP Add (analysis, auto-pool by pair):
  - `intentText: "在 Ref 添加 LP，NEAR/USDC，amountA 0.01，amountB 1.2，先分析"`
- LP Add (analysis, plain NL token amounts):
  - `intentText: "在 Ref 添加 LP，投入 0.02 NEAR 和 2 USDC，先分析"`
- LP Add (execute follow-up, choose another candidate pool):
  - `intentText: "继续执行，用第2个池子"` (with same `runId`, `runMode=execute`, after a prior simulate that returned `poolCandidates`)
- LP Remove (simulate):
  - `intentText: "在 Ref 移除 LP，pool 7，shares 100000，minA 1，minB 1，先模拟"`
- LP Remove (simulate, auto-pool by pair):
  - `intentText: "在 Ref 移除 LP，NEAR/USDC，shares 100000，minA 1，minB 1，先模拟"`
- LP Remove (simulate, by percentage):
  - `intentText: "在 Ref 移除 LP，NEAR/USDC，50%，先模拟"`
- LP Remove (simulate, full position):
  - `intentText: "在 Ref 移除 LP，NEAR/USDC，全部撤出，先模拟"`
- LP Remove + Auto Withdraw (execute intent):
  - `intentText: "在 Ref 移除 LP，NEAR/USDC，50%，提回钱包，确认主网执行"`
- Ref Withdraw (simulate, exact amount):
  - `intentText: "在 Ref 把 USDC 提回钱包，amountRaw 1000000，先模拟"`
- Ref Withdraw (analysis, full balance):
  - `intentText: "在 Ref 把 USDC 全部提回钱包，先分析"`
- Burrow Markets (read):
  - `帮我查一下 NEAR 主网 Burrow 借贷市场`
- Stable Yield Planner (read):
  - `帮我分析一下 NEAR 主网稳定币供应策略，先分析`
- Stable Yield Planner (handoff execute flow):
  - `先模拟：先分析 NEAR 主网稳定币供应策略`
  - execute requires `stableYieldPlanId` + `stableYieldApprovalToken` from simulate output, for example:
    - `runMode: "execute", intentType: "near.defi.stableYieldPlan", runId: "wf-xxx", stableYieldPlanId: "near.stable-yield....", stableYieldApprovalToken: "near.defi.stableYieldProposalApproval.v1:...", confirmMainnet: true`
  - optional `stableYieldActionId` can pin which action to execute (e.g. `near.stable-yield....supply`), otherwise defaults to first proposed action
- Burrow Positions (read):
  - `帮我查一下 NEAR 主网 Burrow 我的借贷仓位`
- Burrow Supply (execute):
  - `在 Burrow 存入 1 USDC，作为抵押，确认主网执行`
- Burrow Borrow (execute):
  - `在 Burrow 借 0.01 USDC 并提到钱包，确认主网执行`
- Burrow Borrow (high-risk override execute):
  - `继续执行上一笔 Burrow 借款，确认主网执行，并确认风险执行`
- Burrow Repay (execute):
  - `在 Burrow 还款 0.005 USDC，确认主网执行`
- Burrow Withdraw (execute):
  - `在 Burrow 提取 0.005 USDC 到钱包，确认主网执行`
- Burrow Withdraw (high-risk override execute):
  - `继续执行上一笔 Burrow 提款，确认主网执行，accept risk`
- Compose unsigned transfer (tool):
  - `near_buildTransferNearTransaction` with `fromAccountId`, `toAccountId`, `amountNear`
- Compose unsigned Ref swap (tool):
  - `near_buildSwapRefTransaction` with `fromAccountId`, `tokenInId`, `tokenOutId`, `amountInRaw` (optional `minAmountOutRaw`/`slippageBps`)
- Compose unsigned Intents deposit (tool):
  - `near_buildIntentsSwapDepositTransaction` with `fromAccountId`, `originAsset`, `destinationAsset`, `amount`
- Compose unsigned Ref LP add/remove (tools):
  - `near_buildAddLiquidityRefTransaction` with `poolId` (or pair), `amountARaw`, `amountBRaw`
  - `near_buildRemoveLiquidityRefTransaction` with `poolId`, `shares` (or `shareBps`); set `autoWithdraw=true` to get post-remove withdraw templates
- Compose unsigned Ref withdraw (tool):
  - `near_buildRefWithdrawTransaction` with `fromAccountId`, `tokenId`, `amountRaw` (or `withdrawAll=true`)
- Compose unsigned Burrow lend (tools):
  - `near_buildSupplyBurrowTransaction` with `tokenId`, `amountRaw`, optional `asCollateral`
  - `near_buildBorrowBurrowTransaction` with `tokenId`, `amountRaw`, optional `withdrawToWallet`
  - `near_buildRepayBurrowTransaction` with `tokenId`, `amountRaw`
  - `near_buildWithdrawBurrowTransaction` with `tokenId`, `amountRaw`, optional `recipientId`
- Ref Deposits (read):
  - `帮我查一下 NEAR 主网 Ref 里我存了哪些币`
- Ref LP Positions (read):
  - `帮我查一下 NEAR 主网 Ref LP 持仓（扫描前 200 个池子）`
- Intents Tokens (read):
  - `帮我查一下 NEAR Intents 支持的 near 链 USDC 资产`
- Intents Quote (read, dry preview):
  - `帮我用 NEAR Intents 预估把 wNEAR 换成 USDC，amount=10000000000000000000000（dry）`
- Intents Explorer Transactions (read):
  - `帮我查一下 NEAR Intents 最近 20 笔交易，筛选状态 SUCCESS/PROCESSING`
  - `帮我用 cursor 模式查 NEAR Intents 交易，direction=next，numberOfTransactions=20`
  - `帮我查一下 NEAR Intents 异常交易（quickView=abnormal）`
- Intents Status (read):
  - `帮我查一下 NEAR Intents 这个 depositAddress 的状态：0x...`
  - `帮我查一下 NEAR Intents 这个 correlationId 的状态：corr-...`
- Intents ANY_INPUT Withdrawals (read):
  - `帮我查一下 NEAR Intents 这个 depositAddress 的 ANY_INPUT 提现记录：0x...`
- Intents Swap (workflow simulate):
  - `intentText: "通过 intents 把 NEAR 换成 USDC，amountRaw 10000000000000000000000，先模拟"`
- Intents Swap ANY_INPUT (workflow analysis/simulate):
  - `intentText: "通过 intents any input 把 NEAR 换成 USDC，amountRaw 10000000000000000000000，先模拟"`
- Intents Swap ANY_INPUT (workflow execute):
  - `intentText: "继续执行刚才这笔 intents any input 兑换，确认主网执行"` (execute artifact includes polled ANY_INPUT withdrawal records when available)
- Intents Swap (workflow execute submit):
  - `intentText: "继续执行刚才这笔 intents 兑换，txHash 0x..."` (with same `runId`, `runMode=execute`, and prior simulate output that includes `depositAddress`/`depositMemo`)
- Intents Swap (workflow execute with signed tx):
  - `runMode=execute` + `signedTxBase64` (workflow auto-broadcasts and then submits intents deposit)
- Intents Swap (workflow execute + wait final status):
  - `intentText: "继续执行刚才这笔 intents 兑换，txHash 0x...，等待完成并跟踪状态"`

## Sui (Minimal)

- `read`: `sui_getBalance` (SUI or custom `coinType`)
- `read`: `sui_getDefiPositions` (aggregated wallet + Cetus farms/vault positions snapshot)
- `read`: `sui_getPortfolio` (multi-asset balances with optional metadata + grouped human-readable output)
- `read portfolio balance mode`: `sui_getBalance`/`sui_getPortfolio` now use effective balance `max(totalBalance, fundsInAddressBalance)` so assets like USDC are not hidden when coin-object balance is `0` but in-address funds are non-zero
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
- `workflow`: `w3rt_run_sui_workflow_v0` (analysis/simulate/execute with deterministic mainnet confirmToken; execute supports either local signer or signed payload submit via `signedTransactionBytesBase64 + signedSignatures`)
- `workflow follow-up execute`: after `simulate`, a natural follow-up `execute` (same run/session) can reuse the simulated transaction and sign directly with local Sui keystore signer, so no extra signing params are required
- `workflow LP usability`: for `sui.lp.cetus.add/remove`, if `poolId` is omitted but `positionId` is provided, workflow now attempts to auto-resolve `poolId` from the on-chain position object
- `workflow`: `w3rt_run_sui_stablelayer_workflow_v0` (analysis/simulate/execute for stable-layer mint/burn/claim with deterministic mainnet confirmToken; supports signed payload submit on execute)
- `workflow`: `w3rt_run_sui_cetus_farms_workflow_v0` (analysis/simulate/execute for Cetus v2 farms stake/unstake/harvest with deterministic mainnet confirmToken; supports signed payload submit on execute)
- `workflow`: `w3rt_run_sui_defi_workflow_v0` (unified DeFi router workflow; auto-routes to core/stablelayer/cetus-farms flows)
- `workflow risk gate (core)`: mainnet high-risk core actions (currently high-slippage swap / risky LP params) require explicit risk confirmation (`confirmRisk=true` or natural language like `我接受风险继续执行`)
- `workflow readable risk hint (core)`: core workflow simulate/execute text now includes `风险提示：...` short hints to improve non-JSON readability
- `workflow phase summary`: Sui workflow analysis/simulate/execute artifacts include `summaryLine` (concise one-line replay for PI/OpenClaw narration)
- `workflow execute summary`: Sui execute artifacts now include `summaryLine` (concise `intent + digest/status` output for PI/OpenClaw narration)
- `rpc`: `sui_rpc` (generic Sui JSON-RPC passthrough with dangerous method safety guard)

### Sui DeFi NL Examples (Pi)

Use unified router tool `w3rt_run_sui_defi_workflow_v0`:

- Swap (analysis):
  - `intentText: "swap 1000000 from 0x2::sui::SUI to 0x...::usdc::USDC"`
- LP Add (analysis, less structured):
  - `intentText: "provide liquidity pool: 0xabc position: 0xdef 0x2::sui::SUI 0x2::usdc::USDC tick: -5 to 5 a: 10 b: 20"`
- LP Add (analysis, auto-resolve poolId from position):
  - `intentText: "给 position 0xdef 添加 SUI/USDC 流动性，tick -5 到 5，amountA 10 amountB 20，先分析"`
- Cetus Farms Harvest (analysis):
  - `intentText: "claim farm rewards pool: 0xabc nft: 0xdef"`
- StableLayer Mint (analysis):
  - `intentText: "mint stable coin 0x...::btc_usdc::BtcUSDC amount 1000000"`
- High-risk swap execute (natural-language override):
  - `intentText: "继续执行刚才这笔，确认主网执行，我接受风险继续执行，confirmToken SUI-..."`

Recommended execution flow on mainnet:
1. `runMode=analysis` -> capture `confirmToken`
2. `runMode=simulate` -> verify artifacts/status
3. `runMode=execute` with `confirmMainnet=true` and `confirmToken=<token>`  
   optional local-signer path: pass `signedTransactionBytesBase64` + `signedSignatures` to broadcast without exposing private key

## Use In Pi (Recommended)

You do **not** need `pi-mono`. Install this project as a normal Pi extension source.

### 1) Prerequisites

- Pi CLI installed (`pi --version`)
- Node.js 20+ and npm
- Sui CLI installed (`sui --version`)
- NEAR CLI (for local credential bootstrap, optional but recommended)
- Local Sui wallet initialized and active on mainnet

Sui CLI quick init (first-time setup):

```bash
# Create/switch mainnet environment
sui client new-env --alias mainnet --rpc https://fullnode.mainnet.sui.io:443
sui client switch --env mainnet

# Create address if you do not have one yet
sui client new-address ed25519

# Verify active wallet
sui client active-address
sui client active-env
```

Expected local files:

```bash
ls ~/.sui/sui_config/sui.keystore
ls ~/.sui/sui_config/client.yaml
```

### 2) Install once (GitHub source recommended)

This package is designed to be installed directly into Pi.
You do not need to clone or run `pi-mono`.

Install directly from GitHub:

```bash
pi install https://github.com/DaviRain-Su/pi-chain-tools
# or
pi install git:github.com/DaviRain-Su/pi-chain-tools
```

Local repository install (for development):

```bash
pi install /Users/davirian/dev/pi-chain-tools
```

npm install source (optional, after publish):

```bash
pi install npm:pi-chain-tools
```

The package auto-loads one bundled extension (`src/pi/default-extension.ts`) that registers:

- Meta capability discovery toolset (`w3rt_getCapabilities_v0`)
- Solana workflow toolset
- Sui full toolset (read/compose/execute/workflow/rpc)
- NEAR read/execute/workflow/rpc toolset (including Ref swap quote + execute)
- EVM Polymarket toolset (read/compose/execute/workflow)

### 3) Reload Pi and smoke test

Run in Pi:

```text
/reload
```

Then ask naturally:

```text
帮我查一下 Sui 主网余额
```

Or ask for ACP/OpenClaw capability discovery:

```text
列出你现在支持的链上能力和自然语言操作示例
```

Notes:

- Sui is Move-based, not ERC20-based; assets are identified by `coinType`.
- `sui_getBalance` without `coinType` returns all non-zero assets (including USDC if present), and treats `fundsInAddressBalance` as effective balance when larger than `totalBalance`.

### 4) Sui signer config (no `fromPrivateKey` needed)

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

### 5) NEAR signer config (no explicit private key required)

NEAR execute/workflow tools can auto-load signer in this order:

1. `privateKey` parameter (`ed25519:...`)
2. `NEAR_PRIVATE_KEY`
3. local credentials file:
   - `~/.near-credentials/<network>/<accountId>.json`

Account id resolution order:

1. `fromAccountId` / `accountId` parameter
2. `NEAR_ACCOUNT_ID`
3. `NEAR_WALLET_ACCOUNT_ID`
4. first account under `~/.near-credentials/<network>/`

Quick checks:

```bash
ls ~/.near-credentials/mainnet
cat ~/.near-credentials/mainnet/<your-account>.json
```

### 6) Execution allow/safety config

- Mainnet execute is guarded. You must explicitly confirm (internally `confirmMainnet=true`).
- Workflow execute on mainnet also requires the matching `confirmToken` from prior analysis/simulate.
- `sui_rpc` blocks dangerous methods by default; only use `allowDangerous=true` when you know exactly what you are doing.
- NEAR Ref swap safety defaults:
  - `NEAR_SWAP_MAX_SLIPPAGE_BPS` default `1000` (10%)
  - hard cap `5000` (50%)
  - provided `minAmountOutRaw` must be `>=` quote safe minimum

Natural language confirmation example:

```text
继续执行刚才这笔，确认主网执行
```

### 7) Natural language examples (Sui)

- Swap simulate:
  - `把 0.01 SUI 换成 USDC，先模拟。`
- Swap execute (after simulate):
  - `继续执行刚才这笔，确认主网执行。`
- Swap execute (local sign submit, no private key):
  - `继续执行刚才这笔，用本地钱包签名后的 payload 广播到主网。`
- Cetus farms pools:
  - `帮我查一下 Sui 主网 Cetus farms 的池子列表。`
- StableLayer:
  - `在 Sui 主网把 1000000 raw USDC mint 成 stable，先模拟。`
- Portfolio (include stablecoins):
  - `帮我查一下 Sui 主网本地钱包余额（包含USDC）`

### 8) Natural language examples (NEAR)

- Native balance (local/default account):
  - `帮我查一下 NEAR 主网本地钱包余额`
- Account state:
  - `帮我查一下 NEAR 账户 alice.near 的状态`
- FT balance (USDT example):
  - `帮我查一下 alice.near 在 usdt.tether-token.near 的余额`
- Portfolio (include common stablecoins):
  - `帮我查一下 NEAR 主网本地钱包资产（包含 USDC/USDT）`
- Portfolio + USD valuation:
  - `帮我查一下 NEAR 主网本地钱包资产并估算美元价值`
- Workflow analyze:
  - `把 0.01 NEAR 转到 bob.near，先分析`
- Workflow simulate:
  - `把 0.01 NEAR 转到 bob.near，先模拟`
- Workflow execute:
  - `继续执行刚才这笔，确认主网执行`
- Ref quote:
  - `帮我查一下 NEAR 上 Ref 从 usdt.tether-token.near 到 usdc.fakes.near 的报价，amountInRaw 1000000`
- Ref quote (symbol mode):
  - `帮我查一下 NEAR 上 Ref 报价：NEAR 到 USDC，amountInRaw 10000000000000000000000`
- Ref swap simulate:
  - `把 usdt.tether-token.near 的 1000000 raw 换成 usdc.fakes.near，先模拟`
- Ref swap simulate (natural language):
  - `把 0.01 NEAR 换成 USDC，先模拟`
- Ref swap execute:
  - `继续执行刚才这笔，确认主网执行`
- Intents quote (read):
  - `帮我用 NEAR Intents 预估把 NEAR 换成 USDC，amount=10000000000000000000000（dry）`
- Intents explorer txs (read):
  - `帮我查一下 NEAR Intents Explorer 最近 20 笔 near -> eth 的交易`
- Intents workflow simulate:
  - `通过 intents 把 NEAR 换成 USDC，amountRaw 10000000000000000000000，先模拟`
- Intents workflow execute (submit deposit):
  - `继续执行刚才这笔 intents 兑换，txHash 0x...，确认主网执行`
- Intents workflow execute (follow-up confirm token in NL):
  - `继续执行刚才这笔，确认主网执行，NEAR-XXXXXXXXXX`
- Intents workflow execute (natural no-wait):
  - `继续执行刚才这笔 intents 兑换，不用等待完成，确认主网执行`
- Intents workflow execute (signed tx auto-broadcast):
  - `继续执行刚才这笔 intents 兑换，signedTxBase64 <BASE64_SIGNED_TX>，确认主网执行`
- Intents ANY_INPUT withdrawals:
  - `帮我查一下 NEAR Intents ANY_INPUT 提现记录，depositAddress 0x...`
- Ref deposits:
  - `帮我查一下 NEAR 主网 Ref 存款（deposits）`
- Ref LP positions:
  - `帮我查一下 NEAR 主网 Ref LP 持仓`
- Burrow lending risk:
  - `帮我查一下 NEAR 主网 Burrow 借贷仓位，并给我美元风险摘要`

### 9) Quick self-check

```bash
# 1) verify extension is installed
pi list

# 2) reload runtime
# (in Pi chat)
/reload

# 3) verify Sui wallet context
sui client active-env
sui client active-address

# 4) verify NEAR local credentials
ls ~/.near-credentials/mainnet
```

Then run these prompts:

- `列出你现在支持的链上能力和自然语言操作示例`
- `帮我查一下 Sui 主网本地钱包余额（包含USDC）`
- `帮我查一下 NEAR 主网 Ref 存款（deposits）`
- `帮我查一下 NEAR 主网 Ref LP 持仓`

### ACP/OpenClaw Capability Discovery

If your host agent supports ACP-style tool exposure, use capability discovery first:

- Tool name: `w3rt_getCapabilities_v0`
- Purpose: machine-readable capability catalog (`schema = w3rt.capabilities.v1`)
- Includes:
  - chain coverage + maturity status
  - workflow entry tools + intent types
  - signer requirements and env keys
  - natural-language examples
  - tool-group summary (`read/compose/execute/rpc`)
- Filtering:
  - `maxRisk=low|medium|high` (default `high`)
  - `executableOnly=true` (only executable workflow capabilities)

ACP handshake tool:

- Tool name: `w3rt_getCapabilityHandshake_v0`
- Purpose: protocol-level handshake/negotiation payload (`schema = w3rt.capability.handshake.v1`)
- Includes protocol info (`acp-tools`), server version, capability digest, and optional embedded capability catalog

Policy tools:

- `w3rt_getPolicy_v0`: read runtime execution policy (`schema = w3rt.policy.v1`)
- `w3rt_setPolicy_v0`: update runtime execution policy (current scope: `evm.transfer`, supports templates `production_safe` / `open_dev`)
- `w3rt_getPolicyAudit_v0`: read recent policy update audit log (`schema = w3rt.policy.audit.v1`)

Natural language examples:

- `列出你支持的所有链和工作流能力`
- `只看 EVM 的能力，不要示例`
- `给我 OpenClaw 可用的能力清单`
- `给我 ACP 握手信息并附带能力清单`
- `只返回中低风险且可执行的能力清单`
- `把转账策略应用 production_safe 模板`
- `把转账策略改成 allowlist，只允许 0x...`
- `查询当前转账策略`
- `查询最近 10 条转账策略审计日志`

### 10) Troubleshooting

- `Cannot find module ...` (for example `@mysten/utils` / `@mysten/bcs` / `@cetusprotocol/common-sdk`):
  - run `npm install` (or `bun install`) in this repo, then `/reload`
  - if still failing after dependency changes, restart Pi once
- `Failed to load extension: import_bn.default is not a constructor`:
  - dependency tree mismatch; reinstall deps (`rm -rf node_modules && npm install`) then `/reload`
- tool conflicts (`Tool "xxx" conflicts with ...`):
  - keep one provider only; remove duplicated chain extension or uninstall old local temp extension
- Sui balance only shows SUI but not USDC:
  - use `sui_getPortfolio` or `sui_getBalance` without forcing `coinType`
  - confirm the wallet actually has that `coinType` on current network
- Sui client warning `Client/Server api version mismatch`:
  - warning only; read calls usually work, but update Sui CLI for best compatibility
- NEAR signer not found:
  - check `fromAccountId` / `NEAR_ACCOUNT_ID` and local file `~/.near-credentials/<network>/<account>.json`

Useful extension management commands:

```bash
pi list
pi update
pi remove https://github.com/<your-org>/pi-chain-tools
pi remove /Users/davirian/dev/pi-chain-tools
```

### 11) Common local failure auto-recovery behavior

- `npm run ci` now routes through `scripts/ci.mjs` -> `npm run ci:resilient` by default, so local runs automatically inherit:
  - python alias resilience (`python3` shim when `python` is absent)
  - deterministic runtime metrics normalization before lint
  - bounded retries for SIGTERM and one flaky test retry
- Python resolver behavior:
  - prefer native `python` if available
  - fallback to temporary `python3` shim (`python` -> `python3`)
  - if neither exists, fail with explicit precheck guidance instead of cascading unrelated failures
- Generated runtime files (`apps/dashboard/data/**`) are excluded from Biome source checks to avoid CI churn from local runtime drift. Source files remain strict.
- Path-safety behavior:
  - `scripts/normalize-runtime-metrics.mjs` safely no-ops with warning when run outside repo root or when runtime file is absent
  - `npm run dashboard:start` uses `scripts/dashboard-start.mjs`, which warns and exits cleanly if `apps/dashboard/server.mjs` cannot be resolved

### 12) Publish To npm (optional)

Before publish:

```bash
npm login
npm whoami
npm run ci
```

Check package name availability:

```bash
npm view pi-chain-tools version
```

If name is occupied, use a scoped name (for example `@davirian/pi-chain-tools`) in `package.json`, then publish:

```bash
npm publish --access public
```

After publish, users can install with:

```bash
pi install npm:pi-chain-tools
```

### 12) Optional: `pi-mono` development wiring

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
npm run ci
# bounded retry wrapper for transient host/network flakes (local/dev helper)
npm run ci:retry
```

Security checks are enforced by `npm run ci`, which runs:

```bash
npm run check
npm run security:check
npm test
```

For details on the allowlist and remediation workflow, see:

- `docs/security-audit.md`
- Local default package manager: Bun
- CI package manager: npm (`npm ci` + lockfile)
- npm peer strategy: project-level `.npmrc` sets `legacy-peer-deps=true` to allow mixed SDK peer ranges (Sui + Solana ecosystems).

## Website (GitHub Pages)

This repo includes a submission-ready static site in `docs/`.

- entry: `docs/index.html`
- style: `docs/styles.css`
- behavior: `docs/app.js`

Deploy with GitHub Pages:

1. Open GitHub repository `Settings` -> `Pages`.
2. Set Source to `Deploy from a branch`.
3. Select branch `main` and folder `/docs`.
4. Save and wait for the published URL.

## OpenClaw ACP Quickstart

- Quickstart doc: `docs/openclaw-acp-quickstart.md`
- Recommended startup order:
  1. `w3rt_getCapabilityHandshake_v0`
  2. `w3rt_getPolicy_v0`
  3. `w3rt_setPolicy_v0` (apply `production_safe` template for production)
  4. `w3rt_getPolicyAudit_v0` (optional, verify policy update record)
  5. run workflow analysis/simulate before execute

### Install as OpenClaw NEAR plugin (local path)

This repository now includes an OpenClaw plugin manifest (`openclaw.plugin.json`) at repo root.
To expose the NEAR toolset in OpenClaw directly:

```bash
openclaw plugins install /absolute/path/to/pi-chain-tools
```

Then ensure plugin is enabled (if needed) and restart/reload gateway:

```bash
openclaw plugins enable pi-chain-tools
openclaw gateway restart
```

Quick references:

- Setup guide: `docs/openclaw-near-setup.md`
- Env template: `.env.near.example`
- Dashboard doc: `docs/near-dashboard.md`
- Ops runbook (ACP/Payments/DLQ): `docs/openclaw-ops-runbook.md`
- Good Vibes Only submission template (BSC): `docs/hackathon-goodvibes-submission.md`
- Re{define} (Starknet Privacy + Bitcoin) submission draft: `docs/hackathon-redefine-submission.md`
- Monad × Morpho submission template: `docs/hackathon-monad-morpho-submission.md`
- Monad × Morpho 3-day build plan: `docs/monad-morpho-build-plan.md`
- Morpho Earn integration checklist (file-level): `docs/monad-morpho-integration-checklist.md`
- Hackathon final submission checklist: `docs/hackathon-final-submission-checklist.md`
- Hackathon 5-min pitch script: `docs/hackathon-5min-pitch-script.md`
- Monad + Morpho SDK integration plan: `docs/monad-morpho-sdk-integration-plan.md`
- Sol-agent integration plan: `docs/sol-agent-integration-plan.md`
- Final release notes: `docs/final-release-notes.md`
- Sol-agent risk boundary (production safety contract): `docs/sol-agent-risk-boundary.md`
- Sol-agent bridge + registry mapping (Phase B, safe): `src/chains/solana/sol-agent-bridge.ts`, `src/chains/solana/registry/*`
- Submission evidence artifact guide: `npm run submission:evidence` (writes `docs/submission-evidence.md`)
- One-click Monad↔BSC demo flow: `npm run demo:monad-bsc` (dry-run default, explicit execute guard)

### Local NEAR Dashboard (web)

A lightweight local dashboard is included for quick account visibility.
It reads NEAR wallet + tracked FT balances + Burrow registration status.

Start it from repo root:

```bash
npm run dashboard:start
```

Open in browser:

- `http://127.0.0.1:4173`

### Submission Evidence Automation

Generate a submission-ready markdown artifact (deterministic, non-destructive):

```bash
npm run submission:evidence
```

Output:

- `docs/submission-evidence.md`

The artifact includes latest commit metadata, best-effort quality snapshot (`check/test/security:check`), dashboard/session references, and tx-proof template placeholders.

### One-click Demo (Monad + BSC)

Safe default (dry-run):

```bash
npm run demo:monad-bsc
```

Live execute is blocked unless explicit guard text is provided:

```bash
npm run demo:monad-bsc -- --execute --confirm-execute I_UNDERSTAND_THIS_WILL_EXECUTE_ONCHAIN
```

Optional env overrides:

- `NEAR_ACCOUNT_ID` (default account shown on first load)
- `NEAR_RPC_URL` (single endpoint override)
- `NEAR_RPC_URLS` (comma-separated endpoints, auto-fallback on 429)
- `NEAR_DASHBOARD_PORT` (default `4173`)

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
