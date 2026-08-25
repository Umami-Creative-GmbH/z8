import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
	type ApprovalWorkflowRepositoryTestDatabaseConfig,
	parseApprovalWorkflowRepositoryTestDatabaseUrl,
} from "../src/lib/approvals/workflow/repository-integration-harness";

const TEST_SENTINEL = "approval-workflow-repository-test";
const INCIDENT_LATEST_CREATED_AT = "1785493929039";
const EXPAND_CREATED_AT = "1785232090757";
const CYCLE_IDENTITY_CREATED_AT = "1785232118219";
const RECOVERY_CREATED_AT = "1785493929040";
const RECOVERY_TAG = "0060_approval_workflow_recovery";
const REAL_MIGRATIONS_FOLDER = fileURLToPath(
	new URL("../drizzle", import.meta.url),
);
const JOURNAL_TAGS_TO_SKIP = new Set([
	"0055_approval_workflow_expand",
	"0056_approval_workflow_cycle_identity",
	RECOVERY_TAG,
]);
const APPROVAL_TABLES = [
	"approval_inbox_projection",
	"approval_outbox",
	"approval_outbox_delivery",
	"approval_requester_projection",
	"approval_stage_assignment",
	"approval_workflow",
	"approval_workflow_command",
	"approval_workflow_event",
	"approval_workflow_migration_issue",
	"approval_workflow_rollout",
	"approval_workflow_stage",
] as const;
const APPROVAL_SOURCE_TABLES = [
	"absence_entry",
	"compliance_exception",
	"shift_request",
	"travel_expense_claim",
	"work_period",
] as const;
const PENDING_INDEX_NAME = "approvalWorkflow_org_source_pending_idx";
const PENDING_INDEX_COLUMNS = [
	"organization_id",
	"workflow_type",
	"source_type",
	"source_id",
] as const;

interface JournalEntry {
	tag: string;
	[key: string]: unknown;
}

interface MigrationJournal {
	entries: JournalEntry[];
	[key: string]: unknown;
}

export interface ApprovalCatalog {
	tables: string[];
	columns: { table: string; name: string; type: string }[];
	indexes: {
		name: string;
		table: string;
		unique: boolean;
		columns: string[];
		predicate: string | null;
	}[];
}

export interface RawMigrationLedgerRow {
	id: unknown;
	hash: unknown;
	created_at: unknown;
}

export interface MigrationLedgerRow {
	id: string;
	hash: string;
	createdAt: string;
}

export interface DisposableDatabasePreflight {
	expectedDatabaseName: string;
	currentDatabaseName: string;
	drizzleSchemaExists: boolean;
	publicSchemaObjectCount: bigint;
	unexpectedUserSchemaCount: bigint;
}

export interface CatalogNamespaceReference {
	tableName: string;
	columnName: string;
}

export function filterIncidentJournal(
	journal: MigrationJournal,
): MigrationJournal {
	return {
		...journal,
		entries: journal.entries.filter(
			(entry) => !JOURNAL_TAGS_TO_SKIP.has(entry.tag),
		),
	};
}

function normalizeLedgerValue(
	value: unknown,
	field: "id" | "created_at",
): string {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value !== "string") {
		throw new Error(`Drizzle migration ledger ${field} has an invalid value`);
	}

	const normalized = value.trim();
	if (/^-?\d+$/.test(normalized)) return BigInt(normalized).toString();
	if (field === "created_at") {
		const timestamp = Date.parse(normalized);
		if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
	}
	return normalized;
}

export function normalizeMigrationLedger(
	rows: readonly RawMigrationLedgerRow[],
): MigrationLedgerRow[] {
	return rows.map((row) => {
		if (typeof row.hash !== "string") {
			throw new Error("Drizzle migration ledger hash has an invalid value");
		}
		return {
			id: normalizeLedgerValue(row.id, "id"),
			hash: row.hash,
			createdAt: normalizeLedgerValue(row.created_at, "created_at"),
		};
	});
}

export function assertMigrationLedgerUnchanged(
	before: readonly RawMigrationLedgerRow[],
	after: readonly RawMigrationLedgerRow[],
): void {
	if (
		JSON.stringify(normalizeMigrationLedger(before)) !==
		JSON.stringify(normalizeMigrationLedger(after))
	) {
		throw new Error("Retry changed the Drizzle migration ledger");
	}
}

export function buildCatalogNamespaceCountQuery(
	reference: CatalogNamespaceReference,
): string {
	if (
		!/^pg_[a-z0-9_]+$/.test(reference.tableName) ||
		!/^[a-z_][a-z0-9_]*namespace$/.test(reference.columnName)
	) {
		throw new Error("Invalid pg_catalog namespace reference");
	}
	return `select count(*)::text as count from pg_catalog."${reference.tableName}" where "${reference.columnName}" = $1::oid`;
}

export function sumCatalogNamespaceCounts(
	counts: readonly { count: string | number | bigint }[],
): bigint {
	return counts.reduce((total, row) => {
		if (
			(typeof row.count === "number" &&
				(!Number.isSafeInteger(row.count) || row.count < 0)) ||
			(typeof row.count === "string" && !/^\d+$/.test(row.count)) ||
			(typeof row.count === "bigint" && row.count < BigInt(0))
		) {
			throw new Error("Invalid pg_catalog namespace object count");
		}
		return total + BigInt(row.count);
	}, BigInt(0));
}

export function assertDisposableDatabasePreflight(
	evidence: DisposableDatabasePreflight,
): void {
	if (
		evidence.currentDatabaseName !== evidence.expectedDatabaseName ||
		evidence.drizzleSchemaExists ||
		evidence.publicSchemaObjectCount !== BigInt(0) ||
		evidence.unexpectedUserSchemaCount !== BigInt(0)
	) {
		throw new Error(
			"Refusing destructive approval migration verification: test DB preflight failed",
		);
	}
}

export function assertApprovalCatalog(catalog: ApprovalCatalog): void {
	const missingTables = APPROVAL_TABLES.filter(
		(table) => !catalog.tables.includes(table),
	);
	if (missingTables.length > 0) {
		throw new Error(
			`Missing canonical approval tables: ${missingTables.join(", ")}`,
		);
	}

	const invalidColumns = APPROVAL_SOURCE_TABLES.filter((table) => {
		const column = catalog.columns.find(
			(candidate) =>
				candidate.table === table && candidate.name === "approval_workflow_id",
		);
		return column?.type !== "uuid";
	});
	if (invalidColumns.length > 0) {
		throw new Error(
			`Missing UUID approval_workflow_id columns: ${invalidColumns.join(", ")}`,
		);
	}

	const index = catalog.indexes.find(
		(candidate) => candidate.name === PENDING_INDEX_NAME,
	);
	const hasExpectedColumns =
		index?.columns.length === PENDING_INDEX_COLUMNS.length &&
		index.columns.every(
			(column, position) => column === PENDING_INDEX_COLUMNS[position],
		);
	const normalizedPredicate = index?.predicate
		?.toLowerCase()
		.replaceAll('"', "")
		.replace(/::[a-z_][a-z0-9_]*/g, "")
		.replace(/[()]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (
		index?.table !== "approval_workflow" ||
		index.unique !== true ||
		!hasExpectedColumns ||
		normalizedPredicate !== "status = 'pending'"
	) {
		throw new Error(`Invalid ${PENDING_INDEX_NAME}`);
	}
}

function requireTestDatabaseConfig(): ApprovalWorkflowRepositoryTestDatabaseConfig {
	const databaseUrl =
		process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
	if (!databaseUrl) {
		throw new Error(
			"APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL is required",
		);
	}
	if (
		process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL !== TEST_SENTINEL
	) {
		throw new Error(
			`APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL must equal ${TEST_SENTINEL}`,
		);
	}
	return parseApprovalWorkflowRepositoryTestDatabaseUrl(databaseUrl);
}

async function preflightDisposableDatabase(
	pool: Pool,
	expectedDatabaseName: string,
): Promise<void> {
	const identityResult = await pool.query<{
		current_database_name: string;
		drizzle_schema_exists: boolean;
		unexpected_user_schema_count: string;
	}>(`
		select current_database() as current_database_name,
			exists (
				select 1
				from pg_catalog.pg_namespace
				where nspname = 'drizzle'
			) as drizzle_schema_exists,
			(
				select count(*)::text
				from pg_catalog.pg_namespace
				where nspname not in ('pg_catalog', 'pg_toast', 'information_schema', 'public')
					and nspname !~ '^pg_temp_[0-9]+$'
					and nspname !~ '^pg_toast_temp_[0-9]+$'
			) as unexpected_user_schema_count
	`);
	const identity = identityResult.rows[0];
	if (!identity) {
		throw new Error(
			"Refusing destructive approval migration verification: test DB preflight returned no evidence",
		);
	}

	const namespaceResult = await pool.query<{ oid: string }>(`
		select oid::text as oid
		from pg_catalog.pg_namespace
		where nspname = 'public'
	`);
	const publicNamespaceOid = namespaceResult.rows[0]?.oid;
	if (!publicNamespaceOid) {
		throw new Error(
			"Refusing destructive approval migration verification: public schema is absent",
		);
	}

	const referenceResult = await pool.query<{
		table_name: string;
		column_name: string;
	}>(`
		select relation.relname as table_name,
			attribute.attname as column_name
		from pg_catalog.pg_attribute attribute
		join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
		join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
		where namespace.nspname = 'pg_catalog'
			and relation.relkind in ('r', 'p')
			and attribute.attnum > 0
			and not attribute.attisdropped
			and attribute.atttypid = 'pg_catalog.oid'::pg_catalog.regtype
			and attribute.attname like '%namespace'
		order by relation.relname, attribute.attname
	`);
	const countResults = await Promise.all(
		referenceResult.rows.map(async (reference) => {
			const result = await pool.query<{ count: string }>(
				buildCatalogNamespaceCountQuery({
					tableName: reference.table_name,
					columnName: reference.column_name,
				}),
				[publicNamespaceOid],
			);
			const count = result.rows[0];
			if (!count) throw new Error("pg_catalog namespace count returned no row");
			return count;
		}),
	);
	assertDisposableDatabasePreflight({
		expectedDatabaseName,
		currentDatabaseName: identity.current_database_name,
		drizzleSchemaExists: identity.drizzle_schema_exists,
		publicSchemaObjectCount: sumCatalogNamespaceCounts(countResults),
		unexpectedUserSchemaCount: BigInt(identity.unexpected_user_schema_count),
	});
}

async function assertAnchorLedgerState(
	pool: Pool,
	expandHash: string,
	recoveryExpected: boolean,
): Promise<void> {
	const result = await pool.query<{ created_at: string; hash: string }>(
		`
			select created_at::text as created_at, hash
			from drizzle.__drizzle_migrations
			where created_at = any($1::bigint[])
		`,
		[[EXPAND_CREATED_AT, CYCLE_IDENTITY_CREATED_AT, RECOVERY_CREATED_AT]],
	);
	const expandRows = result.rows.filter(
		(row) => row.created_at === EXPAND_CREATED_AT,
	);
	const cycleRows = result.rows.filter(
		(row) => row.created_at === CYCLE_IDENTITY_CREATED_AT,
	);
	const recoveryRows = result.rows.filter(
		(row) => row.created_at === RECOVERY_CREATED_AT,
	);
	if (
		expandRows.length !== 1 ||
		expandRows[0]?.hash !== expandHash ||
		cycleRows.length !== 0 ||
		recoveryRows.length !== (recoveryExpected ? 1 : 0)
	) {
		throw new Error("Constructed approval migration ledger state is invalid");
	}
}

async function loadMigrationLedger(
	pool: Pool,
): Promise<RawMigrationLedgerRow[]> {
	const result = await pool.query<RawMigrationLedgerRow>(`
		select id, hash, created_at
		from drizzle.__drizzle_migrations
		order by id
	`);
	return result.rows;
}

async function assertIncidentState(pool: Pool): Promise<void> {
	const ledger = normalizeMigrationLedger(await loadMigrationLedger(pool));
	if (ledger.at(-1)?.createdAt !== INCIDENT_LATEST_CREATED_AT) {
		throw new Error(
			`Incident ledger latest created_at must be ${INCIDENT_LATEST_CREATED_AT}`,
		);
	}
	const result = await pool.query<{
		approval_table_exists: boolean;
		work_period_column_exists: boolean;
	}>(`
		select
			to_regclass('public.approval_workflow') is not null as approval_table_exists,
			exists (
				select 1
				from pg_catalog.pg_attribute attribute
				join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
				join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
				where namespace.nspname = 'public'
					and relation.relname = 'work_period'
					and attribute.attname = 'approval_workflow_id'
					and attribute.attnum > 0
					and not attribute.attisdropped
			) as work_period_column_exists
	`);
	const state = result.rows[0];
	if (state?.approval_table_exists || state?.work_period_column_exists) {
		throw new Error("Failed to recreate the skipped approval migration state");
	}
}

async function loadApprovalCatalog(pool: Pool): Promise<ApprovalCatalog> {
	const [tableResult, columnResult, indexResult] = await Promise.all([
		pool.query<{ name: string }>(
			`
				select relation.relname as name
				from pg_catalog.pg_class relation
				join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
				where namespace.nspname = 'public'
					and relation.relkind in ('r', 'p')
					and relation.relname = any($1::text[])
			`,
			[[...APPROVAL_TABLES]],
		),
		pool.query<{ table: string; name: string; type: string }>(
			`
				select relation.relname as table,
					attribute.attname as name,
					pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as type
				from pg_catalog.pg_attribute attribute
				join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
				join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
				where namespace.nspname = 'public'
					and relation.relname = any($1::text[])
					and attribute.attname = 'approval_workflow_id'
					and attribute.attnum > 0
					and not attribute.attisdropped
			`,
			[[...APPROVAL_SOURCE_TABLES]],
		),
		pool.query<{
			name: string;
			table: string;
			unique: boolean;
			columns: string[];
			predicate: string | null;
		}>(
			`
				select index_relation.relname as name,
					table_relation.relname as table,
					index.indisunique as unique,
					array(
						select pg_catalog.pg_get_indexdef(index.indexrelid, position, true)
						from generate_series(1, index.indnkeyatts) as position
						order by position
					) as columns,
					pg_catalog.pg_get_expr(index.indpred, index.indrelid) as predicate
				from pg_catalog.pg_index index
				join pg_catalog.pg_class index_relation on index_relation.oid = index.indexrelid
				join pg_catalog.pg_class table_relation on table_relation.oid = index.indrelid
				join pg_catalog.pg_namespace namespace on namespace.oid = table_relation.relnamespace
				where namespace.nspname = 'public'
					and index_relation.relname = $1
			`,
			[PENDING_INDEX_NAME],
		),
	]);
	return {
		tables: tableResult.rows.map((row) => row.name),
		columns: columnResult.rows,
		indexes: indexResult.rows,
	};
}

async function assertRecoveryState(pool: Pool): Promise<void> {
	const recoveryLedgerResult = await pool.query<{ count: number }>(
		`
			select count(*)::integer as count
			from drizzle.__drizzle_migrations
			where created_at = $1
		`,
		[RECOVERY_CREATED_AT],
	);
	if (recoveryLedgerResult.rows[0]?.count !== 1) {
		throw new Error(`Drizzle ledger does not record ${RECOVERY_TAG}`);
	}
	assertApprovalCatalog(await loadApprovalCatalog(pool));
}

async function run(): Promise<void> {
	const databaseConfig = requireTestDatabaseConfig();
	let pool: Pool | undefined;
	let temporaryDirectory: string | undefined;
	let destructiveResetAuthorized = false;
	try {
		temporaryDirectory = await mkdtemp(
			join(tmpdir(), "z8-approval-migration-recovery-"),
		);
		const incidentMigrationsFolder = join(temporaryDirectory, "drizzle");
		await cp(REAL_MIGRATIONS_FOLDER, incidentMigrationsFolder, {
			recursive: true,
		});
		const journalPath = join(incidentMigrationsFolder, "meta", "_journal.json");
		const journal = JSON.parse(
			await readFile(journalPath, "utf8"),
		) as MigrationJournal;
		await writeFile(
			journalPath,
			`${JSON.stringify(filterIncidentJournal(journal), null, 2)}\n`,
		);

		pool = new Pool({ connectionString: databaseConfig.databaseUrl });
		await preflightDisposableDatabase(pool, databaseConfig.databaseName);
		console.log(
			"Migration recovery verification: probing custom schema refusal",
		);
		await pool.query('create schema "approval_migration_preflight_probe"');
		let customSchemaRefused = false;
		try {
			await preflightDisposableDatabase(pool, databaseConfig.databaseName);
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!error.message.startsWith(
					"Refusing destructive approval migration verification",
				)
			) {
				throw error;
			}
			customSchemaRefused = true;
		} finally {
			await pool.query('drop schema "approval_migration_preflight_probe"');
		}
		if (!customSchemaRefused) {
			throw new Error("Custom schema preflight probe was not refused");
		}
		await preflightDisposableDatabase(pool, databaseConfig.databaseName);
		destructiveResetAuthorized = true;
		const database = drizzle({ client: pool });

		console.log("Migration recovery verification: recreating incident state");
		await migrate(database, { migrationsFolder: incidentMigrationsFolder });
		await assertIncidentState(pool);

		console.log("Migration recovery verification: applying recovery migration");
		await migrate(database, { migrationsFolder: REAL_MIGRATIONS_FOLDER });
		await assertRecoveryState(pool);

		console.log("Migration recovery verification: checking retry idempotency");
		const beforeRetry = await loadMigrationLedger(pool);
		await migrate(database, { migrationsFolder: REAL_MIGRATIONS_FOLDER });
		const afterRetry = await loadMigrationLedger(pool);
		assertMigrationLedgerUnchanged(beforeRetry, afterRetry);
		await assertRecoveryState(pool);

		console.log(
			"Migration recovery verification: checking anchor-present index recovery",
		);
		await pool.query(`drop index public."${PENDING_INDEX_NAME}"`);
		await pool.query(`
			create unique index "${PENDING_INDEX_NAME}"
			on public.approval_workflow using btree
			(organization_id, source_type, source_id)
			where status = 'pending'
		`);
		const anchorResult = await pool.query<{ exists: boolean }>(`
			select to_regclass('public.approval_workflow') is not null as exists
		`);
		if (anchorResult.rows[0]?.exists !== true) {
			throw new Error(
				"Approval workflow anchor table is absent before recovery replay",
			);
		}
		const deletedRecovery = await pool.query(
			"delete from drizzle.__drizzle_migrations where created_at = $1",
			[RECOVERY_CREATED_AT],
		);
		if (deletedRecovery.rowCount !== 1) {
			throw new Error("Expected to remove exactly one recovery ledger row");
		}
		const expandSql = await readFile(
			join(REAL_MIGRATIONS_FOLDER, "0055_approval_workflow_expand.sql"),
			"utf8",
		);
		const expandHash = createHash("sha256").update(expandSql).digest("hex");
		await pool.query(
			`
				insert into drizzle.__drizzle_migrations (hash, created_at)
				select $1, $2::bigint
				where not exists (
					select 1
					from drizzle.__drizzle_migrations
					where created_at = $2::bigint
				)
			`,
			[expandHash, EXPAND_CREATED_AT],
		);
		await assertAnchorLedgerState(pool, expandHash, false);
		await migrate(database, { migrationsFolder: REAL_MIGRATIONS_FOLDER });
		await assertAnchorLedgerState(pool, expandHash, true);
		await assertRecoveryState(pool);

		console.log(
			"Migration recovery verification: checking fresh migration chain",
		);
		if (!destructiveResetAuthorized) {
			throw new Error(
				"Refusing destructive schema reset without same-run test DB preflight",
			);
		}
		await pool.query("drop schema if exists drizzle cascade");
		await pool.query("drop schema public cascade");
		await pool.query("create schema public authorization current_user");
		await pool.query("grant all on schema public to public");
		await migrate(database, { migrationsFolder: REAL_MIGRATIONS_FOLDER });
		await assertRecoveryState(pool);

		console.log("Migration recovery verification: passed");
	} finally {
		try {
			await pool?.end();
		} finally {
			if (temporaryDirectory) {
				await rm(temporaryDirectory, { recursive: true, force: true });
			}
		}
	}
}

const invokedPath = process.argv[1]
	? pathToFileURL(resolve(process.argv[1])).href
	: "";
if (import.meta.url === invokedPath) {
	run().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
