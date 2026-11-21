/**
 * #1924: Real-PostgreSQL integration suite for:
 * 1. DB-state-driven version-aware work policy writers across pre-0326, parked-0326,
 *    and post-0327 states (including metadata-only edit skip, same-day multi-version
 *    ordering & replacement warning, and failed child rollback).
 * 2. Serialized location archival & deactivation guard:
 *    - bidirectional `deleteLocation` and `updateLocation(isActive: false)` vs
 *      `publishWorkPolicyVersion` races in BOTH commit orders using two concurrent
 *      PostgreSQL connections;
 *    - single-location archival preserving `work_policy_presence.location_id` under
 *      `ON DELETE NO ACTION` and full-organization teardown.
 */

import { randomBytes } from "node:crypto";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { ValidationError } from "@/lib/effect/errors";
import {
	deleteOrArchiveLocationGuarded,
	deleteOrArchiveLocationInTx,
	updateLocationGuarded,
	updateLocationInTx,
} from "@/lib/locations/location-lifecycle";
import { integrationAdminPool, openIntegrationPool } from "@/test/integration-database";
import {
	createVersionedWorkPolicy,
	duplicateVersionedWorkPolicy,
	updateOrPublishWorkPolicy,
	updateOrPublishWorkPolicyInTx,
} from "./versioned-policy-writer";

const fullSchema = { ...authSchema, ...schema };

function wrapPoolAsDrizzle(pool: Pool): DatabaseClient {
	return drizzle({ client: pool, schema: fullSchema }) as unknown as DatabaseClient;
}

function wrapClientAsDrizzle(client: PoolClient): DatabaseClient {
	return drizzle({ client, schema: fullSchema }) as unknown as DatabaseClient;
}

const ORG_ID = "t1924-policy-org";
const USER_ID = "t1924-policy-admin";

async function seedOrgAndAdmin(pool: Pool, orgId = ORG_ID, userId = USER_ID) {
	await pool.query("DELETE FROM organization WHERE id = $1", [orgId]);
	await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
	const now = new Date("2026-10-01T08:00:00.000Z");
	await pool.query(
		`INSERT INTO organization (id, name, slug, timezone, created_at)
		 VALUES ($1, 'T1924 Org', $1, 'Europe/Berlin', $2)`,
		[orgId, now],
	);
	await pool.query(
		`INSERT INTO "user" (id, name, email, created_at, updated_at)
		 VALUES ($1, 'Admin', $2, $3, $3)`,
		[userId, `${userId}@example.test`, now],
	);
}

async function seedLocation(
	pool: Pool,
	orgId: string,
	userId: string,
	name: string,
	isActive = true,
) {
	const {
		rows: [row],
	} = await pool.query<{ id: string }>(
		`INSERT INTO location (organization_id, name, is_active, created_by, updated_at)
		 VALUES ($1, $2, $3, $4, now())
		 RETURNING id`,
		[orgId, name, isActive, userId],
	);
	return row.id;
}

async function waitForRowLockWaiter(pool: Pool, timeoutMs = 5000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { rows } = await pool.query<{ waiting: string }>(
			`SELECT count(*)::text AS waiting
			 FROM pg_stat_activity
			 WHERE datname = current_database()
			   AND pid <> pg_backend_pid()
			   AND state = 'active'
			   AND wait_event_type = 'Lock'`,
		);
		if (Number(rows[0]?.waiting ?? "0") > 0) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("Timed out waiting for blocked row-lock waiter");
}

describe("versioned work policy writers & serialized location archival (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

	const sharedAdmin = integrationAdminPool();
	const siblingDbName = `approval_workflow_repository_test_1924_${randomBytes(4).toString("hex")}`;
	let siblingPool: Pool;
	let siblingDb: DatabaseClient;

	beforeAll(async () => {
		// Create an isolated sibling database to test parked-0326 and post-0327 DDL states
		// without mutating the shared integration database's triggers/constraints.
		await sharedAdmin.query(`CREATE DATABASE "${siblingDbName}"`);
		siblingPool = openIntegrationPool({ databaseName: siblingDbName, max: 8 });
		siblingDb = wrapPoolAsDrizzle(siblingPool);

		const engineModule = await import("../../../scripts/boundary-migration-engine.js");
		const migrationsFolder = path.resolve(process.cwd(), "drizzle");
		await engineModule.runBoundaryAwareMigrations({
			pool: siblingPool,
			migrationsFolder,
			allowContractConstraints: true,
			allowPolicyV1Seal: true,
			lockRetries: 5,
			logger: { log: () => {}, warn: () => {}, error: () => {} },
		});
	});

	afterAll(async () => {
		await sharedAdmin.query("DELETE FROM organization WHERE id = $1", [ORG_ID]);
		await sharedAdmin.query('DELETE FROM "user" WHERE id = $1', [USER_ID]);
		if (siblingPool) {
			await siblingPool.end();
		}
		await sharedAdmin.query(
			`SELECT pg_terminate_backend(pid)
			 FROM pg_stat_activity
			 WHERE datname = $1 AND pid <> pg_backend_pid()`,
			[siblingDbName],
		);
		await sharedAdmin.query(`DROP DATABASE IF EXISTS "${siblingDbName}"`);
	});

	beforeEach(async () => {
		await seedOrgAndAdmin(sharedAdmin);
		await seedOrgAndAdmin(siblingPool);
	});

	it("pre-0326: creates v1 idempotently, skips metadata-only edits, dual-writes flags, and preserves all 7 ArbZG columns", async () => {
		const sharedDb = wrapPoolAsDrizzle(sharedAdmin);
		const locId = await seedLocation(sharedAdmin, ORG_ID, USER_ID, "Berlin HQ");

		const created = await createVersionedWorkPolicy(sharedDb, {
			organizationId: ORG_ID,
			actorUserId: USER_ID,
			data: {
				name: "Pre-0326 Policy",
				description: "Initial",
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
					maxWeeklyMinutes: 2880,
					maxUninterruptedMinutes: 360,
					minRestPeriodMinutes: 660,
					restPeriodEnforcement: "block",
					overtimeDailyThresholdMinutes: 480,
					overtimeWeeklyThresholdMinutes: 2400,
					overtimeMonthlyThresholdMinutes: 10800,
					alertBeforeLimitMinutes: 45,
					alertThresholdPercent: 85,
					breakRules: [
						{
							workingMinutesThreshold: 360,
							requiredBreakMinutes: 30,
							options: [
								{ splitCount: 2, minimumSplitMinutes: 15, minimumLongestSplitMinutes: null },
							],
						},
					],
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

		expect(created.version.versionNumber).toBe(1);
		expect(created.version.sealedAt).toBeNull();

		// Metadata-only edit does not create any new version
		const metadataRes = await updateOrPublishWorkPolicy(sharedDb, {
			organizationId: ORG_ID,
			actorUserId: USER_ID,
			policyId: created.policy.id,
			data: { name: "Pre-0326 Renamed", description: "Updated metadata only" },
		});
		expect(metadataRes.metadataOnly).toBe(true);
		expect(metadataRes.version.versionNumber).toBe(1);

		const { rows: versionsAfterMeta } = await sharedAdmin.query(
			"SELECT id FROM work_policy_version WHERE policy_id = $1",
			[created.policy.id],
		);
		expect(versionsAfterMeta).toHaveLength(1);

		// Pre-cutover versioned edit toggles scheduleEnabled off and updates break rules without wiping 7 ArbZG cols
		const edited = await updateOrPublishWorkPolicy(sharedDb, {
			organizationId: ORG_ID,
			actorUserId: USER_ID,
			policyId: created.policy.id,
			data: {
				scheduleEnabled: false,
				regulation: {
					maxDailyMinutes: 540,
					breakRules: [],
				},
			},
		});
		expect(edited.metadataOnly).toBe(false);
		expect(edited.version.versionNumber).toBe(1);
		expect(edited.version.scheduleEnabled).toBe(false);
		expect(edited.policy.regulation).toMatchObject({
			maxDailyMinutes: 540,
			minRestPeriodMinutes: 660,
			restPeriodEnforcement: "block",
			overtimeDailyThresholdMinutes: 480,
			overtimeWeeklyThresholdMinutes: 2400,
			overtimeMonthlyThresholdMinutes: 10800,
			alertBeforeLimitMinutes: 45,
			alertThresholdPercent: 85,
		});

		// Duplicate copies all 7 ArbZG columns atomically
		const copy = await duplicateVersionedWorkPolicy(sharedDb, {
			organizationId: ORG_ID,
			actorUserId: USER_ID,
			policyId: created.policy.id,
		});
		expect(copy.policy.name).toBe("Pre-0326 Renamed (Copy)");
		expect(copy.policy.regulation?.minRestPeriodMinutes).toBe(660);
	});

	it("parked-0326 & post-0327: idempotent v1 create, dual-write flags, sealed immutable versions, same-day ordering/warning, and child rollback", async () => {
		// Simulate migration 0326 parked state on sibling DB:
		// 1) Drop temporary Policy Bridge Triggers
		// 2) Drop legacy UNIQUE(policy_id) constraints on schedule/regulation/presence
		// 3) Replace work_policy_presence.location_id FK with ON DELETE NO ACTION
		// 4) Keep work_policy_versioning_state.sealed_cutover_at IS NULL
		await siblingPool.query(`
			DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_sync_v1" ON "work_policy";
			DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_schedule_version" ON "work_policy_schedule";
			DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_presence_version" ON "work_policy_presence";
			DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_regulation_version" ON "work_policy_regulation";
			DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_schedule_day_version" ON "work_policy_schedule_day";
			DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_break_rule_version" ON "work_policy_break_rule";
			DROP TRIGGER IF EXISTS "trg_01_bridge_work_policy_break_option_version" ON "work_policy_break_option";
			ALTER TABLE "work_policy_schedule" DROP CONSTRAINT IF EXISTS "work_policy_schedule_policy_id_unique";
			ALTER TABLE "work_policy_regulation" DROP CONSTRAINT IF EXISTS "work_policy_regulation_policy_id_unique";
			ALTER TABLE "work_policy_presence" DROP CONSTRAINT IF EXISTS "work_policy_presence_policy_id_unique";
			ALTER TABLE "work_policy_presence" DROP CONSTRAINT IF EXISTS "work_policy_presence_location_id_location_id_fk";
			ALTER TABLE "work_policy_presence"
				ADD CONSTRAINT "work_policy_presence_location_id_location_id_fk"
				FOREIGN KEY ("location_id") REFERENCES "location"("id")
				ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
			UPDATE "work_policy_versioning_state" SET "sealed_cutover_at" = NULL WHERE "singleton" = true;
		`);

		const locA = await seedLocation(siblingPool, ORG_ID, USER_ID, "Munich Office");
		const locB = await seedLocation(siblingPool, ORG_ID, USER_ID, "Hamburg Office");

		// --- PARKED AT 0326 ---
		const parkedCreated = await createVersionedWorkPolicy(siblingDb, {
			organizationId: ORG_ID,
			actorUserId: USER_ID,
			data: {
				name: "Parked Policy",
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
					breakRules: [
						{
							workingMinutesThreshold: 360,
							requiredBreakMinutes: 30,
							options: [
								{ splitCount: 1, minimumSplitMinutes: null, minimumLongestSplitMinutes: null },
							],
						},
					],
				},
				presence: {
					presenceMode: "minimum_count",
					requiredOnsiteDays: 2,
					locationId: locA,
				},
			},
		});
		// Without bridge triggers, writer still creates unsealed v1 idempotently and populates policy_version_id!
		expect(parkedCreated.version.versionNumber).toBe(1);
		expect(parkedCreated.version.sealedAt).toBeNull();
		expect(parkedCreated.policy.schedule?.policyVersionId).toBe(parkedCreated.version.id);

		// Parked-0326 flag edit dual-writes enablement flags to BOTH work_policy and unsealed v1!
		await updateOrPublishWorkPolicy(siblingDb, {
			organizationId: ORG_ID,
			actorUserId: USER_ID,
			policyId: parkedCreated.policy.id,
			data: { presenceEnabled: false },
		});
		const {
			rows: [dualWritten],
		} = await siblingPool.query<{ wp_pres: boolean; v1_pres: boolean }>(
			`SELECT wp.presence_enabled AS wp_pres, v.presence_enabled AS v1_pres
			 FROM work_policy wp
			 JOIN work_policy_version v ON v.policy_id = wp.id AND v.version_number = 1
			 WHERE wp.id = $1`,
			[parkedCreated.policy.id],
		);
		expect(dualWritten).toEqual({ wp_pres: false, v1_pres: false });

		// --- TRANSITION TO POST-0327 (seal v1 + set sealed_cutover_at) ---
		await siblingPool.query(`
			UPDATE "work_policy_version" SET "sealed_at" = now() WHERE "sealed_at" IS NULL;
			UPDATE "work_policy_versioning_state" SET "sealed_cutover_at" = now() WHERE "singleton" = true;
		`);

		// Post-0327 create seals v1 as final statement!
		const postCreated = await createVersionedWorkPolicy(siblingDb, {
			organizationId: ORG_ID,
			actorUserId: USER_ID,
			data: {
				name: "Post-0327 Policy",
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
					locationId: locA,
				},
			},
		});
		expect(postCreated.version.versionNumber).toBe(1);
		expect(postCreated.version.sealedAt).not.toBeNull();

		// Metadata-only edit post-0327 skips creating a new version
		const metaOnlyPost = await updateOrPublishWorkPolicy(siblingDb, {
			organizationId: ORG_ID,
			actorUserId: USER_ID,
			policyId: postCreated.policy.id,
			data: { name: "Post-0327 Policy Renamed" },
		});
		expect(metaOnlyPost.metadataOnly).toBe(true);
		expect(metaOnlyPost.version.versionNumber).toBe(1);

		// Publish v2 effective 2026-07-01 moving presence to locB
		const v2 = await updateOrPublishWorkPolicy(siblingDb, {
			organizationId: ORG_ID,
			actorUserId: USER_ID,
			policyId: postCreated.policy.id,
			data: {
				effectiveFromDate: "2026-07-01",
				schedule: {
					scheduleCycle: "weekly",
					scheduleType: "simple",
					workingDaysPreset: "weekdays",
					hoursPerCycle: "38",
				},
				presenceEnabled: true,
				presence: {
					presenceMode: "minimum_count",
					requiredOnsiteDays: 2,
					locationId: locB,
				},
			},
		});
		expect(v2.version.versionNumber).toBe(2);
		expect(v2.version.sealedAt).not.toBeNull();
		expect(v2.replacesSameDayVersion).toBeNull();
		// Preserved ArbZG fields from v1
		expect(v2.policy.regulation?.minRestPeriodMinutes).toBe(660);

		// Publish v3 on the SAME effective date (2026-07-01) -> warns about replacing v2!
		const v3 = await updateOrPublishWorkPolicy(siblingDb, {
			organizationId: ORG_ID,
			actorUserId: USER_ID,
			policyId: postCreated.policy.id,
			data: {
				effectiveFromDate: "2026-07-01",
				schedule: {
					scheduleCycle: "weekly",
					scheduleType: "simple",
					workingDaysPreset: "weekdays",
					hoursPerCycle: "35",
				},
			},
		});
		expect(v3.version.versionNumber).toBe(3);
		expect(v3.version.sealedAt).not.toBeNull();
		expect(v3.replacesSameDayVersion).toEqual({
			replacedVersionId: v2.version.id,
			replacedVersionNumber: 2,
			effectiveFromDate: "2026-07-01",
			message: "Replaces version 2 effective 2026-07-01 for the entire day.",
		});

		// Verify deterministic ordering: (effective_from_date DESC, version_number DESC) puts v3 first
		const { rows: orderedVersions } = await siblingPool.query<{
			version_number: number;
			effective_from_date: string;
		}>(
			`SELECT version_number, effective_from_date::text
			 FROM work_policy_version
			 WHERE policy_id = $1
			 ORDER BY effective_from_date DESC, version_number DESC`,
			[postCreated.policy.id],
		);
		expect(orderedVersions.map((r) => r.version_number)).toEqual([3, 2, 1]);

		// Failed child insert rolls back the entire version publish (duplicate dayOfWeek hits unique index)
		await expect(
			updateOrPublishWorkPolicy(siblingDb, {
				organizationId: ORG_ID,
				actorUserId: USER_ID,
				policyId: postCreated.policy.id,
				data: {
					effectiveFromDate: "2026-08-01",
					schedule: {
						scheduleCycle: "weekly",
						scheduleType: "detailed",
						workingDaysPreset: "custom",
						days: [
							{ dayOfWeek: "monday", hoursPerDay: "8", isWorkDay: true },
							{ dayOfWeek: "monday", hoursPerDay: "4", isWorkDay: true },
						],
					},
				},
			}),
		).rejects.toThrow();

		const { rows: versionsAfterRollback } = await siblingPool.query(
			"SELECT version_number FROM work_policy_version WHERE policy_id = $1",
			[postCreated.policy.id],
		);
		expect(versionsAfterRollback).toHaveLength(3); // v4 rolled back completely!

		// --- SINGLE-LOCATION ARCHIVAL & FULL-ORG TEARDOWN ---
		// On 2026-08-01, active version is v3 (locB). locA is ONLY referenced by sealed historical v1!
		// Attempting to delete locB (active) is refused with blocking policy name:
		await expect(
			deleteOrArchiveLocationGuarded(siblingDb, {
				organizationId: ORG_ID,
				locationId: locB,
				actorUserId: USER_ID,
				asOfDate: "2026-08-01",
			}),
		).rejects.toThrow(/Post-0327 Policy Renamed/);

		// Attempting to deactivate locB via updateLocation(isActive: false) is ALSO refused:
		await expect(
			updateLocationGuarded(siblingDb, {
				organizationId: ORG_ID,
				locationId: locB,
				actorUserId: USER_ID,
				data: { isActive: false },
				asOfDate: "2026-08-01",
			}),
		).rejects.toThrow(/Post-0327 Policy Renamed/);

		// Deleting locA (sealed historical reference only) ARCHIVES it instead of physically deleting,
		// preserving work_policy_presence.location_id intact!
		const archiveResult = await deleteOrArchiveLocationGuarded(siblingDb, {
			organizationId: ORG_ID,
			locationId: locA,
			actorUserId: USER_ID,
			asOfDate: "2026-08-01",
		});
		expect(archiveResult).toEqual({
			outcome: "archived",
			id: locA,
			name: "Munich Office",
			historicalReferenceCount: 2, // parkedCreated v1 + postCreated v1
		});

		const {
			rows: [locARow],
		} = await siblingPool.query<{ is_active: boolean }>(
			"SELECT is_active FROM location WHERE id = $1",
			[locA],
		);
		expect(locARow?.is_active).toBe(false);

		const {
			rows: [v1Presence],
		} = await siblingPool.query<{ location_id: string | null }>(
			"SELECT location_id FROM work_policy_presence WHERE policy_version_id = $1",
			[postCreated.version.id],
		);
		expect(v1Presence?.location_id).toBe(locA);

		// Unreferenced location is physically deleted
		const locUnused = await seedLocation(siblingPool, ORG_ID, USER_ID, "Unused Annex");
		const deleteUnused = await deleteOrArchiveLocationGuarded(siblingDb, {
			organizationId: ORG_ID,
			locationId: locUnused,
			actorUserId: USER_ID,
			asOfDate: "2026-08-01",
		});
		expect(deleteUnused).toEqual({ outcome: "deleted", id: locUnused, name: "Unused Annex" });
		const { rows: unusedAfter } = await siblingPool.query("SELECT id FROM location WHERE id = $1", [
			locUnused,
		]);
		expect(unusedAfter).toHaveLength(0);

		// Full-org teardown succeeds even with sealed versions + ON DELETE NO ACTION FK on location_id!
		await siblingPool.query("DELETE FROM organization WHERE id = $1", [ORG_ID]);
		const { rows: remainingOrgs } = await siblingPool.query(
			"SELECT id FROM organization WHERE id = $1",
			[ORG_ID],
		);
		expect(remainingOrgs).toHaveLength(0);
	});

	it("serializes bidirectional deleteLocation / updateLocation(isActive: false) vs publishWorkPolicyVersion races in BOTH commit orders without deadlocks", async () => {
		// Ensure post-0327 state on sibling DB
		await siblingPool.query(
			`UPDATE "work_policy_versioning_state" SET "sealed_cutover_at" = now() WHERE "singleton" = true`,
		);

		const createBasePolicy = async (name: string) =>
			createVersionedWorkPolicy(siblingDb, {
				organizationId: ORG_ID,
				actorUserId: USER_ID,
				data: {
					name,
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

		// --- RACE 1: publishWorkPolicyVersion commits FIRST, deleteLocation waits on location FOR UPDATE then REFUSES ---
		{
			const locId = await seedLocation(siblingPool, ORG_ID, USER_ID, "Race1 Location");
			const policy = await createBasePolicy("Race1 Policy");

			const clientA = await siblingPool.connect();
			const clientB = await siblingPool.connect();
			try {
				await clientA.query("BEGIN ISOLATION LEVEL READ COMMITTED");
				await updateOrPublishWorkPolicyInTx(wrapClientAsDrizzle(clientA) as never, {
					organizationId: ORG_ID,
					actorUserId: USER_ID,
					policyId: policy.policy.id,
					data: {
						effectiveFromDate: "2026-09-01",
						presenceEnabled: true,
						presence: { presenceMode: "minimum_count", requiredOnsiteDays: 2, locationId: locId },
					},
				});

				// clientA now holds location FOR SHARE; start clientB deleteLocation (blocks on location FOR UPDATE)
				const deletePromise = (async () => {
					await clientB.query("BEGIN ISOLATION LEVEL READ COMMITTED");
					try {
						const res = await deleteOrArchiveLocationInTx(wrapClientAsDrizzle(clientB) as never, {
							organizationId: ORG_ID,
							locationId: locId,
							actorUserId: USER_ID,
							asOfDate: "2026-08-01",
						});
						await clientB.query("COMMIT");
						return res;
					} catch (err) {
						await clientB.query("ROLLBACK");
						throw err;
					}
				})();

				await waitForRowLockWaiter(siblingPool);
				await clientA.query("COMMIT");

				await expect(deletePromise).rejects.toThrow(/Race1 Policy/);
			} finally {
				clientA.release();
				clientB.release();
			}
		}

		// --- RACE 2: deleteLocation commits FIRST, publishWorkPolicyVersion waits on location FOR SHARE then REFUSES ---
		{
			const locId = await seedLocation(siblingPool, ORG_ID, USER_ID, "Race2 Location");
			const policy = await createBasePolicy("Race2 Policy");

			const clientA = await siblingPool.connect();
			const clientB = await siblingPool.connect();
			try {
				await clientA.query("BEGIN ISOLATION LEVEL READ COMMITTED");
				await deleteOrArchiveLocationInTx(wrapClientAsDrizzle(clientA) as never, {
					organizationId: ORG_ID,
					locationId: locId,
					actorUserId: USER_ID,
					asOfDate: "2026-08-01",
				});

				// clientA holds location FOR UPDATE and deleted it (uncommitted); clientB publish blocks on location FOR SHARE
				const publishPromise = (async () => {
					await clientB.query("BEGIN ISOLATION LEVEL READ COMMITTED");
					try {
						const res = await updateOrPublishWorkPolicyInTx(wrapClientAsDrizzle(clientB) as never, {
							organizationId: ORG_ID,
							actorUserId: USER_ID,
							policyId: policy.policy.id,
							data: {
								effectiveFromDate: "2026-09-01",
								presenceEnabled: true,
								presence: {
									presenceMode: "minimum_count",
									requiredOnsiteDays: 2,
									locationId: locId,
								},
							},
						});
						await clientB.query("COMMIT");
						return res;
					} catch (err) {
						await clientB.query("ROLLBACK");
						throw err;
					}
				})();

				await waitForRowLockWaiter(siblingPool);
				await clientA.query("COMMIT");

				await expect(publishPromise).rejects.toThrow(ValidationError);
			} finally {
				clientA.release();
				clientB.release();
			}
		}

		// --- RACE 3: publishWorkPolicyVersion commits FIRST, updateLocation(isActive: false) waits then REFUSES ---
		{
			const locId = await seedLocation(siblingPool, ORG_ID, USER_ID, "Race3 Location");
			const policy = await createBasePolicy("Race3 Policy");

			const clientA = await siblingPool.connect();
			const clientB = await siblingPool.connect();
			try {
				await clientA.query("BEGIN ISOLATION LEVEL READ COMMITTED");
				await updateOrPublishWorkPolicyInTx(wrapClientAsDrizzle(clientA) as never, {
					organizationId: ORG_ID,
					actorUserId: USER_ID,
					policyId: policy.policy.id,
					data: {
						effectiveFromDate: "2026-09-01",
						presenceEnabled: true,
						presence: { presenceMode: "minimum_count", requiredOnsiteDays: 1, locationId: locId },
					},
				});

				const deactivatePromise = (async () => {
					await clientB.query("BEGIN ISOLATION LEVEL READ COMMITTED");
					try {
						const res = await updateLocationInTx(wrapClientAsDrizzle(clientB) as never, {
							organizationId: ORG_ID,
							locationId: locId,
							actorUserId: USER_ID,
							data: { isActive: false },
							asOfDate: "2026-08-01",
						});
						await clientB.query("COMMIT");
						return res;
					} catch (err) {
						await clientB.query("ROLLBACK");
						throw err;
					}
				})();

				await waitForRowLockWaiter(siblingPool);
				await clientA.query("COMMIT");

				await expect(deactivatePromise).rejects.toThrow(/Race3 Policy/);
			} finally {
				clientA.release();
				clientB.release();
			}
		}

		// --- RACE 4: updateLocation(isActive: false) commits FIRST, publishWorkPolicyVersion waits then REFUSES ---
		{
			const locId = await seedLocation(siblingPool, ORG_ID, USER_ID, "Race4 Location");
			const policy = await createBasePolicy("Race4 Policy");

			const clientA = await siblingPool.connect();
			const clientB = await siblingPool.connect();
			try {
				await clientA.query("BEGIN ISOLATION LEVEL READ COMMITTED");
				await updateLocationInTx(wrapClientAsDrizzle(clientA) as never, {
					organizationId: ORG_ID,
					locationId: locId,
					actorUserId: USER_ID,
					data: { isActive: false },
					asOfDate: "2026-08-01",
				});

				const publishPromise = (async () => {
					await clientB.query("BEGIN ISOLATION LEVEL READ COMMITTED");
					try {
						const res = await updateOrPublishWorkPolicyInTx(wrapClientAsDrizzle(clientB) as never, {
							organizationId: ORG_ID,
							actorUserId: USER_ID,
							policyId: policy.policy.id,
							data: {
								effectiveFromDate: "2026-09-01",
								presenceEnabled: true,
								presence: {
									presenceMode: "minimum_count",
									requiredOnsiteDays: 1,
									locationId: locId,
								},
							},
						});
						await clientB.query("COMMIT");
						return res;
					} catch (err) {
						await clientB.query("ROLLBACK");
						throw err;
					}
				})();

				await waitForRowLockWaiter(siblingPool);
				await clientA.query("COMMIT");

				await expect(publishPromise).rejects.toThrow(ValidationError);
			} finally {
				clientA.release();
				clientB.release();
			}
		}
	});
});
