#!/usr/bin/env node

const BASE_URL = process.env.DASHBOARD_BASE_URL || "http://127.0.0.1:4173";

function parseArgs(argv) {
	const args = {
		originChain: process.env.BRIDGE_SMOKE_ORIGIN_CHAIN || "bsc",
		destinationChain: process.env.BRIDGE_SMOKE_DEST_CHAIN || "solana",
		tokenIn: process.env.BRIDGE_SMOKE_TOKEN_IN || "USDC",
		tokenOut: process.env.BRIDGE_SMOKE_TOKEN_OUT || "USDC",
		amount: process.env.BRIDGE_SMOKE_AMOUNT || "1",
		recipient:
			process.env.BRIDGE_SMOKE_RECIPIENT ||
			"FM7WTd5Hr7ppp6vu3M4uAspF4DoRjrYPPFvAmqB7H95D",
		timeoutMs: Number.parseInt(
			process.env.BRIDGE_SMOKE_TIMEOUT_MS || "20000",
			10,
		),
	};

	for (let i = 0; i < argv.length; i += 1) {
		const item = argv[i];
		if (item === "--origin" && argv[i + 1])
			args.originChain = String(argv[++i]);
		if (item === "--dest" && argv[i + 1])
			args.destinationChain = String(argv[++i]);
		if (item === "--token-in" && argv[i + 1]) args.tokenIn = String(argv[++i]);
		if (item === "--token-out" && argv[i + 1])
			args.tokenOut = String(argv[++i]);
		if (item === "--amount" && argv[i + 1]) args.amount = String(argv[++i]);
		if (item === "--recipient" && argv[i + 1])
			args.recipient = String(argv[++i]);
		if (item === "--timeout" && argv[i + 1]) {
			args.timeoutMs = Number.parseInt(String(argv[++i]), 10);
		}
	}
	return args;
}

async function requestJson(method, path, body, timeoutMs) {
	const startedAt = Date.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${BASE_URL}${path}`, {
			method,
			headers: { "content-type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
			signal: controller.signal,
		});
		const text = await response.text();
		let data;
		try {
			data = JSON.parse(text);
		} catch {
			data = { raw: text };
		}
		return {
			ok: response.ok,
			status: response.status,
			elapsedMs: Date.now() - startedAt,
			data,
		};
	} catch (error) {
		return {
			ok: false,
			status: 0,
			elapsedMs: Date.now() - startedAt,
			data: {
				error: error instanceof Error ? error.message : String(error),
			},
		};
	} finally {
		clearTimeout(timer);
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const readiness = await requestJson(
		"GET",
		"/api/crosschain/debridge/readiness",
		null,
		args.timeoutMs,
	);
	const plan = await requestJson(
		"POST",
		"/api/crosschain/debridge/plan",
		{
			originChain: args.originChain,
			destinationChain: args.destinationChain,
			tokenIn: args.tokenIn,
			tokenOut: args.tokenOut,
			amount: args.amount,
			recipient: args.recipient,
		},
		args.timeoutMs,
	);
	const quote = await requestJson(
		"POST",
		"/api/crosschain/debridge/quote",
		{
			originChain: args.originChain,
			destinationChain: args.destinationChain,
			tokenIn: args.tokenIn,
			tokenOut: args.tokenOut,
			amount: args.amount,
			recipient: args.recipient,
		},
		args.timeoutMs,
	);

	const output = {
		ok: readiness.ok && plan.ok && quote.ok,
		baseUrl: BASE_URL,
		params: args,
		steps: {
			readiness: {
				ok: readiness.ok,
				status: readiness.status,
				elapsedMs: readiness.elapsedMs,
				canExecute: readiness.data?.canExecute ?? null,
				quoteTimeoutMs: readiness.data?.quoteTimeoutMs ?? null,
				blockers: readiness.data?.blockers ?? null,
			},
			plan: {
				ok: plan.ok,
				status: plan.status,
				elapsedMs: plan.elapsedMs,
				mode: plan.data?.mode ?? null,
				blockers: plan.data?.blockers ?? null,
				executeBlockers: plan.data?.executeBlockers ?? null,
			},
			quote: {
				ok: quote.ok,
				status: quote.status,
				elapsedMs: quote.elapsedMs,
				error: quote.data?.error ?? null,
				category: quote.data?.category ?? null,
				retryable: quote.data?.retryable ?? null,
			},
		},
	};

	console.log(JSON.stringify(output, null, 2));
	process.exit(output.ok ? 0 : 1);
}

await main();
