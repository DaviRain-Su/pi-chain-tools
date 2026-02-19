# EVM Security Watch Cron Helper

This document provides a safe, suggested cron setup for periodic EVM security scans.

## 1) Local command invocation (recommended first)

```bash
cd /home/davirain/clawd/pi-chain-tools
npm run security:scan:once
```

## 2) Cron example (every 10 minutes)

```cron
*/10 * * * * cd /home/davirain/clawd/pi-chain-tools && /usr/bin/env bash -lc 'npm run security:scan:once >> apps/dashboard/data/security-watch-cron.log 2>&1'
```

Notes:
- Uses single-run mode so cron controls cadence.
- Report JSON is always written to:
  `apps/dashboard/data/security-reports/YYYY-MM-DD/latest.json`
- If a chain RPC env var is missing, scan degrades gracefully and records warn findings.

## 3) Optional OpenClaw reminder payload (systemEvent style)

If you use OpenClaw scheduling/reminder flows, trigger a periodic reminder that asks the agent to run:

- `npm run security:scan:once`
- then summarize `latest.json` findings (`critical/warn/info`).

Suggested reminder text payload:

```text
Run EVM security watch scan once, then summarize findings from apps/dashboard/data/security-reports/<today>/latest.json. Escalate if critical > 0.
```

## 4) Worker mode alternative

If you prefer one long-running process instead of cron:

```bash
npm run security:watch
# optional: node scripts/evm-security-worker.mjs --interval 120
```

For production, run worker mode under a supervisor (systemd/pm2) to auto-restart on host reboot.
