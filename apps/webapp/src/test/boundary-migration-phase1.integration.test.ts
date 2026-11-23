import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
	ensureAttachableUniqueIndex,
	runBoundaryAwareMigrations,
	verifyPhase1BackfillCompleteness,
} from "../../scripts/boundary-migration-engine.js";
import { integrationAdminPool, openIntegrationPool } from "@/test/integration-database";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

type Journal = {
	version: string;
	dialect: string;
	entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
};

async function createSiblingDatabase(prefix: string): Promise<{
	databaseName: string;
	pool: Pool;
	cleanup: () => Promise<void>;
}> {
	const admin = integrationAdminPool();
	const databaseName = `approval_workflow_repository_test_${prefix}_${randomBytes(5).toString("hex")}`;
	await admin.query(`CREATE DATABASE "${databaseName}"`);
	const pool = openIntegrationPool({ databaseName });
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
	const folder = join(tempDir, `drizzle_${maxPrefix}`);
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

describe("boundary-aware migration engine and Phase 1 expand schema (0318-0321)", () => {
	it(
		"commits 0000-0317 before pre-0318 concurrent index builds, attaches backing indexes via pg_constraint.conindid, leaves team untouched, and enforces Drain Gate 1 & 2 transaction isolation",
		{ timeout: 120000 },
		async () => {
			const sibling = await createSiblingDatabase("p1_empty");
			const tempDir = await mkdtemp(join(tmpdir(), "z8-p1-empty-"));
			try {
				const committedStages: Array<{ stageId: string; tags: string[]; xid: string | null }> = [];
				const result = await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder,
					allowContractConstraints: false,
					allowPolicyV1Seal: false,
					onStageCommitted: (info) => {
						committedStages.push(info);
					},
				});

				expect(result.appliedStages).toEqual([
					"historical_prefix_0000_0317",
					"phase1_expand_0318_0321",
				]);
				expect(result.indexActions).toEqual([
					{ action: "created", indexName: "work_policy_id_org_uidx" },
					{ action: "created", indexName: "employee_employment_history_id_org_uidx" },
				]);
				expect(committedStages).toHaveLength(2);
				expect(committedStages[0]?.xid).not.toBe(committedStages[1]?.xid);

				// Verify pg_constraint.conindid points to the exact concurrently built indexes
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
							'team_id_organizationId_idx'
						)
						ORDER BY tbl.relname
					`)
				).rows;

				expect(conindidRows).toEqual([
					{
						table_name: "employee_employment_history",
						conname: "employee_employment_history_id_org_uidx",
						index_name: "employee_employment_history_id_org_uidx",
						indisvalid: true,
					},
					{
						table_name: "team",
						conname: "team_id_organizationId_idx",
						index_name: "team_id_organizationId_idx",
						indisvalid: true,
					},
					{
						table_name: "work_policy",
						conname: "work_policy_id_org_uidx",
						index_name: "work_policy_id_org_uidx",
						indisvalid: true,
					},
				]);

				// Zero extra unique constraints added to `team` (still just 0014's team_id_organizationId_idx)
				const teamUniques = (
					await sibling.pool.query<{ conname: string }>(`
						SELECT con.conname
						FROM pg_constraint con
						JOIN pg_class tbl ON tbl.oid = con.conrelid
						WHERE tbl.relname = 'team' AND con.contype = 'u'
					`)
				).rows;
				expect(teamUniques).toEqual([{ conname: "team_id_organizationId_idx" }]);

				// Singleton work_policy_versioning_state seeded with sealed_cutover_at = NULL
				const stateRows = (
					await sibling.pool.query<{ singleton: boolean; sealed_cutover_at: Date | null }>(
						`SELECT singleton, sealed_cutover_at FROM "work_policy_versioning_state"`,
					)
				).rows;
				expect(stateRows).toEqual([{ singleton: true, sealed_cutover_at: null }]);

				// Verify Drain Gate 1 & Drain Gate 2 stop/resume & isolated xids on the real 0322-0327 chain
				// Drain Gate 1 default (false): must stop cleanly at 0321
				const gate1Stop = await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder,
					allowContractConstraints: false,
					allowPolicyV1Seal: false,
				});
				expect(gate1Stop.stoppedAtGate).toBe("drain_gate_1");
				expect(gate1Stop.appliedStages).toEqual([]);

				// Authorize Drain Gate 1, keep Drain Gate 2 false: runs 0322-0326 in 5 distinct txns and stops at 0326
				const gate2Stages: Array<{ stageId: string; xid: string | null }> = [];
				const gate2Stop = await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder,
					allowContractConstraints: true,
					allowPolicyV1Seal: false,
					onStageCommitted: (info) => {
						gate2Stages.push({ stageId: info.stageId, xid: info.xid });
					},
				});
				expect(gate2Stop.stoppedAtGate).toBe("drain_gate_2");
				expect(gate2Stop.appliedStages).toEqual([
					"phase2_0322",
					"phase2_0323",
					"phase2_0324",
					"phase2_0325",
					"phase2_0326",
				]);
				expect(new Set(gate2Stages.map((s) => s.xid)).size).toBe(5);

				// Authorize Drain Gate 2: applies 0327 in its own distinct tx
				const sealStages: Array<{ stageId: string; xid: string | null }> = [];
				const sealDone = await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder,
					allowContractConstraints: true,
					allowPolicyV1Seal: true,
					onStageCommitted: (info) => {
						sealStages.push({ stageId: info.stageId, xid: info.xid });
					},
				});
				expect(sealDone.stoppedAtGate).toBeNull();
				expect(sealDone.appliedStages).toEqual(["phase2_0327"]);
				expect(sealStages).toHaveLength(1);
				expect(sealStages[0]?.xid).not.toBe(gate2Stages[4]?.xid);
			} finally {
				await sibling.cleanup();
				await rm(tempDir, { recursive: true, force: true });
			}
		},
	);

	it(
		"aborts without dropping or advancing the ledger on wrong-column and DESC same-name staging indexes, and rebuilds invalid matching indexes concurrently",
		{ timeout: 120000 },
		async () => {
			const sibling = await createSiblingDatabase("p1_idx_guard");
			const tempDir = await mkdtemp(join(tmpdir(), "z8-p1-idx-"));
			try {
				const { folder: folder0317 } = await copyJournalUpTo(tempDir, 317);
				await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder: folder0317,
				});

				const ledgerBefore = (
					await sibling.pool.query(
						"SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at",
					)
				).rows;

				// 1. Wrong-column valid same-name index on work_policy (reversed order)
				await sibling.pool.query(
					`CREATE UNIQUE INDEX "work_policy_id_org_uidx" ON "public"."work_policy" ("organization_id", "id")`,
				);
				await expect(
					runBoundaryAwareMigrations({
						pool: sibling.pool,
						migrationsFolder,
					}),
				).rejects.toThrow(/work_policy_id_org_uidx.*key column/i);

				// Must NOT have dropped the mismatched index or advanced the ledger
				const stillExistsWrongCol = (
					await sibling.pool.query(
						`SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'work_policy_id_org_uidx'`,
					)
				).rowCount;
				expect(stillExistsWrongCol).toBe(1);
				expect(
					(
						await sibling.pool.query(
							"SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at",
						)
					).rows,
				).toEqual(ledgerBefore);
				await sibling.pool.query(`DROP INDEX "public"."work_policy_id_org_uidx"`);

				// 2. Same-column DESC valid same-name index on employee_employment_history
				await sibling.pool.query(
					`CREATE UNIQUE INDEX "employee_employment_history_id_org_uidx" ON "public"."employee_employment_history" ("id", "organization_id" DESC)`,
				);
				await expect(
					runBoundaryAwareMigrations({
						pool: sibling.pool,
						migrationsFolder,
					}),
				).rejects.toThrow(/employee_employment_history_id_org_uidx.*indoption/i);

				// Must NOT have dropped the DESC index or advanced the ledger
				const stillExistsDesc = (
					await sibling.pool.query(
						`SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'employee_employment_history_id_org_uidx'`,
					)
				).rowCount;
				expect(stillExistsDesc).toBe(1);
				expect(
					(
						await sibling.pool.query(
							"SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at",
						)
					).rows,
				).toEqual(ledgerBefore);
				await sibling.pool.query(`DROP INDEX "public"."employee_employment_history_id_org_uidx"`);

				// 3. Invalid matching index (real PG 16 indisvalid=false left by failed CONCURRENTLY build) is rebuilt concurrently
				await sibling.pool.query(
					`CREATE TABLE "public"."_p1_invalid_idx_probe" ("id" uuid NOT NULL, "org_id" text NOT NULL)`,
				);
				const dupId = randomUUID();
				await sibling.pool.query(
					`INSERT INTO "public"."_p1_invalid_idx_probe" VALUES ($1, 'org-1'), ($1, 'org-1')`,
					[dupId],
				);
				await expect(
					sibling.pool.query(
						`CREATE UNIQUE INDEX CONCURRENTLY "_p1_probe_uidx" ON "public"."_p1_invalid_idx_probe" ("id", "org_id")`,
					),
				).rejects.toThrow(/could not create unique index/i);

				const beforeRebuild = (
					await sibling.pool.query<{ indisvalid: boolean }>(`
						SELECT i.indisvalid
						FROM pg_index i
						JOIN pg_class c ON c.oid = i.indexrelid
						WHERE c.relname = '_p1_probe_uidx'
					`)
				).rows[0];
				expect(beforeRebuild?.indisvalid).toBe(false);

				// Remove duplicate row, then ensureAttachableUniqueIndex rebuilds the invalid index cleanly
				await sibling.pool.query(`DELETE FROM "public"."_p1_invalid_idx_probe"`);
				const client = await sibling.pool.connect();
				try {
					const rebuildResult = await ensureAttachableUniqueIndex(client, {
						schema: "public",
						tableName: "_p1_invalid_idx_probe",
						indexName: "_p1_probe_uidx",
						columns: ["id", "org_id"],
						requiredBeforePrefix: 318,
					});
					expect(rebuildResult).toEqual({ action: "rebuilt", indexName: "_p1_probe_uidx" });
				} finally {
					client.release();
				}

				const afterRebuild = (
					await sibling.pool.query<{ indisvalid: boolean }>(`
						SELECT i.indisvalid
						FROM pg_index i
						JOIN pg_class c ON c.oid = i.indexrelid
						WHERE c.relname = '_p1_probe_uidx'
					`)
				).rows[0];
				expect(afterRebuild?.indisvalid).toBe(true);
			} finally {
				await sibling.cleanup();
				await rm(tempDir, { recursive: true, force: true });
			}
		},
	);

	it(
		"recovers cleanly from a mid-backfill crash without duplicate versions, defaults, or conflicts, and preserves all legacy confirmed employment terms intact",
		{ timeout: 120000 },
		async () => {
			const sibling = await createSiblingDatabase("p1_backfill");
			const tempDir = await mkdtemp(join(tmpdir(), "z8-p1-backfill-"));
			try {
				const { folder: folder0317 } = await copyJournalUpTo(tempDir, 317);
				await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder: folder0317,
				});

				// Seed rich pre-0318 production data
				const orgId = `org_${randomBytes(4).toString("hex")}`;
				const userId = `usr_${randomBytes(4).toString("hex")}`;
				const teamId = randomUUID();
				const locationId = randomUUID();
				const emp1Id = randomUUID();
				const emp2Id = randomUUID();
				const policyDetailedId = randomUUID();
				const policySimpleId = randomUUID();
				const scheduleId = randomUUID();
				const regulationId = randomUUID();
				const breakRuleId = randomUUID();
				const presenceId = randomUUID();
				const historyConfirmedMismatchId = randomUUID();
				const historyConfirmedHourlyId = randomUUID();
				const historyDraftId = randomUUID();

				await sibling.pool.query(
					`INSERT INTO "organization" ("id", "name", "slug", "created_at", "timezone") VALUES ($1, 'Acme GmbH', $2, now(), 'Europe/Berlin')`,
					[orgId, orgId],
				);
				await sibling.pool.query(
					`INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES ($1, 'Admin', $2, true, now(), now())`,
					[userId, `${userId}@example.test`],
				);
				await sibling.pool.query(
					`INSERT INTO "team" ("id", "organization_id", "name", "created_at", "updated_at") VALUES ($1, $2, 'Engineering', now(), now())`,
					[teamId, orgId],
				);
				await sibling.pool.query(
					`INSERT INTO "location" ("id", "organization_id", "name", "created_by", "created_at", "updated_at") VALUES ($1, $2, 'Berlin HQ', $3, now(), now())`,
					[locationId, orgId, userId],
				);
				await sibling.pool.query(
					`INSERT INTO "employee" ("id", "user_id", "organization_id", "team_id", "role", "created_at", "updated_at") VALUES ($1, $2, $3, $4, 'employee', now(), now())`,
					[emp1Id, userId, orgId, teamId],
				);
				const user2Id = `usr2_${randomBytes(4).toString("hex")}`;
				await sibling.pool.query(
					`INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES ($1, 'Hourly Worker', $2, true, now(), now())`,
					[user2Id, `${user2Id}@example.test`],
				);
				await sibling.pool.query(
					`INSERT INTO "employee" ("id", "user_id", "organization_id", "team_id", "role", "contract_type", "created_at", "updated_at") VALUES ($1, $2, $3, $4, 'employee', 'hourly', now(), now())`,
					[emp2Id, user2Id, orgId, teamId],
				);

				// Two pre-0318 work policies with full child/grandchild trees + violation
				await sibling.pool.query(
					`INSERT INTO "work_policy" ("id", "organization_id", "name", "schedule_enabled", "regulation_enabled", "presence_enabled", "created_by", "created_at", "updated_at")
					 VALUES
						($1, $2, 'Standard 40h Detailed', true, true, true, $3, now(), now()),
						($4, $2, 'Team 32h Simple', true, false, false, $3, now(), now())`,
					[policyDetailedId, orgId, userId, policySimpleId],
				);
				await sibling.pool.query(
					`INSERT INTO "work_policy_schedule" ("id", "policy_id", "schedule_cycle", "schedule_type", "working_days_preset", "hours_per_cycle", "created_at", "updated_at")
					 VALUES ($1, $2, 'weekly', 'detailed', 'weekdays', 40.00, now(), now())`,
					[scheduleId, policyDetailedId],
				);
				for (const day of ["monday", "tuesday", "wednesday", "thursday", "friday"]) {
					await sibling.pool.query(
						`INSERT INTO "work_policy_schedule_day" ("schedule_id", "day_of_week", "hours_per_day", "is_work_day", "cycle_week")
						 VALUES ($1, $2::day_of_week, 8.00, true, 1)`,
						[scheduleId, day],
					);
				}
				await sibling.pool.query(
					`INSERT INTO "work_policy_regulation" ("id", "policy_id", "max_daily_minutes", "min_rest_period_minutes", "created_at", "updated_at")
					 VALUES ($1, $2, 600, 660, now(), now())`,
					[regulationId, policyDetailedId],
				);
				await sibling.pool.query(
					`INSERT INTO "work_policy_break_rule" ("id", "regulation_id", "working_minutes_threshold", "required_break_minutes", "created_at", "updated_at")
					 VALUES ($1, $2, 360, 30, now(), now())`,
					[breakRuleId, regulationId],
				);
				await sibling.pool.query(
					`INSERT INTO "work_policy_break_option" ("break_rule_id", "split_count", "minimum_split_minutes")
					 VALUES ($1, 2, 15)`,
					[breakRuleId],
				);
				await sibling.pool.query(
					`INSERT INTO "work_policy_presence" ("id", "policy_id", "presence_mode", "required_onsite_days", "location_id", "created_at", "updated_at")
					 VALUES ($1, $2, 'minimum_count', 3, $3, now(), now())`,
					[presenceId, policyDetailedId, locationId],
				);
				await sibling.pool.query(
					`INSERT INTO "work_policy_violation" ("employee_id", "organization_id", "policy_id", "violation_date", "violation_type")
					 VALUES ($1, $2, $3, '2026-03-10 12:00:00', 'max_daily')`,
					[emp1Id, orgId, policyDetailedId],
				);

				// Active org & team assignments
				await sibling.pool.query(
					`INSERT INTO "work_policy_assignment" ("policy_id", "organization_id", "assignment_type", "priority", "is_active", "created_by", "created_at", "updated_at")
					 VALUES ($1, $2, 'organization', 0, true, $3, now(), now())`,
					[policyDetailedId, orgId, userId],
				);
				await sibling.pool.query(
					`INSERT INTO "work_policy_assignment" ("policy_id", "organization_id", "assignment_type", "team_id", "priority", "is_active", "created_by", "created_at", "updated_at")
					 VALUES ($1, $2, 'team', $3, 1, true, $4, now(), now())`,
					[policySimpleId, orgId, teamId, userId],
				);

				// Pre-migration employment terms:
				// 1. Confirmed fixed 30h/week (1800 min) pointing at 40h detailed policy -> triggers mismatch conflict, values kept intact
				// 2. Confirmed hourly 20h/week (1200 min) @ 25.50 EUR, non-UTC-midnight instant (2026-03-31 22:00:00 = 2026-04-01 Europe/Berlin!)
				// 3. Draft row -> migrated_legacy_terms stays false
				await sibling.pool.query(
					`INSERT INTO "employee_employment_history" (
						"id", "employee_id", "organization_id", "valid_from", "contract_type",
						"weekly_contract_minutes", "work_model", "work_policy_id", "hourly_rate",
						"review_state", "created_by", "created_at", "updated_at"
					) VALUES
						($1, $2, $3, '2026-01-01 00:00:00', 'fixed', 1800, 'hybrid', $4, NULL, 'confirmed', $5, now(), now()),
						($6, $7, $3, '2026-03-31 22:00:00', 'hourly', 1200, 'remote', NULL, 25.50, 'confirmed', $5, now(), now()),
						($8, $2, $3, '2026-06-01 00:00:00', 'fixed', 2400, 'onsite', $4, NULL, 'draft', $5, now(), now())`,
					[
						historyConfirmedMismatchId,
						emp1Id,
						orgId,
						policyDetailedId,
						userId,
						historyConfirmedHourlyId,
						emp2Id,
						historyDraftId,
					],
				);

				// First run: simulate a crash mid-backfill after chunk 1 of contract_default_from_assignments!
				let crashedOnce = false;
				await expect(
					runBoundaryAwareMigrations({
						pool: sibling.pool,
						migrationsFolder,
						backfillChunkSize: 1,
						onBackfillChunkCommitted: (info) => {
							if (
								!crashedOnce &&
								info.step === "contract_default_from_assignments" &&
								info.chunkNumber === 1
							) {
								crashedOnce = true;
								throw new Error("SIMULATED_MID_BACKFILL_CRASH");
							}
						},
					}),
				).rejects.toThrow("SIMULATED_MID_BACKFILL_CRASH");
				expect(crashedOnce).toBe(true);

				// Second run: restart cleanly after crash! 0318-0321 are already committed, backfill resumes & finishes!
				await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder,
					backfillChunkSize: 1,
				});

				// Re-running a third time is a pure no-op
				await runBoundaryAwareMigrations({
					pool: sibling.pool,
					migrationsFolder,
					backfillChunkSize: 1,
				});

				// Completeness gate confirms zero unbackfilled rows across all targets
				const verifyClient = await sibling.pool.connect();
				try {
					const counts = await verifyPhase1BackfillCompleteness(verifyClient);
					for (const count of Object.values(counts)) {
						expect(Number(count)).toBe(0);
					}
				} finally {
					verifyClient.release();
				}

				// Exactly 2 v1 versions (1 per policy, unsealed, is_legacy_baseline = true)
				const versions = (
					await sibling.pool.query<{
						policy_id: string;
						version_number: number;
						is_legacy_baseline: boolean;
						sealed_at: Date | null;
					}>(
						`SELECT policy_id, version_number, is_legacy_baseline, sealed_at FROM "work_policy_version"`,
					)
				).rows;
				expect(versions).toHaveLength(2);
				expect(
					versions.every(
						(v) => v.version_number === 1 && v.is_legacy_baseline && v.sealed_at === null,
					),
				).toBe(true);

				// Zero duplicate contract_defaults (exactly 1 org + 1 team)
				const defaults = (
					await sibling.pool.query<{ scope: string; team_id: string | null }>(
						`SELECT scope, team_id FROM "contract_default" ORDER BY scope`,
					)
				).rows;
				expect(defaults).toEqual([
					{ scope: "organization", team_id: null },
					{ scope: "team", team_id: teamId },
				]);

				// Zero duplicate conflicts (exactly 1 weekly_hours_policy_day_sum_mismatch)
				const conflicts = (
					await sibling.pool.query<{
						employment_history_id: string;
						conflict_kind: string;
						details: { weeklyContractMinutes: number; policyDaySumMinutes: number };
					}>(
						`SELECT employment_history_id, conflict_kind, details FROM "contract_migration_conflict"`,
					)
				).rows;
				expect(conflicts).toHaveLength(1);
				expect(conflicts[0]?.employment_history_id).toBe(historyConfirmedMismatchId);
				expect(conflicts[0]?.conflict_kind).toBe("weekly_hours_policy_day_sum_mismatch");
				expect(conflicts[0]?.details.weeklyContractMinutes).toBe(1800);
				expect(conflicts[0]?.details.policyDaySumMinutes).toBe(2400);

				// All legacy confirmed employment terms preserved intact with migrated_legacy_terms = true!
				const termsRows = (
					await sibling.pool.query<{
						id: string;
						valid_from_date: string;
						contract_type: string;
						weekly_contract_minutes: number;
						work_model: string;
						work_policy_id: string | null;
						hourly_rate: string | null;
						migrated_legacy_terms: boolean;
						employment_profile: string;
						arbzg_scope: string;
					}>(`
						SELECT
							id,
							valid_from_date::text,
							contract_type::text,
							weekly_contract_minutes,
							work_model::text,
							work_policy_id,
							hourly_rate::text,
							migrated_legacy_terms,
							employment_profile,
							arbzg_scope
						FROM "employee_employment_history"
					`)
				).rows;

				const mismatchRow = termsRows.find((r) => r.id === historyConfirmedMismatchId);
				expect(mismatchRow).toEqual({
					id: historyConfirmedMismatchId,
					valid_from_date: "2026-01-01",
					contract_type: "fixed",
					weekly_contract_minutes: 1800,
					work_model: "hybrid",
					work_policy_id: policyDetailedId,
					hourly_rate: null,
					migrated_legacy_terms: true,
					employment_profile: "regular",
					arbzg_scope: "standard",
				});

				const hourlyRow = termsRows.find((r) => r.id === historyConfirmedHourlyId);
				expect(hourlyRow).toEqual({
					id: historyConfirmedHourlyId,
					// 2026-03-31 22:00:00 UTC in Europe/Berlin (CEST +02:00) is 2026-04-01!
					valid_from_date: "2026-04-01",
					contract_type: "hourly",
					weekly_contract_minutes: 1200,
					work_model: "remote",
					work_policy_id: null,
					hourly_rate: "25.50",
					migrated_legacy_terms: true,
					employment_profile: "regular",
					arbzg_scope: "standard",
				});

				const draftRow = termsRows.find((r) => r.id === historyDraftId);
				expect(draftRow?.migrated_legacy_terms).toBe(false);
				expect(draftRow?.valid_from_date).toBe("2026-06-01");
			} finally {
				await sibling.cleanup();
				await rm(tempDir, { recursive: true, force: true });
			}
		},
	);

	it(
		"enforces #1922 bridge compatibility, sealed-version immutability (never on violations) with full-org cascade delete, on-call constraints, linear agreement chains, and 0321 retrospective departures & batches",
		{ timeout: 120000 },
		async () => {
			// Run against a sibling DB stopped at 0321 (Drain Gate 1) so Phase 1 bridge triggers are active.
			const sibling = await createSiblingDatabase("p1_bridges");
			const pool = sibling.pool;
			const orgId = `org_p1_${randomBytes(4).toString("hex")}`;
			const userId = `usr_p1_${randomBytes(4).toString("hex")}`;
			const empId = randomUUID();
			const teamId = randomUUID();
			const periodId = randomUUID();
			const policyId = randomUUID();

			try {
				await runBoundaryAwareMigrations({
					pool,
					migrationsFolder,
					allowContractConstraints: false,
					allowPolicyV1Seal: false,
				});
				await pool.query(
					`INSERT INTO "organization" ("id", "name", "slug", "created_at", "timezone") VALUES ($1, 'Bridge Co', $2, now(), 'Europe/Berlin')`,
					[orgId, orgId],
				);
				await pool.query(
					`INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at") VALUES ($1, 'Bridge Admin', $2, true, now(), now())`,
					[userId, `${userId}@example.test`],
				);
				await pool.query(
					`INSERT INTO "team" ("id", "organization_id", "name", "created_at", "updated_at") VALUES ($1, $2, 'Ops', now(), now())`,
					[teamId, orgId],
				);
				await pool.query(
					`INSERT INTO "employee" ("id", "user_id", "organization_id", "team_id", "role", "created_at", "updated_at") VALUES ($1, $2, $3, $4, 'employee', now(), now())`,
					[empId, userId, orgId, teamId],
				);
				await pool.query(
					`INSERT INTO "employee_employment_period" ("id", "organization_id", "employee_id", "status", "started_at", "start_provenance")
					 VALUES ($1, $2, $3, 'open', now(), 'recorded')`,
					[periodId, orgId, empId],
				);

				// 1. Legacy #1922 writer creates work_policy + schedule + regulation + break_rule + break_option + violation WITHOUT policy_version_id
				await pool.query(
					`INSERT INTO "work_policy" ("id", "organization_id", "name", "schedule_enabled", "regulation_enabled", "presence_enabled", "created_by", "created_at", "updated_at")
					 VALUES ($1, $2, 'Legacy Writer Policy', true, true, false, $3, now(), now())`,
					[policyId, orgId, userId],
				);
				const v1Row = (
					await pool.query<{ id: string; schedule_enabled: boolean }>(
						`SELECT id, schedule_enabled FROM "work_policy_version" WHERE policy_id = $1 AND version_number = 1`,
						[policyId],
					)
				).rows[0];
				expect(v1Row?.id).toBeTruthy();
				expect(v1Row?.schedule_enabled).toBe(true);

				// Updating work_policy flags syncs onto unsealed v1
				await pool.query(`UPDATE "work_policy" SET presence_enabled = true WHERE id = $1`, [
					policyId,
				]);
				const v1AfterFlagSync = (
					await pool.query<{ presence_enabled: boolean }>(
						`SELECT presence_enabled FROM "work_policy_version" WHERE id = $1`,
						[v1Row!.id],
					)
				).rows[0];
				expect(v1AfterFlagSync?.presence_enabled).toBe(true);

				// Insert child & grandchild rows without policy_version_id -> bridge populates v1.id
				const regId = randomUUID();
				const brId = randomUUID();
				await pool.query(
					`INSERT INTO "work_policy_regulation" ("id", "policy_id", "max_daily_minutes", "created_at", "updated_at") VALUES ($1, $2, 600, now(), now())`,
					[regId, policyId],
				);
				await pool.query(
					`INSERT INTO "work_policy_break_rule" ("id", "regulation_id", "working_minutes_threshold", "required_break_minutes", "created_at", "updated_at") VALUES ($1, $2, 360, 30, now(), now())`,
					[brId, regId],
				);
				const boRes = await pool.query<{ policy_version_id: string }>(
					`INSERT INTO "work_policy_break_option" ("break_rule_id", "split_count", "minimum_split_minutes") VALUES ($1, 2, 15) RETURNING policy_version_id`,
					[brId],
				);
				expect(boRes.rows[0]?.policy_version_id).toBe(v1Row!.id);

				// #1922-style delete + reinsert of regulation works while v1 is unsealed
				await pool.query(`DELETE FROM "work_policy_regulation" WHERE id = $1`, [regId]);
				const reg2Id = randomUUID();
				const reg2Res = await pool.query<{ policy_version_id: string }>(
					`INSERT INTO "work_policy_regulation" ("id", "policy_id", "max_daily_minutes", "created_at", "updated_at") VALUES ($1, $2, 540, now(), now()) RETURNING policy_version_id`,
					[reg2Id, policyId],
				);
				expect(reg2Res.rows[0]?.policy_version_id).toBe(v1Row!.id);

				// Insert violation without policy_version_id -> bridge populates v1.id
				const violationRes = await pool.query<{ id: string; policy_version_id: string }>(
					`INSERT INTO "work_policy_violation" ("employee_id", "organization_id", "policy_id", "violation_date", "violation_type")
					 VALUES ($1, $2, $3, now(), 'max_daily') RETURNING id, policy_version_id`,
					[empId, orgId, policyId],
				);
				expect(violationRes.rows[0]?.policy_version_id).toBe(v1Row!.id);

				// 2. Seal v1 -> mutations on work_policy_version & child tables rejected, NEVER on work_policy_violation!
				await pool.query(`UPDATE "work_policy_version" SET sealed_at = now() WHERE id = $1`, [
					v1Row!.id,
				]);
				await expect(
					pool.query(`UPDATE "work_policy_version" SET schedule_enabled = false WHERE id = $1`, [
						v1Row!.id,
					]),
				).rejects.toThrow(/immutable/i);
				await expect(
					pool.query(`UPDATE "work_policy_regulation" SET max_daily_minutes = 480 WHERE id = $1`, [
						reg2Id,
					]),
				).rejects.toThrow(/sealed/i);
				await expect(
					pool.query(`DELETE FROM "work_policy_regulation" WHERE id = $1`, [reg2Id]),
				).rejects.toThrow(/sealed/i);
				// work_policy_violation remains writable (e.g. acknowledgement)!
				await pool.query(
					`UPDATE "work_policy_violation" SET acknowledged_note = 'Reviewed' WHERE id = $1`,
					[violationRes.rows[0]!.id],
				);

				// 3. contract_default rejects on_call template version while accepting policy & published_shifts
				const tplId = randomUUID();
				await pool.query(
					`INSERT INTO "contract_template" ("id", "organization_id", "name") VALUES ($1, $2, 'Templates')`,
					[tplId, orgId],
				);
				const onCallVerId = randomUUID();
				const shiftsVerId = randomUUID();
				await pool.query(
					`INSERT INTO "contract_template_version" ("id", "organization_id", "template_id", "version_number", "schedule_source", "default_on_call_hours_kind")
					 VALUES ($1, $2, $3, 1, 'on_call', 'unspecified')`,
					[onCallVerId, orgId, tplId],
				);
				await pool.query(
					`INSERT INTO "contract_template_version" ("id", "organization_id", "template_id", "version_number", "schedule_source")
					 VALUES ($1, $2, $3, 2, 'published_shifts')`,
					[shiftsVerId, orgId, tplId],
				);
				await expect(
					pool.query(
						`INSERT INTO "contract_default" ("organization_id", "scope", "template_version_id", "effective_from_date")
						 VALUES ($1, 'organization', $2, DATE '2026-01-01')`,
						[orgId, onCallVerId],
					),
				).rejects.toThrow(/contract_default_template_version_fk/i);
				await pool.query(
					`INSERT INTO "contract_default" ("organization_id", "scope", "template_version_id", "effective_from_date")
					 VALUES ($1, 'organization', $2, DATE '2026-01-01')`,
					[orgId, shiftsVerId],
				);

				// 4. Terms Bridge Trigger + 3VL-safe § 12 TzBfG on-call check
				const histRes = await pool.query<{ id: string; valid_from_date: string }>(
					`INSERT INTO "employee_employment_history" (
						"employee_id", "organization_id", "employment_period_id", "valid_from",
						"contract_type", "weekly_contract_minutes", "work_model", "created_by", "created_at", "updated_at"
					) VALUES ($1, $2, $3, '2026-05-01 00:00:00', 'fixed', 2400, 'onsite', $4, now(), now())
					RETURNING id, valid_from_date::text`,
					[empId, orgId, periodId, userId],
				);
				expect(histRes.rows[0]?.valid_from_date).toBe("2026-05-01");

				// NULL schedule_source with non-null on_call_hours_kind MUST be rejected by IS TRUE check!
				await expect(
					pool.query(
						`UPDATE "employee_employment_history" SET "on_call_hours_kind" = 'exact', "on_call_weekly_minutes" = 600 WHERE id = $1`,
						[histRes.rows[0]!.id],
					),
				).rejects.toThrow(/employee_employment_history_on_call_check/i);

				// Valid on_call agreement passes
				await pool.query(
					`UPDATE "employee_employment_history"
					 SET "schedule_source" = 'on_call', "on_call_hours_kind" = 'minimum', "on_call_weekly_minutes" = 1200, "on_call_daily_minutes" = 240
					 WHERE id = $1`,
					[histRes.rows[0]!.id],
				);

				// 5. Linear employment_term_agreement chain enforcement
				const agr1Id = randomUUID();
				const agr2Id = randomUUID();
				await pool.query(
					`INSERT INTO "employment_term_agreement" ("id", "organization_id", "employee_id", "employment_period_id", "sequence_number", "kind", "starts_on", "ends_on", "reason")
					 VALUES ($1, $2, $3, $4, 1, 'fixed_term', DATE '2026-01-01', DATE '2026-12-31', 'without_objective_reason')`,
					[agr1Id, orgId, empId, periodId],
				);
				// Skipping sequence_number (3 referencing 1) rejected by composite self-FK on previous_sequence_number
				await expect(
					pool.query(
						`INSERT INTO "employment_term_agreement" ("organization_id", "employee_id", "employment_period_id", "sequence_number", "supersedes_id", "kind", "starts_on", "ends_on")
						 VALUES ($1, $2, $3, 3, $4, 'fixed_term', DATE '2027-01-01', DATE '2027-12-31')`,
						[orgId, empId, periodId, agr1Id],
					),
				).rejects.toThrow(/employment_term_agreement_supersedes_fk/i);
				// Valid extension (seq 2 -> seq 1) succeeds
				await pool.query(
					`INSERT INTO "employment_term_agreement" ("id", "organization_id", "employee_id", "employment_period_id", "sequence_number", "supersedes_id", "kind", "starts_on", "ends_on", "reason")
					 VALUES ($1, $2, $3, $4, 2, $5, 'fixed_term', DATE '2027-01-01', DATE '2027-12-31', 'without_objective_reason')`,
					[agr2Id, orgId, empId, periodId, agr1Id],
				);
				// Branching (another row superseding agr1Id) rejected
				await expect(
					pool.query(
						`INSERT INTO "employment_term_agreement" ("organization_id", "employee_id", "employment_period_id", "sequence_number", "supersedes_id", "kind", "starts_on")
						 VALUES ($1, $2, $3, 3, $4, 'permanent', DATE '2028-01-01')`,
						[orgId, empId, periodId, agr1Id],
					),
				).rejects.toThrow();

				// 6. 0321 retrospective departure, review kinds, event kinds, and durable contract_change_batch
				const depId = randomUUID();
				await pool.query(
					`INSERT INTO "employee_departure" (
						"id", "organization_id", "employee_id", "employment_period_id", "mode",
						"last_working_day", "timezone", "cutoff_at", "revision", "status",
						"created_by", "request_id", "request_fingerprint", "effective_at"
					) VALUES ($1, $2, $3, $4, 'retrospective', DATE '2026-02-28', 'Europe/Berlin', now(), 1, 'effective', $5, $6, 'fp1', now())`,
					[depId, orgId, empId, periodId, userId, randomUUID()],
				);
				await pool.query(
					`INSERT INTO "employee_departure_review" ("organization_id", "employee_id", "employment_period_id", "departure_id", "kind")
					 VALUES
						($1, $2, $3, $4, 'work_after_cutoff'),
						($1, $2, $3, $4, 'payroll_reconciliation')`,
					[orgId, empId, periodId, depId],
				);
				await pool.query(
					`INSERT INTO "employee_departure_event" ("organization_id", "employee_id", "departure_id", "employment_period_id", "request_id", "event_index", "kind")
					 VALUES
						($1, $2, $3, $4, $5, 0, 'departure_recorded_retrospectively'),
						($1, $2, $3, $4, $5, 1, 'departure_date_corrected')`,
					[orgId, empId, depId, periodId, randomUUID()],
				);
				const batchId = randomUUID();
				await pool.query(
					`INSERT INTO "contract_change_batch" ("id", "organization_id", "request_id", "request_fingerprint", "operation_kind", "execution_mode", "created_by")
					 VALUES ($1, $2, $3, 'batch-fp', 'bulk_template_apply', 'inline', $4)`,
					[batchId, orgId, randomUUID(), userId],
				);
				await pool.query(
					`INSERT INTO "contract_change_batch_item" ("organization_id", "batch_id", "employee_id", "item_index", "operation_dedupe_key")
					 VALUES ($1, $2, $3, 0, 'dedupe-1')`,
					[orgId, batchId, empId],
				);

				// 7. Full-organization cascade delete succeeds cleanly even with sealed policy versions, violations, defaults, and linear agreement chains!
				await pool.query(`DELETE FROM "organization" WHERE id = $1`, [orgId]);
				const remaining = (
					await pool.query(`SELECT 1 FROM "work_policy_version" WHERE organization_id = $1`, [
						orgId,
					])
				).rowCount;
				expect(remaining).toBe(0);
			} finally {
				await sibling.cleanup();
			}
		},
	);
});
