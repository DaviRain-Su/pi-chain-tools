#!/usr/bin/env node

const lines = [
	"EVM Security Watch service helper",
	"",
	"1) Prepare env file:",
	"   cp ops/systemd/evm-security-watch.env.example ops/systemd/evm-security-watch.env",
	"   # edit secrets + RPC URLs",
	"",
	"2) Install systemd unit (requires root, run manually):",
	"   sudo cp ops/systemd/evm-security-watch.service /etc/systemd/system/",
	"   sudo systemctl daemon-reload",
	"   sudo systemctl enable --now evm-security-watch.service",
	"",
	"3) Check status/logs:",
	"   systemctl status evm-security-watch.service --no-pager",
	"   journalctl -u evm-security-watch.service -f",
	"",
	"4) Restart after env/config changes:",
	"   sudo systemctl restart evm-security-watch.service",
	"",
	"PM2 (optional):",
	"   pm2 start npm --name evm-security-watch -- run security:watch -- --interval 120",
	"   pm2 save",
	"",
	"Notes:",
	"- worker state is persisted in apps/dashboard/data/security-state.json",
	"- after restart, critical cooldown + warn/info aggregation continue from persisted state",
];

console.log(lines.join("\n"));
