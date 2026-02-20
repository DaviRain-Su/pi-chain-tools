# BSC Live Proof — LI.FI 5 USDC Swap (USDC -> USDT)

- Date: 2026-02-20
- Network: BSC (chainId 56)
- Mode: live autosign
- Wallet: `0x911eeBB64735fC6ea1CAD729893c5956Db2fe939`
- Intent: real 5 USDC production-path validation

## Precision Correction

BSC USDC uses **18 decimals** (not 6).  
So true 5 USDC is:
- raw amount: `5000000000000000000`

A prior test used `5000000` raw and is recorded as an invalid precision attempt.

## Final Valid Transactions (Corrected 5 USDC)

1. Approval (USDC -> LI.FI router)
   - txHash: `0x010a8dadf04bc172e8a4de13eb6c3987c1ffd1ab5ebffc3cdf183b3d931b87c8`
   - Explorer: https://bscscan.com/tx/0x010a8dadf04bc172e8a4de13eb6c3987c1ffd1ab5ebffc3cdf183b3d931b87c8

2. Swap execution (LI.FI route)
   - txHash: `0x9ff4a2fd723e85a9e85bcfe7c4962b5df980134fb49580ae4a3096590013b639`
   - Explorer: https://bscscan.com/tx/0x9ff4a2fd723e85a9e85bcfe7c4962b5df980134fb49580ae4a3096590013b639
   - Block: `82304620`

## LI.FI Tracking (Corrected Run)

- status: `DONE`
- substatus: `COMPLETED`
- LI.FI explorer: https://scan.li.fi/tx/0x9ff4a2fd723e85a9e85bcfe7c4962b5df980134fb49580ae4a3096590013b639

## Amounts (from LI.FI status)

- Input token: USDC
- Input amount raw: `5000000000000000000` (~5 USDC)
- Output token: USDT
- Output amount raw: `4989055543665897472` (~4.989055543665897472 USDT)

## Notes

- Earlier cross-chain (BSC -> Base) quote attempt for 5U had no valid route due to minimum route constraints.
- Same-chain BSC route is used here to validate end-to-end autosign + live broadcast + post-track.
