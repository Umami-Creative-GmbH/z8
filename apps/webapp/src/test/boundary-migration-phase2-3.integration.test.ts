/**
 * #1926: Real-PostgreSQL integration, concurrency, integrity, and scale suite for
 * Phase 2A/2B constraint migrations (0322-0326) and Phase 3 zero-DDL v1 sealing (0327).
 *
 * Covers every rollout, concurrency, integrity, and scale gate in Spec #1921 / Ticket #1926:
 * 1. Empty-DB full-journal bootstrap (0000-0327) + pg_constraint.conindid inspection & quoted legacy index drops.
 * 2. Zero-policy existing-org Drain Gate 2 stop at 0326 and full Compose/K8s Drain Gate matrix (0321 -> 0326 -> 0327)
 *    via the real production CLI runner (`migrate-with-lock.js`), plus pre-0322/0323 overlap pre-clean.
 * 3. Wrong-column and same-column DESC pre-0324 staging-index abort guards leaving the ledger untouched at 0323,
 *    plus pre-0324 final delta reconciliation.
 * 4. Bounded 500ms lock-timeout abort & retry on 0322 and 0323.
 * 5. Observed < 1000ms reader-wait gate on 0324/0326 under work_policy_schedule_day & location contention,
 *    plus parked-at-0326 policy creation & flag edit.
 * 6. Bidirectional 0327 lock ordering (editor-first and 0327-first), concurrent contract/assignment FK writes
 *    vs 0327 (zero deadlocks 40P01), four mismatched parent/version pairs (23503), violation cross-org /
 *    cross-policy / null-policy_id rejection (23503/23514), on-call IS TRUE check (23514) & default prohibition
 *    (23503), direct location delete refusal (23503) & full-org cascade teardown.
 * 7. 10,000-employee (~25k assignments, ~25k employment terms, ~25k violations) + 1,050-policy latency benchmark
 *    asserting < 2000ms on 0322/0323 and < 1000ms concurrent policy-writer wait through 0327 commit.
 */

import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	createVersionedWorkPolicy,
	updateOrPublishWorkPolicy,
} from "@/lib/work-policy/versioned-policy-writer";
import {
	integrationAdminPool,
	openIntegrationPool,
	parseIntegrationDatabaseUrl,
} from "@/test/integration-database";
import { migrationsFolderThrough } from "@/test/migrations-through";
import {
	extractPostgresErrorCode,
	runBoundaryAwareMigrations,
	runPhase1ChunkedBackfill,
} from "../../scripts/boundary-migration-engine.js";

const execute = promisify(execFile);
const appDirectory = fileURLToPath(new URL("../../", import.meta.url));
// This suite pins the 0000-0327 chain: migrations after 0327 are out of its scope.
const pinnedMigrations = await migrationsFolderThrough(
	fileURLToPath(new URL("../../drizzle", import.meta.url)),
	327,
);
const migrationsFolder = pinnedMigrations.folder;
afterAll(pinnedMigrations.cleanup);
const fullSchema = { ...authSchema, ...schema };

type Journal = {
	version: string;
	dialect: string;
	entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
};

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * Migrations after the 0327 seal in the real journal (0328 on, #1935): the engine applies them in
 * one `post_0327` stage right after the seal, so a run through the real folder ends there, with
 * the ledger at the journal's last prefix.
 */
const realJournal = JSON.parse(
	readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
) as Journal;
const LATEST_MIGRATION_PREFIX = Math.max(
	...realJournal.entries.map((entry) => Number.parseInt(entry.tag.slice(0, 4), 10)),
);
const POST_0327_STAGES = LATEST_MIGRATION_PREFIX > 327 ? ["post_0327"] : [];

function wrapPoolAsDrizzle(pool: Pool): DatabaseClient {
	return drizzle({ client: pool, schema: fullSchema }) as unknown as DatabaseClient;
}

async function createSiblingDatabase(
	prefix: string,
	maxConnections = 10,
): Promise<{
	databaseName: string;
	pool: Pool;
	cleanup: () => Promise<void>;
}> {
	const admin = integrationAdminPool();
	const databaseName = `approval_workflow_repository_test_${prefix}_${randomBytes(5).toString("hex")}`;
	await admin.query(`CREATE DATABASE "${databaseName}"`);
	const pool = openIntegrationPool({ databaseName, max: maxConnections });
	return {
		databaseName,
		pool,
		cleanup: async () => {
			await pool.end();
			await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
		},
	};
}

async function copyJournalUpTo(
	tempDir: string,
	maxPrefix: number,
): Promise<{ folder: string; journal: Journal }> {
	const folder = join(tempDir, `drizzle_${maxPrefix}_${randomBytes(3).toString("hex")}`);
	await cp(migrationsFolder, folder, { recursive: true });
	const journalPath = join(folder, "meta", "_journal.json");
	const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
	const filtered = {
		...journal,
		entries: journal.entries.filter(
			(entry) => Number.parseInt(entry.tag.slice(0, 4), 10) <= maxPrefix,
		),
	};
	await writeFile(journalPath, `${JSON.stringify(filtered, null, 2)}\n`);
	return { folder, journal: filtered };
}

async function runCliMigrationRunner(
	databaseName: string,
	extraEnv: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
	const config = parseIntegrationDatabaseUrl(
		process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL ?? "",
	);
	const url = new URL(config.databaseUrl);
	url.pathname = `/${databaseName}`;
	const env: NodeJS.ProcessEnv = {
		...process.env,
		DATABASE_URL: url.toString(),
		POSTGRES_HOST: url.hostname,
		POSTGRES_PORT: url.port,
		POSTGRES_DB: databaseName,
		POSTGRES_USER: decodeURIComponent(url.username),
		POSTGRES_PASSWORD: decodeURIComponent(url.password),
		POSTGRES_SSL_MODE: "disable",
		DRIZZLE_MIGRATIONS_FOLDER: migrationsFolder,
		...extraEnv,
	};
	delete env.DRIZZLE_MIGRATE_COMMAND;
	delete env.POSTGRES_SSL_CA_CERT;
	delete env.POSTGRES_SSL_ROOT_CERT_PATH;
	return execute(process.execPath, ["./scripts/migrate-with-lock.js"], {
		cwd: appDirectory,
		env,
		timeout: 60_000,
	});
}

async function readMaxAppliedPrefix(pool: Pool): Promise<number> {
	const journal = JSON.parse(
		await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
	) as Journal;
	const res = await pool.query<{ created_at: string }>(
		`SELECT created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`,
	);
	const latestWhen = Number(res.rows[0]?.created_at ?? 0);
	const entry = journal.entries.find((e) => e.when === latestWhen);
	return entry ? Number.parseInt(entry.tag.slice(0, 4), 10) : -1;
}

describe("Phase 2A/2B constraints, O(1) policy metadata swap, and zero-DDL v1 seal (0322-0327)", () => {
	it(
		"bootstraps an empty DB cleanly through 0000-0327 with isolated xids, exact pg_constraint.conindid backing indexes, dropped quoted legacy indexes, and zero violation immutability triggers",
		{ timeout: 120_000 },
		async () => {
			const sibling = await createSiblingDatabase("p23_empty");
			try {
				const committedStages: Array<{ stageId: string; tags: string[]; xid: string | null }> = [];
				const result = await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder,
					allowContractConstraints: true,
					allowPolicyV1Seal: true,
					logger: silentLogger,
					onStageCommitted: (info) => {
						committedStages.push(info);
					},
				});

				expect(result.stoppedAtGate).toBeNull();
				expect(result.appliedStages).toEqual([
					"historical_prefix_0000_0317",
					"phase1_expand_0318_0321",
					"phase2_0322",
					"phase2_0323",
					"phase2_0324",
					"phase2_0325",
					"phase2_0326",
					"phase2_0327",
					...POST_0327_STAGES,
				]);
				expect(committedStages).toHaveLength(8 + POST_0327_STAGES.length);
				expect(new Set(committedStages.map((s) => s.xid)).size).toBe(8 + POST_0327_STAGES.length);

				// Inspect pg_constraint.conindid for all 8 concurrently built & attached unique constraints
				const conindidRows = (
					await sibling.pool.query<{
						table_name: string;
						conname: string;
						index_name: string;
						indisvalid: boolean;
					}>(`
						SELECT
							tbl.relname AS table_name,
							con.conname,
							idx.relname AS index_name,
							i.indisvalid
						FROM pg_constraint con
						JOIN pg_class tbl ON tbl.oid = con.conrelid
						JOIN pg_class idx ON idx.oid = con.conindid
						JOIN pg_index i ON i.indexrelid = idx.oid
						WHERE con.conname IN (
							'work_policy_id_org_uidx',
							'employee_employment_history_id_org_uidx',
							'work_policy_schedule_version_uidx',
							'work_policy_schedule_id_version_uidx',
							'work_policy_presence_version_uidx',
							'work_policy_regulation_version_uidx',
							'work_policy_regulation_id_version_uidx',
							'work_policy_break_rule_id_version_uidx'
						)
						ORDER BY con.conname
					`)
				).rows;
				expect(conindidRows).toHaveLength(8);
				for (const row of conindidRows) {
					expect(row.index_name).toBe(row.conname);
					expect(row.indisvalid).toBe(true);
				}

				// Quoted mixed-case legacy assignment unique indexes MUST be dropped
				const droppedLegacyIndexes = (
					await sibling.pool.query<{ indexname: string }>(`
						SELECT indexname
						FROM pg_indexes
						WHERE schemaname = 'public'
							AND indexname IN ('workPolicyAssignment_org_default_idx', 'workPolicyAssignment_team_idx')
					`)
				).rows;
				expect(droppedLegacyIndexes).toEqual([]);

				// Legacy UNIQUE(policy_id) constraints and temporary NOT NULL checks MUST be dropped
				const droppedLegacyConstraints = (
					await sibling.pool.query<{ conname: string }>(`
						SELECT conname
						FROM pg_constraint
						WHERE conname IN (
							'work_policy_schedule_policy_id_unique',
							'work_policy_presence_policy_id_unique',
							'work_policy_regulation_policy_id_unique',
							'work_policy_schedule_policy_version_not_null_check',
							'work_policy_schedule_day_policy_version_not_null_check',
							'work_policy_presence_policy_version_not_null_check',
							'work_policy_regulation_policy_version_not_null_check',
							'work_policy_break_rule_policy_version_not_null_check',
							'work_policy_break_option_policy_version_not_null_check'
						)
					`)
				).rows;
				expect(droppedLegacyConstraints).toEqual([]);

				// All 6 policy child/grandchild policy_version_id columns are NOT NULL
				const notNullCols = (
					await sibling.pool.query<{ table_name: string; attnotnull: boolean }>(`
						SELECT c.relname AS table_name, a.attnotnull
						FROM pg_class c
						JOIN pg_attribute a ON a.attrelid = c.oid
						WHERE c.relnamespace = 'public'::regnamespace
							AND c.relname IN (
								'work_policy_schedule',
								'work_policy_schedule_day',
								'work_policy_presence',
								'work_policy_regulation',
								'work_policy_break_rule',
								'work_policy_break_option'
							)
							AND a.attname = 'policy_version_id'
							AND NOT a.attisdropped
						ORDER BY c.relname
					`)
				).rows;
				expect(notNullCols).toHaveLength(6);
				expect(notNullCols.every((c) => c.attnotnull === true)).toBe(true);

				// Replacement location FK is validated ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
				const locFk = (
					await sibling.pool.query<{
						confdeltype: string;
						condeferrable: boolean;
						condeferred: boolean;
						convalidated: boolean;
					}>(`
						SELECT confdeltype, condeferrable, condeferred, convalidated
						FROM pg_constraint
						WHERE conname = 'work_policy_presence_location_id_location_id_fk'
					`)
				).rows[0];
				expect(locFk).toEqual({
					confdeltype: "a",
					condeferrable: true,
					condeferred: true,
					convalidated: true,
				});

				// All 4 btree_gist exclusion constraints exist and are valid
				const exclConstraints = (
					await sibling.pool.query<{ conname: string; convalidated: boolean }>(`
						SELECT conname, convalidated
						FROM pg_constraint
						WHERE contype = 'x'
							AND conname IN (
								'work_policy_assignment_org_no_overlap_excl',
								'work_policy_assignment_team_no_overlap_excl',
								'work_policy_assignment_employee_no_overlap_excl',
								'employee_employment_history_confirmed_stint_no_overlap_excl'
							)
						ORDER BY conname
					`)
				).rows;
				expect(exclConstraints).toEqual([
					{
						conname: "employee_employment_history_confirmed_stint_no_overlap_excl",
						convalidated: true,
					},
					{ conname: "work_policy_assignment_employee_no_overlap_excl", convalidated: true },
					{ conname: "work_policy_assignment_org_no_overlap_excl", convalidated: true },
					{ conname: "work_policy_assignment_team_no_overlap_excl", convalidated: true },
				]);

				// Zero temporary bridge triggers remain; all 7 immutability triggers remain (never on violations)
				const remainingBridgeTriggers = (
					await sibling.pool.query<{ tgname: string }>(
						`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'trg_01_bridge_%'`,
					)
				).rows;
				expect(remainingBridgeTriggers).toEqual([]);

				const immutabilityTriggers = (
					await sibling.pool.query<{ relname: string; tgname: string }>(`
						SELECT c.relname, t.tgname
						FROM pg_trigger t
						JOIN pg_class c ON c.oid = t.tgrelid
						WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg_02_immutability_%'
						ORDER BY c.relname
					`)
				).rows;
				expect(immutabilityTriggers.map((r) => r.relname)).toEqual([
					"work_policy_break_option",
					"work_policy_break_rule",
					"work_policy_presence",
					"work_policy_regulation",
					"work_policy_schedule",
					"work_policy_schedule_day",
					"work_policy_version",
				]);

				// 0327 sealed cutover timestamp is recorded
				const cutoverState = (
					await sibling.pool.query<{ sealed_cutover_at: Date | null }>(
						`SELECT sealed_cutover_at FROM "work_policy_versioning_state" WHERE singleton = true`,
					)
				).rows[0];
				expect(cutoverState?.sealed_cutover_at).toBeInstanceOf(Date);
			} finally {
				await sibling.cleanup();
			}
		},
	);

	it(
		"enforces zero-policy existing-org Drain Gate 2 stop at 0326, full Compose/K8s Drain Gate CLI matrix (0321 -> 0326 -> 0327), and pre-0322/0323 overlap pre-clean",
		{ timeout: 120_000 },
		async () => {
			const sibling = await createSiblingDatabase("p23_gates");
			const tempDir = await mkdtemp(join(tmpdir(), "z8-p23-gates-"));
			try {
				// Start at 0317 with an existing org that has ZERO work_policy rows,
				// plus a second org with overlapping legacy assignments & overlapping confirmed terms
				const { folder: folder0317 } = await copyJournalUpTo(tempDir, 317);
				await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder: folder0317,
					logger: silentLogger,
				});

				const zeroPolicyOrgId = `org_zero_${randomBytes(4).toString("hex")}`;
				const userId = `usr_zero_${randomBytes(4).toString("hex")}`;
				const empId = randomUUID();
				const periodId = randomUUID();
				await sibling.pool.query(
					`INSERT INTO "organization" ("id", "name", "slug", "created_at", "timezone") VALUES ($1, 'Zero Policy Org', $1, now(), 'Europe/Berlin')`,
					[zeroPolicyOrgId],
				);
				await sibling.pool.query(
					`INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES ($1, 'Admin', $2, true, now(), now())`,
					[userId, `${userId}@example.test`],
				);
				await sibling.pool.query(
					`INSERT INTO "employee" ("id", "user_id", "organization_id", "role", "created_at", "updated_at") VALUES ($1, $2, $3, 'employee', now(), now())`,
					[empId, userId, zeroPolicyOrgId],
				);
				await sibling.pool.query(
					`INSERT INTO "employee_employment_period" ("id", "organization_id", "employee_id", "status", "started_at", "start_provenance")
					 VALUES ($1, $2, $3, 'open', '2026-01-01T00:00:00Z', 'recorded')`,
					[periodId, zeroPolicyOrgId, empId],
				);
				// Seed two overlapping confirmed terms in the same stint (pre-0323 overlap pre-clean must clamp them!)
				await sibling.pool.query(
					`INSERT INTO "employee_employment_history" (
						"employee_id", "organization_id", "employment_period_id", "valid_from", "valid_until",
						"contract_type", "weekly_contract_minutes", "work_model", "review_state", "created_by", "created_at", "updated_at"
					) VALUES
						($1, $2, $3, '2026-01-01 00:00:00', NULL, 'fixed', 2400, 'onsite', 'confirmed', $4, '2026-01-01 00:00:00', now()),
						($1, $2, $3, '2026-04-01 00:00:00', NULL, 'fixed', 1920, 'hybrid', 'confirmed', $4, '2026-02-01 00:00:00', now())`,
					[empId, zeroPolicyOrgId, periodId, userId],
				);

				// Confirm literally 0 work_policy rows exist
				const policyCount = Number(
					(
						await sibling.pool.query<{ count: string }>(
							`SELECT COUNT(*) AS count FROM "work_policy"`,
						)
					).rows[0]?.count,
				);
				expect(policyCount).toBe(0);

				// Step 1: Production CLI runner with Compose/K8s defaults (both false) -> MUST stop at 0321
				await runCliMigrationRunner(sibling.databaseName, {
					DB_ALLOW_CONTRACT_CONSTRAINTS: "false",
					DB_ALLOW_POLICY_V1_SEAL: "false",
				});
				expect(await readMaxAppliedPrefix(sibling.pool)).toBe(321);

				// Step 2: Authorize Drain Gate 1 ONLY -> MUST advance through 0326 and STOP at 0326 even with 0 policies!
				await runCliMigrationRunner(sibling.databaseName, {
					DB_ALLOW_CONTRACT_CONSTRAINTS: "true",
					DB_ALLOW_POLICY_V1_SEAL: "false",
				});
				expect(await readMaxAppliedPrefix(sibling.pool)).toBe(326);
				const cutoverAt0326 = (
					await sibling.pool.query<{ sealed_cutover_at: Date | null }>(
						`SELECT sealed_cutover_at FROM "work_policy_versioning_state" WHERE singleton = true`,
					)
				).rows[0];
				expect(cutoverAt0326?.sealed_cutover_at).toBeNull();

				// Verify overlapping confirmed terms were pre-cleaned & logged as legacy_terms_overlap
				const clampedTerms = (
					await sibling.pool.query<{ valid_from_date: string; valid_until_date: string | null }>(
						`SELECT valid_from_date::text, valid_until_date::text FROM "employee_employment_history" WHERE employee_id = $1 ORDER BY valid_from_date`,
						[empId],
					)
				).rows;
				expect(clampedTerms).toEqual([
					{ valid_from_date: "2026-01-01", valid_until_date: "2026-04-01" },
					{ valid_from_date: "2026-04-01", valid_until_date: null },
				]);
				const overlapConflicts = (
					await sibling.pool.query<{ conflict_kind: string }>(
						`SELECT conflict_kind FROM "contract_migration_conflict" WHERE organization_id = $1 AND conflict_kind = 'legacy_terms_overlap'`,
						[zeroPolicyOrgId],
					)
				).rows;
				expect(overlapConflicts).toHaveLength(1);

				// Step 3: Authorize Drain Gate 2 -> MUST apply 0327 and set sealed_cutover_at
				await runCliMigrationRunner(sibling.databaseName, {
					DB_ALLOW_CONTRACT_CONSTRAINTS: "true",
					DB_ALLOW_POLICY_V1_SEAL: "true",
				});
				expect(await readMaxAppliedPrefix(sibling.pool)).toBe(LATEST_MIGRATION_PREFIX);
				const cutoverAt0327 = (
					await sibling.pool.query<{ sealed_cutover_at: Date | null }>(
						`SELECT sealed_cutover_at FROM "work_policy_versioning_state" WHERE singleton = true`,
					)
				).rows[0];
				expect(cutoverAt0327?.sealed_cutover_at).toBeInstanceOf(Date);

				// Step 4 (F1 regression): once 0327 is applied, a future post-0327 migration (0328)
				// MUST run cleanly even when BOTH drain-gate flags are false (the Compose/K8s defaults)!
				const postCutoverDir = await mkdtemp(join(tmpdir(), "z8-phase3-post0327-"));
				try {
					await cp(migrationsFolder, postCutoverDir, { recursive: true });
					const postMetaDir = join(postCutoverDir, "meta");
					const fullJournal = JSON.parse(
						await readFile(join(postMetaDir, "_journal.json"), "utf8"),
					) as {
						version: string;
						dialect: string;
						entries: Array<{
							idx: number;
							version: string;
							when: number;
							tag: string;
							breakpoints: boolean;
						}>;
					};
					const maxWhen = Math.max(...fullJournal.entries.map((e) => e.when));
					fullJournal.entries.push({
						idx: fullJournal.entries.length,
						version: "7",
						when: maxWhen + 86_400_000,
						tag: "0328_post_cutover_probe",
						breakpoints: true,
					});
					await writeFile(
						join(postCutoverDir, "0328_post_cutover_probe.sql"),
						`CREATE TABLE IF NOT EXISTS "z8_post_0327_probe" ("id" integer PRIMARY KEY);\n`,
						"utf8",
					);
					await writeFile(
						join(postMetaDir, "_journal.json"),
						JSON.stringify(fullJournal, null, 2),
						"utf8",
					);

					const postResult = await runBoundaryAwareMigrations({
						pool: sibling.pool,
						migrationsFolder: postCutoverDir,
						allowContractConstraints: false,
						allowPolicyV1Seal: false,
						logger: silentLogger,
					});
					expect(postResult.stoppedAtGate).toBeNull();
					expect(postResult.appliedStages).toEqual(["post_0327"]);
					const maxLedgerCreatedAt = Number(
						(
							await sibling.pool.query<{ max_created_at: string }>(
								`SELECT MAX(created_at)::text AS max_created_at FROM drizzle.__drizzle_migrations`,
							)
						).rows[0]?.max_created_at,
					);
					expect(maxLedgerCreatedAt).toBe(maxWhen + 86_400_000);
					const probeExists = await sibling.pool.query<{ exists: boolean }>(
						`SELECT to_regclass('public.z8_post_0327_probe') IS NOT NULL AS exists`,
					);
					expect(probeExists.rows[0]?.exists).toBe(true);
				} finally {
					await rm(postCutoverDir, { recursive: true, force: true });
				}
			} finally {
				await sibling.cleanup();
				await rm(tempDir, { recursive: true, force: true });
			}
		},
	);

	it(
		"aborts pre-0324 without dropping or advancing the ledger on wrong-column and same-column DESC staging indexes, and reconciles delta child/violation rows before 0324",
		{ timeout: 120_000 },
		async () => {
			const sibling = await createSiblingDatabase("p23_idx_guard");
			const tempDir = await mkdtemp(join(tmpdir(), "z8-p23-idx-"));
			try {
				const { folder: folder0323 } = await copyJournalUpTo(tempDir, 323);
				await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder: folder0323,
					allowContractConstraints: true,
					allowPolicyV1Seal: false,
					logger: silentLogger,
				});
				expect(await readMaxAppliedPrefix(sibling.pool)).toBe(323);

				// Seed an org/policy and force a NULL policy_version_id row (simulating a pre-cutover delta write)
				// by temporarily disabling bridge triggers on a synthetic delta row to prove pre-0324 reconciliation catches it
				const orgId = `org_delta_${randomBytes(4).toString("hex")}`;
				const userId = `usr_delta_${randomBytes(4).toString("hex")}`;
				const empId = randomUUID();
				const policyId = randomUUID();
				await sibling.pool.query(
					`INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES ($1, 'Delta Org', $1, now())`,
					[orgId],
				);
				await sibling.pool.query(
					`INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES ($1, 'Admin', $2, true, now(), now())`,
					[userId, `${userId}@example.test`],
				);
				await sibling.pool.query(
					`INSERT INTO "employee" ("id", "user_id", "organization_id", "role", "created_at", "updated_at") VALUES ($1, $2, $3, 'employee', now(), now())`,
					[empId, userId, orgId],
				);
				await sibling.pool.query(
					`INSERT INTO "work_policy" ("id", "organization_id", "name", "schedule_enabled", "regulation_enabled", "presence_enabled", "created_by", "created_at", "updated_at")
					 VALUES ($1, $2, 'Delta Policy', true, false, false, $3, now(), now())`,
					[policyId, orgId, userId],
				);
				// Insert a schedule row then NULL its policy_version_id (still allowed at 0323 before 0324/0326)
				const schedRes = await sibling.pool.query<{ id: string }>(
					`INSERT INTO "work_policy_schedule" ("policy_id", "schedule_cycle", "schedule_type", "working_days_preset", "hours_per_cycle", "created_at", "updated_at")
					 VALUES ($1, 'weekly', 'simple', 'weekdays', 40.00, now(), now()) RETURNING id`,
					[policyId],
				);
				await sibling.pool.query(
					`UPDATE "work_policy_schedule" SET "policy_version_id" = NULL WHERE id = $1`,
					[schedRes.rows[0]!.id],
				);
				const violRes = await sibling.pool.query<{ id: string }>(
					`INSERT INTO "work_policy_violation" ("employee_id", "organization_id", "policy_id", "violation_date", "violation_type")
					 VALUES ($1, $2, $3, now(), 'max_daily') RETURNING id`,
					[empId, orgId, policyId],
				);
				await sibling.pool.query(
					`UPDATE "work_policy_violation" SET "policy_version_id" = NULL WHERE id = $1`,
					[violRes.rows[0]!.id],
				);

				const ledgerAt0323 = (
					await sibling.pool.query(
						`SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at`,
					)
				).rows;

				// 1. Wrong-column valid same-name index on work_policy_schedule (reversed order)
				await sibling.pool.query(
					`CREATE UNIQUE INDEX "work_policy_schedule_id_version_uidx" ON "public"."work_policy_schedule" ("policy_version_id", "id")`,
				);
				await expect(
					runBoundaryAwareMigrations({
						pool: sibling.pool,
						migrationsFolder,
						allowContractConstraints: true,
						allowPolicyV1Seal: false,
						logger: silentLogger,
					}),
				).rejects.toThrow(/work_policy_schedule_id_version_uidx.*key column/i);

				// Mismatched index MUST NOT be dropped and ledger MUST stay at 0323
				expect(
					(
						await sibling.pool.query(
							`SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'work_policy_schedule_id_version_uidx'`,
						)
					).rowCount,
				).toBe(1);
				expect(
					(
						await sibling.pool.query(
							`SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at`,
						)
					).rows,
				).toEqual(ledgerAt0323);
				await sibling.pool.query(`DROP INDEX "public"."work_policy_schedule_id_version_uidx"`);

				// 2. Same-column DESC valid same-name index on work_policy_regulation (indoption != 0)
				await sibling.pool.query(
					`CREATE UNIQUE INDEX "work_policy_regulation_version_uidx" ON "public"."work_policy_regulation" ("policy_version_id" DESC)`,
				);
				await expect(
					runBoundaryAwareMigrations({
						pool: sibling.pool,
						migrationsFolder,
						allowContractConstraints: true,
						allowPolicyV1Seal: false,
						logger: silentLogger,
					}),
				).rejects.toThrow(/work_policy_regulation_version_uidx.*indoption/i);

				// DESC index MUST NOT be dropped and ledger MUST stay at 0323
				expect(
					(
						await sibling.pool.query(
							`SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'work_policy_regulation_version_uidx'`,
						)
					).rowCount,
				).toBe(1);
				expect(
					(
						await sibling.pool.query(
							`SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at`,
						)
					).rows,
				).toEqual(ledgerAt0323);
				await sibling.pool.query(`DROP INDEX "public"."work_policy_regulation_version_uidx"`);

				// 3. Removing the bad index lets pre-0324 delta reconciliation + 0324-0326 succeed cleanly!
				const resumed = await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder,
					allowContractConstraints: true,
					allowPolicyV1Seal: false,
					logger: silentLogger,
				});
				expect(resumed.stoppedAtGate).toBe("drain_gate_2");
				expect(await readMaxAppliedPrefix(sibling.pool)).toBe(326);

				// Verify the delta schedule & violation rows were reconciled before 0324/0325/0326
				const reconciledSched = (
					await sibling.pool.query<{ policy_version_id: string | null }>(
						`SELECT policy_version_id FROM "work_policy_schedule" WHERE id = $1`,
						[schedRes.rows[0]!.id],
					)
				).rows[0];
				const reconciledViol = (
					await sibling.pool.query<{ policy_version_id: string | null }>(
						`SELECT policy_version_id FROM "work_policy_violation" WHERE id = $1`,
						[violRes.rows[0]!.id],
					)
				).rows[0];
				expect(reconciledSched?.policy_version_id).toBeTruthy();
				expect(reconciledViol?.policy_version_id).toBeTruthy();
			} finally {
				await sibling.cleanup();
				await rm(tempDir, { recursive: true, force: true });
			}
		},
	);

	it(
		"enforces bounded 500ms lock-timeout abort (SQLSTATE 55P03) and retries cleanly on 0322 and 0323",
		{ timeout: 120_000 },
		async () => {
			const sibling = await createSiblingDatabase("p23_lock500");
			const tempDir = await mkdtemp(join(tmpdir(), "z8-p23-lock500-"));
			try {
				const { folder: folder0322 } = await copyJournalUpTo(tempDir, 322);
				const { folder: folder0323 } = await copyJournalUpTo(tempDir, 323);

				await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder,
					allowContractConstraints: false,
					allowPolicyV1Seal: false,
					logger: silentLogger,
				});
				expect(await readMaxAppliedPrefix(sibling.pool)).toBe(321);

				// --- 0322: bounded 500ms abort when lockRetries = 0, then retry success when blocker releases ---
				const blocker0322 = await sibling.pool.connect();
				try {
					await blocker0322.query("BEGIN");
					await blocker0322.query(`SELECT 1 FROM "work_policy_assignment" LIMIT 1`);

					const t0 = performance.now();
					let caught0322: unknown = null;
					try {
						await runBoundaryAwareMigrations({
							pool: sibling.pool,
							migrationsFolder: folder0322,
							allowContractConstraints: true,
							allowPolicyV1Seal: false,
							lockRetries: 0,
							logger: silentLogger,
						});
					} catch (error) {
						caught0322 = error;
					}
					const abortElapsedMs = performance.now() - t0;
					expect(extractPostgresErrorCode(caught0322)).toBe("55P03");
					expect(abortElapsedMs).toBeGreaterThanOrEqual(400);
					expect(abortElapsedMs).toBeLessThan(2000);
					expect(await readMaxAppliedPrefix(sibling.pool)).toBe(321);

					// Now run with retries enabled and release the blocker after 650ms (past first 500ms abort)
					const releaseTimer = setTimeout(() => {
						void blocker0322.query("COMMIT");
					}, 650);
					try {
						const res0322 = await runBoundaryAwareMigrations({
							pool: sibling.pool,
							migrationsFolder: folder0322,
							allowContractConstraints: true,
							allowPolicyV1Seal: false,
							lockRetries: 10,
							retryBaseDelayMs: 100,
							retryMaxDelayMs: 250,
							logger: silentLogger,
						});
						expect(res0322.appliedStages).toEqual(["phase2_0322"]);
						expect(await readMaxAppliedPrefix(sibling.pool)).toBe(322);
					} finally {
						clearTimeout(releaseTimer);
					}
				} finally {
					await blocker0322.query("ROLLBACK").catch(() => {});
					blocker0322.release();
				}

				// --- 0323: bounded 500ms abort when lockRetries = 0, then retry success when blocker releases ---
				const blocker0323 = await sibling.pool.connect();
				try {
					await blocker0323.query("BEGIN");
					await blocker0323.query(`SELECT 1 FROM "employee_employment_history" LIMIT 1`);

					const t0 = performance.now();
					let caught0323: unknown = null;
					try {
						await runBoundaryAwareMigrations({
							pool: sibling.pool,
							migrationsFolder: folder0323,
							allowContractConstraints: true,
							allowPolicyV1Seal: false,
							lockRetries: 0,
							logger: silentLogger,
						});
					} catch (error) {
						caught0323 = error;
					}
					const abortElapsedMs = performance.now() - t0;
					expect(extractPostgresErrorCode(caught0323)).toBe("55P03");
					expect(abortElapsedMs).toBeGreaterThanOrEqual(400);
					expect(abortElapsedMs).toBeLessThan(2000);
					expect(await readMaxAppliedPrefix(sibling.pool)).toBe(322);

					const releaseTimer = setTimeout(() => {
						void blocker0323.query("COMMIT");
					}, 650);
					try {
						const res0323 = await runBoundaryAwareMigrations({
							pool: sibling.pool,
							migrationsFolder: folder0323,
							allowContractConstraints: true,
							allowPolicyV1Seal: false,
							lockRetries: 10,
							retryBaseDelayMs: 100,
							retryMaxDelayMs: 250,
							logger: silentLogger,
						});
						expect(res0323.appliedStages).toEqual(["phase2_0323"]);
						expect(await readMaxAppliedPrefix(sibling.pool)).toBe(323);
					} finally {
						clearTimeout(releaseTimer);
					}
				} finally {
					await blocker0323.query("ROLLBACK").catch(() => {});
					blocker0323.release();
				}
			} finally {
				await sibling.cleanup();
				await rm(tempDir, { recursive: true, force: true });
			}
		},
	);

	it(
		"maintains observed < 1000ms reader wait on 0324/0326 under work_policy_schedule_day and location contention, and supports parked-at-0326 policy creation & flag edit",
		{ timeout: 120_000 },
		async () => {
			const sibling = await createSiblingDatabase("p23_nowait", 12);
			const tempDir = await mkdtemp(join(tmpdir(), "z8-p23-nowait-"));
			try {
				const { folder: folder0323 } = await copyJournalUpTo(tempDir, 323);
				await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder: folder0323,
					allowContractConstraints: true,
					allowPolicyV1Seal: false,
					logger: silentLogger,
				});

				// Seed org, user, location, policy + schedule_day
				const orgId = `org_nw_${randomBytes(4).toString("hex")}`;
				const userId = `usr_nw_${randomBytes(4).toString("hex")}`;
				const locId = randomUUID();
				const policyId = randomUUID();
				await sibling.pool.query(
					`INSERT INTO "organization" ("id", "name", "slug", "created_at", "timezone") VALUES ($1, 'Nowait Co', $1, now(), 'Europe/Berlin')`,
					[orgId],
				);
				await sibling.pool.query(
					`INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES ($1, 'Admin', $2, true, now(), now())`,
					[userId, `${userId}@example.test`],
				);
				await sibling.pool.query(
					`INSERT INTO "location" ("id", "organization_id", "name", "is_active", "created_by", "created_at", "updated_at")
					 VALUES ($1, $2, 'HQ', true, $3, now(), now())`,
					[locId, orgId, userId],
				);
				await sibling.pool.query(
					`INSERT INTO "work_policy" ("id", "organization_id", "name", "schedule_enabled", "regulation_enabled", "presence_enabled", "created_by", "created_at", "updated_at")
					 VALUES ($1, $2, 'Base Policy', true, false, true, $3, now(), now())`,
					[policyId, orgId, userId],
				);
				const schedRes = await sibling.pool.query<{ id: string }>(
					`INSERT INTO "work_policy_schedule" ("policy_id", "schedule_cycle", "schedule_type", "working_days_preset", "created_at", "updated_at")
					 VALUES ($1, 'weekly', 'detailed', 'custom', now(), now()) RETURNING id`,
					[policyId],
				);
				await sibling.pool.query(
					`INSERT INTO "work_policy_schedule_day" ("schedule_id", "day_of_week", "hours_per_day", "is_work_day", "cycle_week")
					 VALUES ($1, 'monday', 8.00, true, 1)`,
					[schedRes.rows[0]!.id],
				);
				await sibling.pool.query(
					`INSERT INTO "work_policy_presence" ("policy_id", "presence_mode", "required_onsite_days", "location_id", "created_at", "updated_at")
					 VALUES ($1, 'minimum_count', 2, $2, now(), now())`,
					[policyId, locId],
				);

				// Hold ACCESS SHARE contention on BOTH work_policy_schedule_day AND location while running 0324-0326,
				// and continuously probe reader latency on a third connection!
				const holderScheduleDay = await sibling.pool.connect();
				const holderLocation = await sibling.pool.connect();
				const readerClient = await sibling.pool.connect();
				let stopReading = false;
				let maxReaderWaitMs = 0;
				let readSamples = 0;

				try {
					await holderScheduleDay.query("BEGIN");
					await holderScheduleDay.query(`SELECT COUNT(*) FROM "work_policy_schedule_day"`);
					await holderLocation.query("BEGIN");
					await holderLocation.query(`SELECT COUNT(*) FROM "location"`);

					const readerLoop = (async () => {
						while (!stopReading) {
							const start = performance.now();
							await readerClient.query(`SELECT COUNT(*) FROM "work_policy_schedule_day"`);
							await readerClient.query(`SELECT COUNT(*) FROM "location"`);
							const elapsed = performance.now() - start;
							if (elapsed > maxReaderWaitMs) maxReaderWaitMs = elapsed;
							readSamples += 1;
							await new Promise((resolve) => setTimeout(resolve, 15));
						}
					})();

					// Release the two contenders staggered at 350ms and 600ms (proving NOWAIT retries cleanly without queueing behind readers!)
					const t1 = setTimeout(() => {
						void holderScheduleDay.query("COMMIT");
					}, 350);
					const t2 = setTimeout(() => {
						void holderLocation.query("COMMIT");
					}, 600);

					try {
						const res = await runBoundaryAwareMigrations({
							pool: sibling.pool,
							migrationsFolder,
							allowContractConstraints: true,
							allowPolicyV1Seal: false,
							lockRetries: 40,
							retryBaseDelayMs: 40,
							retryMaxDelayMs: 120,
							logger: silentLogger,
						});
						expect(res.stoppedAtGate).toBe("drain_gate_2");
						expect(res.appliedStages).toEqual(["phase2_0324", "phase2_0325", "phase2_0326"]);
					} finally {
						clearTimeout(t1);
						clearTimeout(t2);
						stopReading = true;
						await readerLoop;
					}
				} finally {
					await holderScheduleDay.query("ROLLBACK").catch(() => {});
					await holderLocation.query("ROLLBACK").catch(() => {});
					holderScheduleDay.release();
					holderLocation.release();
					readerClient.release();
				}

				expect(readSamples).toBeGreaterThan(5);
				expect(maxReaderWaitMs).toBeLessThan(1000);

				// While parked at 0326 (bridge triggers dropped, sealed_cutover_at IS NULL):
				// Policy creation & enablement flag edits MUST succeed cleanly!
				const db = wrapPoolAsDrizzle(sibling.pool);
				const createdParked = await createVersionedWorkPolicy(db, {
					organizationId: orgId,
					actorUserId: userId,
					data: {
						name: "Parked 0326 Policy",
						scheduleEnabled: true,
						regulationEnabled: true,
						presenceEnabled: true,
						schedule: {
							scheduleCycle: "weekly",
							scheduleType: "simple",
							workingDaysPreset: "weekdays",
							hoursPerCycle: "40",
						},
						regulation: {
							maxDailyMinutes: 600,
							minRestPeriodMinutes: 660,
							restPeriodEnforcement: "block",
							breakRules: [],
						},
						presence: {
							presenceMode: "minimum_count",
							requiredOnsiteDays: 3,
							locationId: locId,
							evaluationPeriod: "weekly",
							enforcement: "warn",
						},
					},
				});
				expect(createdParked.version.versionNumber).toBe(1);
				expect(createdParked.version.sealedAt).toBeNull();

				const editedParked = await updateOrPublishWorkPolicy(db, {
					organizationId: orgId,
					actorUserId: userId,
					policyId: createdParked.policy.id,
					data: {
						scheduleEnabled: false,
						presenceEnabled: false,
					},
				});
				expect(editedParked.version.versionNumber).toBe(1);
				expect(editedParked.version.sealedAt).toBeNull();
				expect(editedParked.version.scheduleEnabled).toBe(false);
				expect(editedParked.version.presenceEnabled).toBe(false);

				// Both work_policy AND unsealed work_policy_version v1 reflect the updated flags!
				const syncedFlags = (
					await sibling.pool.query<{
						wp_sched: boolean;
						wp_pres: boolean;
						v_sched: boolean;
						v_pres: boolean;
					}>(
						`SELECT wp.schedule_enabled AS wp_sched, wp.presence_enabled AS wp_pres,
						        v.schedule_enabled AS v_sched, v.presence_enabled AS v_pres
						 FROM "work_policy" wp
						 JOIN "work_policy_version" v ON v.policy_id = wp.id AND v.version_number = 1
						 WHERE wp.id = $1`,
						[createdParked.policy.id],
					)
				).rows[0];
				expect(syncedFlags).toEqual({
					wp_sched: false,
					wp_pres: false,
					v_sched: false,
					v_pres: false,
				});
			} finally {
				await sibling.cleanup();
				await rm(tempDir, { recursive: true, force: true });
			}
		},
	);

	it(
		"proves bidirectional 0327 lock ordering (editor-first & 0327-first), concurrent FK writes with zero deadlocks (40P01), all 4 mismatched parent/version pairs (23503), violation guards (23503/23514), on-call IS TRUE check & default prohibition, and location delete refusal vs full-org teardown",
		{ timeout: 120_000 },
		async () => {
			const dbEditorFirst = await createSiblingDatabase("p23_0327_ef", 12);
			const dbSealFirst = await createSiblingDatabase("p23_0327_sf", 12);
			try {
				// Bootstrap both sibling DBs to Drain Gate 2 (parked at 0326)
				await Promise.all([
					runBoundaryAwareMigrations({
						pool: dbEditorFirst.pool,
						migrationsFolder,
						allowContractConstraints: true,
						allowPolicyV1Seal: false,
						logger: silentLogger,
					}),
					runBoundaryAwareMigrations({
						pool: dbSealFirst.pool,
						migrationsFolder,
						allowContractConstraints: true,
						allowPolicyV1Seal: false,
						logger: silentLogger,
					}),
				]);

				// --- Part A: Editor-first vs 0327 + concurrent assignment/contract FK writes (zero 40P01) ---
				const orgA = `org_ef_${randomBytes(4).toString("hex")}`;
				const userA = `usr_ef_${randomBytes(4).toString("hex")}`;
				const empA = randomUUID();
				await dbEditorFirst.pool.query(
					`INSERT INTO "organization" ("id", "name", "slug", "created_at", "timezone") VALUES ($1, 'EF Org', $1, now(), 'Europe/Berlin')`,
					[orgA],
				);
				await dbEditorFirst.pool.query(
					`INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES ($1, 'Admin', $2, true, now(), now())`,
					[userA, `${userA}@example.test`],
				);
				await dbEditorFirst.pool.query(
					`INSERT INTO "employee" ("id", "user_id", "organization_id", "role", "created_at", "updated_at") VALUES ($1, $2, $3, 'employee', now(), now())`,
					[empA, userA, orgA],
				);
				const createdA = await createVersionedWorkPolicy(wrapPoolAsDrizzle(dbEditorFirst.pool), {
					organizationId: orgA,
					actorUserId: userA,
					data: {
						name: "Race Policy A",
						scheduleEnabled: true,
						regulationEnabled: false,
						presenceEnabled: false,
						schedule: {
							scheduleCycle: "weekly",
							scheduleType: "simple",
							workingDaysPreset: "weekdays",
							hoursPerCycle: "40",
						},
					},
				});

				// Seed a contract_template for concurrent FK inserts against work_policy during 0327
				const tplId = randomUUID();
				await dbEditorFirst.pool.query(
					`INSERT INTO "contract_template" ("id", "organization_id", "name") VALUES ($1, $2, 'FK Race Tpl')`,
					[tplId, orgA],
				);

				// Editor acquires work_policy FOR UPDATE first, holds 200ms while 0327 + concurrent FK writers run
				const editorClient = await dbEditorFirst.pool.connect();
				try {
					await editorClient.query("BEGIN");
					await editorClient.query(`SELECT id FROM "work_policy" WHERE id = $1 FOR UPDATE`, [
						createdA.policy.id,
					]);

					const sealPromise = runBoundaryAwareMigrations({
						pool: dbEditorFirst.pool,
						migrationsFolder,
						allowContractConstraints: true,
						allowPolicyV1Seal: true,
						lockRetries: 10,
						retryBaseDelayMs: 50,
						retryMaxDelayMs: 150,
						logger: silentLogger,
					});

					// Concurrent contract_template_version & work_policy_assignment FK writers targeting work_policy
					const fkWriters = Promise.all(
						[1, 2, 3, 4].map(async (versionNum) => {
							await dbEditorFirst.pool.query(
								`INSERT INTO "contract_template_version" ("organization_id", "template_id", "version_number", "work_policy_id")
								 VALUES ($1, $2, $3, $4)`,
								[orgA, tplId, versionNum, createdA.policy.id],
							);
						}),
					);
					const assignWriter = dbEditorFirst.pool.query(
						`INSERT INTO "work_policy_assignment" (
							"policy_id", "organization_id", "assignment_type", "employee_id",
							"priority", "effective_from_date", "source_kind", "is_active", "created_by", "created_at", "updated_at"
						) VALUES ($1, $2, 'employee', $3, 2, DATE '2026-01-01', 'manager_assignment', true, $4, now(), now())`,
						[createdA.policy.id, orgA, empA, userA],
					);

					await new Promise((resolve) => setTimeout(resolve, 200));
					// Editor updates unsealed v1 flag before committing
					await editorClient.query(
						`UPDATE "work_policy" SET "regulation_enabled" = true WHERE id = $1`,
						[createdA.policy.id],
					);
					await editorClient.query(
						`UPDATE "work_policy_version" SET "regulation_enabled" = true WHERE id = $1 AND "sealed_at" IS NULL`,
						[createdA.version.id],
					);
					await editorClient.query("COMMIT");

					const [sealRes] = await Promise.all([sealPromise, fkWriters, assignWriter]);
					expect(sealRes.appliedStages).toEqual(["phase2_0327", ...POST_0327_STAGES]);
				} finally {
					await editorClient.query("ROLLBACK").catch(() => {});
					editorClient.release();
				}

				const v1AfterEditorFirst = (
					await dbEditorFirst.pool.query<{ regulation_enabled: boolean; sealed_at: Date | null }>(
						`SELECT regulation_enabled, sealed_at FROM "work_policy_version" WHERE id = $1`,
						[createdA.version.id],
					)
				).rows[0];
				expect(v1AfterEditorFirst?.regulation_enabled).toBe(true);
				expect(v1AfterEditorFirst?.sealed_at).toBeInstanceOf(Date);

				// --- Part B: 0327-first vs editor (editor waits on work_policy, wakes post-commit, publishes v2!) ---
				const orgB = `org_sf_${randomBytes(4).toString("hex")}`;
				const userB = `usr_sf_${randomBytes(4).toString("hex")}`;
				await dbSealFirst.pool.query(
					`INSERT INTO "organization" ("id", "name", "slug", "created_at", "timezone") VALUES ($1, 'SF Org', $1, now(), 'Europe/Berlin')`,
					[orgB],
				);
				await dbSealFirst.pool.query(
					`INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES ($1, 'Admin', $2, true, now(), now())`,
					[userB, `${userB}@example.test`],
				);
				const createdB = await createVersionedWorkPolicy(wrapPoolAsDrizzle(dbSealFirst.pool), {
					organizationId: orgB,
					actorUserId: userB,
					data: {
						name: "Race Policy B",
						scheduleEnabled: true,
						regulationEnabled: false,
						presenceEnabled: false,
						schedule: {
							scheduleCycle: "weekly",
							scheduleType: "simple",
							workingDaysPreset: "weekdays",
							hoursPerCycle: "40",
						},
					},
				});

				const sealSql = await readFile(
					join(migrationsFolder, "0327_work_policy_v1_seal.sql"),
					"utf8",
				);
				const sealStatements = sealSql
					.split("--> statement-breakpoint")
					.map((s) => s.trim())
					.filter(Boolean);

				const sealClient = await dbSealFirst.pool.connect();
				try {
					await sealClient.query("BEGIN");
					for (const stmt of sealStatements) {
						await sealClient.query(stmt);
					}

					// Start editor while 0327 still holds EXCLUSIVE on work_policy
					const editorPromise = updateOrPublishWorkPolicy(wrapPoolAsDrizzle(dbSealFirst.pool), {
						organizationId: orgB,
						actorUserId: userB,
						policyId: createdB.policy.id,
						data: {
							schedule: {
								scheduleCycle: "weekly",
								scheduleType: "simple",
								workingDaysPreset: "weekdays",
								hoursPerCycle: "35",
							},
						},
					});

					await new Promise((resolve) => setTimeout(resolve, 150));
					await sealClient.query("COMMIT");

					const publishedResult = await editorPromise;
					expect(publishedResult.version.versionNumber).toBe(2);
					expect(publishedResult.version.sealedAt).toBeInstanceOf(Date);
				} finally {
					await sealClient.query("ROLLBACK").catch(() => {});
					sealClient.release();
				}

				// --- Part C: Integrity guards on post-0327 schema ---
				const pool = dbEditorFirst.pool;
				const orgOther = `org_other_${randomBytes(4).toString("hex")}`;
				const locId = randomUUID();
				await pool.query(
					`INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES ($1, 'Other Org', $1, now())`,
					[orgOther],
				);
				await pool.query(
					`INSERT INTO "location" ("id", "organization_id", "name", "is_active", "created_by", "created_at", "updated_at")
					 VALUES ($1, $2, 'Protected HQ', true, $3, now(), now())`,
					[locId, orgA, userA],
				);

				// Create two policies (P1 with unsealed v1 & v2; P2 with v1) to test all 4 mismatched parent/version pairs (23503)
				const p1Id = randomUUID();
				const p2Id = randomUUID();
				const p1v1Id = randomUUID();
				const p1v2Id = randomUUID();
				const p2v1Id = randomUUID();
				await pool.query(
					`INSERT INTO "work_policy" ("id", "organization_id", "name", "schedule_enabled", "regulation_enabled", "presence_enabled", "created_by", "created_at", "updated_at")
					 VALUES
						($1, $3, 'Integrity P1', true, true, true, $4, now(), now()),
						($2, $3, 'Integrity P2', true, true, true, $4, now(), now())`,
					[p1Id, p2Id, orgA, userA],
				);
				await pool.query(
					`INSERT INTO "work_policy_version" (
						"id", "organization_id", "policy_id", "version_number", "effective_from_date",
						"schedule_enabled", "regulation_enabled", "presence_enabled", "sealed_at", "created_by"
					) VALUES
						($1, $4, $5, 1, DATE '2026-01-01', true, true, true, NULL, $7),
						($2, $4, $5, 2, DATE '2026-06-01', true, true, true, NULL, $7),
						($3, $4, $6, 1, DATE '2026-01-01', true, true, true, NULL, $7)`,
					[p1v1Id, p1v2Id, p2v1Id, orgA, p1Id, p2Id, userA],
				);

				// Valid schedule, regulation, break_rule, and presence on p1v1Id
				const sched1Id = randomUUID();
				const reg1Id = randomUUID();
				const br1Id = randomUUID();
				await pool.query(
					`INSERT INTO "work_policy_schedule" ("id", "policy_id", "policy_version_id", "schedule_cycle", "schedule_type", "working_days_preset", "created_at", "updated_at")
					 VALUES ($1, $2, $3, 'weekly', 'detailed', 'custom', now(), now())`,
					[sched1Id, p1Id, p1v1Id],
				);
				await pool.query(
					`INSERT INTO "work_policy_regulation" ("id", "policy_id", "policy_version_id", "max_daily_minutes", "created_at", "updated_at")
					 VALUES ($1, $2, $3, 600, now(), now())`,
					[reg1Id, p1Id, p1v1Id],
				);
				await pool.query(
					`INSERT INTO "work_policy_break_rule" ("id", "regulation_id", "policy_version_id", "working_minutes_threshold", "required_break_minutes", "created_at", "updated_at")
					 VALUES ($1, $2, $3, 360, 30, now(), now())`,
					[br1Id, reg1Id, p1v1Id],
				);
				await pool.query(
					`INSERT INTO "work_policy_presence" ("policy_id", "policy_version_id", "presence_mode", "required_onsite_days", "location_id", "created_at", "updated_at")
					 VALUES ($1, $2, 'minimum_count', 2, $3, now(), now())`,
					[p1Id, p1v1Id, locId],
				);

				// 4 mismatched parent/version pairs -> ALL rejected with SQLSTATE 23503!
				const mismatch1 = await pool
					.query(
						`INSERT INTO "work_policy_schedule" ("policy_id", "policy_version_id", "schedule_cycle", "schedule_type", "working_days_preset", "created_at", "updated_at")
						 VALUES ($1, $2, 'weekly', 'simple', 'weekdays', now(), now())`,
						[p1Id, p2v1Id],
					)
					.catch((e) => e);
				expect(extractPostgresErrorCode(mismatch1)).toBe("23503");

				const mismatch2 = await pool
					.query(
						`INSERT INTO "work_policy_schedule_day" ("schedule_id", "policy_version_id", "day_of_week", "hours_per_day", "is_work_day")
						 VALUES ($1, $2, 'monday', 8.00, true)`,
						[sched1Id, p1v2Id],
					)
					.catch((e) => e);
				expect(extractPostgresErrorCode(mismatch2)).toBe("23503");

				const mismatch3 = await pool
					.query(
						`INSERT INTO "work_policy_break_rule" ("regulation_id", "policy_version_id", "working_minutes_threshold", "required_break_minutes", "created_at", "updated_at")
						 VALUES ($1, $2, 540, 45, now(), now())`,
						[reg1Id, p1v2Id],
					)
					.catch((e) => e);
				expect(extractPostgresErrorCode(mismatch3)).toBe("23503");

				const mismatch4 = await pool
					.query(
						`INSERT INTO "work_policy_break_option" ("break_rule_id", "policy_version_id", "split_count", "minimum_split_minutes")
						 VALUES ($1, $2, 2, 15)`,
						[br1Id, p1v2Id],
					)
					.catch((e) => e);
				expect(extractPostgresErrorCode(mismatch4)).toBe("23503");

				// Violation guards: null policy_id with non-null policy_version_id (23514), cross-policy (23503), cross-org (23503)
				const violNullPolicy = await pool
					.query(
						`INSERT INTO "work_policy_violation" ("employee_id", "organization_id", "policy_id", "policy_version_id", "violation_date", "violation_type")
						 VALUES ($1, $2, NULL, $3, now(), 'max_daily')`,
						[empA, orgA, p1v1Id],
					)
					.catch((e) => e);
				expect(extractPostgresErrorCode(violNullPolicy)).toBe("23514");

				const violCrossPolicy = await pool
					.query(
						`INSERT INTO "work_policy_violation" ("employee_id", "organization_id", "policy_id", "policy_version_id", "violation_date", "violation_type")
						 VALUES ($1, $2, $3, $4, now(), 'max_daily')`,
						[empA, orgA, p1Id, p2v1Id],
					)
					.catch((e) => e);
				expect(extractPostgresErrorCode(violCrossPolicy)).toBe("23503");

				const empOther = randomUUID();
				await pool.query(
					`INSERT INTO "employee" ("id", "user_id", "organization_id", "role", "created_at", "updated_at") VALUES ($1, $2, $3, 'employee', now(), now())`,
					[empOther, userA, orgOther],
				);
				const violCrossOrg = await pool
					.query(
						`INSERT INTO "work_policy_violation" ("employee_id", "organization_id", "policy_id", "policy_version_id", "violation_date", "violation_type")
						 VALUES ($1, $2, $3, $4, now(), 'max_daily')`,
						[empOther, orgOther, p1Id, p1v1Id],
					)
					.catch((e) => e);
				expect(extractPostgresErrorCode(violCrossOrg)).toBe("23503");

				// On-call 3VL-safe IS TRUE check (23514) & default prohibition (23503)
				const onCallNullBypass = await pool
					.query(
						`INSERT INTO "employee_employment_history" (
							"employee_id", "organization_id", "valid_from", "valid_from_date", "contract_type",
							"schedule_source", "on_call_hours_kind", "on_call_weekly_minutes", "created_by", "created_at", "updated_at"
						) VALUES ($1, $2, '2026-01-01 00:00:00', DATE '2026-01-01', 'fixed', NULL, 'exact', 600, $3, now(), now())`,
						[empA, orgA, userA],
					)
					.catch((e) => e);
				expect(extractPostgresErrorCode(onCallNullBypass)).toBe("23514");

				const onCallVerId = randomUUID();
				await pool.query(
					`INSERT INTO "contract_template_version" ("id", "organization_id", "template_id", "version_number", "schedule_source", "default_on_call_hours_kind")
					 VALUES ($1, $2, $3, 99, 'on_call', 'unspecified')`,
					[onCallVerId, orgA, tplId],
				);
				const onCallDefaultErr = await pool
					.query(
						`INSERT INTO "contract_default" ("organization_id", "scope", "template_version_id", "effective_from_date")
						 VALUES ($1, 'organization', $2, DATE '2026-01-01')`,
						[orgA, onCallVerId],
					)
					.catch((e) => e);
				expect(extractPostgresErrorCode(onCallDefaultErr)).toBe("23503");

				// Direct single-location delete is REFUSED (23503) while full-org cascade teardown SUCCEEDS!
				await pool.query(`UPDATE "work_policy_version" SET "sealed_at" = now() WHERE id = $1`, [
					p1v1Id,
				]);
				const directLocDeleteErr = await pool
					.query(`DELETE FROM "location" WHERE id = $1`, [locId])
					.catch((e) => e);
				expect(extractPostgresErrorCode(directLocDeleteErr)).toBe("23503");

				await pool.query(`DELETE FROM "organization" WHERE id = $1`, [orgA]);
				expect(
					(await pool.query(`SELECT 1 FROM "work_policy_presence" WHERE location_id = $1`, [locId]))
						.rowCount,
				).toBe(0);
			} finally {
				await dbEditorFirst.cleanup();
				await dbSealFirst.cleanup();
			}
		},
	);

	it(
		"meets scale latency targets on 10,000 employees (~25k assignments, ~25k terms, ~25k violations) and 1,050 policies (< 2000ms for 0322/0323 and < 1000ms concurrent policy-writer wait through 0327 commit)",
		{ timeout: 180_000 },
		async () => {
			const sibling = await createSiblingDatabase("p23_scale", 10);
			const tempDir = await mkdtemp(join(tmpdir(), "z8-p23-scale-"));
			try {
				const { folder: folder0321 } = await copyJournalUpTo(tempDir, 321);
				const { folder: folder0322 } = await copyJournalUpTo(tempDir, 322);
				const { folder: folder0323 } = await copyJournalUpTo(tempDir, 323);

				await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder: folder0321,
					allowContractConstraints: false,
					allowPolicyV1Seal: false,
					logger: silentLogger,
				});

				// Bulk-seed 1 org, 1 admin, 1 location, 1,050 policies, 10,000 employees,
				// 25,000 work_policy_assignments, 25,000 employee_employment_history rows, 25,000 violations
				const orgId = `org_scale_${randomBytes(4).toString("hex")}`;
				const adminUserId = `usr_scale_admin_${randomBytes(4).toString("hex")}`;
				const locId = randomUUID();

				await sibling.pool.query(
					`INSERT INTO "organization" ("id", "name", "slug", "created_at", "timezone") VALUES ($1, 'Scale 10k GmbH', $1, now(), 'Europe/Berlin')`,
					[orgId],
				);
				await sibling.pool.query(
					`INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES ($1, 'Scale Admin', $2, true, now(), now())`,
					[adminUserId, `${adminUserId}@example.test`],
				);
				await sibling.pool.query(
					`INSERT INTO "location" ("id", "organization_id", "name", "is_active", "created_by", "created_at", "updated_at")
					 VALUES ($1, $2, 'Campus HQ', true, $3, now(), now())`,
					[locId, orgId, adminUserId],
				);

				// 1,050 policies with schedule, schedule_day, regulation, break_rule, break_option, presence
				await sibling.pool.query(
					`
					WITH inserted_policies AS (
						INSERT INTO "work_policy" (
							"organization_id", "name", "schedule_enabled", "regulation_enabled", "presence_enabled", "created_by", "created_at", "updated_at"
						)
						SELECT $1, 'Scale Policy ' || g, true, true, true, $2, now(), now()
						FROM generate_series(1, 1050) AS g
						RETURNING id
					),
					inserted_schedules AS (
						INSERT INTO "work_policy_schedule" (
							"policy_id", "schedule_cycle", "schedule_type", "working_days_preset", "hours_per_cycle", "created_at", "updated_at"
						)
						SELECT id, 'weekly', 'simple', 'weekdays', 40.00, now(), now()
						FROM inserted_policies
						RETURNING id, policy_id
					),
					inserted_regs AS (
						INSERT INTO "work_policy_regulation" (
							"policy_id", "max_daily_minutes", "max_weekly_minutes", "created_at", "updated_at"
						)
						SELECT id, 600, 2880, now(), now()
						FROM inserted_policies
						RETURNING id, policy_id
					),
					inserted_presence AS (
						INSERT INTO "work_policy_presence" (
							"policy_id", "presence_mode", "required_onsite_days", "location_id", "created_at", "updated_at"
						)
						SELECT id, 'minimum_count', 3, $3, now(), now()
						FROM inserted_policies
						RETURNING id
					)
					SELECT COUNT(*) FROM inserted_presence
					`,
					[orgId, adminUserId, locId],
				);

				// 10,000 users + 10,000 employees + 10,000 open employment periods (in 2,000-row batches to fit default Docker /dev/shm)
				for (let offset = 0; offset < 10000; offset += 2000) {
					const batchStart = offset + 1;
					const batchEnd = offset + 2000;
					await sibling.pool.query(
						`
						WITH gen AS (
							SELECT g, ('u_scale_' || g) AS uid
							FROM generate_series($2::int, $3::int) AS g
						),
						ins_users AS (
							INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
							SELECT uid, 'Employee ' || g, uid || '@scale.test', true, now(), now()
							FROM gen
							RETURNING id
						),
						ins_emps AS (
							INSERT INTO "employee" ("user_id", "organization_id", "role", "created_at", "updated_at")
							SELECT id, $1, 'employee', now(), now()
							FROM ins_users
							RETURNING id
						)
						INSERT INTO "employee_employment_period" (
							"organization_id", "employee_id", "status", "started_at", "start_provenance"
						)
						SELECT $1, id, 'open', '2024-01-01T00:00:00Z', 'recorded'
						FROM ins_emps
						`,
						[orgId, batchStart, batchEnd],
					);
				}

				// 25,000 work_policy_assignments (2.5 non-overlapping windows/employee),
				// 25,000 employee_employment_history rows (2.5 non-overlapping confirmed windows/employee),
				// and 25,000 work_policy_violation rows (in 2,000-employee batches)
				for (let offset = 0; offset < 10000; offset += 2000) {
					const rnStart = offset + 1;
					const rnEnd = offset + 2000;
					await sibling.pool.query(
						`
						WITH emp_numbered AS (
							SELECT
								ep.employee_id,
								ep.id AS period_id,
								ROW_NUMBER() OVER (ORDER BY ep.employee_id) AS rn
							FROM "employee_employment_period" ep
							WHERE ep.organization_id = $1
						),
						emp_slice AS (
							SELECT employee_id, period_id, rn
							FROM emp_numbered
							WHERE rn BETWEEN $3 AND $4
						),
						pol_numbered AS (
							SELECT
								id AS policy_id,
								ROW_NUMBER() OVER (ORDER BY id) AS prn
							FROM "work_policy"
							WHERE organization_id = $1
						),
						slots AS (
							SELECT 1 AS slot, DATE '2024-01-01' AS d_from, DATE '2025-01-01' AS d_until
							UNION ALL
							SELECT 2 AS slot, DATE '2025-01-01' AS d_from, DATE '2026-01-01' AS d_until
							UNION ALL
							SELECT 3 AS slot, DATE '2026-01-01' AS d_from, NULL::date AS d_until
						),
						expanded AS (
							SELECT
								e.employee_id,
								e.period_id,
								p.policy_id,
								s.slot,
								s.d_from,
								s.d_until
							FROM emp_slice e
							JOIN slots s ON (s.slot <= 2 OR e.rn <= 5000)
							JOIN pol_numbered p ON p.prn = ((e.rn + s.slot) % 1050) + 1
						),
						ins_assign AS (
							INSERT INTO "work_policy_assignment" (
								"policy_id", "organization_id", "assignment_type", "employee_id", "priority",
								"effective_from", "effective_until", "effective_from_date", "effective_until_date",
								"source_kind", "is_active", "created_by", "created_at", "updated_at"
							)
							SELECT
								policy_id, $1, 'employee', employee_id, 2,
								d_from::timestamp, d_until::timestamp, d_from, d_until,
								'manager_assignment', true, $2, now(), now()
							FROM expanded
							RETURNING 1
						),
						ins_terms AS (
							INSERT INTO "employee_employment_history" (
								"employee_id", "organization_id", "employment_period_id",
								"valid_from", "valid_until", "valid_from_date", "valid_until_date",
								"contract_type", "weekly_contract_minutes", "work_model", "work_policy_id",
								"review_state", "created_by", "created_at", "updated_at"
							)
							SELECT
								employee_id, $1, period_id,
								d_from::timestamp, d_until::timestamp, d_from, d_until,
								'fixed', 2400, 'hybrid', policy_id,
								'confirmed', $2, now(), now()
							FROM expanded
							RETURNING 1
						),
						ins_viol AS (
							INSERT INTO "work_policy_violation" (
								"employee_id", "organization_id", "policy_id", "violation_date", "violation_type"
							)
							SELECT
								employee_id, $1, policy_id, d_from::timestamp + interval '10 hours', 'max_daily'
							FROM expanded
							RETURNING 1
						)
						SELECT
							(SELECT COUNT(*)::int FROM ins_assign) AS assignments,
							(SELECT COUNT(*)::int FROM ins_terms) AS terms,
							(SELECT COUNT(*)::int FROM ins_viol) AS violations
						`,
						[orgId, adminUserId, rnStart, rnEnd],
					);
				}

				const seededCounts = (
					await sibling.pool.query<{
						employees: number;
						policies: number;
						assignments: number;
						terms: number;
						violations: number;
					}>(
						`
						SELECT
							(SELECT COUNT(*)::int FROM "employee" WHERE organization_id = $1) AS employees,
							(SELECT COUNT(*)::int FROM "work_policy" WHERE organization_id = $1) AS policies,
							(SELECT COUNT(*)::int FROM "work_policy_assignment" WHERE organization_id = $1) AS assignments,
							(SELECT COUNT(*)::int FROM "employee_employment_history" WHERE organization_id = $1) AS terms,
							(SELECT COUNT(*)::int FROM "work_policy_violation" WHERE organization_id = $1) AS violations
						`,
						[orgId],
					)
				).rows[0];
				expect(seededCounts).toEqual({
					employees: 10000,
					policies: 1050,
					assignments: 25000,
					terms: 25000,
					violations: 25000,
				});

				// Ensure backfill is complete before timing 0322/0323
				const backfillClient = await sibling.pool.connect();
				try {
					await runPhase1ChunkedBackfill(backfillClient, { chunkSize: 2000 });
				} finally {
					backfillClient.release();
				}

				// ANALYZE so planner has fresh stats on the 25k-row tables
				await sibling.pool.query(
					`ANALYZE "work_policy", "work_policy_version", "work_policy_assignment", "employee_employment_history", "work_policy_violation"`,
				);

				// Measure 0322 isolated DDL transaction duration (< 2000ms target)
				const t0322Start = performance.now();
				await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder: folder0322,
					allowContractConstraints: true,
					allowPolicyV1Seal: false,
					backfillChunkSize: 2000,
					logger: silentLogger,
				});
				const duration0322Ms = performance.now() - t0322Start;

				// Measure 0323 isolated DDL transaction duration (< 2000ms target)
				const t0323Start = performance.now();
				await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder: folder0323,
					allowContractConstraints: true,
					allowPolicyV1Seal: false,
					backfillChunkSize: 2000,
					logger: silentLogger,
				});
				const duration0323Ms = performance.now() - t0323Start;

				// Advance through pre-0324 + 0324 + 0325 + 0326 (parked at Drain Gate 2)
				const parkedRes = await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder,
					allowContractConstraints: true,
					allowPolicyV1Seal: false,
					backfillChunkSize: 2000,
					logger: silentLogger,
				});
				expect(parkedRes.stoppedAtGate).toBe("drain_gate_2");

				// Measure concurrent policy-writer wait through 0327 commit sealing 1,050+ policies (< 1000ms target)
				const samplePolicyId = (
					await sibling.pool.query<{ id: string }>(
						`SELECT id FROM "work_policy" WHERE organization_id = $1 LIMIT 1`,
						[orgId],
					)
				).rows[0]!.id;

				const seal0327Promise = (async () => {
					const t0 = performance.now();
					const res = await runBoundaryAwareMigrations({
						pool: sibling.pool,
						migrationsFolder,
						allowContractConstraints: true,
						allowPolicyV1Seal: true,
						logger: silentLogger,
					});
					return { res, ms: performance.now() - t0 };
				})();

				const writerWaitStart = performance.now();
				const concurrentWrite = await updateOrPublishWorkPolicy(wrapPoolAsDrizzle(sibling.pool), {
					organizationId: orgId,
					actorUserId: adminUserId,
					policyId: samplePolicyId,
					data: {
						schedule: {
							scheduleCycle: "weekly",
							scheduleType: "simple",
							workingDaysPreset: "weekdays",
							hoursPerCycle: "38",
						},
					},
				});
				const writerWaitMs = performance.now() - writerWaitStart;
				const { res: sealRes, ms: duration0327Ms } = await seal0327Promise;

				expect(sealRes.appliedStages).toEqual(["phase2_0327", ...POST_0327_STAGES]);
				expect(concurrentWrite.policy.id).toBe(samplePolicyId);

				// Log measured benchmark timings for verification reporting
				console.info(
					`[benchmark #1926] 10k employees (25k assignments, 25k terms, 25k violations) + 1,050 policies: 0322=${duration0322Ms.toFixed(1)}ms, 0323=${duration0323Ms.toFixed(1)}ms, 0327=${duration0327Ms.toFixed(1)}ms, concurrent-writer-wait=${writerWaitMs.toFixed(1)}ms`,
				);

				expect(duration0322Ms).toBeLessThan(2000);
				expect(duration0323Ms).toBeLessThan(2000);
				expect(writerWaitMs).toBeLessThan(1000);

				// All 1,050+ policies are now sealed!
				const unsealedCount = Number(
					(
						await sibling.pool.query<{ count: string }>(
							`SELECT COUNT(*) AS count FROM "work_policy_version" WHERE sealed_at IS NULL`,
						)
					).rows[0]?.count,
				);
				expect(unsealedCount).toBe(0);
			} finally {
				await sibling.cleanup();
				await rm(tempDir, { recursive: true, force: true });
			}
		},
	);
});
