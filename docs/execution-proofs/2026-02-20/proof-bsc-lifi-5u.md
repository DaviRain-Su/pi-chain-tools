# BSC Live Proof — LI.FI 5U Swap (USDC -> USDT)

- Date: 2026-02-20
- Network: BSC (chainId 56)
- Mode: live autosign
- Wallet: `0x911eeBB64735fC6ea1CAD729893c5956Db2fe939`
- Intent: small-amount production-path validation (5 USDC)

## Transactions

1. Approval (USDC -> LI.FI router)
   - txHash: `0xbb0bb4f22e296df155055497ff67923c46ebf81eabdac4b58c0358d3090a2c3d`
   - Explorer: https://bscscan.com/tx/0xbb0bb4f22e296df155055497ff67923c46ebf81eabdac4b58c0358d3090a2c3d

2. Swap execution (LI.FI route)
   - txHash: `0x3fc8d3cb6402fc1041bc79ba570b31b5269091812be31b1c3231e154fbb6acff`
   - Explorer: https://bscscan.com/tx/0x3fc8d3cb6402fc1041bc79ba570b31b5269091812be31b1c3231e154fbb6acff
   - Block: `82303712`

## LI.FI Tracking

- status: `DONE`
- substatus: `COMPLETED`
- substatusMessage: `The transfer is complete.`
- LI.FI explorer: https://scan.li.fi/tx/0x3fc8d3cb6402fc1041bc79ba570b31b5269091812be31b1c3231e154fbb6acff

## Amounts (from LI.FI status)

- Input token: USDC
- Input amount raw: `5000000` (5 USDC)
- Output token: USDT
- Output amount raw: `4987823` (~4.987823 USDT)
- Fee (LI.FI fixed): `12500` raw USDC

## Notes

- Earlier cross-chain (BSC -> Base) quote attempt for 5U had no valid route due to minimum route constraints.
- This proof validates end-to-end autosign + live broadcast + post-track path on BSC using same-chain LI.FI route.
