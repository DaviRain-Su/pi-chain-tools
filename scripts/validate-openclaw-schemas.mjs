import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const schemaDir = path.join(process.cwd(), "docs", "schemas");
const schemaFiles = [
	"openclaw-btc5m-workflow.schema.json",
	"openclaw-btc5m-runtime-state.schema.json",
	"openclaw-btc5m-retry-policy.schema.json",
];

const args = new Set(process.argv.slice(2));
const isStrict = args.has("--strict");
const isJsonOutput = args.has("--json");
const isListRequested = args.has("--list");
const isListStrict = args.has("--list-strict") || (isListRequested && isStrict);
const isHelpRequested = args.has("--help") || args.has("-h");
const allowedArgs = new Set([
	"--strict",
	"--json",
	"--list",
	"--list-strict",
	"--help",
	"-h",
]);
const unknownArgs = process.argv
	.slice(2)
	.filter((arg) => !allowedArgs.has(arg));

function printUsage() {
	console.log(
		"Usage: node scripts/validate-openclaw-schemas.mjs [--strict] [--json] [--list] [--list-strict] [--help|-h]\n\n" +
			"Validate OpenClaw BTC5m schema artifacts in docs/schemas.\n\n" +
			"Options:\n" +
			"  --strict       print grouped diagnostics + fix guidance. In list mode, also enforces list-strict\n" +
			"  --json         print machine-readable JSON result\n" +
			"  --list         list configured schema files (resolved paths + existence)\n" +
			"  --list-strict  when listing, fail if any configured schema file is missing or not a file\n" +
			"  --help,-h      show this message\n\n" +
			"Files:\n" +
			"  openclaw-btc5m-workflow.schema.json\n" +
			"  openclaw-btc5m-runtime-state.schema.json\n" +
			"  openclaw-btc5m-retry-policy.schema.json\n\n" +
			"npm script helpers:\n" +
			"  npm run schema:check-files         # list schema file manifest (strict, human-readable)\n" +
			"  npm run schema:check-files:json    # list schema file manifest (strict, JSON)\n" +
			"  npm run schema:validate            # full schema content validation\n",
	);
}

const errorGuidance = {
	schema_dir_missing: {
		help: "Initialize/checkout repo with docs/schemas directory present.",
		fix: "Check workflow/CI working directory and repository contents.",
	},
	missing_file: {
		help: "Schema file does not exist.",
		fix: "Add the missing schema file under docs/schemas and ensure it is committed.",
	},
	invalid_json: {
		help: "Schema file is not valid JSON.",
		fix: "Fix JSON syntax (commas, quotes, trailing commas).",
	},
	root_type_invalid: {
		help: "Parsed JSON is not an object schema root.",
		fix: "Use an object as the root schema shape (top-level { ... }).",
	},
	missing_schema_field: {
		help: "Required top-level metadata field is missing/invalid.",
		fix: "Fill in $schema/title/$id with non-empty strings.",
	},
	unresolved_defs_ref: {
		help: "Local $ref points to undefined $defs definition.",
		fix: "Use #/$defs/<name> and ensure target name exists in schema.",
	},
};

/**
 * @typedef {{ code: string; file: string; message: string; detail?: string }} SchemaValidationError
 */

function collectRefs(node, out = []) {
	if (node === null || typeof node !== "object") {
		return out;
	}

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
			continue;
		}
		collectRefs(value, out);
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

function createError(file, code, message, detail) {
	return {
		file,
		code,
		message,
		detail,
	};
}

async function validateFile(fileName) {
	const filePath = path.join(schemaDir, fileName);
	let raw;

	try {
		raw = await readFile(filePath, "utf8");
	} catch {
		return [
			createError(
				fileName,
				"missing_file",
				`missing schema file: ${fileName}`,
				"No such file or directory.",
			),
		];
	}

	let schema;
	try {
		schema = JSON.parse(raw);
	} catch (error) {
		const parseMessage =
			error instanceof Error ? error.message : "Unknown JSON parse error";
		return [
			createError(fileName, "invalid_json", "invalid JSON", parseMessage),
		];
	}

	if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
		return [
			createError(
				fileName,
				"root_type_invalid",
				"root schema must be a JSON object",
			),
		];
	}

	const errors = [];
	if (typeof schema.$schema !== "string" || schema.$schema.length === 0) {
		errors.push(
			createError(
				fileName,
				"missing_schema_field",
				"missing or invalid $schema",
			),
		);
	}
	if (typeof schema.title !== "string" || schema.title.length === 0) {
		errors.push(
			createError(fileName, "missing_schema_field", "missing or invalid title"),
		);
	}
	if (typeof schema.$id !== "string" || schema.$id.length === 0) {
		errors.push(
			createError(fileName, "missing_schema_field", "missing or invalid $id"),
		);
	}

	const refs = collectRefs(schema);
	for (const ref of refs) {
		if (!hasNested(schema, ref)) {
			errors.push(
				createError(
					fileName,
					"unresolved_defs_ref",
					`unresolved local $defs ref ${ref}`,
				),
			);
		}
	}

	return errors;
}

function groupByCode(errors) {
	const grouped = new Map();
	for (const error of errors) {
		if (!grouped.has(error.code)) {
			grouped.set(error.code, []);
		}
		grouped.get(error.code)?.push(error);
	}
	return grouped;
}

function printCompact(errors) {
	for (const error of errors) {
		const suffix = error.detail ? ` (${error.detail})` : "";
		console.error(`SCHEMA_INVALID: ${error.file}: ${error.message}${suffix}`);
	}
}

function printStrict(errors) {
	const grouped = groupByCode(errors);
	const codes = [...grouped.keys()].sort();

	console.error("SCHEMA_VALIDATION_FAILED");
	for (const code of codes) {
		const items = grouped.get(code) ?? [];
		const guidance = errorGuidance[code] ?? {
			help: "Validation failed.",
			fix: "Please inspect and fix the issue first.",
		};

		console.error(`\n[${code}] ${guidance.help}`);
		console.error(`  fix: ${guidance.fix}`);
		for (const item of items) {
			const suffix = item.detail ? ` | ${item.detail}` : "";
			console.error(`  - ${item.file}: ${item.message}${suffix}`);
		}
	}
}

function printJsonOutput(errors) {
	console.error(
		JSON.stringify(
			{
				status: "failed",
				errors,
			},
			null,
			2,
		),
	);
}

async function getSchemaFileList() {
	const items = await Promise.all(
		schemaFiles.map(async (fileName) => {
			const filePath = path.join(schemaDir, fileName);
			try {
				const schemaStat = await stat(filePath);
				return {
					fileName,
					filePath,
					exists: true,
					isFile: schemaStat.isFile(),
					sizeBytes: schemaStat.size,
				};
			} catch {
				return {
					fileName,
					filePath,
					exists: false,
					isFile: false,
					sizeBytes: 0,
				};
			}
		}),
	);
	return items;
}

async function printListOutput() {
	const list = await getSchemaFileList();
	const valid = list.filter((item) => item.exists && item.isFile);
	const invalid = list.filter((item) => !item.exists || !item.isFile);

	const payload = {
		status: isListStrict && invalid.length > 0 ? "failed" : "list",
		summary: {
			totalFiles: list.length,
			existingFiles: valid.length,
			missingFiles: invalid.length,
			allExist: invalid.length === 0,
		},
		files: list,
	};

	if (isJsonOutput) {
		if (invalid.length > 0 && isListStrict) {
			console.log(
				JSON.stringify(
					{
						...payload,
						errors: invalid.map((item) =>
							createError(
								item.fileName,
								"missing_file",
								`invalid schema file: ${item.fileName}`,
								`Expected file at: ${item.filePath}`,
							),
						),
					},
					null,
					2,
				),
			);
			return false;
		}

		console.log(JSON.stringify(payload, null, 2));
		return true;
	}

	console.log("Configured schema files:");
	for (const item of list) {
		const fileState = item.exists
			? item.isFile
				? "(found)"
				: "(not-a-file)"
			: "(missing)";
		console.log(`- ${item.fileName} ${fileState}`);
		console.log(`  path: ${item.filePath}`);
		console.log(`  size: ${item.exists ? `${item.sizeBytes} bytes` : "n/a"}`);
	}
	console.log(`Summary: ${valid.length}/${list.length} files exist.`);

	if (isListStrict && invalid.length > 0) {
		printCompact(
			invalid.map((item) =>
				createError(
					item.fileName,
					"missing_file",
					`invalid schema file: ${item.fileName}`,
					`Expected file at: ${item.filePath}`,
				),
			),
		);
		return false;
	}

	if (isStrict && invalid.length > 0) {
		printStrict(
			invalid.map((item) =>
				createError(
					item.fileName,
					"missing_file",
					`invalid schema file: ${item.fileName}`,
					`Expected file at: ${item.filePath}`,
				),
			),
		);
	}

	return true;
}

async function main() {
	if (isHelpRequested) {
		printUsage();
		return;
	}

	if (unknownArgs.length > 0) {
		console.error(`Unknown options: ${unknownArgs.join(", ")}`);
		printUsage();
		process.exit(1);
	}

	if (isListRequested || isListStrict) {
		const listOk = await printListOutput();
		if (!listOk) {
			process.exit(1);
		}
		return;
	}

	let hasDir = true;
	try {
		await readdir(schemaDir, { withFileTypes: true });
	} catch {
		hasDir = false;
		if (isJsonOutput) {
			printJsonOutput([
				createError(
					"",
					"schema_dir_missing",
					`SCHEMA_DIR_MISSING: ${schemaDir}`,
				),
			]);
		} else {
			console.error(`SCHEMA_DIR_MISSING: ${schemaDir}`);
		}
	}

	if (!hasDir) {
		process.exit(1);
	}

	const errors = [];
	for (const fileName of schemaFiles) {
		errors.push(...(await validateFile(fileName)));
	}

	if (errors.length > 0) {
		if (isJsonOutput) {
			printJsonOutput(errors);
		} else if (isStrict) {
			printStrict(errors);
		} else {
			printCompact(errors);
		}
		process.exit(1);
	}

	if (isJsonOutput) {
		console.log(
			JSON.stringify(
				{
					status: "ok",
					files: schemaFiles,
				},
				null,
				2,
			),
		);
		return;
	}
	console.log("SCHEMA_VALIDATION_OK");
}

await main();
