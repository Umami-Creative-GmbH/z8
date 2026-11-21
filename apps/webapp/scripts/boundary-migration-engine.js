import { spawnSync as nodeSpawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { readMigrationFiles } from "drizzle-orm/migrator";

const RETRYABLE_SQLSTATES = new Set(["55P03", "57014"]);
const RETRYABLE_OUTPUT_PATTERN =
	/\b(?:55P03|57014|lock_not_available|canceling statement due to (?:lock|statement) timeout)\b/i;

export const DEFAULT_MIGRATION_LOCK_RETRIES = 20;
export const DEFAULT_BACKFILL_CHUNK_SIZE = 1000;

/**
 * Pre-0318 concurrent unique indexes attached via `UNIQUE USING INDEX` in 0318 and 0320.
 * `team` already has `team_id_organizationId_idx` from 0014 — zero DDL on `team`.
 */
export const PRE_0318_CONCURRENT_INDEXES = Object.freeze([
	Object.freeze({
		schema: "public",
		tableName: "work_policy",
		indexName: "work_policy_id_org_uidx",
		columns: Object.freeze(["id", "organization_id"]),
		requiredBeforePrefix: 318,
	}),
	Object.freeze({
		schema: "public",
		tableName: "employee_employment_history",
		indexName: "employee_employment_history_id_org_uidx",
		columns: Object.freeze(["id", "organization_id"]),
		requiredBeforePrefix: 320,
	}),
]);

/**
 * Pre-0324 concurrent unique indexes used by Phase 2 policy-version constraints (#1926).
 */
export const PRE_0324_CONCURRENT_INDEXES = Object.freeze([
	Object.freeze({
		schema: "public",
		tableName: "work_policy_schedule",
		indexName: "work_policy_schedule_version_uidx",
		columns: Object.freeze(["policy_version_id"]),
		requiredBeforePrefix: 324,
	}),
	Object.freeze({
		schema: "public",
		tableName: "work_policy_schedule",
		indexName: "work_policy_schedule_id_version_uidx",
		columns: Object.freeze(["id", "policy_version_id"]),
		requiredBeforePrefix: 324,
	}),
	Object.freeze({
		schema: "public",
		tableName: "work_policy_presence",
		indexName: "work_policy_presence_version_uidx",
		columns: Object.freeze(["policy_version_id"]),
		requiredBeforePrefix: 324,
	}),
	Object.freeze({
		schema: "public",
		tableName: "work_policy_regulation",
		indexName: "work_policy_regulation_version_uidx",
		columns: Object.freeze(["policy_version_id"]),
		requiredBeforePrefix: 324,
	}),
	Object.freeze({
		schema: "public",
		tableName: "work_policy_regulation",
		indexName: "work_policy_regulation_id_version_uidx",
		columns: Object.freeze(["id", "policy_version_id"]),
		requiredBeforePrefix: 324,
	}),
	Object.freeze({
		schema: "public",
		tableName: "work_policy_break_rule",
		indexName: "work_policy_break_rule_id_version_uidx",
		columns: Object.freeze(["id", "policy_version_id"]),
		requiredBeforePrefix: 324,
	}),
]);

function quoteIdentifier(identifier) {
	return `"${String(identifier).replaceAll('"', '""')}"`;
}

export function parseDrainGateConfig(env = process.env) {
	const retriesRaw = env.DB_MIGRATION_LOCK_RETRIES ?? String(DEFAULT_MIGRATION_LOCK_RETRIES);
	if (!/^\d+$/.test(String(retriesRaw).trim())) {
		throw new Error(
			`DB_MIGRATION_LOCK_RETRIES must be a non-negative integer; received "${retriesRaw}".`,
		);
	}
	const lockRetries = Number.parseInt(String(retriesRaw).trim(), 10);
	if (!Number.isSafeInteger(lockRetries) || lockRetries < 0) {
		throw new Error(
			`DB_MIGRATION_LOCK_RETRIES must be a non-negative integer; received "${retriesRaw}".`,
		);
	}

	return {
		allowContractConstraints: env.DB_ALLOW_CONTRACT_CONSTRAINTS === "true",
		allowPolicyV1Seal: env.DB_ALLOW_POLICY_V1_SEAL === "true",
		lockRetries,
	};
}

export function extractPostgresErrorCode(error) {
	if (!error || typeof error !== "object") return null;
	if (typeof error.code === "string" && error.code.length > 0) {
		return error.code;
	}
	if (error.cause && typeof error.cause === "object") {
		return extractPostgresErrorCode(error.cause);
	}
	return null;
}

export function isRetryableLockOrTimeoutError(error) {
	const code = extractPostgresErrorCode(error);
	return code !== null && RETRYABLE_SQLSTATES.has(code);
}

function computeJitteredBackoffMs(attempt, baseDelayMs, maxDelayMs, random = Math.random) {
	const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.min(attempt, 10));
	const floor = Math.max(1, Math.floor(ceiling * 0.5));
	return floor + Math.floor(random() * (ceiling - floor + 1));
}

export async function withLockTimeoutRetry(operation, options = {}) {
	const {
		stepName = "migration-step",
		maxRetries = DEFAULT_MIGRATION_LOCK_RETRIES,
		baseDelayMs = 150,
		maxDelayMs = 2000,
		sleep = (ms) => delay(ms),
		random = Math.random,
		logger = console,
	} = options;

	let attempt = 0;
	for (;;) {
		try {
			return await operation(attempt);
		} catch (error) {
			if (!isRetryableLockOrTimeoutError(error) || attempt >= maxRetries) {
				throw error;
			}
			const sqlstate = extractPostgresErrorCode(error);
			const waitMs = computeJitteredBackoffMs(attempt, baseDelayMs, maxDelayMs, random);
			attempt += 1;
			logger.warn?.(
				`[migration] Step "${stepName}" hit SQLSTATE ${sqlstate}; retry ${attempt}/${maxRetries} after ${waitMs}ms`,
			);
			await sleep(waitMs);
		}
	}
}

/**
 * Runs a child command (such as DRIZZLE_MIGRATE_COMMAND), mirroring stdout/stderr
 * while retrying on SQLSTATE 55P03 / 57014 with jittered backoff.
 */
export async function runCommandWithLockRetry(commandSpec, options = {}) {
	const {
		stepName = "migrate-command",
		maxRetries = DEFAULT_MIGRATION_LOCK_RETRIES,
		baseDelayMs = 150,
		maxDelayMs = 2000,
		sleep = (ms) => delay(ms),
		random = Math.random,
		spawnSyncImpl = nodeSpawnSync,
		stdoutWrite = (chunk) => process.stdout.write(chunk),
		stderrWrite = (chunk) => process.stderr.write(chunk),
		env = process.env,
		cwd = process.cwd(),
		logger = console,
	} = options;

	let attempt = 0;
	for (;;) {
		const result = spawnSyncImpl(commandSpec.command, commandSpec.args, {
			shell: commandSpec.shell,
			env,
			cwd,
			encoding: "utf8",
			stdio: "pipe",
		});

		const stdoutText = typeof result.stdout === "string" ? result.stdout : "";
		const stderrText = typeof result.stderr === "string" ? result.stderr : "";

		if (stdoutText.length > 0) stdoutWrite(stdoutText);
		if (stderrText.length > 0) stderrWrite(stderrText);

		if (result.status === 0 && !result.error) {
			return result;
		}

		const combinedOutput = `${stderrText}\n${stdoutText}`;
		const retryable = RETRYABLE_OUTPUT_PATTERN.test(combinedOutput);
		if (!retryable || attempt >= maxRetries) {
			throw new Error(`Migration command failed with exit code ${result.status ?? "unknown"}.`, {
				cause: result.error,
			});
		}

		const waitMs = computeJitteredBackoffMs(attempt, baseDelayMs, maxDelayMs, random);
		attempt += 1;
		logger.warn?.(
			`[migration] Command "${stepName}" hit retryable lock/timeout error; retry ${attempt}/${maxRetries} after ${waitMs}ms`,
		);
		await sleep(waitMs);
	}
}

export function parseMigrationPrefix(tag) {
	const match = /^(\d+)_/.exec(String(tag));
	if (!match) {
		throw new Error(`Invalid migration tag "${tag}": expected NNNN_ prefix.`);
	}
	return Number.parseInt(match[1], 10);
}

export function readJournaledMigrations(migrationsFolder) {
	const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
	const journal = JSON.parse(readFileSync(journalPath, "utf8"));
	const loaded = readMigrationFiles({ migrationsFolder });
	if (journal.entries.length !== loaded.length) {
		throw new Error(
			`Journal entry count (${journal.entries.length}) does not match loaded migrations (${loaded.length}).`,
		);
	}

	return journal.entries.map((entry, index) => ({
		tag: entry.tag,
		prefix: parseMigrationPrefix(entry.tag),
		when: entry.when,
		folderMillis: loaded[index].folderMillis,
		hash: loaded[index].hash,
		sql: loaded[index].sql,
		bps: loaded[index].bps,
	}));
}

function stageIdForPrefix(prefix) {
	if (prefix <= 317) return "historical_prefix_0000_0317";
	if (prefix <= 321) return "phase1_expand_0318_0321";
	if (prefix === 322) return "phase2_0322";
	if (prefix === 323) return "phase2_0323";
	if (prefix === 324) return "phase2_0324";
	if (prefix === 325) return "phase2_0325";
	if (prefix === 326) return "phase2_0326";
	if (prefix === 327) return "phase2_0327";
	return "post_0327";
}

/**
 * Groups ordered migrations into isolated transaction stages so historical
 * 0000-0317, 0318-0321, 0322, 0323, 0324, 0325, 0326, 0327, and >0327 never
 * share a PostgreSQL transaction across boundaries.
 */
export function buildMigrationStagePlan(migrations) {
	const stages = [];
	for (const migration of migrations) {
		const stageId = stageIdForPrefix(migration.prefix);
		const current = stages[stages.length - 1];
		if (current && current.id === stageId) {
			current.migrations.push(migration);
		} else {
			stages.push({ id: stageId, migrations: [migration] });
		}
	}
	return stages;
}

const INSPECT_UNIQUE_INDEX_SQL = `
SELECT
	idx.oid AS index_oid,
	ns.nspname AS index_schema,
	idx.relname AS index_name,
	idx.relkind AS index_relkind,
	tbl_ns.nspname AS table_schema,
	tbl.relname AS table_name,
	am.amname AS access_method,
	i.indisunique,
	i.indimmediate,
	i.indnullsnotdistinct,
	i.indisvalid,
	i.indisready,
	i.indnkeyatts,
	i.indnatts,
	(i.indexprs IS NOT NULL) AS has_expressions,
	(i.indpred IS NOT NULL) AS is_partial,
	COALESCE(
		(
			SELECT json_agg(
				json_build_object(
					'pos', k.pos,
					'attnum', k.attnum,
					'attname', a.attname,
					'indoption', opt.val,
					'indcollation', col.val,
					'attcollation', a.attcollation,
					'opclass_oid', cls.val,
					'opclass_name', opc.opcname,
					'opclass_is_default', opc.opcdefault
				)
				ORDER BY k.pos
			)
			FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, pos)
			LEFT JOIN pg_attribute a
				ON a.attrelid = i.indrelid AND a.attnum = k.attnum
			LEFT JOIN unnest(i.indoption::int2[]) WITH ORDINALITY AS opt(val, pos)
				ON opt.pos = k.pos
			LEFT JOIN unnest(i.indcollation::oid[]) WITH ORDINALITY AS col(val, pos)
				ON col.pos = k.pos
			LEFT JOIN unnest(i.indclass::oid[]) WITH ORDINALITY AS cls(val, pos)
				ON cls.pos = k.pos
			LEFT JOIN pg_opclass opc
				ON opc.oid = cls.val
		),
		'[]'::json
	) AS key_columns
FROM pg_class idx
JOIN pg_namespace ns ON ns.oid = idx.relnamespace
LEFT JOIN pg_index i ON i.indexrelid = idx.oid
LEFT JOIN pg_class tbl ON tbl.oid = i.indrelid
LEFT JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
LEFT JOIN pg_am am ON am.oid = idx.relam
WHERE ns.nspname = $1
	AND idx.relname = $2
`;

/**
 * Evaluates full PostgreSQL 16 `UNIQUE USING INDEX` attachability rules:
 * - owning table (schema + tableName)
 * - btree access method
 * - indisunique = true
 * - indimmediate = true
 * - indnullsnotdistinct = false
 * - non-expression (indexprs IS NULL)
 * - non-partial (indpred IS NULL)
 * - exact ordered indkey (indnkeyatts == indnatts == expected columns length)
 * - default sort ordering (indoption = 0, rejecting DESC / NULLS FIRST)
 * - default operator class (opcdefault = true)
 * - column collation (indcollation = attcollation)
 * - indisvalid = true (rebuilds invalid structural matches via DROP INDEX CONCURRENTLY)
 */
export function evaluateUniqueIndexAttachability(row, spec) {
	if (!row) {
		return { status: "missing", reasons: [] };
	}

	const expectedSchema = spec.schema ?? "public";
	const expectedColumns = spec.columns;
	const structuralReasons = [];

	if (row.index_relkind !== "i") {
		structuralReasons.push(
			`relation "${expectedSchema}"."${spec.indexName}" is relkind "${row.index_relkind}", expected index ("i")`,
		);
	}
	if (row.table_schema !== expectedSchema || row.table_name !== spec.tableName) {
		structuralReasons.push(
			`owning table is "${row.table_schema ?? "unknown"}"."${row.table_name ?? "unknown"}", expected "${expectedSchema}"."${spec.tableName}"`,
		);
	}
	if (row.access_method !== "btree") {
		structuralReasons.push(
			`access method is "${row.access_method ?? "unknown"}", expected "btree"`,
		);
	}
	if (row.indisunique !== true) {
		structuralReasons.push("indisunique is false (must be unique)");
	}
	if (row.indimmediate !== true) {
		structuralReasons.push(
			"indimmediate is false (deferrable index cannot back UNIQUE USING INDEX)",
		);
	}
	if (row.indnullsnotdistinct !== false) {
		structuralReasons.push("indnullsnotdistinct is true (must be false)");
	}
	if (row.has_expressions !== false) {
		structuralReasons.push("index contains expressions (indexprs IS NOT NULL)");
	}
	if (row.is_partial !== false) {
		structuralReasons.push("index is partial (indpred IS NOT NULL)");
	}

	const keyColumns = Array.isArray(row.key_columns) ? row.key_columns : [];
	if (
		Number(row.indnkeyatts) !== expectedColumns.length ||
		Number(row.indnatts) !== expectedColumns.length ||
		keyColumns.length !== expectedColumns.length
	) {
		structuralReasons.push(
			`column count mismatch: indnkeyatts=${row.indnkeyatts}, indnatts=${row.indnatts}, expected ${expectedColumns.length} (${expectedColumns.join(", ")})`,
		);
	} else {
		for (let i = 0; i < expectedColumns.length; i += 1) {
			const expectedCol = expectedColumns[i];
			const actual = keyColumns[i];
			if (!actual || Number(actual.attnum) <= 0 || actual.attname !== expectedCol) {
				structuralReasons.push(
					`key column #${i + 1} is "${actual?.attname ?? "expression"}", expected "${expectedCol}"`,
				);
				continue;
			}
			if (Number(actual.indoption) !== 0) {
				structuralReasons.push(
					`column "${expectedCol}" has non-default sort ordering (indoption=${actual.indoption}, expected 0 ASC NULLS LAST)`,
				);
			}
			if (actual.opclass_is_default !== true) {
				structuralReasons.push(
					`column "${expectedCol}" uses non-default operator class "${actual.opclass_name ?? "unknown"}"`,
				);
			}
			if (String(actual.indcollation) !== String(actual.attcollation)) {
				structuralReasons.push(
					`column "${expectedCol}" uses collation ${actual.indcollation}, expected column collation ${actual.attcollation}`,
				);
			}
		}
	}

	if (structuralReasons.length > 0) {
		return { status: "incompatible", reasons: structuralReasons };
	}

	if (row.indisvalid !== true) {
		return {
			status: "rebuild_invalid",
			reasons: ["index is invalid (indisvalid = false)"],
		};
	}

	return { status: "attachable", reasons: [] };
}

export async function inspectUniqueIndexAttachability(client, spec) {
	const schema = spec.schema ?? "public";
	const result = await client.query(INSPECT_UNIQUE_INDEX_SQL, [schema, spec.indexName]);
	const row = result.rows[0] ?? null;
	return {
		row,
		evaluation: evaluateUniqueIndexAttachability(row, spec),
	};
}

/**
 * Ensures a non-transactional `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS`
 * index exists and satisfies every PostgreSQL 16 `UNIQUE USING INDEX` rule.
 * Rebuilds structurally matching invalid indexes via `DROP INDEX CONCURRENTLY`;
 * aborts without dropping or advancing the ledger on any incompatible index.
 */
export async function ensureAttachableUniqueIndex(client, spec, retryOptions = {}) {
	const schema = spec.schema ?? "public";
	const quotedSchema = quoteIdentifier(schema);
	const quotedIndex = quoteIdentifier(spec.indexName);
	const quotedTable = quoteIdentifier(spec.tableName);
	const quotedColumns = spec.columns.map(quoteIdentifier).join(", ");

	const initial = await inspectUniqueIndexAttachability(client, spec);
	if (initial.evaluation.status === "attachable") {
		return { action: "reused", indexName: spec.indexName };
	}

	if (initial.evaluation.status === "incompatible") {
		throw new Error(
			`Refusing to attach or drop incompatible existing index "${schema}"."${spec.indexName}" on "${schema}"."${spec.tableName}" (${spec.columns.join(", ")}): ${initial.evaluation.reasons.join("; ")}`,
		);
	}

	let rebuilt = false;
	if (initial.evaluation.status === "rebuild_invalid") {
		rebuilt = true;
		await withLockTimeoutRetry(
			async () => {
				await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${quotedSchema}.${quotedIndex}`);
			},
			{ ...retryOptions, stepName: `drop-invalid-index:${spec.indexName}` },
		);
	}

	await withLockTimeoutRetry(
		async () => {
			await client.query(
				`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${quotedIndex} ON ${quotedSchema}.${quotedTable} (${quotedColumns})`,
			);
		},
		{ ...retryOptions, stepName: `create-index-concurrently:${spec.indexName}` },
	);

	const verified = await inspectUniqueIndexAttachability(client, spec);
	if (verified.evaluation.status !== "attachable") {
		throw new Error(
			`Index "${schema}"."${spec.indexName}" failed PostgreSQL 16 attachability verification after creation: ${verified.evaluation.reasons.join("; ")}`,
		);
	}

	return { action: rebuilt ? "rebuilt" : "created", indexName: spec.indexName };
}

async function ensureMigrationsTable(
	client,
	migrationsSchema = "drizzle",
	migrationsTable = "__drizzle_migrations",
) {
	const schemaIdent = quoteIdentifier(migrationsSchema);
	const tableIdent = quoteIdentifier(migrationsTable);
	await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaIdent}`);
	await client.query(`
		CREATE TABLE IF NOT EXISTS ${schemaIdent}.${tableIdent} (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at bigint
		)
	`);
}

async function readLatestAppliedMigrationMillis(
	client,
	migrationsSchema = "drizzle",
	migrationsTable = "__drizzle_migrations",
) {
	const schemaIdent = quoteIdentifier(migrationsSchema);
	const tableIdent = quoteIdentifier(migrationsTable);
	const result = await client.query(
		`SELECT id, hash, created_at FROM ${schemaIdent}.${tableIdent} ORDER BY created_at DESC LIMIT 1`,
	);
	const latest = result.rows[0];
	return latest ? Number(latest.created_at) : null;
}

async function executeMigrationStageInTransaction(client, stage, options = {}) {
	const {
		migrationsSchema = "drizzle",
		migrationsTable = "__drizzle_migrations",
		retryOptions = {},
		onStageCommitted,
	} = options;
	const schemaIdent = quoteIdentifier(migrationsSchema);
	const tableIdent = quoteIdentifier(migrationsTable);

	await withLockTimeoutRetry(
		async () => {
			await client.query("BEGIN");
			try {
				for (const migration of stage.migrations) {
					for (const statement of migration.sql) {
						if (statement.trim().length === 0) continue;
						await client.query(statement);
					}
					await client.query(
						`INSERT INTO ${schemaIdent}.${tableIdent} ("hash", "created_at") VALUES ($1, $2)`,
						[migration.hash, migration.folderMillis],
					);
				}
				const xidResult = await client.query("SELECT pg_current_xact_id()::text AS xid");
				await client.query("COMMIT");
				if (onStageCommitted) {
					await onStageCommitted({
						stageId: stage.id,
						tags: stage.migrations.map((m) => m.tag),
						xid: xidResult.rows[0]?.xid ?? null,
					});
				}
			} catch (error) {
				await client.query("ROLLBACK");
				throw error;
			}
		},
		{ ...retryOptions, stepName: `stage:${stage.id}` },
	);
}

async function runChunkLoop(client, stepName, chunkSize, executeChunk, options = {}) {
	const { retryOptions = {}, onBackfillChunkCommitted } = options;
	let chunkNumber = 0;
	let totalProcessed = 0;

	for (;;) {
		const rowsProcessed = await withLockTimeoutRetry(
			async () => {
				await client.query("BEGIN");
				try {
					const count = await executeChunk(client, chunkSize);
					await client.query("COMMIT");
					return count;
				} catch (error) {
					await client.query("ROLLBACK");
					throw error;
				}
			},
			{ ...retryOptions, stepName: `backfill:${stepName}:chunk-${chunkNumber + 1}` },
		);

		if (rowsProcessed <= 0) {
			break;
		}
		chunkNumber += 1;
		totalProcessed += rowsProcessed;
		if (onBackfillChunkCommitted) {
			await onBackfillChunkCommitted({
				step: stepName,
				chunkNumber,
				rowsProcessed,
				totalProcessed,
			});
		}
	}

	return { step: stepName, chunks: chunkNumber, totalProcessed };
}

/**
 * Crash-safe, resumable 1,000-row/tx chunked backfill (`ROW EXCLUSIVE` only)
 * run immediately after 0318-0321 commit and before Drain Gate 1 / 0322.
 */
export async function runPhase1ChunkedBackfill(client, options = {}) {
	const {
		chunkSize = DEFAULT_BACKFILL_CHUNK_SIZE,
		retryOptions = {},
		onBackfillChunkCommitted,
	} = options;

	if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
		throw new Error(`Backfill chunkSize must be a positive integer; received ${chunkSize}.`);
	}

	const stats = [];

	// B1: work_policy -> legacy baseline v1 work_policy_version (unsealed until Drain Gate 2 / 0327)
	stats.push(
		await runChunkLoop(
			client,
			"work_policy_v1",
			chunkSize,
			async (tx, limit) => {
				const res = await tx.query(
					`
					WITH batch AS (
						SELECT
							wp.id,
							wp.organization_id,
							wp.schedule_enabled,
							wp.regulation_enabled,
							wp.presence_enabled,
							wp.created_by
						FROM "work_policy" wp
						WHERE NOT EXISTS (
							SELECT 1
							FROM "work_policy_version" v
							WHERE v.policy_id = wp.id
								AND v.version_number = 1
						)
						ORDER BY wp.id
						LIMIT $1
					)
					INSERT INTO "work_policy_version" (
						"organization_id",
						"policy_id",
						"version_number",
						"effective_from_date",
						"schedule_enabled",
						"regulation_enabled",
						"presence_enabled",
						"is_legacy_baseline",
						"sealed_at",
						"created_by"
					)
					SELECT
						b.organization_id,
						b.id,
						1,
						DATE '1970-01-01',
						b.schedule_enabled,
						b.regulation_enabled,
						b.presence_enabled,
						true,
						NULL,
						b.created_by
					FROM batch b
					ON CONFLICT ("policy_id", "version_number") DO NOTHING
					`,
					[limit],
				);
				return res.rowCount ?? 0;
			},
			{ retryOptions, onBackfillChunkCommitted },
		),
	);

	// B2: 3 direct policy children -> policy_version_id
	for (const tableName of [
		"work_policy_schedule",
		"work_policy_presence",
		"work_policy_regulation",
	]) {
		const quoted = quoteIdentifier(tableName);
		stats.push(
			await runChunkLoop(
				client,
				`${tableName}_version`,
				chunkSize,
				async (tx, limit) => {
					const res = await tx.query(
						`
						WITH batch AS (
							SELECT t.id, v.id AS version_id
							FROM ${quoted} t
							JOIN "work_policy_version" v
								ON v.policy_id = t.policy_id
								AND v.version_number = 1
							WHERE t.policy_version_id IS NULL
							ORDER BY t.id
							LIMIT $1
							FOR UPDATE OF t SKIP LOCKED
						)
						UPDATE ${quoted} t
						SET "policy_version_id" = batch.version_id
						FROM batch
						WHERE t.id = batch.id
						`,
						[limit],
					);
					return res.rowCount ?? 0;
				},
				{ retryOptions, onBackfillChunkCommitted },
			),
		);
	}

	// B3: 3 policy grandchildren -> policy_version_id
	const grandchildSpecs = [
		{
			table: "work_policy_schedule_day",
			parentTable: "work_policy_schedule",
			fkColumn: "schedule_id",
		},
		{
			table: "work_policy_break_rule",
			parentTable: "work_policy_regulation",
			fkColumn: "regulation_id",
		},
		{
			table: "work_policy_break_option",
			parentTable: "work_policy_break_rule",
			fkColumn: "break_rule_id",
		},
	];
	for (const spec of grandchildSpecs) {
		const quotedChild = quoteIdentifier(spec.table);
		const quotedParent = quoteIdentifier(spec.parentTable);
		const quotedFk = quoteIdentifier(spec.fkColumn);
		stats.push(
			await runChunkLoop(
				client,
				`${spec.table}_version`,
				chunkSize,
				async (tx, limit) => {
					const res = await tx.query(
						`
						WITH batch AS (
							SELECT c.id, p.policy_version_id AS version_id
							FROM ${quotedChild} c
							JOIN ${quotedParent} p ON p.id = c.${quotedFk}
							WHERE c.policy_version_id IS NULL
								AND p.policy_version_id IS NOT NULL
							ORDER BY c.id
							LIMIT $1
							FOR UPDATE OF c SKIP LOCKED
						)
						UPDATE ${quotedChild} c
						SET "policy_version_id" = batch.version_id
						FROM batch
						WHERE c.id = batch.id
						`,
						[limit],
					);
					return res.rowCount ?? 0;
				},
				{ retryOptions, onBackfillChunkCommitted },
			),
		);
	}

	// B4: work_policy_violation -> policy_version_id (only where policy_id IS NOT NULL)
	stats.push(
		await runChunkLoop(
			client,
			"work_policy_violation_version",
			chunkSize,
			async (tx, limit) => {
				const res = await tx.query(
					`
					WITH batch AS (
						SELECT t.id, v.id AS version_id
						FROM "work_policy_violation" t
						JOIN "work_policy_version" v
							ON v.policy_id = t.policy_id
							AND v.organization_id = t.organization_id
							AND v.version_number = 1
						WHERE t.policy_id IS NOT NULL
							AND t.policy_version_id IS NULL
						ORDER BY t.id
						LIMIT $1
						FOR UPDATE OF t SKIP LOCKED
					)
					UPDATE "work_policy_violation" t
					SET "policy_version_id" = batch.version_id
					FROM batch
					WHERE t.id = batch.id
					`,
					[limit],
				);
				return res.rowCount ?? 0;
			},
			{ retryOptions, onBackfillChunkCommitted },
		),
	);

	// B5a: work_policy_assignment canonical dates & source_kind
	stats.push(
		await runChunkLoop(
			client,
			"work_policy_assignment_canonical",
			chunkSize,
			async (tx, limit) => {
				const res = await tx.query(
					`
					WITH batch AS (
						SELECT
							a.id,
							COALESCE(
								a.effective_from_date,
								CASE
									WHEN a.effective_from IS NOT NULL
										THEN z8_terms_timestamp_to_calendar_date(a.effective_from, a.organization_id)
									ELSE DATE '1970-01-01'
								END
							) AS next_from_date,
							COALESCE(
								a.effective_until_date,
								CASE
									WHEN a.effective_until IS NOT NULL
										THEN z8_terms_timestamp_to_calendar_date(a.effective_until, a.organization_id)
									ELSE NULL
								END
							) AS next_until_date,
							COALESCE(
								a.source_kind,
								CASE
									WHEN a.source_contract_default_id IS NOT NULL THEN 'contract_default'
									WHEN a.source_employment_history_id IS NOT NULL THEN 'employment_terms'
									WHEN a.assignment_type IN ('organization', 'team') THEN 'legacy'
									ELSE 'manager_assignment'
								END
							) AS next_source_kind
						FROM "work_policy_assignment" a
						WHERE a.effective_from_date IS NULL
							OR a.source_kind IS NULL
						ORDER BY a.id
						LIMIT $1
						FOR UPDATE OF a SKIP LOCKED
					)
					UPDATE "work_policy_assignment" a
					SET
						"effective_from_date" = batch.next_from_date,
						"effective_until_date" = batch.next_until_date,
						"source_kind" = batch.next_source_kind
					FROM batch
					WHERE a.id = batch.id
					`,
					[limit],
				);
				return res.rowCount ?? 0;
			},
			{ retryOptions, onBackfillChunkCommitted },
		),
	);

	// B5b: promote active org/team work_policy_assignment rows into contract_default (crash-safe, idempotent)
	stats.push(
		await runChunkLoop(
			client,
			"contract_default_from_assignments",
			chunkSize,
			async (tx, limit) => {
				const rowsResult = await tx.query(
					`
					SELECT
						a.id,
						a.organization_id,
						a.policy_id,
						a.assignment_type::text AS scope,
						a.team_id,
						COALESCE(a.effective_from_date, DATE '1970-01-01') AS effective_from_date,
						a.effective_until_date,
						a.created_by
					FROM "work_policy_assignment" a
					WHERE a.assignment_type IN ('organization', 'team')
						AND a.is_active = true
						AND a.source_contract_default_id IS NULL
						AND NOT EXISTS (
							SELECT 1
							FROM "contract_migration_conflict" c
							WHERE c.organization_id = a.organization_id
								AND c.dedupe_key = 'legacy_assignment:' || a.id::text
						)
					ORDER BY a.id
					LIMIT $1
					FOR UPDATE OF a SKIP LOCKED
					`,
					[limit],
				);

				let processed = 0;
				for (const row of rowsResult.rows) {
					const existingResult = await tx.query(
						`
						SELECT cd.id, ctv.work_policy_id
						FROM "contract_default" cd
						JOIN "contract_template_version" ctv
							ON ctv.id = cd.template_version_id
							AND ctv.organization_id = cd.organization_id
						WHERE cd.organization_id = $1
							AND cd.scope = $2
							AND cd.is_active = true
							AND cd.effective_from_date = $3
							AND (
								($2 = 'organization' AND cd.team_id IS NULL)
								OR ($2 = 'team' AND cd.team_id = $4)
							)
						LIMIT 1
						`,
						[row.organization_id, row.scope, row.effective_from_date, row.team_id],
					);

					const existing = existingResult.rows[0];
					if (existing) {
						if (existing.work_policy_id === row.policy_id) {
							await tx.query(
								`
								UPDATE "work_policy_assignment"
								SET
									"source_contract_default_id" = $1,
									"source_kind" = 'contract_default'
								WHERE "id" = $2
								`,
								[existing.id, row.id],
							);
						} else {
							await tx.query(
								`
								INSERT INTO "contract_migration_conflict" (
									"organization_id",
									"work_policy_id",
									"conflict_kind",
									"dedupe_key",
									"details"
								)
								VALUES (
									$1,
									$2,
									'legacy_assignment_conflict',
									$3,
									$4::jsonb
								)
								ON CONFLICT ("organization_id", "dedupe_key") DO NOTHING
								`,
								[
									row.organization_id,
									row.policy_id,
									`legacy_assignment:${row.id}`,
									JSON.stringify({
										assignmentId: row.id,
										scope: row.scope,
										teamId: row.team_id,
										existingContractDefaultId: existing.id,
										existingWorkPolicyId: existing.work_policy_id,
										assignmentWorkPolicyId: row.policy_id,
									}),
								],
							);
						}
						processed += 1;
						continue;
					}

					const templateName =
						row.scope === "organization"
							? "Migrated Organization Default"
							: `Migrated Team Default (${row.team_id})`;

					const templateRes = await tx.query(
						`
						INSERT INTO "contract_template" (
							"organization_id",
							"name",
							"kind",
							"is_active",
							"created_by"
						)
						VALUES ($1, $2, 'default_backing', true, $3)
						RETURNING "id"
						`,
						[row.organization_id, templateName, row.created_by],
					);
					const templateId = templateRes.rows[0].id;

					const versionRes = await tx.query(
						`
						INSERT INTO "contract_template_version" (
							"organization_id",
							"template_id",
							"version_number",
							"work_policy_id",
							"schedule_mode",
							"presence_override",
							"balance_mode",
							"schedule_source",
							"created_by"
						)
						VALUES ($1, $2, 1, $3, 'policy', 'inherit', 'tracked', 'policy', $4)
						RETURNING "id"
						`,
						[row.organization_id, templateId, row.policy_id, row.created_by],
					);
					const templateVersionId = versionRes.rows[0].id;

					const defaultRes = await tx.query(
						`
						INSERT INTO "contract_default" (
							"organization_id",
							"scope",
							"team_id",
							"template_version_id",
							"require_default_eligible",
							"effective_from_date",
							"effective_until_date",
							"is_active",
							"created_by"
						)
						VALUES ($1, $2, $3, $4, true, $5, $6, true, $7)
						RETURNING "id"
						`,
						[
							row.organization_id,
							row.scope,
							row.team_id,
							templateVersionId,
							row.effective_from_date,
							row.effective_until_date,
							row.created_by,
						],
					);
					const contractDefaultId = defaultRes.rows[0].id;

					await tx.query(
						`
						UPDATE "work_policy_assignment"
						SET
							"source_contract_default_id" = $1,
							"source_kind" = 'contract_default'
						WHERE "id" = $2
						`,
						[contractDefaultId, row.id],
					);
					processed += 1;
				}
				return processed;
			},
			{ retryOptions, onBackfillChunkCommitted },
		),
	);

	// B6a: employee_employment_history canonical dates + migrated_legacy_terms = true on pre-migration confirmed rows
	// Preserves weekly_contract_minutes, work_model, contract_type, hourly_rate, work_policy_id intact!
	stats.push(
		await runChunkLoop(
			client,
			"employee_employment_history_canonical",
			chunkSize,
			async (tx, limit) => {
				const res = await tx.query(
					`
					WITH batch AS (
						SELECT
							h.id,
							z8_terms_timestamp_to_calendar_date(h.valid_from, h.organization_id) AS next_from_date,
							CASE
								WHEN h.valid_until IS NOT NULL
									THEN z8_terms_timestamp_to_calendar_date(h.valid_until, h.organization_id)
								ELSE NULL
							END AS next_until_date,
							(h.review_state = 'confirmed') AS is_legacy_confirmed
						FROM "employee_employment_history" h
						WHERE h.valid_from_date IS NULL
						ORDER BY h.id
						LIMIT $1
						FOR UPDATE OF h SKIP LOCKED
					)
					UPDATE "employee_employment_history" h
					SET
						"valid_from_date" = batch.next_from_date,
						"valid_until_date" = batch.next_until_date,
						"migrated_legacy_terms" = CASE
							WHEN batch.is_legacy_confirmed THEN true
							ELSE h."migrated_legacy_terms"
						END
					FROM batch
					WHERE h.id = batch.id
					`,
					[limit],
				);
				return res.rowCount ?? 0;
			},
			{ retryOptions, onBackfillChunkCommitted },
		),
	);

	// B6b: record idempotent weekly_hours_policy_day_sum_mismatch conflicts for migrated legacy confirmed terms
	let cursorId = null;
	let conflictChunks = 0;
	let totalConflicts = 0;
	for (;;) {
		const chunkResult = await withLockTimeoutRetry(
			async () => {
				await client.query("BEGIN");
				try {
					const scanRes = await client.query(
						`
						WITH page AS (
							SELECT
								h.id,
								h.organization_id,
								h.employee_id,
								h.work_policy_id,
								h.weekly_contract_minutes
							FROM "employee_employment_history" h
							WHERE h.migrated_legacy_terms = true
								AND h.review_state = 'confirmed'
								AND h.work_policy_id IS NOT NULL
								AND h.weekly_contract_minutes IS NOT NULL
								AND ($1::uuid IS NULL OR h.id > $1::uuid)
							ORDER BY h.id
							LIMIT $2
						),
						policy_sums AS (
							SELECT
								p.id AS history_id,
								p.organization_id,
								p.employee_id,
								p.work_policy_id,
								p.weekly_contract_minutes,
								ROUND(COALESCE(SUM(CASE WHEN d.is_work_day THEN d.hours_per_day ELSE 0 END), 0) * 60)::int AS policy_day_sum_minutes
							FROM page p
							JOIN "work_policy" wp
								ON wp.id = p.work_policy_id
								AND wp.organization_id = p.organization_id
								AND wp.schedule_enabled = true
							JOIN "work_policy_schedule" s
								ON s.policy_id = wp.id
								AND s.schedule_type = 'detailed'
								AND s.schedule_cycle = 'weekly'
							JOIN "work_policy_schedule_day" d
								ON d.schedule_id = s.id
								AND COALESCE(d.cycle_week, 1) = 1
							GROUP BY p.id, p.organization_id, p.employee_id, p.work_policy_id, p.weekly_contract_minutes
						),
						inserted AS (
							INSERT INTO "contract_migration_conflict" (
								"organization_id",
								"employee_id",
								"employment_history_id",
								"work_policy_id",
								"conflict_kind",
								"dedupe_key",
								"details"
							)
							SELECT
								ps.organization_id,
								ps.employee_id,
								ps.history_id,
								ps.work_policy_id,
								'weekly_hours_policy_day_sum_mismatch',
								'hours_mismatch:' || ps.history_id::text,
								jsonb_build_object(
									'weeklyContractMinutes', ps.weekly_contract_minutes,
									'policyDaySumMinutes', ps.policy_day_sum_minutes,
									'workPolicyId', ps.work_policy_id
								)
							FROM policy_sums ps
							WHERE ps.policy_day_sum_minutes <> ps.weekly_contract_minutes
							ON CONFLICT ("organization_id", "dedupe_key") DO NOTHING
							RETURNING 1
						)
						SELECT
							(SELECT COUNT(*)::int FROM page) AS scanned,
							(SELECT id::text FROM page ORDER BY id DESC LIMIT 1) AS max_id,
							(SELECT COUNT(*)::int FROM inserted) AS inserted_count
						`,
						[cursorId, chunkSize],
					);
					await client.query("COMMIT");
					return scanRes.rows[0];
				} catch (error) {
					await client.query("ROLLBACK");
					throw error;
				}
			},
			{
				...retryOptions,
				stepName: `backfill:hours_mismatch_conflicts:chunk-${conflictChunks + 1}`,
			},
		);

		const scanned = Number(chunkResult?.scanned ?? 0);
		if (scanned === 0) break;
		cursorId = chunkResult.max_id;
		conflictChunks += 1;
		const insertedCount = Number(chunkResult?.inserted_count ?? 0);
		totalConflicts += insertedCount;
		if (onBackfillChunkCommitted) {
			await onBackfillChunkCommitted({
				step: "hours_mismatch_conflicts",
				chunkNumber: conflictChunks,
				rowsProcessed: scanned,
				totalProcessed: totalConflicts,
			});
		}
		if (scanned < chunkSize) break;
	}
	stats.push({
		step: "hours_mismatch_conflicts",
		chunks: conflictChunks,
		totalProcessed: totalConflicts,
	});

	// B7: Completeness verification gate
	await verifyPhase1BackfillCompleteness(client);

	return stats;
}

export async function verifyPhase1BackfillCompleteness(client) {
	const result = await client.query(`
		SELECT
			(
				SELECT COUNT(*)::int FROM "work_policy" wp
				WHERE NOT EXISTS (
					SELECT 1 FROM "work_policy_version" v
					WHERE v.policy_id = wp.id AND v.version_number = 1
				)
			) AS missing_work_policy_v1,
			(SELECT COUNT(*)::int FROM "work_policy_schedule" WHERE "policy_version_id" IS NULL) AS missing_schedule_version,
			(SELECT COUNT(*)::int FROM "work_policy_schedule_day" WHERE "policy_version_id" IS NULL) AS missing_schedule_day_version,
			(SELECT COUNT(*)::int FROM "work_policy_presence" WHERE "policy_version_id" IS NULL) AS missing_presence_version,
			(SELECT COUNT(*)::int FROM "work_policy_regulation" WHERE "policy_version_id" IS NULL) AS missing_regulation_version,
			(SELECT COUNT(*)::int FROM "work_policy_break_rule" WHERE "policy_version_id" IS NULL) AS missing_break_rule_version,
			(SELECT COUNT(*)::int FROM "work_policy_break_option" WHERE "policy_version_id" IS NULL) AS missing_break_option_version,
			(SELECT COUNT(*)::int FROM "work_policy_violation" WHERE "policy_id" IS NOT NULL AND "policy_version_id" IS NULL) AS missing_violation_version,
			(SELECT COUNT(*)::int FROM "work_policy_assignment" WHERE "effective_from_date" IS NULL OR "source_kind" IS NULL) AS missing_assignment_canonical,
			(SELECT COUNT(*)::int FROM "employee_employment_history" WHERE "valid_from_date" IS NULL) AS missing_terms_canonical
	`);

	const counts = result.rows[0] ?? {};
	const remaining = Object.entries(counts).filter(([, count]) => Number(count) > 0);
	if (remaining.length > 0) {
		const summary = remaining.map(([key, count]) => `${key}=${count}`).join(", ");
		throw new Error(
			`Phase 1 backfill completeness check failed; unbackfilled rows remain: ${summary}`,
		);
	}

	return counts;
}

/**
 * Chunked, crash-safe pre-0322 reconciliation and overlap pre-clean on `work_policy_assignment`:
 * - Normalizes any newly written rows missing `effective_from_date` or `source_kind`
 * - Fixes priority mismatches and inverted/empty date ranges (`effective_until_date <= effective_from_date`)
 * - Resolves overlapping active intervals per scope (`organization`, `team`, `employee`)
 *   while idempotently recording `legacy_assignment_conflict` entries.
 */
export async function runPre0322AssignmentPreClean(client, options = {}) {
	const {
		chunkSize = DEFAULT_BACKFILL_CHUNK_SIZE,
		retryOptions = {},
		onBackfillChunkCommitted,
	} = options;
	const stats = [];

	// 1. Delta canonical backfill + priority normalization
	stats.push(
		await runChunkLoop(
			client,
			"pre_0322_assignment_canonical",
			chunkSize,
			async (tx, limit) => {
				const res = await tx.query(
					`
					WITH batch AS (
						SELECT
							a.id,
							COALESCE(
								a.effective_from_date,
								CASE
									WHEN a.effective_from IS NOT NULL
										THEN z8_terms_timestamp_to_calendar_date(a.effective_from, a.organization_id)
									ELSE DATE '1970-01-01'
								END
							) AS next_from_date,
							COALESCE(
								a.effective_until_date,
								CASE
									WHEN a.effective_until IS NOT NULL
										THEN z8_terms_timestamp_to_calendar_date(a.effective_until, a.organization_id)
									ELSE NULL
								END
							) AS next_until_date,
							COALESCE(
								a.source_kind,
								CASE
									WHEN a.source_contract_default_id IS NOT NULL THEN 'contract_default'
									WHEN a.source_employment_history_id IS NOT NULL THEN 'employment_terms'
									WHEN a.assignment_type IN ('organization', 'team') THEN 'legacy'
									ELSE 'manager_assignment'
								END
							) AS next_source_kind,
							CASE a.assignment_type
								WHEN 'organization' THEN 0
								WHEN 'team' THEN 1
								ELSE 2
							END AS expected_priority
						FROM "work_policy_assignment" a
						WHERE a.effective_from_date IS NULL
							OR a.source_kind IS NULL
							OR a.priority <> CASE a.assignment_type
								WHEN 'organization' THEN 0
								WHEN 'team' THEN 1
								ELSE 2
							END
						ORDER BY a.id
						LIMIT $1
						FOR UPDATE OF a SKIP LOCKED
					)
					UPDATE "work_policy_assignment" a
					SET
						"effective_from_date" = batch.next_from_date,
						"effective_until_date" = batch.next_until_date,
						"source_kind" = batch.next_source_kind,
						"priority" = batch.expected_priority
					FROM batch
					WHERE a.id = batch.id
					`,
					[limit],
				);
				return res.rowCount ?? 0;
			},
			{ retryOptions, onBackfillChunkCommitted },
		),
	);

	// 2. Deactivate & normalize any rows with inverted/empty intervals (effective_until_date <= effective_from_date)
	stats.push(
		await runChunkLoop(
			client,
			"pre_0322_assignment_inverted_dates",
			chunkSize,
			async (tx, limit) => {
				const rowsRes = await tx.query(
					`
					SELECT id, organization_id, policy_id, effective_from_date::text, effective_until_date::text
					FROM "work_policy_assignment"
					WHERE "effective_until_date" IS NOT NULL
						AND "effective_until_date" <= "effective_from_date"
					ORDER BY id
					LIMIT $1
					FOR UPDATE SKIP LOCKED
					`,
					[limit],
				);
				for (const row of rowsRes.rows) {
					await tx.query(
						`
						INSERT INTO "contract_migration_conflict" (
							"organization_id", "work_policy_id", "conflict_kind", "dedupe_key", "details"
						)
						VALUES ($1, $2, 'legacy_assignment_conflict', $3, $4::jsonb)
						ON CONFLICT ("organization_id", "dedupe_key") DO NOTHING
						`,
						[
							row.organization_id,
							row.policy_id,
							`legacy_assignment_inverted:${row.id}`,
							JSON.stringify({
								assignmentId: row.id,
								effectiveFromDate: row.effective_from_date,
								effectiveUntilDate: row.effective_until_date,
								resolution: "deactivated_and_cleared_until",
							}),
						],
					);
					await tx.query(
						`
						UPDATE "work_policy_assignment"
						SET "is_active" = false, "effective_until_date" = NULL, "effective_until" = NULL
						WHERE id = $1
						`,
						[row.id],
					);
				}
				return rowsRes.rows.length;
			},
			{ retryOptions, onBackfillChunkCommitted },
		),
	);

	// 3. Resolve overlapping active intervals per scope (organization, team, employee)
	stats.push(
		await runChunkLoop(
			client,
			"pre_0322_assignment_overlaps",
			chunkSize,
			async (tx, limit) => {
				const overlapRes = await tx.query(
					`
					WITH ordered AS (
						SELECT
							id,
							organization_id,
							policy_id,
							assignment_type::text AS assignment_type,
							team_id,
							employee_id,
							effective_from_date,
							effective_until_date,
							LEAD(id) OVER (
								PARTITION BY organization_id, assignment_type, team_id, employee_id
								ORDER BY effective_from_date ASC, created_at ASC, id ASC
							) AS next_id,
							LEAD(effective_from_date) OVER (
								PARTITION BY organization_id, assignment_type, team_id, employee_id
								ORDER BY effective_from_date ASC, created_at ASC, id ASC
							) AS next_from_date
						FROM "work_policy_assignment"
						WHERE "is_active" = true
					)
					SELECT
						o.id,
						o.organization_id,
						o.policy_id,
						o.assignment_type,
						o.effective_from_date::text AS effective_from_date,
						o.effective_until_date::text AS effective_until_date,
						o.next_id,
						o.next_from_date::text AS next_from_date
					FROM ordered o
					WHERE o.next_id IS NOT NULL
						AND (o.effective_until_date IS NULL OR o.effective_until_date > o.next_from_date)
					ORDER BY o.id
					LIMIT $1
					`,
					[limit],
				);

				let resolved = 0;
				for (const row of overlapRes.rows) {
					await tx.query(
						`
						INSERT INTO "contract_migration_conflict" (
							"organization_id", "work_policy_id", "conflict_kind", "dedupe_key", "details"
						)
						VALUES ($1, $2, 'legacy_assignment_conflict', $3, $4::jsonb)
						ON CONFLICT ("organization_id", "dedupe_key") DO NOTHING
						`,
						[
							row.organization_id,
							row.policy_id,
							`legacy_assignment_overlap:${row.id}:${row.next_id}`,
							JSON.stringify({
								assignmentId: row.id,
								overlappingNextId: row.next_id,
								assignmentType: row.assignment_type,
								effectiveFromDate: row.effective_from_date,
								effectiveUntilDate: row.effective_until_date,
								nextFromDate: row.next_from_date,
								resolution:
									row.effective_from_date === row.next_from_date
										? "deactivated_older_same_start"
										: "clamped_effective_until_date",
							}),
						],
					);

					if (row.effective_from_date === row.next_from_date) {
						await tx.query(
							`UPDATE "work_policy_assignment" SET "is_active" = false WHERE id = $1`,
							[row.id],
						);
					} else {
						await tx.query(
							`
							UPDATE "work_policy_assignment"
							SET
								"effective_until_date" = $2::date,
								"effective_until" = $2::date::timestamp
							WHERE id = $1
							`,
							[row.id, row.next_from_date],
						);
					}
					resolved += 1;
				}
				return resolved;
			},
			{ retryOptions, onBackfillChunkCommitted },
		),
	);

	return stats;
}

/**
 * Chunked, crash-safe pre-0323 reconciliation and confirmed-interval overlap pre-clean
 * on `employee_employment_history` before installing `btree_gist` exclusion constraints.
 */
export async function runPre0323TermsPreClean(client, options = {}) {
	const {
		chunkSize = DEFAULT_BACKFILL_CHUNK_SIZE,
		retryOptions = {},
		onBackfillChunkCommitted,
	} = options;
	const stats = [];

	// 1. Delta backfill any newly written rows missing valid_from_date
	stats.push(
		await runChunkLoop(
			client,
			"pre_0323_terms_canonical",
			chunkSize,
			async (tx, limit) => {
				const res = await tx.query(
					`
					WITH batch AS (
						SELECT
							h.id,
							z8_terms_timestamp_to_calendar_date(h.valid_from, h.organization_id) AS next_from_date,
							CASE
								WHEN h.valid_until IS NOT NULL
									THEN z8_terms_timestamp_to_calendar_date(h.valid_until, h.organization_id)
								ELSE NULL
							END AS next_until_date
						FROM "employee_employment_history" h
						WHERE h.valid_from_date IS NULL
						ORDER BY h.id
						LIMIT $1
						FOR UPDATE OF h SKIP LOCKED
					)
					UPDATE "employee_employment_history" h
					SET
						"valid_from_date" = batch.next_from_date,
						"valid_until_date" = batch.next_until_date
					FROM batch
					WHERE h.id = batch.id
					`,
					[limit],
				);
				return res.rowCount ?? 0;
			},
			{ retryOptions, onBackfillChunkCommitted },
		),
	);

	// 2. Clamp inverted intervals (valid_until_date < valid_from_date) to zero-length superseded rows
	stats.push(
		await runChunkLoop(
			client,
			"pre_0323_terms_inverted_dates",
			chunkSize,
			async (tx, limit) => {
				const rowsRes = await tx.query(
					`
					SELECT id, organization_id, employee_id, valid_from_date::text, valid_until_date::text
					FROM "employee_employment_history"
					WHERE "valid_until_date" IS NOT NULL
						AND "valid_until_date" < "valid_from_date"
					ORDER BY id
					LIMIT $1
					FOR UPDATE SKIP LOCKED
					`,
					[limit],
				);
				for (const row of rowsRes.rows) {
					await tx.query(
						`
						INSERT INTO "contract_migration_conflict" (
							"organization_id", "employee_id", "employment_history_id", "conflict_kind", "dedupe_key", "details"
						)
						VALUES ($1, $2, $3, 'legacy_terms_overlap', $4, $5::jsonb)
						ON CONFLICT ("organization_id", "dedupe_key") DO NOTHING
						`,
						[
							row.organization_id,
							row.employee_id,
							row.id,
							`legacy_terms_inverted:${row.id}`,
							JSON.stringify({
								employmentHistoryId: row.id,
								validFromDate: row.valid_from_date,
								validUntilDate: row.valid_until_date,
								resolution: "clamped_to_zero_length",
							}),
						],
					);
					await tx.query(
						`
						UPDATE "employee_employment_history"
						SET "valid_until_date" = "valid_from_date", "valid_until" = "valid_from_date"::timestamp
						WHERE id = $1
						`,
						[row.id],
					);
				}
				return rowsRes.rows.length;
			},
			{ retryOptions, onBackfillChunkCommitted },
		),
	);

	// 3. Resolve overlapping confirmed non-empty intervals within the same stint
	stats.push(
		await runChunkLoop(
			client,
			"pre_0323_terms_overlaps",
			chunkSize,
			async (tx, limit) => {
				const overlapRes = await tx.query(
					`
					WITH ordered AS (
						SELECT
							id,
							organization_id,
							employee_id,
							employment_period_id,
							valid_from_date,
							valid_until_date,
							LEAD(id) OVER (
								PARTITION BY organization_id, employee_id, employment_period_id
								ORDER BY valid_from_date ASC, created_at ASC, id ASC
							) AS next_id,
							LEAD(valid_from_date) OVER (
								PARTITION BY organization_id, employee_id, employment_period_id
								ORDER BY valid_from_date ASC, created_at ASC, id ASC
							) AS next_from_date
						FROM "employee_employment_history"
						WHERE "review_state" = 'confirmed'
							AND "employment_period_id" IS NOT NULL
							AND ("valid_until_date" IS NULL OR "valid_until_date" > "valid_from_date")
					)
					SELECT
						o.id,
						o.organization_id,
						o.employee_id,
						o.valid_from_date::text AS valid_from_date,
						o.valid_until_date::text AS valid_until_date,
						o.next_id,
						o.next_from_date::text AS next_from_date
					FROM ordered o
					WHERE o.next_id IS NOT NULL
						AND (o.valid_until_date IS NULL OR o.valid_until_date > o.next_from_date)
					ORDER BY o.id
					LIMIT $1
					`,
					[limit],
				);

				let resolved = 0;
				for (const row of overlapRes.rows) {
					await tx.query(
						`
						INSERT INTO "contract_migration_conflict" (
							"organization_id", "employee_id", "employment_history_id", "conflict_kind", "dedupe_key", "details"
						)
						VALUES ($1, $2, $3, 'legacy_terms_overlap', $4, $5::jsonb)
						ON CONFLICT ("organization_id", "dedupe_key") DO NOTHING
						`,
						[
							row.organization_id,
							row.employee_id,
							row.id,
							`legacy_terms_overlap:${row.id}:${row.next_id}`,
							JSON.stringify({
								employmentHistoryId: row.id,
								overlappingNextId: row.next_id,
								validFromDate: row.valid_from_date,
								validUntilDate: row.valid_until_date,
								nextFromDate: row.next_from_date,
								resolution:
									row.valid_from_date === row.next_from_date
										? "superseded_zero_length"
										: "clamped_valid_until_date",
							}),
						],
					);

					await tx.query(
						`
						UPDATE "employee_employment_history"
						SET
							"valid_until_date" = $2::date,
							"valid_until" = $2::date::timestamp
						WHERE id = $1
						`,
						[row.id, row.next_from_date],
					);
					resolved += 1;
				}
				return resolved;
			},
			{ retryOptions, onBackfillChunkCommitted },
		),
	);

	return stats;
}

/**
 * Pre-0324 non-transactional final delta reconciliation across all policy tables
 * and `work_policy_violation` before concurrently building the 6 policy-version staging indexes.
 */
export async function runPre0324PolicyDeltaReconciliation(client, options = {}) {
	const {
		chunkSize = DEFAULT_BACKFILL_CHUNK_SIZE,
		retryOptions = {},
		onBackfillChunkCommitted,
	} = options;
	const stats = [];

	// Delta v1 versions for any newly created work_policy rows
	stats.push(
		await runChunkLoop(
			client,
			"pre_0324_work_policy_v1",
			chunkSize,
			async (tx, limit) => {
				const res = await tx.query(
					`
					WITH batch AS (
						SELECT
							wp.id,
							wp.organization_id,
							wp.schedule_enabled,
							wp.regulation_enabled,
							wp.presence_enabled,
							wp.created_by
						FROM "work_policy" wp
						WHERE NOT EXISTS (
							SELECT 1
							FROM "work_policy_version" v
							WHERE v.policy_id = wp.id
								AND v.version_number = 1
						)
						ORDER BY wp.id
						LIMIT $1
					)
					INSERT INTO "work_policy_version" (
						"organization_id",
						"policy_id",
						"version_number",
						"effective_from_date",
						"schedule_enabled",
						"regulation_enabled",
						"presence_enabled",
						"is_legacy_baseline",
						"sealed_at",
						"created_by"
					)
					SELECT
						b.organization_id,
						b.id,
						1,
						DATE '1970-01-01',
						b.schedule_enabled,
						b.regulation_enabled,
						b.presence_enabled,
						true,
						NULL,
						b.created_by
					FROM batch b
					ON CONFLICT ("policy_id", "version_number") DO NOTHING
					`,
					[limit],
				);
				return res.rowCount ?? 0;
			},
			{ retryOptions, onBackfillChunkCommitted },
		),
	);

	for (const tableName of [
		"work_policy_schedule",
		"work_policy_presence",
		"work_policy_regulation",
	]) {
		const quoted = quoteIdentifier(tableName);
		stats.push(
			await runChunkLoop(
				client,
				`pre_0324_${tableName}_version`,
				chunkSize,
				async (tx, limit) => {
					const res = await tx.query(
						`
						WITH batch AS (
							SELECT t.id, v.id AS version_id
							FROM ${quoted} t
							JOIN "work_policy_version" v
								ON v.policy_id = t.policy_id
								AND v.version_number = 1
							WHERE t.policy_version_id IS NULL
							ORDER BY t.id
							LIMIT $1
							FOR UPDATE OF t SKIP LOCKED
						)
						UPDATE ${quoted} t
						SET "policy_version_id" = batch.version_id
						FROM batch
						WHERE t.id = batch.id
						`,
						[limit],
					);
					return res.rowCount ?? 0;
				},
				{ retryOptions, onBackfillChunkCommitted },
			),
		);
	}

	const grandchildSpecs = [
		{
			table: "work_policy_schedule_day",
			parentTable: "work_policy_schedule",
			fkColumn: "schedule_id",
		},
		{
			table: "work_policy_break_rule",
			parentTable: "work_policy_regulation",
			fkColumn: "regulation_id",
		},
		{
			table: "work_policy_break_option",
			parentTable: "work_policy_break_rule",
			fkColumn: "break_rule_id",
		},
	];
	for (const spec of grandchildSpecs) {
		const quotedChild = quoteIdentifier(spec.table);
		const quotedParent = quoteIdentifier(spec.parentTable);
		const quotedFk = quoteIdentifier(spec.fkColumn);
		stats.push(
			await runChunkLoop(
				client,
				`pre_0324_${spec.table}_version`,
				chunkSize,
				async (tx, limit) => {
					const res = await tx.query(
						`
						WITH batch AS (
							SELECT c.id, p.policy_version_id AS version_id
							FROM ${quotedChild} c
							JOIN ${quotedParent} p ON p.id = c.${quotedFk}
							WHERE c.policy_version_id IS NULL
								AND p.policy_version_id IS NOT NULL
							ORDER BY c.id
							LIMIT $1
							FOR UPDATE OF c SKIP LOCKED
						)
						UPDATE ${quotedChild} c
						SET "policy_version_id" = batch.version_id
						FROM batch
						WHERE c.id = batch.id
						`,
						[limit],
					);
					return res.rowCount ?? 0;
				},
				{ retryOptions, onBackfillChunkCommitted },
			),
		);
	}

	stats.push(
		await runChunkLoop(
			client,
			"pre_0324_work_policy_violation_version",
			chunkSize,
			async (tx, limit) => {
				const res = await tx.query(
					`
					WITH batch AS (
						SELECT t.id, v.id AS version_id
						FROM "work_policy_violation" t
						JOIN "work_policy_version" v
							ON v.policy_id = t.policy_id
							AND v.organization_id = t.organization_id
							AND v.version_number = 1
						WHERE t.policy_id IS NOT NULL
							AND t.policy_version_id IS NULL
						ORDER BY t.id
						LIMIT $1
						FOR UPDATE OF t SKIP LOCKED
					)
					UPDATE "work_policy_violation" t
					SET "policy_version_id" = batch.version_id
					FROM batch
					WHERE t.id = batch.id
					`,
					[limit],
				);
				return res.rowCount ?? 0;
			},
			{ retryOptions, onBackfillChunkCommitted },
		),
	);

	// Verify zero unbackfilled policy/child/grandchild/violation rows remain
	const check = await client.query(`
		SELECT
			(
				SELECT COUNT(*)::int FROM "work_policy" wp
				WHERE NOT EXISTS (
					SELECT 1 FROM "work_policy_version" v
					WHERE v.policy_id = wp.id AND v.version_number = 1
				)
			) AS missing_work_policy_v1,
			(SELECT COUNT(*)::int FROM "work_policy_schedule" WHERE "policy_version_id" IS NULL) AS missing_schedule_version,
			(SELECT COUNT(*)::int FROM "work_policy_schedule_day" WHERE "policy_version_id" IS NULL) AS missing_schedule_day_version,
			(SELECT COUNT(*)::int FROM "work_policy_presence" WHERE "policy_version_id" IS NULL) AS missing_presence_version,
			(SELECT COUNT(*)::int FROM "work_policy_regulation" WHERE "policy_version_id" IS NULL) AS missing_regulation_version,
			(SELECT COUNT(*)::int FROM "work_policy_break_rule" WHERE "policy_version_id" IS NULL) AS missing_break_rule_version,
			(SELECT COUNT(*)::int FROM "work_policy_break_option" WHERE "policy_version_id" IS NULL) AS missing_break_option_version,
			(SELECT COUNT(*)::int FROM "work_policy_violation" WHERE "policy_id" IS NOT NULL AND "policy_version_id" IS NULL) AS missing_violation_version
	`);
	const remaining = Object.entries(check.rows[0] ?? {}).filter(([, count]) => Number(count) > 0);
	if (remaining.length > 0) {
		const summary = remaining.map(([key, count]) => `${key}=${count}`).join(", ");
		throw new Error(
			`Pre-0324 policy delta reconciliation incomplete; unbackfilled rows remain: ${summary}`,
		);
	}

	return stats;
}

async function relationExists(client, relationName) {
	const res = await client.query("SELECT to_regclass($1) IS NOT NULL AS exists", [relationName]);
	return res.rows[0]?.exists === true;
}

async function resolveWorkClient(options) {
	if (options.pool) {
		const client = await options.pool.connect();
		return {
			client,
			release: () => client.release(),
		};
	}
	if (options.client) {
		return {
			client: options.client,
			release: () => {},
		};
	}
	throw new Error("runBoundaryAwareMigrations requires either `pool` or `client`.");
}

/**
 * Single shared boundary-aware migration engine used identically by both the
 * production locked migration runner (`migrate-with-lock.js`) and the
 * PostgreSQL integration suite full-journal bootstrap.
 */
export async function runBoundaryAwareMigrations(options) {
	const {
		migrationsFolder,
		migrationsSchema = "drizzle",
		migrationsTable = "__drizzle_migrations",
		allowContractConstraints = false,
		allowPolicyV1Seal = false,
		lockRetries = DEFAULT_MIGRATION_LOCK_RETRIES,
		retryBaseDelayMs = 150,
		retryMaxDelayMs = 2000,
		backfillChunkSize = DEFAULT_BACKFILL_CHUNK_SIZE,
		pre0318Indexes = PRE_0318_CONCURRENT_INDEXES,
		pre0324Indexes = PRE_0324_CONCURRENT_INDEXES,
		onStageCommitted,
		onBackfillChunkCommitted,
		logger = console,
	} = options;

	if (!migrationsFolder) {
		throw new Error("runBoundaryAwareMigrations requires `migrationsFolder`.");
	}

	const retryOptions = {
		maxRetries: lockRetries,
		baseDelayMs: retryBaseDelayMs,
		maxDelayMs: retryMaxDelayMs,
		logger,
	};

	const allMigrations = readJournaledMigrations(migrationsFolder);
	const { client, release } = await resolveWorkClient(options);

	try {
		await ensureMigrationsTable(client, migrationsSchema, migrationsTable);
		const lastAppliedMillis = await readLatestAppliedMigrationMillis(
			client,
			migrationsSchema,
			migrationsTable,
		);

		const pending = allMigrations.filter(
			(migration) => lastAppliedMillis === null || migration.folderMillis > lastAppliedMillis,
		);
		const stages = buildMigrationStagePlan(pending);

		const appliedStages = [];
		const indexActions = [];
		let backfillStats = null;
		let stoppedAtGate = null;

		const hasAppliedMigration = async (prefix) => {
			const target = allMigrations.find((m) => m.prefix === prefix);
			if (!target) return false;
			const currentMillis = await readLatestAppliedMigrationMillis(
				client,
				migrationsSchema,
				migrationsTable,
			);
			return currentMillis !== null && currentMillis >= target.folderMillis;
		};

		// 1. Historical prefix 0000-0317 commits first before any pre-0318 concurrent index build.
		const historicalStage = stages.find((s) => s.id === "historical_prefix_0000_0317");
		if (historicalStage) {
			await executeMigrationStageInTransaction(client, historicalStage, {
				migrationsSchema,
				migrationsTable,
				retryOptions,
				onStageCommitted,
			});
			appliedStages.push(historicalStage.id);
		}

		// 2. Pre-0318 concurrent unique indexes + Phase 1 Expand (0318-0321)
		const phase1Stage = stages.find((s) => s.id === "phase1_expand_0318_0321");
		if (phase1Stage) {
			const maxPhase1Prefix = Math.max(...phase1Stage.migrations.map((m) => m.prefix));
			for (const indexSpec of pre0318Indexes) {
				if (indexSpec.requiredBeforePrefix <= maxPhase1Prefix) {
					const action = await ensureAttachableUniqueIndex(client, indexSpec, retryOptions);
					indexActions.push(action);
				}
			}

			await executeMigrationStageInTransaction(client, phase1Stage, {
				migrationsSchema,
				migrationsTable,
				retryOptions,
				onStageCommitted,
			});
			appliedStages.push(phase1Stage.id);
		}

		// 3. Post-0321 crash-safe resumable chunked backfill + completeness verification gate.
		// Runs whenever 0321 is applied and 0322 is not yet applied (ensuring mid-backfill crash recovery).
		const is0321Applied = await hasAppliedMigration(321);
		const is0322Applied = await hasAppliedMigration(322);
		const phase1SchemaPresent =
			is0321Applied && (await relationExists(client, "public.work_policy_version"));
		if (phase1SchemaPresent && !is0322Applied) {
			backfillStats = await runPhase1ChunkedBackfill(client, {
				chunkSize: backfillChunkSize,
				retryOptions,
				onBackfillChunkCommitted,
			});
		}

		// 4. Drain Gate 1: stop cleanly at 0321 unless explicitly authorized.
		const postPhase1Stages = stages.filter(
			(s) => s.id !== "historical_prefix_0000_0317" && s.id !== "phase1_expand_0318_0321",
		);
		if (postPhase1Stages.length > 0 && !allowContractConstraints) {
			stoppedAtGate = "drain_gate_1";
			logger.info?.(
				"[migration] Drain Gate 1 active (DB_ALLOW_CONTRACT_CONSTRAINTS !== 'true'); stopping cleanly after 0321 and backfill completeness verification.",
			);
			return {
				appliedStages,
				indexActions,
				backfillStats,
				stoppedAtGate,
			};
		}

		// 5. Phase 2 isolated boundaries: 0322, 0323, pre-0324 concurrent indexes, 0324, 0325, 0326, Drain Gate 2, 0327, >0327
		for (const stage of postPhase1Stages) {
			if (stage.id === "phase2_0327" || stage.id === "post_0327") {
				if (!allowPolicyV1Seal) {
					stoppedAtGate = "drain_gate_2";
					logger.info?.(
						"[migration] Drain Gate 2 active (DB_ALLOW_POLICY_V1_SEAL !== 'true'); stopping cleanly after 0326 before v1 seal (0327).",
					);
					return {
						appliedStages,
						indexActions,
						backfillStats,
						stoppedAtGate,
					};
				}
			}

			if (stage.id === "phase2_0322") {
				await runPre0322AssignmentPreClean(client, {
					chunkSize: backfillChunkSize,
					retryOptions,
					onBackfillChunkCommitted,
				});
			}

			if (stage.id === "phase2_0323") {
				await runPre0323TermsPreClean(client, {
					chunkSize: backfillChunkSize,
					retryOptions,
					onBackfillChunkCommitted,
				});
			}

			if (stage.id === "phase2_0324") {
				await runPre0324PolicyDeltaReconciliation(client, {
					chunkSize: backfillChunkSize,
					retryOptions,
					onBackfillChunkCommitted,
				});
				for (const indexSpec of pre0324Indexes) {
					const action = await ensureAttachableUniqueIndex(client, indexSpec, retryOptions);
					indexActions.push(action);
				}
			}

			await executeMigrationStageInTransaction(client, stage, {
				migrationsSchema,
				migrationsTable,
				retryOptions,
				onStageCommitted,
			});
			appliedStages.push(stage.id);
		}

		return {
			appliedStages,
			indexActions,
			backfillStats,
			stoppedAtGate,
		};
	} finally {
		release();
	}
}
