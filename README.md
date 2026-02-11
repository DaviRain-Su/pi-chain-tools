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
- `read`: `sui_getPortfolio` (multi-asset balances with optional metadata)
- `read`: `sui_getSwapQuote` (Cetus aggregator quote + route details on mainnet/testnet)
- `read`: `sui_getStableLayerSupply` (Stable Layer total supply + optional per-coin supply on mainnet/testnet)
- `compose`: `sui_buildTransferSuiTransaction` / `sui_buildTransferCoinTransaction` (unsigned tx payload builders)
- `compose`: `sui_buildSwapCetusTransaction` (quote + unsigned swap tx build)
- `compose`: `sui_buildCetusAddLiquidityTransaction` / `sui_buildCetusRemoveLiquidityTransaction` (official Cetus CLMM SDK unsigned LP tx build)
- `compose`: `sui_buildStableLayerMintTransaction` / `sui_buildStableLayerBurnTransaction` / `sui_buildStableLayerClaimTransaction` (stable-layer-sdk unsigned tx build)
- `execute`: `sui_swapCetus` (Cetus aggregator route + on-chain swap execution on mainnet/testnet)
- `execute`: `sui_cetusAddLiquidity` / `sui_cetusRemoveLiquidity` (official Cetus CLMM SDK LP primitives)
- `execute`: `sui_stableLayerMint` / `sui_stableLayerBurn` / `sui_stableLayerClaim` (stable-layer-sdk execute tools)
- `execute`: `sui_transferSui` (amount in `amountMist` or `amountSui`, with mainnet safety gate `confirmMainnet=true`)
- `execute`: `sui_transferCoin` (non-SUI transfer, auto-merge coin objects, with mainnet safety gate)
- `workflow`: `w3rt_run_sui_workflow_v0` (analysis/simulate/execute with deterministic mainnet confirmToken)
- `workflow`: `w3rt_run_sui_stablelayer_workflow_v0` (analysis/simulate/execute for stable-layer mint/burn/claim with deterministic mainnet confirmToken)
- `rpc`: `sui_rpc` (generic Sui JSON-RPC passthrough with dangerous method safety guard)

## Use As Pi Extension

```ts
import solanaExtension from "pi-chain-tools/pi/solana-extension";

export default solanaExtension;
```

```ts
import suiExtension from "pi-chain-tools/pi/sui-extension";

export default suiExtension;
```

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
