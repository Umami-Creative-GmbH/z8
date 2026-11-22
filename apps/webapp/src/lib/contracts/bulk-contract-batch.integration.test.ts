/**
 * #1928: Real-PostgreSQL integration, crash-recovery & 10,000-employee scale suite for:
 * - Commit-first durable batch submission with `(organization_id, request_id)` uniqueness,
 *   identical-fingerprint replay idempotency (with stalled-batch nudge), and
 *   mismatched-fingerprint `request_conflict`.
 * - Unified batch runner (`runContractChangeBatch`) executing inline (≤200) and async (>200)
 *   batches with 60s lease + heartbeat every 10 items, sorted-UUID item ordering, and
 *   atomic per-employee `source_batch_item_id` deduplication.
 * - Periodic recovery sweeper (`runContractChangeBatchRecovery`) via `FOR UPDATE SKIP LOCKED`:
 *   - Crash-after-commit before inline start (`pending` > 10s recovered cleanly);
 *   - Crash mid-inline after partial progress + lease-expiry recovery with ZERO duplicate
 *     `employee_employment_history` or `work_policy_assignment` rows (including when an item
 *     committed its domain write before its batch-item status row updated!).
 * - All 3 bulk operations + strictly read-only dry-run previews:
 *   `apply_template_version` (preserve divergences vs overwrite), `adopt_default` for
 *   `migrated_legacy_terms = true`, and `bulk_operational_update`.
 * - Validated CSV contract import and CSV leaving-date import (future, immediate, retrospective
 *   across closed month & settled payroll opening `payroll_reconciliation`, past-date correction,
 *   and legacy historical backfill) + confirmation fingerprint enforcement.
 * - Representative 10,000-employee bulk preview, async batch enqueue (`executionMode = 'async'`),
 *   and 10,000-row CSV dry-run performance verification.
 */

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";
import {
	contractChangeBatch,
	contractChangeBatchItem,
	employeeDeparture,
	employeeDepartureReview,
	employeeEmploymentHistory,
	payrollSettledDay,
	workPolicyAssignment,
} from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { ConflictError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { createDepartureCommands } from "@/lib/employee-lifecycle/commands";
import type { DepartureClockOutPort } from "@/lib/employee-lifecycle/types";
import { createVersionedWorkPolicy } from "@/lib/work-policy/versioned-policy-writer";
import { integrationAdminPool } from "@/test/integration-database";
import {
	commitContractChange,
	commitCsvImportBatch,
	createContractTemplate,
	getContractChangeBatch,
	listContractChangeBatches,
	previewBulkContractAction,
	previewCsvContractImport,
	previewCsvLeavingDateImport,
	resolveEffectiveContractOnDay,
	runContractChangeBatch,
	runContractChangeBatchRecovery,
	scheduleContractDefault,
	submitBulkContractAction,
	submitContractChangeBatch,
} from "./index";

const fullSchema = { ...authSchema, ...schema };

const ORG_ID = "t1928-bulk-org";
const ADMIN_USER_ID = "t1928-bulk-admin";
const SCALE_ORG_ID = "t1928-scale-10k-org";
const SCALE_ADMIN_USER_ID = "t1928-scale-10k-admin";

const noopClockOut: DepartureClockOutPort = {
	close: async () => ({ kind: "not_running" }),
};

describe("durable bulk contracts, crash recovery & CSV imports (PostgreSQL, #1928)", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	const db = drizzle({ client: admin, schema: fullSchema }) as unknown as DatabaseClient;

	async function cleanup() {
		await admin.query("DELETE FROM organization WHERE id = $1", [ORG_ID]);
		await admin.query(`DELETE FROM "user" WHERE id LIKE 't1928-bulk-%'`);
	}

	async function cleanupScaleOrgIfPresent() {
		const existing = await admin.query<{ id: string }>(
			"SELECT id FROM organization WHERE id = $1",
			[SCALE_ORG_ID],
		);
		if (existing.rows.length > 0) {
			await admin.query("DELETE FROM organization WHERE id = $1", [SCALE_ORG_ID]);
			await admin.query(`DELETE FROM "user" WHERE id LIKE 't1928-scale-%'`);
		}
	}

	async function seedOrgAndAdmin() {
		const now = new Date("2026-01-01T00:00:00.000Z");
		await admin.query(
			`INSERT INTO "user" (id, name, email, created_at, updated_at)
			 VALUES ($1, 'Bulk Admin', 't1928-bulk-admin@example.test', $2, $2)`,
			[ADMIN_USER_ID, now],
		);
		await admin.query(
			`INSERT INTO organization (id, name, slug, timezone, created_at)
			 VALUES ($1, 'Bulk Test Org', 't1928-bulk-org', 'Europe/Berlin', $2)`,
			[ORG_ID, now],
		);
		await admin.query(
			`INSERT INTO member (id, organization_id, user_id, role, status, created_at)
			 VALUES ($1, $2, $3, 'owner', 'approved', $4)`,
			[randomUUID(), ORG_ID, ADMIN_USER_ID, now],
		);
		await admin.query(
			`INSERT INTO employee (
				user_id, organization_id, first_name, last_name, role, contract_type, is_active, updated_at
			) VALUES ($1, $2, 'Bulk', 'Admin', 'admin', 'fixed', true, $3)`,
			[ADMIN_USER_ID, ORG_ID, now],
		);
	}

	async function seedTeam(name: string) {
		const {
			rows: [row],
		} = await admin.query<{ id: string }>(
			`INSERT INTO team (organization_id, name, created_at, updated_at)
			 VALUES ($1, $2, now(), now())
			 RETURNING id`,
			[ORG_ID, name],
		);
		return row.id;
	}

	async function seedSimplePolicy(name: string, hoursPerCycle: string) {
		const created = await createVersionedWorkPolicy(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			data: {
				name,
				scheduleEnabled: true,
				regulationEnabled: false,
				presenceEnabled: false,
				schedule: {
					scheduleCycle: "weekly",
					scheduleType: "simple",
					workingDaysPreset: "weekdays",
					hoursPerCycle,
				},
			},
		});
		return created.policy.id;
	}

	async function seedEmployee(opts: {
		key: string;
		employeeNumber?: string | null;
		teamId?: string | null;
		contractType?: "fixed" | "hourly";
		role?: "admin" | "manager" | "employee";
		startedAt?: string;
		isActive?: boolean;
		memberStatus?: "approved" | "pending";
	}) {
		const userId = `t1928-bulk-${opts.key}`;
		const email = `${userId}@example.test`;
		const now = new Date("2026-01-01T00:00:00.000Z");
		await admin.query(
			`INSERT INTO "user" (id, name, email, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $4)`,
			[userId, opts.key, email, now],
		);
		await admin.query(
			`INSERT INTO member (id, organization_id, user_id, role, status, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			[
				randomUUID(),
				ORG_ID,
				userId,
				opts.role === "admin" ? "admin" : "member",
				opts.memberStatus ?? "approved",
				now,
			],
		);
		const active = opts.isActive ?? true;
		const {
			rows: [emp],
		} = await admin.query<{ id: string }>(
			`INSERT INTO employee (
				user_id, organization_id, team_id, first_name, last_name, employee_number,
				role, contract_type, is_active, updated_at
			) VALUES ($1, $2, $3, $4, 'Tester', $5, $6, $7, $8, $9)
			RETURNING id`,
			[
				userId,
				ORG_ID,
				opts.teamId ?? null,
				opts.key,
				opts.employeeNumber ?? null,
				opts.role ?? "employee",
				opts.contractType ?? "fixed",
				active,
				now,
			],
		);
		let employmentPeriodId: string | null = null;
		if (active) {
			const {
				rows: [period],
			} = await admin.query<{ id: string }>(
				`INSERT INTO employee_employment_period (
					organization_id, employee_id, status, started_at, start_provenance
				) VALUES ($1, $2, 'open', $3::timestamptz, 'recorded')
				RETURNING id`,
				[ORG_ID, emp.id, opts.startedAt ?? "2026-01-01T00:00:00Z"],
			);
			employmentPeriodId = period.id;
		}
		if (opts.teamId) {
			await admin.query(
				`UPDATE employee_team_history
				 SET effective_from = $2::timestamptz
				 WHERE employee_id = $1`,
				[emp.id, opts.startedAt ?? "2026-01-01T00:00:00Z"],
			);
		}
		return {
			userId,
			email,
			employeeId: emp.id,
			employmentPeriodId,
			employeeNumber: opts.employeeNumber ?? null,
		};
	}

	beforeEach(async () => {
		await cleanup();
		await seedOrgAndAdmin();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("commits sorted-UUID batch items atomically, replays identical fingerprints idempotently, nudges stalled batches, and rejects mismatched fingerprints with request_conflict", async () => {
		const empA = await seedEmployee({ key: "replay-a", employeeNumber: "R-001" });
		const empB = await seedEmployee({ key: "replay-b", employeeNumber: "R-002" });
		const requestId = randomUUID();

		// 1. Commit-first without executing inline (simulating a stalled pending batch)
		const first = await submitContractChangeBatch(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			requestId,
			operationKind: "bulk_terms_update",
			payload: {
				effectiveFromDate: "2026-07-01",
				overwritePersonalDivergences: false,
				changes: { workModel: "hybrid" },
				changeReason: "Hybrid rollout",
			},
			items: [
				{ employeeId: empB.employeeId, payload: {} },
				{ employeeId: empA.employeeId, payload: {} },
			],
			skipImmediateExecution: true,
			runnerOptions: { skipBalanceDirtyNotification: true },
		});

		expect(first.replayed).toBe(false);
		expect(first.executionMode).toBe("inline");
		expect(first.batch.status).toBe("pending");

		// Verify items were persisted in strictly ascending employeeId UUID order
		const storedItems = await db
			.select()
			.from(contractChangeBatchItem)
			.where(eq(contractChangeBatchItem.batchId, first.batch.id))
			.orderBy(asc(contractChangeBatchItem.itemIndex));
		const expectedSortedIds = [empA.employeeId, empB.employeeId].sort((a, b) => a.localeCompare(b));
		expect(storedItems.map((i) => i.employeeId)).toEqual(expectedSortedIds);

		// 2. Reusing same requestId with different payload throws ConflictError(request_conflict)
		await expect(
			submitContractChangeBatch(db, {
				organizationId: ORG_ID,
				actorUserId: ADMIN_USER_ID,
				requestId,
				operationKind: "bulk_terms_update",
				payload: {
					effectiveFromDate: "2026-07-01",
					overwritePersonalDivergences: false,
					changes: { workModel: "remote" }, // different payload!
					changeReason: "Different rollout",
				},
				items: [
					{ employeeId: empA.employeeId, payload: {} },
					{ employeeId: empB.employeeId, payload: {} },
				],
			}),
		).rejects.toMatchObject({
			_tag: "ConflictError",
			conflictType: "request_conflict",
		} satisfies Partial<ConflictError>);

		// 3. Replaying same requestId with identical fingerprint (even reversed item order) returns original batch AND nudges execution!
		const replay = await submitContractChangeBatch(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			requestId,
			operationKind: "bulk_terms_update",
			payload: {
				changeReason: "Hybrid rollout",
				changes: { workModel: "hybrid" },
				overwritePersonalDivergences: false,
				effectiveFromDate: "2026-07-01",
			},
			items: [
				{ employeeId: empA.employeeId, payload: {} },
				{ employeeId: empB.employeeId, payload: {} },
			],
			runnerOptions: { skipBalanceDirtyNotification: true },
		});

		expect(replay.replayed).toBe(true);
		expect(replay.recoveryNudged).toBe(true);
		expect(replay.batch.id).toBe(first.batch.id);
		expect(replay.batch.status).toBe("completed");
		expect(replay.batch.completedItems).toBe(2);

		// 4. Subsequent replay on already-completed batch is a pure idempotent receipt read
		const secondReplay = await submitContractChangeBatch(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			requestId,
			operationKind: "bulk_terms_update",
			payload: {
				effectiveFromDate: "2026-07-01",
				overwritePersonalDivergences: false,
				changes: { workModel: "hybrid" },
				changeReason: "Hybrid rollout",
			},
			items: [
				{ employeeId: empB.employeeId, payload: {} },
				{ employeeId: empA.employeeId, payload: {} },
			],
			runnerOptions: { skipBalanceDirtyNotification: true },
		});
		expect(secondReplay.replayed).toBe(true);
		expect(secondReplay.recoveryNudged).toBe(false);
		expect(secondReplay.batch.id).toBe(first.batch.id);

		// Confirm exactly 1 history row per employee
		const historyRows = await db
			.select()
			.from(employeeEmploymentHistory)
			.where(eq(employeeEmploymentHistory.organizationId, ORG_ID));
		expect(historyRows).toHaveLength(2);
	});

	it("recovers a crash-after-commit pending batch (>10s) via runContractChangeBatchRecovery without grabbing fresh (<10s) pending batches", async () => {
		const emp1 = await seedEmployee({ key: "crash-after-1" });
		const emp2 = await seedEmployee({ key: "crash-after-2" });
		const t0 = new Date("2026-07-01T10:00:00.000Z");

		const crashedBatch = await submitContractChangeBatch(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			requestId: randomUUID(),
			operationKind: "bulk_terms_update",
			payload: {
				effectiveFromDate: "2026-07-01",
				overwritePersonalDivergences: false,
				changes: { balanceMode: "trust_based" },
				changeReason: "Crash-after-commit batch",
			},
			items: [{ employeeId: emp1.employeeId, payload: {} }],
			now: t0,
			skipImmediateExecution: true,
		});

		const freshBatch = await submitContractChangeBatch(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			requestId: randomUUID(),
			operationKind: "bulk_terms_update",
			payload: {
				effectiveFromDate: "2026-07-01",
				overwritePersonalDivergences: false,
				changes: { balanceMode: "trust_based" },
				changeReason: "Fresh pending batch",
			},
			items: [{ employeeId: emp2.employeeId, payload: {} }],
			now: new Date(t0.getTime() + 12_000), // only 3s old at t0 + 15s
			skipImmediateExecution: true,
		});

		const recovery = await runContractChangeBatchRecovery(db, {
			organizationId: ORG_ID,
			now: () => new Date(t0.getTime() + 15_000),
			runnerOptions: { skipBalanceDirtyNotification: true },
		});

		expect(recovery.scanned).toBe(1);
		expect(recovery.completed).toBe(1);

		const recoveredDetail = await getContractChangeBatch(db, ORG_ID, crashedBatch.batch.id);
		const freshDetail = await getContractChangeBatch(db, ORG_ID, freshBatch.batch.id);
		expect(recoveredDetail?.batch.status).toBe("completed");
		expect(recoveredDetail?.batch.completedItems).toBe(1);
		expect(freshDetail?.batch.status).toBe("pending");

		const resolved = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: emp1.employeeId,
			date: "2026-07-01",
		});
		expect(resolved?.balanceMode).toBe("trust_based");
	});

	it("recovers a mid-inline crash with lease heartbeat and expired lease with ZERO duplicate employment terms or policy assignments (including pre-status-update crash)", async () => {
		const policyId = await seedSimplePolicy("Bulk Standard 38h", "38.00");
		const employees = [];
		for (let i = 0; i < 15; i++) {
			employees.push(await seedEmployee({ key: `midcrash-${String(i).padStart(2, "0")}` }));
		}

		const t0 = new Date("2026-07-01T12:00:00.000Z");
		const heartbeats: number[] = [];

		// 1. Run inline batch, crashing deterministically right after item 11 (after heartbeat at item 10)
		const submitted = await submitContractChangeBatch(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			requestId: randomUUID(),
			operationKind: "bulk_terms_update",
			payload: {
				effectiveFromDate: "2026-08-01",
				overwritePersonalDivergences: false,
				changes: { workPolicyId: policyId, weeklyContractMinutes: 2280 },
				changeReason: "Mid-inline crash test",
			},
			items: employees.map((e) => ({ employeeId: e.employeeId, payload: {} })),
			now: t0,
			runnerOptions: {
				now: () => t0,
				skipBalanceDirtyNotification: true,
				onHeartbeat: (info) => heartbeats.push(info.processedInThisRun),
				onAfterItemProcessed: ({ processedInThisRun }) =>
					processedInThisRun === 11 ? { stopExecution: true } : undefined,
			},
		});

		expect(heartbeats).toEqual([10]);
		expect(submitted.batch.status).toBe("running");
		expect(submitted.batch.leaseToken).not.toBeNull();
		expect(submitted.batch.leaseExpiresAt).not.toBeNull();

		// 2. Simulate worst-case split crash on item #12: domain commit succeeded with sourceBatchItemId,
		//    but process died BEFORE updating contract_change_batch_item.status to 'completed'!
		const remainingBeforeRecovery = await db
			.select()
			.from(contractChangeBatchItem)
			.where(
				and(
					eq(contractChangeBatchItem.batchId, submitted.batch.id),
					eq(contractChangeBatchItem.status, "pending"),
				),
			)
			.orderBy(asc(contractChangeBatchItem.employeeId));
		expect(remainingBeforeRecovery).toHaveLength(4);

		const splitCrashedItem = remainingBeforeRecovery[0];
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: splitCrashedItem.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-08-01",
			workPolicyId: policyId,
			weeklyContractMinutes: 2280,
			sourceBatchItemId: splitCrashedItem.id,
			changeReason: "Simulated pre-status-update commit",
			now: t0,
		});
		await db
			.update(contractChangeBatchItem)
			.set({ status: "running" })
			.where(eq(contractChangeBatchItem.id, splitCrashedItem.id));

		// 3. Before lease expiry (t0 + 30s), sweeper MUST NOT steal the active lease
		const earlyRecovery = await runContractChangeBatchRecovery(db, {
			organizationId: ORG_ID,
			now: () => new Date(t0.getTime() + 30_000),
			runnerOptions: { skipBalanceDirtyNotification: true },
		});
		expect(earlyRecovery.scanned).toBe(0);

		// 4. After lease expiry (t0 + 65s), sweeper claims & completes all remaining items cleanly!
		const lateRecovery = await runContractChangeBatchRecovery(db, {
			organizationId: ORG_ID,
			now: () => new Date(t0.getTime() + 65_000),
			runnerOptions: { skipBalanceDirtyNotification: true },
		});
		expect(lateRecovery.scanned).toBe(1);
		expect(lateRecovery.completed).toBe(1);

		const detail = await getContractChangeBatch(db, ORG_ID, submitted.batch.id, { limit: 50 });
		expect(detail?.batch.status).toBe("completed");
		expect(detail?.batch.completedItems).toBe(15);
		expect(detail?.batch.failedItems).toBe(0);
		expect(detail?.batch.skippedItems).toBe(0);
		expect(detail?.batch.leaseToken).toBeNull();

		// Verify split-crashed item was marked completed with deduplicated: true
		const recoveredSplitItem = detail?.items.find((i) => i.id === splitCrashedItem.id);
		expect(recoveredSplitItem?.status).toBe("completed");
		expect((recoveredSplitItem?.result as { deduplicated?: boolean })?.deduplicated).toBe(true);

		// Verify ZERO duplicate employment terms or policy assignments across all 15 employees
		const allHistory = await db
			.select()
			.from(employeeEmploymentHistory)
			.where(eq(employeeEmploymentHistory.organizationId, ORG_ID));
		expect(allHistory).toHaveLength(15);

		const allAssignments = await db
			.select()
			.from(workPolicyAssignment)
			.where(
				and(
					eq(workPolicyAssignment.organizationId, ORG_ID),
					eq(workPolicyAssignment.assignmentType, "employee"),
					eq(workPolicyAssignment.isActive, true),
				),
			);
		expect(allAssignments).toHaveLength(15);
	});

	it("prevents concurrent stale/reclaimed dual runners from failing or overwriting completed items (N3)", async () => {
		const policyId = await seedSimplePolicy("Dual Runner Policy 39h", "39.00");
		const employees = [];
		for (let i = 0; i < 6; i++) {
			employees.push(await seedEmployee({ key: `dual-${String(i).padStart(2, "0")}` }));
		}

		const t0 = new Date("2026-07-01T14:00:00.000Z");
		const submitted = await submitContractChangeBatch(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			requestId: randomUUID(),
			operationKind: "bulk_terms_update",
			payload: {
				effectiveFromDate: "2026-09-01",
				overwritePersonalDivergences: false,
				changes: { workPolicyId: policyId, weeklyContractMinutes: 2340 },
				changeReason: "Concurrent dual-runner safety test",
			},
			items: employees.map((e) => ({ employeeId: e.employeeId, payload: {} })),
			now: t0,
			skipImmediateExecution: true,
		});

		// Launch Runner A and pause it mid-chunk after item #1 so its lease expires, then launch
		// Runner B concurrently while Runner A resumes on the exact same chunk!
		let releaseRunnerA: (() => void) | null = null;
		const runnerAPaused = new Promise<void>((resolve) => {
			releaseRunnerA = resolve;
		});
		let runnerACrossedItem1: (() => void) | null = null;
		const waitRunnerAItem1 = new Promise<void>((resolve) => {
			runnerACrossedItem1 = resolve;
		});

		const runnerAPromise = runContractChangeBatch(db, {
			organizationId: ORG_ID,
			batchId: submitted.batch.id,
			now: () => t0,
			leaseDurationMs: 1_000,
			skipBalanceDirtyNotification: true,
			onAfterItemProcessed: async ({ processedInThisRun }) => {
				if (processedInThisRun === 1) {
					runnerACrossedItem1?.();
					await runnerAPaused;
				}
				return undefined;
			},
		});

		await waitRunnerAItem1;

		// Runner B reclaims the expired lease (t0 + 5s) and runs concurrently as Runner A unblocks!
		const runnerBPromise = runContractChangeBatch(db, {
			organizationId: ORG_ID,
			batchId: submitted.batch.id,
			now: () => new Date(t0.getTime() + 5_000),
			leaseDurationMs: 60_000,
			skipBalanceDirtyNotification: true,
		});
		releaseRunnerA?.();

		const [resA, resB] = await Promise.all([runnerAPromise, runnerBPromise]);
		expect(resA.claimed).toBe(true);
		expect(resB.claimed).toBe(true);
		expect(resA.leaseLost).toBe(true);

		const detail = await getContractChangeBatch(db, ORG_ID, submitted.batch.id, { limit: 20 });
		expect(detail?.batch.status).toBe("completed");
		expect(detail?.batch.completedItems).toBe(6);
		expect(detail?.batch.failedItems).toBe(0);
		expect(detail?.batch.skippedItems).toBe(0);
		expect(detail?.items.every((i) => i.status === "completed")).toBe(true);

		const historyRows = await db
			.select()
			.from(employeeEmploymentHistory)
			.where(eq(employeeEmploymentHistory.organizationId, ORG_ID));
		expect(historyRows).toHaveLength(6);
	});

	it("executes all 3 bulk contract operations with read-only dry-run previews: template apply (preserve vs overwrite), adopt_default for legacy terms, and bulk operational update", async () => {
		const orgPolicyId = await seedSimplePolicy("Org Default 40h", "40.00");
		const templatePolicyId = await seedSimplePolicy("Retail Shift 32h", "32.00");

		await scheduleContractDefault(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			scope: "organization",
			effectiveFromDate: "2026-01-01",
			workPolicyId: orgPolicyId,
			weeklyContractMinutes: 2400,
			workModel: "onsite",
			balanceMode: "tracked",
			scheduleMode: "policy",
			scheduleSource: "policy",
		});

		const teamA = await seedTeam("Store Ops");
		const empInheriting = await seedEmployee({ key: "bulk-inh", teamId: teamA });
		const empDiverged = await seedEmployee({ key: "bulk-div", teamId: teamA });
		const empLegacy = await seedEmployee({
			key: "bulk-leg",
			contractType: "hourly",
		});

		// Give empDiverged a personal weeklyContractMinutes divergence (1800m = 30h)
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: empDiverged.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-02-01",
			weeklyContractMinutes: 1800,
		});

		// Give empLegacy migrated_legacy_terms = true with an hourly wage (€22.50)
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: empLegacy.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-02-01",
			contractType: "hourly",
			hourlyRate: 22.5,
			weeklyContractMinutes: 2100,
			workModel: "flexible",
			migratedLegacyTerms: true,
		});

		const tpl = await createContractTemplate(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			name: "Retail 32h Hybrid",
			workPolicyId: templatePolicyId,
			weeklyContractMinutes: 1920,
			workModel: "hybrid",
			balanceMode: "tracked",
			scheduleMode: "policy",
			scheduleSource: "policy",
		});

		// 1. Dry-run preview of template apply (preserve divergences)
		const previewPreserve = await previewBulkContractAction(db, {
			organizationId: ORG_ID,
			actionKind: "apply_template_version",
			templateVersionId: tpl.templateVersionId,
			effectiveFromDate: "2026-07-01",
			overwritePersonalDivergences: false,
			target: { teamId: teamA },
		});
		expect(previewPreserve.totalMatched).toBe(2);
		expect(previewPreserve.canSubmit).toBe(true);
		const divPreviewEntry = previewPreserve.employees.find(
			(e) => e.employeeId === empDiverged.employeeId,
		);
		expect(divPreviewEntry?.preservedDivergenceFields).toContain("weeklyContractMinutes");

		// Submit template apply with overwritePersonalDivergences = false
		const tplReceipt = await submitBulkContractAction(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			actionKind: "apply_template_version",
			templateVersionId: tpl.templateVersionId,
			effectiveFromDate: "2026-07-01",
			overwritePersonalDivergences: false,
			target: { teamId: teamA },
			runnerOptions: { skipBalanceDirtyNotification: true },
		});
		expect(tplReceipt.batch.status).toBe("completed");

		const inhAfter = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: empInheriting.employeeId,
			date: "2026-07-01",
		});
		const divAfter = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: empDiverged.employeeId,
			date: "2026-07-01",
		});
		expect(inhAfter?.weeklyContractMinutes).toBe(1920);
		expect(inhAfter?.workModel).toBe("hybrid");
		// Personal divergence on weeklyContractMinutes preserved, while non-diverged workModel updated!
		expect(divAfter?.weeklyContractMinutes).toBe(1800);
		expect(divAfter?.workModel).toBe("hybrid");

		// Submit template apply with overwritePersonalDivergences = true on later effective date
		await submitBulkContractAction(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			actionKind: "apply_template_version",
			templateVersionId: tpl.templateVersionId,
			effectiveFromDate: "2026-08-01",
			overwritePersonalDivergences: true,
			target: { employeeIds: [empDiverged.employeeId] },
			runnerOptions: { skipBalanceDirtyNotification: true },
		});
		const divOverwritten = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: empDiverged.employeeId,
			date: "2026-08-01",
		});
		expect(divOverwritten?.weeklyContractMinutes).toBe(1920);

		// 2. Bulk "Adopt Org/Team default" targeting migrated_legacy_terms = true automatically
		const adoptPreview = await previewBulkContractAction(db, {
			organizationId: ORG_ID,
			actionKind: "adopt_default",
			effectiveFromDate: "2026-07-01",
			target: {},
		});
		expect(adoptPreview.totalMatched).toBe(1);
		expect(adoptPreview.employees[0]?.employeeId).toBe(empLegacy.employeeId);

		const adoptReceipt = await submitBulkContractAction(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			actionKind: "adopt_default",
			effectiveFromDate: "2026-07-01",
			target: {},
			runnerOptions: { skipBalanceDirtyNotification: true },
		});
		expect(adoptReceipt.batch.status).toBe("completed");

		const legacyAfter = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: empLegacy.employeeId,
			date: "2026-07-01",
		});
		expect(legacyAfter?.migratedLegacyTerms).toBe(false);
		expect(legacyAfter?.weeklyContractMinutes).toBe(2400);
		expect(legacyAfter?.weeklyContractMinutesSource).toBe("org_default");
		expect(legacyAfter?.workModel).toBe("onsite");
		// Employee-owned pay terms stay intact!
		expect(legacyAfter?.contractType).toBe("hourly");
		expect(legacyAfter?.hourlyRate).toBe(22.5);

		// 3. Bulk operational update preserving personal divergence -> fully-diverged employee skipped cleanly
		const opReceipt = await submitBulkContractAction(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			actionKind: "bulk_operational_update",
			effectiveFromDate: "2026-09-01",
			overwritePersonalDivergences: false,
			changes: { workModel: "remote" },
			target: { employeeIds: [empInheriting.employeeId, empLegacy.employeeId] },
			runnerOptions: { skipBalanceDirtyNotification: true },
		});
		expect(opReceipt.batch.status).toBe("completed");
		// empInheriting already has employee_override workModel='hybrid' -> skipped!
		// empLegacy inherits workModel='onsite' from org_default -> updated to 'remote' (with exempt presence default)!
		expect(opReceipt.batch.skippedItems).toBe(1);
		expect(opReceipt.batch.completedItems).toBe(1);

		const legacyRemote = await resolveEffectiveContractOnDay(db, {
			organizationId: ORG_ID,
			employeeId: empLegacy.employeeId,
			date: "2026-09-01",
		});
		expect(legacyRemote?.workModel).toBe("remote");
		expect(legacyRemote?.presenceOverride).toBe("exempt");

		const batches = await listContractChangeBatches(db, ORG_ID);
		expect(batches.length).toBeGreaterThanOrEqual(4);
	});

	it("validates and commits CSV contract imports with strict dry-run error reporting and confirmation fingerprint enforcement", async () => {
		const policyId = await seedSimplePolicy("CSV Policy 35h", "35.00");
		const emp1 = await seedEmployee({ key: "csv-c1", employeeNumber: "EMP-101" });
		const emp2 = await seedEmployee({ key: "csv-c2", employeeNumber: "EMP-102" });
		const emp3 = await seedEmployee({ key: "csv-c3", employeeNumber: "EMP-103" });

		// 1. Invalid CSV -> dry-run reports exact per-row errors and commit refuses
		const invalidCsv = [
			"employee_number,effective_from_date,work_model,schedule_source,on_call_hours_kind",
			"EMP-101,2026-07-01,teleporting,,",
			"UNKNOWN-999,2026-07-01,remote,,",
			"EMP-101,2026-07-01,hybrid,,", // duplicate employee
			"EMP-102,2026-07-01,onsite,on_call,", // missing on_call_hours_kind
		].join("\n");

		const badPreview = await previewCsvContractImport(db, {
			organizationId: ORG_ID,
			csvText: invalidCsv,
		});
		expect(badPreview.canCommit).toBe(false);
		expect(badPreview.errorRows).toBe(4);
		expect(badPreview.rows[0]?.errors[0]).toMatch(/Invalid work_model/i);
		expect(badPreview.rows[1]?.errors[0]).toMatch(/Employee not found/i);
		expect(badPreview.rows[2]?.errors[0]).toMatch(/Duplicate employee/i);
		expect(badPreview.rows[3]?.errors[0]).toMatch(/on_call_hours_kind|hours kind/i);
		expect(badPreview.rows[3]?.errorDetails[0]?.code).toBe("on_call_hours_kind_required");

		await expect(
			commitCsvImportBatch(db, {
				organizationId: ORG_ID,
				actorUserId: ADMIN_USER_ID,
				operationKind: "csv_contract_import",
				csvText: invalidCsv,
				confirmationFingerprint: badPreview.confirmationFingerprint,
			}),
		).rejects.toMatchObject({
			_tag: "ValidationError",
			refusal: "csv_validation_failed",
		} satisfies Partial<ValidationError>);

		// 2. Valid UTF-8 BOM CSV resolving by employee_number, email, and employee_id
		const validCsv = [
			"\uFEFFemployee_number,email,employee_id,effective_from_date,work_policy_name,weekly_hours,work_model,contract_type,hourly_rate,employment_profile,schedule_source,on_call_hours_kind,on_call_weekly_hours,custom_days,change_reason",
			"EMP-101,,,2026-07-01,CSV Policy 35h,35,hybrid,fixed,,regular,,,,,Q3 transfer",
			`,${emp2.email},,2026-07-01,,20,remote,hourly,18.50,working_student,on_call,minimum,16,,"On-call agreement"`,
			`,,${emp3.employeeId},2026-07-01,,,onsite,fixed,,apprentice,,, ,"mon:8h@09:00|tue:8h|wed:4h","Custom apprentice days"`,
		].join("\r\n");

		const goodPreview = await previewCsvContractImport(db, {
			organizationId: ORG_ID,
			csvText: validCsv,
		});
		expect(goodPreview.canCommit).toBe(true);
		expect(goodPreview.errorRows).toBe(0);
		expect(goodPreview.validRows).toBe(3);

		// Mismatched confirmation fingerprint must fail cleanly
		await expect(
			commitCsvImportBatch(db, {
				organizationId: ORG_ID,
				actorUserId: ADMIN_USER_ID,
				operationKind: "csv_contract_import",
				csvText: validCsv,
				confirmationFingerprint: "0".repeat(64),
			}),
		).rejects.toMatchObject({
			_tag: "ConflictError",
			conflictType: "confirmation_fingerprint_mismatch",
		} satisfies Partial<ConflictError>);

		// Commit with matching fingerprint
		const receipt = await commitCsvImportBatch(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			operationKind: "csv_contract_import",
			csvText: validCsv,
			confirmationFingerprint: goodPreview.confirmationFingerprint,
			runnerOptions: { skipBalanceDirtyNotification: true },
		});
		expect(receipt.batch.status).toBe("completed");
		expect(receipt.batch.completedItems).toBe(3);

		const [c1, c2, c3] = await Promise.all([
			resolveEffectiveContractOnDay(db, {
				organizationId: ORG_ID,
				employeeId: emp1.employeeId,
				date: "2026-07-01",
			}),
			resolveEffectiveContractOnDay(db, {
				organizationId: ORG_ID,
				employeeId: emp2.employeeId,
				date: "2026-07-01",
			}),
			resolveEffectiveContractOnDay(db, {
				organizationId: ORG_ID,
				employeeId: emp3.employeeId,
				date: "2026-07-01",
			}),
		]);
		expect(c1?.workPolicy?.policyId).toBe(policyId);
		expect(c1?.weeklyContractMinutes).toBe(2100);
		expect(c2?.contractType).toBe("hourly");
		expect(c2?.hourlyRate).toBe(18.5);
		expect(c2?.employmentProfile).toBe("working_student");
		expect(c2?.scheduleSource).toBe("on_call");
		expect(c2?.onCallTerms?.hoursKind).toBe("minimum");
		expect(c2?.onCallTerms?.weeklyMinutes).toBe(960);
		expect(c3?.scheduleMode).toBe("custom_days");
		expect(c3?.employmentProfile).toBe("apprentice");
	});

	it("validates and commits CSV leaving-date imports across future, immediate, retrospective (with closed month & settled payroll review), past-date correction, and historical backfill, and is crash-idempotent", async () => {
		const fixedNow = parseInstant("2026-06-15T10:00:00Z"); // 2026-06-15 in Europe/Berlin
		const departureCommands = createDepartureCommands({
			db,
			clock: { nowInstant: () => fixedNow },
			clockOut: noopClockOut,
		});

		const empFuture = await seedEmployee({ key: "ld-future", employeeNumber: "LD-001" });
		const empToday = await seedEmployee({ key: "ld-today", employeeNumber: "LD-002" });
		const empPast = await seedEmployee({ key: "ld-past", employeeNumber: "LD-003" });
		const empCorrect = await seedEmployee({ key: "ld-corr", employeeNumber: "LD-004" });
		const empLegacyFormer = await seedEmployee({
			key: "ld-hist",
			employeeNumber: "LD-005",
			isActive: false,
			startedAt: "2025-01-01T00:00:00Z",
		});

		// Seed closed month (2026-05) and settled payroll day (2026-05-20) on empPast
		const closedMonthId = randomUUID();
		await admin.query(
			`INSERT INTO closed_month (
				id, organization_id, month, scope, actor_kind, closed_by, closed_at
			) VALUES ($1, $2, '2026-05-01', 'organization', 'user', $3, now())`,
			[closedMonthId, ORG_ID, ADMIN_USER_ID],
		);
		await admin.query(
			`INSERT INTO closed_month_employee (
				id, organization_id, closed_month_id, employee_id, month,
				range_start, range_end, timezone, covered_at
			) VALUES (
				$1, $2, $3, $4, '2026-05-01',
				'2026-04-30 22:00:00', '2026-05-31 22:00:00', 'Europe/Berlin', now()
			)`,
			[randomUUID(), ORG_ID, closedMonthId, empPast.employeeId],
		);
		await admin.query(
			`INSERT INTO payroll_settled_day (
				id, organization_id, employee_id, date, timezone, credited_minutes,
				method, settled_at, settled_by
			) VALUES ($1, $2, $3, '2026-05-20', 'Europe/Berlin', 480, 'manual', now(), $4)`,
			[randomUUID(), ORG_ID, empPast.employeeId, ADMIN_USER_ID],
		);

		// Give empCorrect an already-effective past departure on 2026-05-10
		const initialPast = await departureCommands.recordPastDeparture(
			{ userId: ADMIN_USER_ID, organizationId: ORG_ID },
			{
				employeeId: empCorrect.employeeId,
				requestId: randomUUID(),
				lastWorkingDay: "2026-05-10",
				replacementEmployeeId: null,
				acknowledgeUnassignedDuties: true,
			},
		);
		expect(initialPast.status).toBe("effective");

		// 1. Dry-run refuses reopening a former employee with a future date
		const reopenCsv = "employee_number,last_working_day\nLD-004,2026-07-01";
		const reopenPreview = await previewCsvLeavingDateImport(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			csvText: reopenCsv,
			now: fixedNow,
		});
		expect(reopenPreview.canCommit).toBe(false);
		expect(reopenPreview.rows[0]?.errors[0]).toMatch(/departure_reopen_forbidden/i);

		// 2. Semicolon CSV covering all 5 leaving-date paths
		const leavingCsv = [
			"Personalnummer;Austrittsdatum;Reason",
			"LD-001;2026-07-31;Planned resignation",
			"LD-002;2026-06-15;Immediate mutual termination",
			"LD-003;2026-05-15;Late HR notice",
			"LD-004;2026-05-12;Clerical date correction",
			"LD-005;2025-12-31;Historical archive backfill",
		].join("\n");

		const preview = await previewCsvLeavingDateImport(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			csvText: leavingCsv,
			now: fixedNow,
		});
		expect(preview.canCommit).toBe(true);
		expect(preview.errorRows).toBe(0);
		expect(preview.rows.map((r) => r.action)).toEqual([
			"schedule_departure",
			"offboard_immediately",
			"record_past_departure",
			"correct_past_departure_date",
			"record_historical_departure_date",
		]);
		// empPast row warns about closed month / settled payroll reconciliation
		expect(preview.rows[2]?.warnings.join(" ")).toMatch(/payroll_reconciliation/i);

		// Commit via durable batch engine
		const receipt = await commitCsvImportBatch(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			operationKind: "csv_departure_import",
			csvText: leavingCsv,
			confirmationFingerprint: preview.confirmationFingerprint,
			clockNow: fixedNow,
			runnerOptions: {
				departureCommands,
				skipBalanceDirtyNotification: true,
			},
		});
		expect(receipt.batch.status).toBe("completed");
		expect(receipt.batch.completedItems).toBe(5);
		expect(receipt.batch.failedItems).toBe(0);

		// Verify closed month & settled payroll day on empPast remain untouched and reconciliation review opened!
		const settledAfter = await db
			.select()
			.from(payrollSettledDay)
			.where(
				and(
					eq(payrollSettledDay.organizationId, ORG_ID),
					eq(payrollSettledDay.employeeId, empPast.employeeId),
				),
			);
		expect(settledAfter).toHaveLength(1);
		expect(settledAfter[0]?.unsettledAt).toBeNull();

		const pastReviews = await db
			.select()
			.from(employeeDepartureReview)
			.where(
				and(
					eq(employeeDepartureReview.organizationId, ORG_ID),
					eq(employeeDepartureReview.employeeId, empPast.employeeId),
					eq(employeeDepartureReview.kind, "payroll_reconciliation"),
				),
			);
		expect(pastReviews).toHaveLength(1);

		// Verify empCorrect's effective departure date was updated to 2026-05-12
		const [corrDep] = await db
			.select()
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, ORG_ID),
					eq(employeeDeparture.employeeId, empCorrect.employeeId),
					eq(employeeDeparture.status, "effective"),
				),
			);
		expect(corrDep?.lastWorkingDay).toBe("2026-05-12");

		// Verify empFuture has pending scheduled departure for 2026-07-31
		const [futureDep] = await db
			.select()
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, ORG_ID),
					eq(employeeDeparture.employeeId, empFuture.employeeId),
					eq(employeeDeparture.status, "pending"),
				),
			);
		expect(futureDep?.lastWorkingDay).toBe("2026-07-31");

		// Verify empToday is immediately offboarded (effective)
		const [todayDep] = await db
			.select()
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, ORG_ID),
					eq(employeeDeparture.employeeId, empToday.employeeId),
					eq(employeeDeparture.status, "effective"),
				),
			);
		expect(todayDep?.mode).toBe("immediate");

		// Simulate crash recovery replay on empPast's batch item: reset batch + item to pending and re-run!
		// Departure receipt ledger keyed by requestId = item.id must replay cleanly with ZERO duplicates!
		const [pastBatchItem] = await db
			.select()
			.from(contractChangeBatchItem)
			.where(
				and(
					eq(contractChangeBatchItem.batchId, receipt.batch.id),
					eq(contractChangeBatchItem.employeeId, empPast.employeeId),
				),
			);
		await db
			.update(contractChangeBatch)
			.set({ status: "running", leaseExpiresAt: new Date(Date.now() - 10_000) })
			.where(eq(contractChangeBatch.id, receipt.batch.id));
		await db
			.update(contractChangeBatchItem)
			.set({ status: "pending" })
			.where(eq(contractChangeBatchItem.id, pastBatchItem.id));

		const replayRun = await runContractChangeBatch(db, {
			organizationId: ORG_ID,
			batchId: receipt.batch.id,
			departureCommands,
			skipBalanceDirtyNotification: true,
		});
		expect(replayRun.batch.status).toBe("completed");
		expect(replayRun.batch.failedItems).toBe(0);

		const pastDeparturesAfterReplay = await db
			.select()
			.from(employeeDeparture)
			.where(
				and(
					eq(employeeDeparture.organizationId, ORG_ID),
					eq(employeeDeparture.employeeId, empPast.employeeId),
				),
			);
		expect(pastDeparturesAfterReplay).toHaveLength(1);
		expect(empLegacyFormer.employeeId).toBeTruthy();
	});

	it("handles 10,000-employee bulk preview, async batch submission (>200 threshold), and 10,000-row CSV dry-run with bounded latency", async () => {
		await cleanupScaleOrgIfPresent();

		const now = new Date("2026-01-01T00:00:00.000Z");
		await admin.query(
			`INSERT INTO "user" (id, name, email, created_at, updated_at)
			 VALUES ($1, 'Scale Admin', 't1928-scale-admin@example.test', $2, $2)`,
			[SCALE_ADMIN_USER_ID, now],
		);
		await admin.query(
			`INSERT INTO organization (id, name, slug, timezone, created_at)
			 VALUES ($1, 'Scale 10K Org', 't1928-scale-10k-org', 'Europe/Berlin', $2)`,
			[SCALE_ORG_ID, now],
		);

		// Bulk-seed 10,000 active current-roster employees in 1,000-row chunks via generate_series
		for (let start = 1; start <= 10_000; start += 1000) {
			const end = start + 999;
			await admin.query(
				`WITH nums AS (
					SELECT g, 't1928-scale-u-' || g AS uid, 'SC-' || lpad(g::text, 5, '0') AS emp_num
					FROM generate_series($3::int, $4::int) AS g
				),
				ins_users AS (
					INSERT INTO "user" (id, name, email, created_at, updated_at)
					SELECT uid, 'Scale User ' || g, uid || '@example.test', $2, $2
					FROM nums
					RETURNING id
				),
				ins_emps AS (
					INSERT INTO employee (
						user_id, organization_id, first_name, last_name, employee_number,
						role, contract_type, is_active, updated_at
					)
					SELECT n.uid, $1, 'Scale', 'User' || n.g, n.emp_num, 'employee', 'fixed', true, $2
					FROM nums n
					JOIN ins_users u ON u.id = n.uid
					RETURNING id
				)
				INSERT INTO employee_employment_period (
					organization_id, employee_id, status, started_at, start_provenance
				)
				SELECT $1, id, 'open', $2, 'recorded'
				FROM ins_emps`,
				[SCALE_ORG_ID, now, start, end],
			);
		}

		// 1. Dry-run preview across all 10,000 employees (chunked, bounded sample)
		const previewStart = performance.now();
		const preview = await previewBulkContractAction(db, {
			organizationId: SCALE_ORG_ID,
			actionKind: "bulk_operational_update",
			effectiveFromDate: "2026-07-01",
			changes: { workModel: "hybrid", weeklyContractMinutes: 2400 },
			target: {},
			sampleLimit: 50,
		});
		const previewMs = performance.now() - previewStart;

		expect(preview.totalMatched).toBe(10_000);
		expect(preview.affectedCount).toBe(10_000);
		expect(preview.executionMode).toBe("async");
		expect(preview.sampleTruncated).toBe(true);
		expect(preview.employees).toHaveLength(50);
		expect(previewMs).toBeLessThan(30_000);

		// 2. Durable async submission (>200 threshold) commits 10,000 sorted-UUID batch items & enqueues BullMQ job
		const enqueuedJobs: { batchId: string; organizationId: string }[] = [];
		const submitStart = performance.now();
		const receipt = await submitBulkContractAction(db, {
			organizationId: SCALE_ORG_ID,
			actorUserId: SCALE_ADMIN_USER_ID,
			actionKind: "bulk_operational_update",
			effectiveFromDate: "2026-07-01",
			changes: { workModel: "hybrid", weeklyContractMinutes: 2400 },
			target: {},
			enqueueAsyncJob: async (job) => {
				enqueuedJobs.push(job);
			},
		});
		const submitMs = performance.now() - submitStart;

		expect(receipt.executionMode).toBe("async");
		expect(receipt.batch.status).toBe("pending");
		expect(receipt.batch.totalItems).toBe(10_000);
		expect(enqueuedJobs).toEqual([{ batchId: receipt.batch.id, organizationId: SCALE_ORG_ID }]);
		expect(submitMs).toBeLessThan(15_000);

		const batchDetail = await getContractChangeBatch(db, SCALE_ORG_ID, receipt.batch.id, {
			limit: 10,
		});
		expect(batchDetail?.totalMatchingItems).toBe(10_000);

		// 3. 10,000-row CSV contract dry-run preview
		const csvLines = ["employee_number,effective_from_date,work_model"];
		for (let i = 1; i <= 10_000; i++) {
			csvLines.push(`SC-${String(i).padStart(5, "0")},2026-07-01,remote`);
		}
		const csvStart = performance.now();
		const csvPreview = await previewCsvContractImport(db, {
			organizationId: SCALE_ORG_ID,
			csvText: csvLines.join("\n"),
			maxPreviewRows: 50,
		});
		const csvMs = performance.now() - csvStart;

		expect(csvPreview.totalRows).toBe(10_000);
		expect(csvPreview.validRows).toBe(10_000);
		expect(csvPreview.errorRows).toBe(0);
		expect(csvPreview.canCommit).toBe(true);
		expect(csvPreview.executionMode).toBe("async");
		expect(csvPreview.rowsTruncated).toBe(true);
		expect(csvPreview.rows).toHaveLength(50);
		expect(csvMs).toBeLessThan(30_000);

		console.info(
			`[10k benchmark] preview=${Math.round(previewMs)}ms submit=${Math.round(submitMs)}ms csvDryRun=${Math.round(csvMs)}ms`,
		);
	});

	it("enforces Astra regression invariants: covering legacy eligibility (A1-19), bulk confirmation fingerprint (A1-21), CSV mode/date contradictions & diagnostic codes (A1-23/A1-31), leaving-date CSV retry replay (A1-28), and errorRowDetails beyond row 50 (A1-29)", async () => {
		const teamId = await seedTeam("Astra Bulk Team");
		const empAdopted = await seedEmployee({
			key: "astra-adopted",
			teamId,
			employeeNumber: "AST-001",
		});
		const empStillLegacy = await seedEmployee({
			key: "astra-legacy",
			teamId,
			employeeNumber: "AST-002",
		});

		// Both start with migrated_legacy_terms = true on 2026-01-01
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: empAdopted.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-01-01",
			weeklyContractMinutes: 2100,
			migratedLegacyTerms: true,
		});
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: empStillLegacy.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-01-01",
			weeklyContractMinutes: 2100,
			migratedLegacyTerms: true,
		});
		// empAdopted adopts defaults on 2026-03-01 and later sets a personal override on 2026-04-01
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: empAdopted.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-03-01",
			migratedLegacyTerms: false,
		});
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: empAdopted.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-04-01",
			weeklyContractMinutes: 1920,
			migratedLegacyTerms: false,
		});

		// A1-19: onlyLegacyTerms on 2026-06-01 matches ONLY empStillLegacy, NOT empAdopted
		const legacyPreview = await previewBulkContractAction(db, {
			organizationId: ORG_ID,
			actionKind: "adopt_default",
			effectiveFromDate: "2026-06-01",
			target: { teamId, onlyLegacyTerms: true },
		});
		expect(legacyPreview.employees.map((e) => e.employeeId)).toEqual([empStillLegacy.employeeId]);

		// A1-21: Adding a new employee to the team after preview invalidates confirmationFingerprint
		const teamPreview = await previewBulkContractAction(db, {
			organizationId: ORG_ID,
			actionKind: "bulk_operational_update",
			effectiveFromDate: "2026-07-01",
			changes: { workModel: "hybrid" },
			target: { teamId },
		});
		await seedEmployee({ key: "astra-late-joiner", teamId, employeeNumber: "AST-003" });
		await expect(
			submitBulkContractAction(db, {
				organizationId: ORG_ID,
				actorUserId: ADMIN_USER_ID,
				actionKind: "bulk_operational_update",
				effectiveFromDate: "2026-07-01",
				changes: { workModel: "hybrid" },
				target: { teamId },
				confirmationFingerprint: teamPreview.confirmationFingerprint,
			}),
		).rejects.toMatchObject({
			_tag: "ConflictError",
			conflictType: "confirmation_fingerprint_mismatch",
		} satisfies Partial<ConflictError>);

		// A1-23 + A1-31: Contradictory explicit departure_mode yields row errors with structured diagnostic codes
		const clockNow = parseInstant("2026-06-15T10:00:00Z");
		const badDepartureCsv = [
			"employee_number,last_working_day,departure_mode",
			"AST-001,2026-09-30,immediate",
			"AST-002,2026-06-15,retrospective",
		].join("\n");
		const badDepPreview = await previewCsvLeavingDateImport(db, {
			organizationId: ORG_ID,
			csvText: badDepartureCsv,
			now: clockNow,
		});
		expect(badDepPreview.canCommit).toBe(false);
		expect(badDepPreview.errorRows).toBe(2);
		expect(badDepPreview.rows[0]?.errorDetails[0]?.code).toBe("departure_immediate_requires_today");
		expect(badDepPreview.rows[1]?.errorDetails[0]?.code).toBe(
			"departure_retrospective_requires_past",
		);

		// A1-28: Retrying a committed leaving-date CSV import with the same requestId replays the original receipt
		await seedEmployee({ key: "astra-dep-retry", employeeNumber: "AST-DEP-1" });
		const validDepCsv = ["employee_number,last_working_day", "AST-DEP-1,2026-09-30"].join("\n");
		const depPreview = await previewCsvLeavingDateImport(db, {
			organizationId: ORG_ID,
			csvText: validDepCsv,
			now: clockNow,
		});
		expect(depPreview.canCommit).toBe(true);
		const retryRequestId = randomUUID();
		const stubClockOut: DepartureClockOutPort = {
			async close() {
				return { kind: "not_running" };
			},
		};
		const depCommands = createDepartureCommands({
			db,
			clock: { nowInstant: () => clockNow },
			clockOut: stubClockOut,
		});
		const firstDepCommit = await commitCsvImportBatch(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			requestId: retryRequestId,
			operationKind: "csv_departure_import",
			csvText: validDepCsv,
			confirmationFingerprint: depPreview.confirmationFingerprint,
			clockNow,
			runnerOptions: { departureCommands: depCommands, skipBalanceDirtyNotification: true },
		});
		expect(firstDepCommit.batch.status).toBe("completed");
		expect(firstDepCommit.replayed).toBe(false);

		// Retry with identical requestId AFTER the scheduled departure has already committed
		const secondDepCommit = await commitCsvImportBatch(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			requestId: retryRequestId,
			operationKind: "csv_departure_import",
			csvText: validDepCsv,
			confirmationFingerprint: depPreview.confirmationFingerprint,
			clockNow,
			runnerOptions: { departureCommands: depCommands, skipBalanceDirtyNotification: true },
		});
		expect(secondDepCommit.replayed).toBe(true);
		expect(secondDepCommit.batch.id).toBe(firstDepCommit.batch.id);

		// A1-29: Row 55 error is returned in errorRowDetails even when maxPreviewRows = 50
		const manyLines = ["employee_number,effective_from_date,work_model"];
		for (let i = 1; i <= 54; i++) {
			manyLines.push(`AST-001,2026-07-01,hybrid`);
		}
		manyLines.push(`UNKNOWN-ROW-55,2026-07-01,teleporting`);
		const deepErrorPreview = await previewCsvContractImport(db, {
			organizationId: ORG_ID,
			csvText: manyLines.join("\n"),
			maxPreviewRows: 50,
		});
		expect(deepErrorPreview.rows).toHaveLength(50);
		expect(deepErrorPreview.errorRowDetails.some((r) => r.rowNumber === 56)).toBe(true);
	});

	it("enforces winning-terms legacy eligibility on rehires (A2-3), replays bulk retries after policy retirement and across pre-upgrade payloads (A2-18/A2-19), and emits structured CSV number diagnostics (A2-23)", async () => {
		// A2-3: Rehired employee has an open stint with non-legacy terms PLUS an old null-period legacy row.
		// onlyLegacyTerms MUST NOT select or modify them!
		const rehiredEmp = await seedEmployee({ key: "a2-3-rehire", employeeNumber: "A2-301" });
		const stillLegacyEmp = await seedEmployee({ key: "a2-3-legacy", employeeNumber: "A2-302" });
		const orgPol = await seedSimplePolicy("A2-3 Org Default Policy", "40.00");
		await scheduleContractDefault(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			scope: "organization",
			effectiveFromDate: "2026-01-01",
			workPolicyId: orgPol,
			weeklyContractMinutes: 2400,
			workModel: "onsite",
			scheduleMode: "policy",
			balanceMode: "tracked",
			scheduleSource: "policy",
		});

		// Insert a covering employment_period_id = NULL legacy row on rehiredEmp (simulating pre-rehire legacy row)
		await admin.query(
			`INSERT INTO employee_employment_history (
				organization_id, employee_id, employment_period_id,
				valid_from, valid_from_date, status, review_state,
				contract_type, currency, weekly_contract_minutes, migrated_legacy_terms,
				created_by, updated_at
			) VALUES (
				$1, $2, NULL,
				'2025-01-01T00:00:00Z', '2025-01-01', 'active', 'confirmed',
				'fixed', 'EUR', 1800, true, $3, now()
			)`,
			[ORG_ID, rehiredEmp.employeeId, ADMIN_USER_ID],
		);
		// Give rehiredEmp non-legacy confirmed terms attached to their open stint
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: rehiredEmp.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-02-01",
			weeklyContractMinutes: 1920,
			migratedLegacyTerms: false,
		});
		// Give stillLegacyEmp an actual winning legacy row
		await commitContractChange(db, {
			organizationId: ORG_ID,
			employeeId: stillLegacyEmp.employeeId,
			actorUserId: ADMIN_USER_ID,
			validFromDate: "2026-02-01",
			weeklyContractMinutes: 1800,
			migratedLegacyTerms: true,
		});

		const legacyPreview = await previewBulkContractAction(db, {
			organizationId: ORG_ID,
			actionKind: "adopt_default",
			effectiveFromDate: "2026-06-01",
			target: {
				employeeIds: [rehiredEmp.employeeId, stillLegacyEmp.employeeId],
				onlyLegacyTerms: true,
			},
		});
		expect(legacyPreview.employees.map((e) => e.employeeId)).toEqual([stillLegacyEmp.employeeId]);

		// A2-18: Retry of an identical committed bulk template application succeeds EVEN AFTER the policy is retired
		const retiringPolicyId = await seedSimplePolicy("A2-18 Retiring Policy", "38.00");
		const tpl = await createContractTemplate(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			name: "A2-18 Template",
			workPolicyId: retiringPolicyId,
			weeklyContractMinutes: 2280,
			workModel: "hybrid",
			balanceMode: "tracked",
			scheduleMode: "policy",
			scheduleSource: "policy",
		});
		const tplPreview = await previewBulkContractAction(db, {
			organizationId: ORG_ID,
			actionKind: "apply_template_version",
			templateVersionId: tpl.templateVersionId,
			effectiveFromDate: "2026-07-01",
			target: { employeeIds: [rehiredEmp.employeeId] },
		});
		const retryReqId = randomUUID();
		const firstSubmit = await submitBulkContractAction(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			requestId: retryReqId,
			actionKind: "apply_template_version",
			templateVersionId: tpl.templateVersionId,
			effectiveFromDate: "2026-07-01",
			target: { employeeIds: [rehiredEmp.employeeId] },
			confirmationFingerprint: tplPreview.confirmationFingerprint,
			runnerOptions: { skipBalanceDirtyNotification: true },
		});
		expect(firstSubmit.replayed).toBe(false);

		// Now retire the referenced policy in the database
		await admin.query(
			`UPDATE work_policy SET is_active = false, updated_at = now() WHERE id = $1`,
			[retiringPolicyId],
		);

		// Identical retry MUST replay the original receipt instead of failing with work_policy_inactive!
		const replayAfterRetire = await submitBulkContractAction(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			requestId: retryReqId,
			actionKind: "apply_template_version",
			templateVersionId: tpl.templateVersionId,
			effectiveFromDate: "2026-07-01",
			target: { employeeIds: [rehiredEmp.employeeId] },
			confirmationFingerprint: tplPreview.confirmationFingerprint,
			runnerOptions: { skipBalanceDirtyNotification: true },
		});
		expect(replayAfterRetire.replayed).toBe(true);
		expect(replayAfterRetire.batch.id).toBe(firstSubmit.batch.id);

		// A2-19: Pre-upgrade batch payload lacking submittedIntentFingerprint still replays cleanly
		// on matching request and rejects mismatched request!
		await admin.query(
			`UPDATE contract_change_batch
			 SET payload = payload - 'submittedIntentFingerprint'
			 WHERE id = $1`,
			[firstSubmit.batch.id],
		);
		const preUpgradeReplay = await submitBulkContractAction(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			requestId: retryReqId,
			actionKind: "apply_template_version",
			templateVersionId: tpl.templateVersionId,
			effectiveFromDate: "2026-07-01",
			target: { employeeIds: [rehiredEmp.employeeId] },
			confirmationFingerprint: tplPreview.confirmationFingerprint,
			runnerOptions: { skipBalanceDirtyNotification: true },
		});
		expect(preUpgradeReplay.replayed).toBe(true);
		await expect(
			submitBulkContractAction(db, {
				organizationId: ORG_ID,
				actorUserId: ADMIN_USER_ID,
				requestId: retryReqId,
				actionKind: "apply_template_version",
				templateVersionId: tpl.templateVersionId,
				effectiveFromDate: "2026-08-01", // changed effective date!
				target: { employeeIds: [rehiredEmp.employeeId] },
				confirmationFingerprint: tplPreview.confirmationFingerprint,
				runnerOptions: { skipBalanceDirtyNotification: true },
			}),
		).rejects.toMatchObject({
			_tag: "ConflictError",
			conflictType: "request_conflict",
		} satisfies Partial<ConflictError>);

		// A2-23: Invalid numeric CSV cell emits structured invalid_number diagnostic (no English parser text)
		const badNumCsv = [
			"employee_number,effective_from_date,weekly_hours",
			"A2-301,2026-07-01,not-a-number",
		].join("\n");
		const badNumPreview = await previewCsvContractImport(db, {
			organizationId: ORG_ID,
			csvText: badNumCsv,
		});
		expect(badNumPreview.canCommit).toBe(false);
		expect(badNumPreview.rows[0]?.errorDetails[0]).toMatchObject({
			code: "invalid_number",
			params: { field: "weekly_hours", value: "not-a-number" },
		});

		// H6: Pre-upgrade bulk replay MUST reject a changed employee target even when reusing the
		// original confirmationFingerprint!
		await expect(
			submitBulkContractAction(db, {
				organizationId: ORG_ID,
				actorUserId: ADMIN_USER_ID,
				requestId: retryReqId,
				actionKind: "apply_template_version",
				templateVersionId: tpl.templateVersionId,
				effectiveFromDate: "2026-07-01",
				target: { employeeIds: [stillLegacyEmp.employeeId] }, // changed target!
				confirmationFingerprint: tplPreview.confirmationFingerprint, // reused old fp!
				runnerOptions: { skipBalanceDirtyNotification: true },
			}),
		).rejects.toMatchObject({
			_tag: "ConflictError",
			conflictType: "request_conflict",
		} satisfies Partial<ConflictError>);

		// H3 / F9-3: Submitting a non-hourly work-model bulk update covering an employee whose
		// employment period starts AFTER effectiveFromDate MUST be rejected before creating a batch!
		const futureHire = await seedEmployee({ key: "h3-future-hire", employeeNumber: "H3-100" });
		await admin.query(
			`UPDATE employee_employment_period
			 SET started_at = '2026-09-01T00:00:00Z', start_provenance = 'recorded'
			 WHERE employee_id = $1`,
			[futureHire.employeeId],
		);
		await expect(
			submitBulkContractAction(db, {
				organizationId: ORG_ID,
				actorUserId: ADMIN_USER_ID,
				actionKind: "bulk_operational_update",
				effectiveFromDate: "2026-07-01",
				target: { employeeIds: [rehiredEmp.employeeId, futureHire.employeeId] },
				changes: { workModel: "remote" },
				runnerOptions: { skipBalanceDirtyNotification: true },
			}),
		).rejects.toMatchObject({
			refusal: "bulk_employee_validation_failed",
		});

		// M2: An empty [D, D) confirmed row MUST NOT mask a valid older legacy terms row!
		await admin.query(
			`INSERT INTO employee_employment_history (
				organization_id, employee_id, employment_period_id,
				valid_from, valid_until, valid_from_date, valid_until_date,
				status, review_state, contract_type, currency, weekly_contract_minutes,
				migrated_legacy_terms, created_by, updated_at
			) VALUES (
				$1, $2, (SELECT id FROM employee_employment_period WHERE employee_id = $2 AND status = 'open' LIMIT 1),
				'2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z', '2026-03-01', '2026-03-01',
				'active', 'confirmed', 'fixed', 'EUR', 2400,
				false, $3, now()
			)`,
			[ORG_ID, stillLegacyEmp.employeeId, ADMIN_USER_ID],
		);
		const emptyMaskPreview = await previewBulkContractAction(db, {
			organizationId: ORG_ID,
			actionKind: "adopt_default",
			effectiveFromDate: "2026-06-01",
			target: {
				employeeIds: [stillLegacyEmp.employeeId],
				onlyLegacyTerms: true,
			},
		});
		expect(emptyMaskPreview.employees.map((e) => e.employeeId)).toEqual([
			stillLegacyEmp.employeeId,
		]);

		// M1: Pre-upgrade CSV contract import retry MUST still replay after its policy is retired!
		const m1Pol = await seedSimplePolicy("M1 Legacy Csv Policy", "39.00");
		const m1Csv = [
			"employee_number,effective_from_date,work_policy_id",
			`A2-301,2026-07-15,${m1Pol}`,
		].join("\n");
		const m1Preview = await previewCsvContractImport(db, {
			organizationId: ORG_ID,
			csvText: m1Csv,
		});
		expect(m1Preview.canCommit).toBe(true);
		const m1ReqId = randomUUID();
		const m1First = await commitCsvImportBatch(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			requestId: m1ReqId,
			operationKind: "csv_contract_import",
			csvText: m1Csv,
			confirmationFingerprint: m1Preview.confirmationFingerprint,
			runnerOptions: { skipBalanceDirtyNotification: true },
		});
		await admin.query(
			`UPDATE contract_change_batch SET payload = payload - 'submittedIntentFingerprint' WHERE id = $1`,
			[m1First.batch.id],
		);
		await admin.query(`UPDATE work_policy SET is_active = false WHERE id = $1`, [m1Pol]);
		const m1Replay = await commitCsvImportBatch(db, {
			organizationId: ORG_ID,
			actorUserId: ADMIN_USER_ID,
			requestId: m1ReqId,
			operationKind: "csv_contract_import",
			csvText: m1Csv,
			confirmationFingerprint: m1Preview.confirmationFingerprint,
			runnerOptions: { skipBalanceDirtyNotification: true },
		});
		expect(m1Replay.replayed).toBe(true);
		expect(m1Replay.batch.id).toBe(m1First.batch.id);
	});
});
