#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_OUT_FILE = "docs/sdk-capability-diff.md";
const DEFAULT_BINDING_PROOF = "docs/sdk-binding-proof.md";
const DEFAULT_COVERAGE_JSON = "docs/sdk-coverage-report.json";
const DEFAULT_READINESS_MD = "docs/sdk-upgrade-readiness.md";
const EXECUTE_MARKERS = [
	"execute",
	"submit",
	"sign",
	"tx",
	"transaction",
	"wallet",
];

function parseArgs(argv = process.argv.slice(2)) {
	const args = {
		out: DEFAULT_OUT_FILE,
		bindingProof: DEFAULT_BINDING_PROOF,
		coverageJson: DEFAULT_COVERAGE_JSON,
		readinessMd: DEFAULT_READINESS_MD,
		upstream: false,
	};
	for (const token of argv) {
		if (token === "--upstream") args.upstream = true;
		else if (token.startsWith("--out=")) args.out = token.slice(6);
		else if (token.startsWith("--binding-proof="))
			args.bindingProof = token.slice("--binding-proof=".length);
		else if (token.startsWith("--coverage-json="))
			args.coverageJson = token.slice("--coverage-json=".length);
		else if (token.startsWith("--readiness-md="))
			args.readinessMd = token.slice("--readiness-md=".length);
	}
	return args;
}

async function readTextSafe(path) {
	try {
		return await readFile(path, "utf8");
	} catch {
		return "";
	}
}

async function readJsonSafe(path) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return null;
	}
}

function parseBindingRows(markdown) {
	const lines = String(markdown || "").split(/\r?\n/);
	const rows = [];
	for (const line of lines) {
		if (!line.startsWith("|")) continue;
		if (line.includes("---")) continue;
		const cols = line
			.split("|")
			.slice(1, -1)
			.map((s) => s.trim());
		if (cols[0] === "Protocol" || cols.length < 6) continue;
		const [protocol, actionPath, npmPackage, source, pathType, blocker] = cols;
		rows.push({
			protocol,
			actionPath,
			npmPackage,
			source,
			pathType,
			blocker: blocker && blocker !== "-" ? blocker : "",
		});
	}
	return rows;
}

function parseReadinessStatuses(markdown) {
	const statuses = new Map();
	for (const line of String(markdown || "").split(/\r?\n/)) {
		if (!line.startsWith("| ")) continue;
		if (line.includes("Package") || line.includes("---")) continue;
		const cols = line
			.split("|")
			.slice(1, -1)
			.map((s) => s.trim());
		if (cols.length < 5) continue;
		statuses.set(cols[0], { status: cols[3], action: cols[4] });
	}
	return statuses;
}

function normalizeToken(value) {
	return String(value || "")
		.toLowerCase()
		.replace(/[`'"()]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function cleanPackageField(value) {
	return String(value || "")
		.replace(/[`']/g, "")
		.split(" ")[0]
		.trim();
}

function findPackageForEntry(entry, bindingRows) {
	const action = normalizeToken(entry.action).split(" ")[0] || "";
	const protocol = normalizeToken(entry.protocol);
	const protocolWords = protocol.split(" ").filter(Boolean);
	const byProtocol = bindingRows.filter((r) => {
		const rp = normalizeToken(r.protocol);
		if (rp.includes(protocol) || protocol.includes(rp)) return true;
		return protocolWords.some((word) => rp.includes(word));
	});
	const row =
		byProtocol.find((r) => normalizeToken(r.actionPath).includes(action)) ||
		byProtocol[0];
	return cleanPackageField(row?.npmPackage) || "unknown";
}

function classifyRecommendation({ mode, blockers, upstreamSignal }) {
	const hasBlockers = blockers.length > 0;
	if (mode === "official-sdk" && !hasBlockers) return "ready";
	if (!hasBlockers && upstreamSignal.hasExecuteHints) return "ready";
	if (mode === "canonical-client" || mode === "native-fallback")
		return "partial";
	return "blocked";
}

function compareVersions(installed, latest) {
	if (!installed || !latest) return "unknown";
	const clean = (v) => String(v).replace(/^[^0-9]*/, "");
	const ia = clean(installed)
		.split(".")
		.map((n) => Number(n) || 0);
	const la = clean(latest)
		.split(".")
		.map((n) => Number(n) || 0);
	for (let i = 0; i < Math.max(ia.length, la.length); i += 1) {
		const left = ia[i] || 0;
		const right = la[i] || 0;
		if (left > right) return "ahead";
		if (left < right) return "behind";
	}
	return "equal";
}

async function fetchNpmSignal(pkg, installedVersion) {
	const url = `https://registry.npmjs.org/${encodeURIComponent(pkg)}`;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5000);
	try {
		const res = await fetch(url, { signal: controller.signal });
		if (!res.ok) {
			return {
				package: pkg,
				available: false,
				unavailableReason: `http-${res.status}`,
			};
		}
		const data = await res.json();
		const latest = data?.["dist-tags"]?.latest || "";
		const readme = String(data?.readme || "").toLowerCase();
		const hasExecuteHints = EXECUTE_MARKERS.some((k) => readme.includes(k));
		return {
			package: pkg,
			available: true,
			latestVersion: latest,
			installedVersion,
			versionDrift: compareVersions(installedVersion, latest),
			hasExecuteHints,
		};
	} catch (error) {
		return {
			package: pkg,
			available: false,
			unavailableReason: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timeout);
	}
}

export async function buildCapabilityDiff({
	bindingProofMd,
	coverageReport,
	readinessMd,
	dependencies,
	upstream = false,
}) {
	const bindingRows = parseBindingRows(bindingProofMd);
	const readiness = parseReadinessStatuses(readinessMd);
	const entries = Array.isArray(coverageReport?.entries)
		? coverageReport.entries
		: [];
	const packageCache = new Map();
	for (const entry of entries) {
		const pkg = findPackageForEntry(entry, bindingRows);
		if (!packageCache.has(pkg)) {
			const installedVersion = dependencies?.[pkg] || "";
			if (upstream && pkg !== "unknown") {
				// eslint-disable-next-line no-await-in-loop
				packageCache.set(pkg, await fetchNpmSignal(pkg, installedVersion));
			} else {
				packageCache.set(pkg, {
					package: pkg,
					available: false,
					unavailableReason: upstream
						? "upstream-check-disabled-for-unknown-package"
						: "upstream-check-disabled",
					hasExecuteHints: false,
					installedVersion,
				});
			}
		}
	}
	const classified = entries.map((entry) => {
		const pkg = findPackageForEntry(entry, bindingRows);
		const blockers = Array.isArray(entry.blockers)
			? entry.blockers.filter(Boolean)
			: [];
		const upstreamSignal = packageCache.get(pkg) || {
			package: pkg,
			available: false,
			unavailableReason: "upstream-check-unavailable",
			hasExecuteHints: false,
		};
		const recommendation = classifyRecommendation({
			mode: entry.currentMode,
			blockers,
			upstreamSignal,
		});
		const readinessHint = readiness.get(pkg);
		const nextCheck =
			recommendation === "ready"
				? `npm run sdk:upgrade-readiness && npm run sdk:capability-diff${upstream ? " -- --upstream" : ""}`
				: recommendation === "partial"
					? `npm run sdk:upgrade-readiness && rg -n \"${entry.codeMarkers?.[0] || "detector_hook"}\" apps src`
					: "npm install && npm run sdk:upgrade-readiness";
		return {
			protocol: entry.protocol,
			action: entry.action,
			endpoint: entry.endpoint,
			package: pkg,
			currentMode: entry.currentMode,
			blockers,
			upstreamSignal,
			readinessHint,
			recommendation,
			nextCheck,
		};
	});
	return classified.sort((a, b) =>
		`${a.protocol}:${a.action}`.localeCompare(`${b.protocol}:${b.action}`),
	);
}

export function renderCapabilityDiffMarkdown(
	rows,
	{ generatedAt, upstreamEnabled },
) {
	const lines = [
		"# SDK Capability Diff",
		"",
		`Generated at: ${generatedAt}`,
		`Upstream check: ${upstreamEnabled ? "enabled" : "disabled"}`,
		"",
		"| Protocol | Action | Package | Mode | Recommendation |",
		"|---|---|---|---|---|",
		...rows.map(
			(row) =>
				`| ${row.protocol} | ${row.action} | ${row.package} | ${row.currentMode} | ${row.recommendation} |`,
		),
		"",
		"## Detailed Classification",
		"",
	];
	for (const row of rows) {
		lines.push(`### ${row.protocol} · ${row.action}`);
		lines.push("");
		lines.push(`- endpoint: \`${row.endpoint}\``);
		lines.push(
			`- current protocol/action binding mode: \`${row.currentMode}\``,
		);
		lines.push(
			`- declared blockers: ${row.blockers.length ? row.blockers.map((b) => `\`${b}\``).join("; ") : "none"}`,
		);
		if (row.upstreamSignal.available) {
			lines.push(
				`- detected upstream signals: package=\`${row.package}\`, installed=\`${row.upstreamSignal.installedVersion || "n/a"}\`, latest=\`${row.upstreamSignal.latestVersion || "n/a"}\`, versionDrift=\`${row.upstreamSignal.versionDrift || "unknown"}\`, apiHints=\`${row.upstreamSignal.hasExecuteHints ? "execute-surface-marker-detected" : "none"}\``,
			);
		} else {
			lines.push(
				`- detected upstream signals: upstream check unavailable (reason: \`${row.upstreamSignal.unavailableReason || "unknown"}\`)`,
			);
		}
		if (row.readinessHint) {
			lines.push(
				`- readiness hint: status=\`${row.readinessHint.status}\`, action=\`${row.readinessHint.action}\``,
			);
		}
		lines.push(`- promotion recommendation: **${row.recommendation}**`);
		lines.push(`- suggested next command/check: \`${row.nextCheck}\``);
		lines.push("");
	}
	return `${lines.join("\n")}\n`;
}

async function main() {
	const args = parseArgs();
	const [bindingProofMd, coverageReport, readinessMd, packageJson] =
		await Promise.all([
			readTextSafe(args.bindingProof),
			readJsonSafe(args.coverageJson),
			readTextSafe(args.readinessMd),
			readJsonSafe("package.json"),
		]);
	const rows = await buildCapabilityDiff({
		bindingProofMd,
		coverageReport,
		readinessMd,
		dependencies: packageJson?.dependencies || {},
		upstream: args.upstream,
	});
	const generatedAt =
		process.env.SDK_CAPABILITY_DIFF_NOW || new Date().toISOString();
	const markdown = renderCapabilityDiffMarkdown(rows, {
		generatedAt,
		upstreamEnabled: args.upstream,
	});
	await writeFile(args.out, markdown, "utf8");
	console.log(`wrote ${args.out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.stack : String(error));
		process.exit(1);
	});
}
