#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { resolveRepoRootFromMetaUrl } from "./runtime-paths.mjs";

const REPO_ROOT = resolveRepoRootFromMetaUrl(import.meta.url) ?? process.cwd();

const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"coverage",
	".next",
	".turbo",
]);

const TOKEN_ASTERDEX = ["As", "ter", "DEX"].join("");
const TOKEN_ASTER_DEX = ["As", "ter", " Dex"].join("");
const TOKEN_ASTER_BNB = ["As", "ter", "/BNB"].join("");
const PATTERNS = [TOKEN_ASTERDEX, TOKEN_ASTER_DEX, TOKEN_ASTER_BNB].map(
	(token) => new RegExp(token, "g"),
);

function isTextBuffer(buffer) {
	for (const byte of buffer) {
		if (byte === 0) return false;
	}
	return true;
}

function countLineCol(text, index) {
	let line = 1;
	let col = 1;
	for (let i = 0; i < index; i += 1) {
		if (text[i] === "\n") {
			line += 1;
			col = 1;
		} else {
			col += 1;
		}
	}
	return { line, col };
}

export async function collectAsterdexMatches(rootDir = REPO_ROOT) {
	const matches = [];

	async function walk(currentDir) {
		const entries = await readdir(currentDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name.startsWith(".git")) continue;
			const fullPath = path.join(currentDir, entry.name);
			const relativePath = path.relative(rootDir, fullPath);
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				await walk(fullPath);
				continue;
			}
			if (!entry.isFile()) continue;
			const fileStat = await stat(fullPath);
			if (fileStat.size > 2 * 1024 * 1024) continue;
			const buffer = await readFile(fullPath);
			if (!isTextBuffer(buffer)) continue;
			const text = buffer.toString("utf8");
			for (const pattern of PATTERNS) {
				pattern.lastIndex = 0;
				for (;;) {
					const m = pattern.exec(text);
					if (!m) break;
					const pos = countLineCol(text, m.index);
					matches.push({
						path: relativePath,
						line: pos.line,
						col: pos.col,
						match: m[0],
					});
				}
			}
		}
	}

	await walk(rootDir);
	return matches;
}

export async function runNoAsterdexGuard(rootDir = REPO_ROOT) {
	const matches = await collectAsterdexMatches(rootDir);
	if (matches.length === 0) {
		console.log(
			`[guard:no-asterdex] PASS (no ${TOKEN_ASTERDEX} residue found)`,
		);
		return { ok: true, matches: [] };
	}
	console.error(`[guard:no-asterdex] FAIL (${TOKEN_ASTERDEX} residue found):`);
	for (const row of matches) {
		console.error(`- ${row.path}:${row.line}:${row.col} -> ${row.match}`);
	}
	return { ok: false, matches };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	runNoAsterdexGuard()
		.then((result) => {
			if (!result.ok) process.exitCode = 1;
		})
		.catch((error) => {
			console.error(
				"[guard:no-asterdex] failed",
				error instanceof Error ? error.message : String(error),
			);
			process.exitCode = 1;
		});
}
