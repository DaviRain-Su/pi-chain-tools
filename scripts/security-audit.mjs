import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const SEVERITY_RANK = {
	low: 10,
	moderate: 20,
	high: 30,
	critical: 40,
};

function parseArgs(argv) {
	const options = {
		policyPath: "./scripts/security-audit-policy.json",
		auditThreshold: process.env.AUDIT_THRESHOLD ?? null,
	};
	for (let index = 0; index < argv.length; index++) {
		const token = argv[index];
		if (!token) continue;
		if (token === "--policy" || token === "-p") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("--policy requires a file path argument.");
			}
			options.policyPath = value;
			index += 1;
			continue;
		}
		if (token === "--threshold") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("--threshold requires a severity value.");
			}
			options.auditThreshold = value;
			index += 1;
			continue;
		}
		if (token.startsWith("--threshold=")) {
			options.auditThreshold = token.slice("--threshold=".length);
		}
	}
	return options;
}

function isValidSeverity(value) {
	return value in SEVERITY_RANK;
}

function compareSeverity(a, b) {
	return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

function normalizeIgnoreEntry(entry) {
	if (typeof entry === "string") {
		return { maxSeverity: entry };
	}
	if (entry && typeof entry === "object") {
		if (typeof entry.maxSeverity === "string") {
			return { maxSeverity: entry.maxSeverity, reason: entry.reason };
		}
		if (typeof entry.reason === "string") {
			return { maxSeverity: "low", reason: entry.reason };
		}
	}
	return null;
}

function runAudit(threshold) {
	if (!isValidSeverity(threshold)) {
		throw new Error(`Unknown severity '${threshold}'.`);
	}
	const command = `npm audit --omit=dev --json --audit-level=${threshold}`;
	try {
		const output = execSync(command, {
			encoding: "utf8",
			maxBuffer: 5_000_000,
		});
		return JSON.parse(output);
	} catch (error) {
		const stdout = String(error.stdout ?? "");
		if (!stdout) {
			throw error;
		}
		try {
			return JSON.parse(stdout);
		} catch {
			throw error;
		}
	}
}

function formatIssueLines(issue, packageName) {
	return `${packageName} (severity: ${issue.severity}, range: ${issue.range})`;
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	const policy = JSON.parse(readFileSync(options.policyPath, "utf8"));
	if (!policy || typeof policy !== "object") {
		throw new Error(`Invalid policy file: ${options.policyPath}`);
	}
	const threshold =
		options.auditThreshold ??
		(typeof policy.threshold === "string" ? policy.threshold : "high");
	if (!isValidSeverity(threshold)) {
		throw new Error(`Invalid threshold: ${threshold}`);
	}
	const ignoreConfig = policy.ignore ?? {};
	const audit = runAudit(threshold);
	const vulnerabilities = audit.vulnerabilities || {};
	const thresholdRank = SEVERITY_RANK[threshold];
	const disallowed = [];

	for (const [packageName, issue] of Object.entries(vulnerabilities)) {
		if (SEVERITY_RANK[issue.severity] < thresholdRank) {
			continue;
		}
		const entry = normalizeIgnoreEntry(ignoreConfig[packageName]);
		if (!entry) {
			disallowed.push({
				packageName,
				...issue,
			});
			continue;
		}
		if (!isValidSeverity(entry.maxSeverity)) {
			throw new Error(
				`Invalid maxSeverity for ${packageName}: ${entry.maxSeverity}`,
			);
		}
		if (compareSeverity(issue.severity, entry.maxSeverity) > 0) {
			disallowed.push({
				packageName,
				...issue,
				reason: entry.reason,
			});
		}
	}

	if (disallowed.length === 0) {
		console.log("Dependency audit passed with policy allowlist.");
		return;
	}

	console.error(
		`Security audit blocked ${disallowed.length} issue(s) above policy:`,
	);
	for (const issue of disallowed) {
		console.error(`- ${formatIssueLines(issue, issue.packageName)}`);
		if (issue.reason) {
			console.error(`  reason: ${issue.reason}`);
		}
	}
	process.exitCode = 1;
}

main();
