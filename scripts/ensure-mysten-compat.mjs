import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function exists(filePath) {
	try {
		await access(filePath, fsConstants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function toPosix(filePath) {
	return filePath.split(path.sep).join(path.posix.sep);
}

function relativeImport(fromFile, toFile) {
	const fromPosix = toPosix(fromFile);
	const toPosixPath = toPosix(toFile);
	let rel = path.posix.relative(path.posix.dirname(fromPosix), toPosixPath);
	if (!rel.startsWith(".")) rel = `./${rel}`;
	return rel;
}

async function ensureFileAlias(outputFile, sourceFile) {
	if (await exists(outputFile)) return;
	if (!(await exists(sourceFile))) return;

	await mkdir(path.dirname(outputFile), { recursive: true });
	const relImport = relativeImport(outputFile, sourceFile);
	const content = `export * from "${relImport}";\n`;
	await writeFile(outputFile, content, "utf8");
}

async function ensureModuleAlias(distDir, outputSubpath, sourceSubpath) {
	const outputFile = path.join(distDir, outputSubpath, "index.mjs");
	const sourceFile = path.join(distDir, sourceSubpath);
	await ensureFileAlias(outputFile, sourceFile);
}

async function ensureSuiAliases(rootDir) {
	const suiDir = path.join(rootDir, "node_modules", "@mysten", "sui");
	const pkgPath = path.join(suiDir, "package.json");
	if (!(await exists(pkgPath))) return;

	let pkg;
	try {
		pkg = JSON.parse(await readFile(pkgPath, "utf8"));
	} catch {
		return;
	}

	if (typeof pkg?.version !== "string") return;
	const major = Number.parseInt(pkg.version.split(".")[0] ?? "", 10);
	if (!Number.isFinite(major) || major >= 2) return;

	const distDir = path.join(suiDir, "dist");
	const aliases = [
		["transactions", "esm/transactions/index.js"],
		["client", "esm/client/index.js"],
		["utils", "esm/utils/index.js"],
		["bcs", "esm/bcs/index.js"],
		["cryptography", "esm/cryptography/index.js"],
		["faucet", "esm/faucet/index.js"],
		["graphql", "esm/graphql/index.js"],
		["grpc", "esm/grpc/index.js"],
		["jsonRpc", "esm/jsonRpc/index.js"],
		["multisig", "esm/multisig/index.js"],
		["verify", "esm/verify/index.js"],
		["zklogin", "esm/zklogin/index.js"],
		["keypairs/ed25519", "esm/keypairs/ed25519/index.js"],
		["keypairs/secp256k1", "esm/keypairs/secp256k1/index.js"],
		["keypairs/secp256r1", "esm/keypairs/secp256r1/index.js"],
		["keypairs/passkey", "esm/keypairs/passkey/index.js"],
		["graphql/schema", "esm/graphql/schemas/latest/index.js"],
	];

	for (const [outputSubpath, sourceSubpath] of aliases) {
		await ensureModuleAlias(distDir, outputSubpath, sourceSubpath);
	}
}

async function ensureUtilsAliases(rootDir) {
	const utilsDir = path.join(rootDir, "node_modules", "@mysten", "utils");
	const pkgPath = path.join(utilsDir, "package.json");
	if (!(await exists(pkgPath))) return;

	const distDir = path.join(utilsDir, "dist");
	const esmIndex = path.join(distDir, "esm", "index.js");
	const aliases = [
		path.join(distDir, "index.mjs"),
		path.join(utilsDir, "index.mjs"),
	];

	for (const outputFile of aliases) {
		await ensureFileAlias(outputFile, esmIndex);
	}
}

async function main() {
	const scriptDir = path.dirname(fileURLToPath(import.meta.url));
	const rootDir = path.resolve(scriptDir, "..");
	await ensureSuiAliases(rootDir);
	await ensureUtilsAliases(rootDir);
}

await main();
