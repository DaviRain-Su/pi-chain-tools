# pi-chain-tools

Multi-chain-ready toolset library for Pi extensions. Solana is implemented, and EVM skeleton is scaffolded, with a chain-agnostic grouping model:

- `read`
- `compose`
- `execute`
- `rpc`

## Structure

- `src/core`: common toolset abstractions and registration helpers
- `src/chains/solana`: Solana runtime + grouped tools
- `src/chains/evm`: EVM runtime + grouped tool skeleton
- `src/pi`: Pi-specific adapter entrypoints

## Solana Tool Groups

- `read`: balance, account info, multiple accounts, blockhash, rent exemption minimum, transaction, signatures, token accounts, token balance
- `compose`: unsigned transfer transaction builders (legacy + v0)
- `execute`: simulate, send, sign+send, confirm, airdrop, transfer
- `rpc`: raw Solana JSON-RPC with safety guard for dangerous methods

## EVM Skeleton

- `read/compose/execute/rpc` group files are created
- no concrete EVM tools are implemented yet
- use `createEvmToolset()` as the extension point for future chains/rpcs/wallets

## Use As Pi Extension

```ts
import solanaExtension from "pi-chain-tools/pi/solana-extension";

export default solanaExtension;
```

## Development

```bash
npm install
npm run check
```

## Future Chains

Add a new chain under `src/chains/<chain>/` and expose a `create<Chain>Toolset()` function.
