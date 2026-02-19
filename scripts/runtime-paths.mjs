#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const PACKAGE_NAME = "pi-chain-tools";

function isRepoRoot(dirPath) {
	const packagePath = path.join(dirPath, "package.json");
	if (!existsSync(packagePath)) return false;
	try {
		const parsed = JSON.parse(readFileSync(packagePath, "utf8"));
		return parsed?.name === PACKAGE_NAME;
	} catch {
		return false;
	}
}

export function resolveRepoRoot(startDir = process.cwd()) {
	let current = path.resolve(startDir);
	while (true) {
		if (isRepoRoot(current)) return current;
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

export function resolveFromRepo(relativePath, startDir = process.cwd()) {
	const repoRoot = resolveRepoRoot(startDir);
	if (!repoRoot) {
		return {
			repoRoot: null,
			absolutePath: null,
		};
	}
	return {
		repoRoot,
		absolutePath: path.join(repoRoot, relativePath),
	};
}
