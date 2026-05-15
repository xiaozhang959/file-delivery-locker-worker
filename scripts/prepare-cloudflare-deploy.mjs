import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const sourceConfigPath = path.join(root, "wrangler.jsonc");
const generatedConfigPath = path.join(root, ".wrangler", "deploy-wrangler.jsonc");
const wranglerBin = process.platform === "win32" ? "wrangler.cmd" : "wrangler";

const expectedTables = new Set([
	"file_deliveries",
	"delivery_events",
	"cap_challenges",
	"cap_tokens",
	"pickup_pow_failures",
	"pickup_access_tokens",
	"auth_sessions",
	"auth_login_failures",
]);

const requiredFileDeliveryColumns = new Set([
	"id",
	"object_key",
	"storage_key",
	"file_name",
	"content_type",
	"delivery_kind",
	"size",
	"content_hash",
	"pickup_code_hash",
	"manage_code_hash",
	"max_downloads",
	"download_count",
	"expires_at",
	"created_at",
	"deleted_at",
	"deleted_reason",
]);

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});

async function main() {
	const config = await readWranglerConfig(sourceConfigPath);
	const workerName = requireNonEmptyString(config.name, "wrangler.jsonc name");
	const r2Binding = requireFirstBinding(config.r2_buckets, "r2_buckets");
	const d1Binding = requireFirstBinding(config.d1_databases, "d1_databases");
	const bucketName = process.env.CF_R2_BUCKET_NAME || r2Binding.bucket_name || workerName;
	const databaseName = process.env.CF_D1_DATABASE_NAME || d1Binding.database_name || workerName;

	await prepareR2Bucket(bucketName);
	const d1Database = await prepareD1Database(databaseName);

	const generatedConfig = {
		...config,
		$schema: relativeToGeneratedConfig(config.$schema),
		main: relativeToGeneratedConfig(config.main),
		assets: {
			...config.assets,
			directory: relativeToGeneratedConfig(config.assets?.directory),
		},
		r2_buckets: [
			{
				...r2Binding,
				bucket_name: bucketName,
			},
		],
		d1_databases: [
			{
				...d1Binding,
				database_name: databaseName,
				database_id: d1Database.uuid,
				migrations_dir: relativeToGeneratedConfig(d1Binding.migrations_dir),
			},
		],
	};

	await mkdir(path.dirname(generatedConfigPath), { recursive: true });
	await writeFile(generatedConfigPath, `${JSON.stringify(generatedConfig, null, "\t")}\n`);
	console.log(`Generated ${path.relative(root, generatedConfigPath)} with existing or prepared Cloudflare resources.`);
}

async function prepareR2Bucket(bucketName) {
	const bucketsOutput = await wrangler(["r2", "bucket", "list"]);
	if (hasR2Bucket(bucketsOutput, bucketName)) {
		console.log(`R2 bucket "${bucketName}" already exists; using it.`);
		return;
	}

	console.log(`Creating R2 bucket "${bucketName}"...`);
	await wrangler(["r2", "bucket", "create", bucketName]);
}

async function prepareD1Database(databaseName) {
	const existing = await findD1Database(databaseName);
	if (!existing) {
		console.log(`Creating D1 database "${databaseName}"...`);
		await wrangler(["d1", "create", databaseName]);
		const created = await findD1Database(databaseName);
		if (!created) {
			throw new Error(`Created D1 database "${databaseName}", but could not find it in wrangler d1 list.`);
		}
		return created;
	}

	console.log(`D1 database "${databaseName}" already exists; validating schema before reuse.`);
	await validateD1Database(databaseName);
	return existing;
}

async function findD1Database(databaseName) {
	const output = await wrangler(["d1", "list", "--json"]);
	const databases = parseJsonOutput(output, "wrangler d1 list --json");
	const list = Array.isArray(databases) ? databases : databases.result ?? [];
	const found = list.find((database) => database.name === databaseName);
	if (!found) {
		return null;
	}

	const uuid = found.uuid || found.database_id || found.id;
	if (!uuid) {
		throw new Error(`D1 database "${databaseName}" was found, but Wrangler did not return a database id.`);
	}

	return { ...found, uuid };
}

async function validateD1Database(databaseName) {
	const tableRows = await executeD1Json(
		databaseName,
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
	);
	const tableNames = tableRows.map((row) => row.name).filter(Boolean);
	if (tableNames.length === 0) {
		console.log(`D1 database "${databaseName}" is empty; it can be initialized by this project.`);
		return;
	}

	const hasProjectTable = tableNames.some((name) => expectedTables.has(name));
	if (!hasProjectTable) {
		throw new Error(`D1 database "${databaseName}" exists but does not look like a file-delivery-locker database. Found tables: ${tableNames.join(", ")}`);
	}

	const missingTables = [...expectedTables].filter((table) => !tableNames.includes(table));
	if (missingTables.length > 0) {
		throw new Error(`D1 database "${databaseName}" is missing required tables: ${missingTables.join(", ")}`);
	}

	const columnRows = await executeD1Json(databaseName, "PRAGMA table_info(file_deliveries)");
	const columns = new Set(columnRows.map((row) => row.name).filter(Boolean));
	const missingColumns = [...requiredFileDeliveryColumns].filter((column) => !columns.has(column));
	if (missingColumns.length > 0) {
		throw new Error(`D1 database "${databaseName}" has file_deliveries, but is missing required columns: ${missingColumns.join(", ")}`);
	}

	console.log(`D1 database "${databaseName}" schema matches this project.`);
}

async function executeD1Json(databaseName, command) {
	const output = await wrangler(["d1", "execute", databaseName, "--remote", "--json", "--command", command]);
	const parsed = parseJsonOutput(output, `wrangler d1 execute ${databaseName}`);
	const firstResult = Array.isArray(parsed) ? parsed[0] : parsed.result?.[0] ?? parsed.result ?? parsed;
	return firstResult.results ?? firstResult.result ?? [];
}

async function wrangler(args) {
	try {
		const { stdout, stderr } = await execFileAsync(wranglerBin, args, {
			cwd: root,
			env: {
				...process.env,
				CI: "true",
			},
			maxBuffer: 1024 * 1024 * 10,
		});
		if (stderr.trim()) {
			process.stderr.write(stderr);
		}
		return stdout;
	} catch (error) {
		const stdout = error?.stdout ? `\n${error.stdout}` : "";
		const stderr = error?.stderr ? `\n${error.stderr}` : "";
		throw new Error(`wrangler ${args.join(" ")} failed.${stdout}${stderr}`);
	}
}

function hasR2Bucket(output, bucketName) {
	return output
		.split(/\r?\n/)
		.some((line) => line.trim() === bucketName || line.trim().split(/\s+/).includes(bucketName));
}

async function readWranglerConfig(filePath) {
	const raw = await readFile(filePath, "utf8");
	return JSON.parse(stripJsonComments(raw));
}

function stripJsonComments(input) {
	let output = "";
	let inString = false;
	let escaped = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let index = 0; index < input.length; index += 1) {
		const char = input[index];
		const next = input[index + 1];

		if (inLineComment) {
			if (char === "\n") {
				inLineComment = false;
				output += char;
			}
			continue;
		}

		if (inBlockComment) {
			if (char === "*" && next === "/") {
				inBlockComment = false;
				index += 1;
			}
			continue;
		}

		if (!inString && char === "/" && next === "/") {
			inLineComment = true;
			index += 1;
			continue;
		}

		if (!inString && char === "/" && next === "*") {
			inBlockComment = true;
			index += 1;
			continue;
		}

		output += char;

		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === "\"") {
				inString = false;
			}
		} else if (char === "\"") {
			inString = true;
		}
	}

	return output;
}

function parseJsonOutput(output, label) {
	const trimmed = output.trim();
	const start = Math.min(...["[", "{"].map((token) => {
		const index = trimmed.indexOf(token);
		return index === -1 ? Number.POSITIVE_INFINITY : index;
	}));
	if (!Number.isFinite(start)) {
		throw new Error(`${label} did not return JSON output.`);
	}

	return JSON.parse(trimmed.slice(start));
}

function requireFirstBinding(bindings, key) {
	if (!Array.isArray(bindings) || bindings.length === 0) {
		throw new Error(`wrangler.jsonc must define ${key}[0].`);
	}

	return bindings[0];
}

function requireNonEmptyString(value, label) {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${label} must be a non-empty string.`);
	}

	return value.trim();
}

function relativeToGeneratedConfig(value) {
	if (typeof value !== "string" || !value.trim()) {
		return value;
	}

	if (path.isAbsolute(value) || value.startsWith("../")) {
		return value;
	}

	return path.posix.join("..", value.replaceAll("\\", "/"));
}
