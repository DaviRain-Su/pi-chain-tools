import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";

const schemaDir = path.join(process.cwd(), "docs", "schemas");
const schemaFiles = [
	"openclaw-btc5m-workflow.schema.json",
	"openclaw-btc5m-runtime-state.schema.json",
	"openclaw-btc5m-retry-policy.schema.json",
];

function collectRefs(node, out = []) {
	if (node === null || typeof node !== "object") return out;

	if (Array.isArray(node)) {
		for (const item of node) {
			collectRefs(item, out);
		}
		return out;
	}

	for (const [key, value] of Object.entries(node)) {
		if (
			key === "$ref" &&
			typeof value === "string" &&
			value.startsWith("#/$defs/")
		) {
			out.push(value);
		} else {
			collectRefs(value, out);
		}
	}

	return out;
}

function hasNested(schema, ref) {
	if (!ref.startsWith("#/$defs/")) {
		return false;
	}

	const segments = ref
		.slice("#/$defs/".length)
		.split("/")
		.filter((segment) => segment.length > 0);

	if (segments.length === 0) {
		return false;
	}

	let cursor = schema?.$defs;
	if (typeof cursor !== "object" || cursor === null) {
		return false;
	}

	for (const segment of segments) {
		if (!Object.prototype.hasOwnProperty.call(cursor, segment)) {
			return false;
		}
		cursor = cursor[segment];
		if (
			cursor === null ||
			(typeof cursor !== "object" && !Array.isArray(cursor))
		) {
			return false;
		}
	}

	return true;
}

async function validateFile(fileName) {
	const filePath = path.join(schemaDir, fileName);
	const raw = await readFile(filePath, "utf8");
	let schema;

	try {
		schema = JSON.parse(raw);
	} catch {
		return [`${fileName}: invalid JSON`];
	}

	if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
		return [`${fileName}: root schema must be a JSON object`];
	}

	const errors = [];
	if (typeof schema.$schema !== "string" || schema.$schema.length === 0) {
		errors.push(`${fileName}: missing or invalid $schema`);
	}
	if (typeof schema.title !== "string" || schema.title.length === 0) {
		errors.push(`${fileName}: missing or invalid title`);
	}
	if (typeof schema.$id !== "string" || schema.$id.length === 0) {
		errors.push(`${fileName}: missing or invalid $id`);
	}

	const refs = collectRefs(schema);
	for (const ref of refs) {
		if (!hasNested(schema, ref)) {
			errors.push(`${fileName}: unresolved local $defs ref ${ref}`);
		}
	}

	return errors;
}

async function main() {
	try {
		const dirEntries = await readdir(schemaDir, { withFileTypes: true });
		const existingFiles = new Set(
			dirEntries.filter((entry) => entry.isFile()).map((entry) => entry.name),
		);

		for (const target of schemaFiles) {
			if (!existingFiles.has(target)) {
				console.error(`MISSING: ${target}`);
				process.exitCode = 1;
			}
		}
	} catch {
		console.error(`SCHEMA_DIR_MISSING: ${schemaDir}`);
		process.exit(1);
	}

	const errors = [];
	for (const fileName of schemaFiles) {
		const fileErrors = await validateFile(fileName);
		errors.push(...fileErrors);
	}

	if (errors.length > 0) {
		for (const err of errors) {
			console.error(`SCHEMA_INVALID: ${err}`);
		}
		process.exit(1);
	}

	console.log("SCHEMA_VALIDATION_OK");
}

await main();
