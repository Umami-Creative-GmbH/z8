/**
 * #474 runtime evidence for the approval authority module against PostgreSQL.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The gated read, the snapshot read, the review-binding read and the SQL
 * fragment run against real rows; nothing is replaced.
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as authSchema from "@/db/auth-schema";
import { configurePostgresUtcTypes, withUtcPostgresSession } from "@/db/postgres-utc";
import * as schema from "@/db/schema";
import { ApprovalEvidenceError } from "@/lib/approvals/evidence/errors";
import type {
	ApprovalWorkflowLifecycleMode,
	ApprovalWorkflowType,
} from "@/lib/approvals/workflow/ports";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import {
	acquireApprovalWriteGate,
	approvalAuthorityOf,
	approvalAuthoritySql,
	approvalRolloutLockScope,
	approvalWriteGateResult,
	assertReviewBindingAuthority,
	readApprovalAuthoritySnapshot,
	readApprovalAuthoritySnapshots,
	readReviewBindingAuthority,
} from ".";

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration = resolveApprovalWorkflowRepositoryTestConfiguration({
	databaseUrl,
	required: integrationRequired,
	sentinel: testSentinel,
});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid approval workflow repository test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration =
	integrationConfiguration.status === "enabled" ? describe : describe.skip;
if (integrationConfiguration.status === "unavailable") {
	describe.skip(`approval authority PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the disposable PostgreSQL runner", () => undefined);
	});
}

configurePostgresUtcTypes();

const ids = {
	organization: "t474-authority",
	otherOrganization: "t474-authority-other",
	recipientUser: "t474-recipient",
	requesterUser: "t474-requester",
	recipient: randomUUID(),
	requester: randomUUID(),
	workflow: randomUUID(),
	stage: randomUUID(),
	assignment: randomUUID(),
	canonicalRevision: randomUUID(),
	canonicalBinding: randomUUID(),
	legacyRequest: randomUUID(),
	legacyRevision: randomUUID(),
	legacyBinding: randomUUID(),
};

/** One kind per lifecycle mode; `shift_request` keeps no rollout row. */
const MODE_BY_KIND: ReadonlyArray<[ApprovalWorkflowType, ApprovalWorkflowLifecycleMode | null]> = [
	["absence", "legacy"],
	["time_correction", "shadow"],
	["manual_time_submission", "ready"],
	["policy_clock_out", "canonical"],
	["travel_expense", "complete"],
	["shift_request", null],
];

describeIntegration("approval authority on PostgreSQL", () => {
	const pool = new Pool(
		withUtcPostgresSession({
			connectionString: databaseUrl ?? "postgresql://unconfigured@127.0.0.1:1/unconfigured",
			max: 4,
		}),
	);
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	const admin = new Pool(withUtcPostgresSession({ connectionString: databaseUrl, max: 2 }));
	const timestamp = new Date("2026-09-27T08:00:00Z");

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.recipientUser, ids.requesterUser],
		]);
	}

	async function seedOrganizations() {
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T474 authority', $1, $3), ($2, 'T474 other', $2, $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
	}

	async function seedRollouts() {
		for (const [workflowType, mode] of MODE_BY_KIND) {
			if (mode === null) continue;
			await admin.query(
				`insert into approval_workflow_rollout
				 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
				 values ($1, $2, $3, 'legacy', $4, $4)`,
				[ids.organization, workflowType, mode, timestamp],
			);
		}
	}

	async function rolloutRows(organizationId: string) {
		const { rows } = await admin.query<{ workflow_type: string; lifecycle_mode: string }>(
			`select workflow_type, lifecycle_mode from approval_workflow_rollout
			 where organization_id = $1 order by workflow_type`,
			[organizationId],
		);
		return rows;
	}

	/** One canonical absence binding and one legacy time-correction binding. */
	async function seedBindings() {
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Riley Recipient', 't474-recipient@example.test', $3, $3),
			 ($2, 'Robin Requester', 't474-requester@example.test', $3, $3)`,
			[ids.recipientUser, ids.requesterUser, timestamp],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'manager', $6), ($3, $4, $5, 'employee', $6)`,
			[
				ids.recipient,
				ids.recipientUser,
				ids.requester,
				ids.requesterUser,
				ids.organization,
				timestamp,
			],
		);
		await admin.query(
			`insert into approval_workflow (
				id, organization_id, workflow_type, source_type, source_id, requester_employee_id,
				status, current_stage_order, version, policy_snapshot, context_snapshot,
				display_snapshot, submitted_at, created_at, updated_at
			) values ($1, $2, 'absence', 'absence_entry', $3, $4, 'pending', 1, 1,
				'{}'::jsonb, '{}'::jsonb, '{}'::jsonb, $5, $5, $5)`,
			[ids.workflow, ids.organization, randomUUID(), ids.requester, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_stage (
				id, organization_id, workflow_id, stage_order, label, resolver_snapshot,
				activation_mode, status, created_at, updated_at
			) values ($1, $2, $3, 1, 'Manager', '{}'::jsonb, 'resolver', 'pending', $4, $4)`,
			[ids.stage, ids.organization, ids.workflow, timestamp],
		);
		await admin.query(
			`insert into approval_stage_assignment (
				id, organization_id, workflow_id, stage_id, assignment_sequence,
				approver_employee_id, status, assigned_at, created_at, updated_at
			) values ($1, $2, $3, $4, 1, $5, 'pending', $6, $6, $6)`,
			[ids.assignment, ids.organization, ids.workflow, ids.stage, ids.recipient, timestamp],
		);
		const revision = `(
			organization_id, authority, workflow_id, legacy_approval_request_id, workflow_type,
			source_type, source_id, request_cycle_key, revision, subject_employee_id,
			requester_employee_id, submitter_actor_kind, submitter_employee_id, schema_version,
			material_fingerprint, facts, labels, provenance, submitted_at, id
		)`;
		await admin.query(
			`insert into approval_submitted_revision ${revision} values
			 ($1, 'canonical', $2, null, 'absence', 'absence_entry', $3, 'cycle-canonical', 1,
				$4, $4, 'employee', $4, 1, 'fingerprint', '{}'::jsonb, '{}'::jsonb, 'submission', $5, $6)`,
			[
				ids.organization,
				ids.workflow,
				randomUUID(),
				ids.requester,
				timestamp,
				ids.canonicalRevision,
			],
		);
		await admin.query(
			`insert into approval_submitted_revision ${revision} values
			 ($1, 'legacy', null, $2, 'time_correction', 'time_entry', $3, 'cycle-legacy', 1,
				$4, $4, 'employee', $4, 1, 'fingerprint', '{}'::jsonb, '{}'::jsonb, 'submission', $5, $6)`,
			[
				ids.organization,
				ids.legacyRequest,
				randomUUID(),
				ids.requester,
				timestamp,
				ids.legacyRevision,
			],
		);
		await admin.query(
			`insert into approval_review_binding (
				id, organization_id, authority, recipient_employee_id, workflow_id, stage_id,
				assignment_id, legacy_approval_request_id, submitted_revision_id, created_at
			) values
			 ($1, $2, 'canonical', $3, $4, $5, $6, null, $7, $10),
			 ($8, $2, 'legacy', $3, null, null, null, $9, $11, $10)`,
			[
				ids.canonicalBinding,
				ids.organization,
				ids.recipient,
				ids.workflow,
				ids.stage,
				ids.assignment,
				ids.canonicalRevision,
				ids.legacyBinding,
				ids.legacyRequest,
				timestamp,
				ids.legacyRevision,
			],
		);
	}

	/** Whether another session could take the kind's exclusive cutover lock now. */
	async function cutoverLockAvailable(workflowType: ApprovalWorkflowType): Promise<boolean> {
		const client = await admin.connect();
		try {
			await client.query("begin");
			const { rows } = await client.query<{ acquired: boolean }>(
				"select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired",
				[approvalRolloutLockScope(ids.organization, workflowType)],
			);
			return rows[0]?.acquired === true;
		} finally {
			await client.query("rollback");
			client.release();
		}
	}

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const result = await admin.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled") {
			throw new Error("Approval authority PostgreSQL is disabled");
		}
	});

	beforeEach(async () => {
		await cleanup();
		await seedOrganizations();
	});

	afterAll(async () => {
		await cleanup();
		await pool.end();
		await admin.end();
	});

	describe("gated read", () => {
		it("takes the shared rollout lock and inserts the legacy row when none exists", async () => {
			expect(await rolloutRows(ids.organization)).toEqual([]);

			const observed = await db.transaction(async (tx) => {
				const gate = await acquireApprovalWriteGate(
					{ db: tx },
					{ organizationId: ids.organization, workflowType: "absence" },
				);
				// Held until commit: a cutover of this kind waits, another kind does not.
				return {
					gate,
					absenceCutover: await cutoverLockAvailable("absence"),
					otherKindCutover: await cutoverLockAvailable("time_correction"),
				};
			});

			expect(observed).toEqual({
				gate: approvalWriteGateResult("legacy"),
				absenceCutover: false,
				otherKindCutover: true,
			});
			expect(await rolloutRows(ids.organization)).toEqual([
				{ workflow_type: "absence", lifecycle_mode: "legacy" },
			]);
			expect(await cutoverLockAvailable("absence")).toBe(true);
		});

		it.each(MODE_BY_KIND.filter(([, mode]) => mode !== null))(
			"reads %s in its stored %s mode without changing it",
			async (workflowType, mode) => {
				await seedRollouts();
				const gate = await db.transaction((tx) =>
					acquireApprovalWriteGate({ db: tx }, { organizationId: ids.organization, workflowType }),
				);
				expect(gate).toEqual(approvalWriteGateResult(mode as ApprovalWorkflowLifecycleMode));
				expect(await rolloutRows(ids.organization)).toHaveLength(5);
			},
		);
	});

	describe("snapshot read", () => {
		it("returns legacy for no row and never writes", async () => {
			const snapshot = await readApprovalAuthoritySnapshot(db, {
				organizationId: ids.organization,
				workflowType: "absence",
			});
			expect(snapshot).toEqual({
				mode: "legacy",
				authority: "legacy",
				shadowMirroring: false,
				compatibilityWriting: false,
			});
			expect(await rolloutRows(ids.organization)).toEqual([]);
		});

		it("never waits for a cutover holding the exclusive rollout lock", async () => {
			await seedRollouts();
			const client = await admin.connect();
			try {
				await client.query("begin");
				await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
					approvalRolloutLockScope(ids.organization, "policy_clock_out"),
				]);
				const snapshot = await Promise.race([
					readApprovalAuthoritySnapshot(db, {
						organizationId: ids.organization,
						workflowType: "policy_clock_out",
					}),
					new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 2000)),
				]);
				expect(snapshot).toMatchObject({ mode: "canonical", authority: "canonical" });
			} finally {
				await client.query("rollback");
				client.release();
			}
		});

		it("reads several kinds of one organization with the same defaults", async () => {
			await seedRollouts();
			const snapshots = await readApprovalAuthoritySnapshots(
				db,
				ids.organization,
				MODE_BY_KIND.map(([workflowType]) => workflowType),
			);
			expect(
				Object.fromEntries([...snapshots].map(([kind, snapshot]) => [kind, snapshot.mode])),
			).toEqual({
				absence: "legacy",
				time_correction: "shadow",
				manual_time_submission: "ready",
				policy_clock_out: "canonical",
				travel_expense: "complete",
				shift_request: "legacy",
			});
		});
	});

	describe("review bindings", () => {
		it("reads each binding's authority and kind in one read, scoped to its organization", async () => {
			await seedBindings();
			const read = (organizationId: string, bindingId: string) =>
				readReviewBindingAuthority(db, { organizationId, bindingId });

			expect(await read(ids.organization, ids.canonicalBinding)).toEqual({
				authority: "canonical",
				kind: "absence",
			});
			expect(await read(ids.organization, ids.legacyBinding)).toEqual({
				authority: "legacy",
				kind: "time_correction",
			});
			expect(await read(ids.otherOrganization, ids.legacyBinding)).toBeNull();
			expect(await read(ids.organization, randomUUID())).toBeNull();
		});

		it("admits a binding only under the gate's authority", async () => {
			await seedBindings();
			const check = (bindingId: string, mode: ApprovalWorkflowLifecycleMode) =>
				assertReviewBindingAuthority(db, {
					organizationId: ids.organization,
					bindingId,
					gate: approvalWriteGateResult(mode),
				});

			await expect(check(ids.canonicalBinding, "complete")).resolves.toEqual({
				authority: "canonical",
				kind: "absence",
			});
			await expect(check(ids.legacyBinding, "shadow")).resolves.toEqual({
				authority: "legacy",
				kind: "time_correction",
			});
			for (const [bindingId, mode] of [
				[ids.canonicalBinding, "ready"],
				[ids.legacyBinding, "canonical"],
				[randomUUID(), "legacy"],
			] as const) {
				const refused = check(bindingId, mode);
				await expect(refused).rejects.toBeInstanceOf(ApprovalEvidenceError);
				await expect(refused).rejects.toMatchObject({ code: "binding_mismatch" });
			}
		});
	});

	describe("SQL fragment", () => {
		it("agrees with the TypeScript table for every mode and a missing row", async () => {
			await seedRollouts();
			const column = sql`r.lifecycle_mode`;
			const result = await db.execute(sql`
				select k.workflow_type,
					${approvalAuthoritySql(column, "legacy")} as legacy,
					${approvalAuthoritySql(column, "canonical")} as canonical,
					not ${approvalAuthoritySql(column, "canonical")} as not_canonical
				from unnest(${sql.param(MODE_BY_KIND.map(([kind]) => kind))}::approval_workflow_type[])
					as k(workflow_type)
				left join approval_workflow_rollout r
					on r.organization_id = ${ids.organization} and r.workflow_type = k.workflow_type
			`);
			const byKind = (left: { workflow_type: string }, right: { workflow_type: string }) =>
				left.workflow_type.localeCompare(right.workflow_type);
			const expected = MODE_BY_KIND.map(([workflowType, mode]) => {
				const canonical = approvalAuthorityOf(mode) === "canonical";
				return {
					workflow_type: workflowType,
					legacy: !canonical,
					canonical,
					not_canonical: !canonical,
				};
			}).toSorted(byKind);
			expect((result.rows as Array<{ workflow_type: string }>).toSorted(byKind)).toEqual(expected);
		});
	});
});
