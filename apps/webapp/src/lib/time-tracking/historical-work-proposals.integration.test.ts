/**
 * #323 / T58 runtime evidence: separately authorized repair and continuation proposals.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Work is written by the real legacy `createManualTimeEntry` action; the historical
 * conflicts a proposal addresses are injected with SQL, as history would contain them.
 * Proposals are created, approved, rejected and applied through the real proposals
 * route (membership lookup, principal loader, CASL ability, shared completed-work
 * coordinator). Repair authorization and append adoption are granted by inserting their
 * control rows, because they have no application setter. Concurrent writers hold the
 * same employee coordination key real writers take.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import type { ManualTimeEntryCommand } from "@/lib/time-tracking/manual-command";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("@/db", async () => {
	const { Pool } = await import("pg");
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const authSchema = await import("@/db/auth-schema");
	const schema = await import("@/db/schema");
	const { configurePostgresUtcTypes, withUtcPostgresSession } = await import("@/db/postgres-utc");
	configurePostgresUtcTypes();
	const pool = new Pool(
		withUtcPostgresSession({
			connectionString:
				process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL ??
				"postgresql://unconfigured@127.0.0.1:1/unconfigured",
			max: 8,
		}),
	);
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	return { ...authSchema, ...schema, db, pool };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => {},
}));

vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: vi.fn(),
	revalidateTag: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t323-session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/notifications/triggers")>();
	return Object.fromEntries(
		Object.entries(original).map(([name, value]) => [
			name,
			typeof value === "function" ? async () => undefined : value,
		]),
	);
});

vi.mock("@/app/[locale]/(app)/time-tracking/actions/approvals", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/app/[locale]/(app)/time-tracking/actions/approvals")
	>()),
	sendManualEntryApprovalNotifications: async () => undefined,
	sendManualEntryApprovedNotification: async () => undefined,
}));

const { POST: proposalsRoute } = await import("@/app/api/time-entries/diagnostics/proposals/route");
const { POST: diagnosticsRoute } = await import("@/app/api/time-entries/diagnostics/route");
const { createManualTimeEntry } = await import("@/app/[locale]/(app)/time-tracking/actions");
const { withCompletedWorkTransaction } = await import(
	"@/lib/time-tracking/completed-work-transaction"
);
const { deleteDemoEmployeeHistory } = await import("@/lib/demo/demo-work");

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
	describe.skip(`proposal PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t323-proposal-org",
	otherOrganization: "t323-other-org",
	ownerUser: "t323-owner-user",
	adminUser: "t323-admin-user",
	managerUser: "t323-manager-user",
	workerUser: "t323-worker-user",
	foreignUser: "t323-foreign-user",
	owner: "d3230000-0000-4000-8000-000000000001",
	admin: "d3230000-0000-4000-8000-000000000002",
	manager: "d3230000-0000-4000-8000-000000000003",
	worker: "d3230000-0000-4000-8000-000000000004",
	foreign: "d3230000-0000-4000-8000-000000000005",
	project: "d3230000-0000-4000-8000-0000000000a1",
	foreignProject: "d3230000-0000-4000-8000-0000000000a2",
} as const;
const users = [ids.ownerUser, ids.adminUser, ids.managerUser, ids.workerUser, ids.foreignUser];
const july = { startDate: "2026-07-01", endDate: "2026-07-31" };

// biome-ignore lint/suspicious/noExplicitAny: route bodies are asserted field by field
type RouteResult = { status: number; body: Record<string, any> };

let entrySequence = 0;
/** A standard-hash entry following `previous` by explicit ID and hash. */
function seedEntry(
	previous: { id: string; hash: string } | null,
	type: "clock_in" | "clock_out",
	timestamp: string,
	employeeId: string = ids.worker,
) {
	entrySequence += 1;
	const previousHash = previous?.hash ?? null;
	return {
		id: `d3231000-0000-4000-8000-${entrySequence.toString().padStart(12, "0")}`,
		employeeId,
		type,
		timestamp,
		previousHash,
		previousEntryId: previous?.id ?? null,
		hash: calculateHash({
			employeeId,
			type,
			timestamp: new Date(timestamp).toISOString(),
			previousHash,
		}),
	};
}

describeIntegration("authorized repair and continuation proposals on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 6 });

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function call(
		body: Record<string, unknown>,
		userId: string = ids.ownerUser,
	): Promise<RouteResult> {
		actAs(userId);
		const response = await proposalsRoute(
			new Request("http://localhost/api/time-entries/diagnostics/proposals", {
				method: "POST",
				body: JSON.stringify(body),
			}) as unknown as NextRequest,
		);
		return { status: response.status, body: await response.json() };
	}

	async function proposeRepair(
		workPeriodId: string,
		changes: Record<string, unknown>[],
		options: { proposalId?: string; userId?: string } = {},
	) {
		return call(
			{
				action: "propose_repair",
				proposalId: options.proposalId ?? randomUUID(),
				workPeriodId,
				changes,
				evidenceNote: "Signed paper timesheet for the day",
				reason: "Resolve the July minutes conflict",
			},
			options.userId,
		);
	}

	async function approve(proposal: { id: string; fingerprint: string }, userId = ids.ownerUser) {
		return call(
			{ action: "approve", proposalId: proposal.id, fingerprint: proposal.fingerprint },
			userId,
		);
	}

	async function applyProposal(proposalId: string, userId = ids.ownerUser) {
		return call({ action: "apply", proposalId }, userId);
	}

	async function findingKinds() {
		actAs(ids.ownerUser);
		const response = await diagnosticsRoute(
			new Request("http://localhost/api/time-entries/diagnostics", {
				method: "POST",
				body: JSON.stringify({ employeeId: ids.worker, ...july }),
			}) as unknown as NextRequest,
		);
		const body = await response.json();
		return (body.work.findings as { kind: string }[]).map((finding) => finding.kind);
	}

	async function authorizeRepair(organizationId: string = ids.organization) {
		await admin.query(
			"insert into historical_work_repair_control (organization_id, mode) values ($1, 'active')",
			[organizationId],
		);
	}

	async function adoptAppend() {
		await admin.query(
			"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
			[ids.organization],
		);
	}

	/** Approved legacy manual work, with its record's minutes changed to `recordMinutes`. */
	async function conflictingWork(date: string, recordMinutes: number) {
		actAs(ids.workerUser);
		const result = await createManualTimeEntry({
			submissionId: randomUUID(),
			reason: "Forgot to clock",
			timezone: "Europe/Berlin",
			browserTimezone: "Europe/Berlin",
			date,
			clockInTime: "08:00",
			clockOutTime: "12:00",
		} as unknown as ManualTimeEntryCommand);
		expect(result).toMatchObject({ success: true });
		const periodId = (result as { data: { workPeriodId: string } }).data.workPeriodId;
		const {
			rows: [period],
		} = await admin.query("select canonical_record_id from work_period where id = $1", [periodId]);
		const recordId: string = period.canonical_record_id;
		// History as it was decided: approved on both representations and its request.
		await admin.query("update work_period set approval_status = 'approved' where id = $1", [
			periodId,
		]);
		await admin.query(
			"update time_record set approval_state = 'approved', duration_minutes = $2 where id = $1",
			[recordId, recordMinutes],
		);
		await admin.query(
			"update approval_request set status = 'approved' where entity_id = $1 and organization_id = $2",
			[periodId, ids.organization],
		);
		return { periodId, recordId };
	}

	async function recordRow(recordId: string) {
		const { rows } = await admin.query("select * from time_record where id = $1", [recordId]);
		return rows[0];
	}

	async function periodRow(periodId: string) {
		const { rows } = await admin.query("select * from work_period where id = $1", [periodId]);
		return rows[0];
	}

	async function proposalRow(proposalId: string) {
		const { rows } = await admin.query("select * from historical_work_proposal where id = $1", [
			proposalId,
		]);
		return rows[0];
	}

	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = $1) as details,
			   (select json_agg(row_to_json(t) order by t.id) from time_record_allocation t where organization_id = $1) as allocations,
			   (select json_agg(row_to_json(t) order by t.id) from approval_request t where organization_id = $1) as requests,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = $1) as positions`,
			[ids.organization],
		);
		return rows[0];
	}

	/** Holds the coordination key every participating writer of the worker takes. */
	async function asConcurrentWriter() {
		const client: PoolClient = await admin.connect();
		await client.query("begin");
		await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [ids.worker]);
		return {
			async commit(write: (client: PoolClient) => Promise<void>) {
				await write(client);
				await client.query("commit");
				client.release();
			},
		};
	}

	async function waitForLockWaiter() {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const { rows } = await admin.query(
				"select count(*)::int as waiting from pg_locks where locktype = 'advisory' and not granted",
			);
			if (rows[0].waiting > 0) return;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw new Error("The application never waited for the concurrent writer");
	}

	async function insertEntries(
		entries: ReturnType<typeof seedEntry>[],
		organizationId = ids.organization,
	) {
		for (const entry of entries) {
			await admin.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone,
				  timezone_source, previous_entry_id, hash, previous_hash, created_at, created_by)
				 values ($1, $2, $3, $4, $5, 0, 'UTC', 'user_setting', $6, $7, $8, $5, $9)`,
				[
					entry.id,
					entry.employeeId,
					organizationId,
					entry.type,
					new Date(entry.timestamp),
					entry.previousEntryId,
					entry.hash,
					entry.previousHash,
					ids.ownerUser,
				],
			);
		}
	}

	async function cleanup() {
		await admin.query("delete from organization where id in ($1, $2)", [
			ids.organization,
			ids.otherOrganization,
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function seed() {
		await cleanup();
		const timestamp = new Date("2026-01-01T00:00:00Z");
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values
			 ($1, 'T323 proposals', $1, 'Europe/Berlin', $3), ($2, 'T323 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t323-m-owner', $1, $2, 'owner', 'approved', $7),
			 ('t323-m-admin', $1, $3, 'admin', 'approved', $7),
			 ('t323-m-manager', $1, $4, 'member', 'approved', $7),
			 ('t323-m-worker', $1, $5, 'member', 'approved', $7),
			 ('t323-m-foreign', $6, $8, 'owner', 'approved', $7)`,
			[
				ids.organization,
				ids.ownerUser,
				ids.adminUser,
				ids.managerUser,
				ids.workerUser,
				ids.otherOrganization,
				timestamp,
				ids.foreignUser,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $11, 'admin', $12), ($3, $4, $11, 'admin', $12),
			 ($5, $6, $11, 'manager', $12), ($7, $8, $11, 'employee', $12),
			 ($9, $10, $13, 'admin', $12)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.admin,
				ids.adminUser,
				ids.manager,
				ids.managerUser,
				ids.worker,
				ids.workerUser,
				ids.foreign,
				ids.foreignUser,
				ids.organization,
				timestamp,
				ids.otherOrganization,
			],
		);
		await admin.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[ids.worker, ids.manager, ids.ownerUser],
		);
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 select user_id, 'Europe/Berlin', $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'manual_time_submission', 'legacy', 'legacy', now(), now())`,
			[ids.organization],
		);
		await admin.query(
			`insert into project (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, 'T323 project', $3, now()), ($4, $5, 'T323 foreign project', $6, now())`,
			[
				ids.project,
				ids.organization,
				ids.ownerUser,
				ids.foreignProject,
				ids.otherOrganization,
				ids.foreignUser,
			],
		);
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
			throw new Error("Proposal PostgreSQL is disabled");
		}
	});

	beforeEach(seed);

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("applies an approved exact repair with separate proposer, approver and executor provenance", async () => {
		const { periodId, recordId } = await conflictingWork("2026-07-06", 200);
		expect(await findingKinds()).toContain("duration_conflict");

		const created = await proposeRepair(periodId, [
			{ target: "time_record", field: "duration_minutes", after: 240 },
		]);
		expect(created.status).toBe(200);
		const proposal = created.body.proposal;
		expect(proposal).toMatchObject({
			kind: "field_repair",
			status: "proposed",
			workPeriodId: periodId,
			proposedBy: { id: ids.ownerUser },
			proposal: {
				work: { workPeriodId: periodId, timeRecordId: recordId },
				changes: [
					{
						target: "time_record",
						id: recordId,
						field: "duration_minutes",
						before: 200,
						after: 240,
					},
				],
				evidence: { note: "Signed paper timesheet for the day" },
				consequences: {
					approval: { effects: ["approved_work_changes", "no_decision_recorded"] },
					payroll: { effects: ["payable_minutes_change", "finalized_exports_unchanged"] },
				},
			},
		});
		expect(
			proposal.proposal.evidence.findings.map((finding: { kind: string }) => finding.kind),
		).toContain("duration_conflict");
		expect(
			proposal.proposal.uncertainty.remainingFindings.map(
				(finding: { kind: string }) => finding.kind,
			),
		).not.toContain("duration_conflict");
		// Legacy manual work has no completed-work receipt; its replay keeps its own rules.
		expect(proposal.proposal.consequences.replay).toEqual({
			receiptIds: [],
			effects: ["committed_replay_returns_recorded_result"],
		});

		// Creating and approving write nothing but the proposal.
		const beforeApply = await snapshot();
		const approved = await approve(proposal, ids.adminUser);
		expect(approved.body).toMatchObject({
			status: "approved",
			proposal: { approvedBy: { id: ids.adminUser } },
		});

		// Not yet authorized: nothing is written and the proposal stays approved.
		expect((await applyProposal(proposal.id)).body).toMatchObject({
			code: "repair_not_authorized",
		});
		expect(await snapshot()).toEqual(beforeApply);
		expect((await proposalRow(proposal.id)).status).toBe("approved");

		await authorizeRepair();
		const applied = await applyProposal(proposal.id);
		expect(applied.status).toBe(200);
		expect(applied.body).toMatchObject({
			status: "applied",
			proposal: {
				status: "applied",
				resolvedBy: { id: ids.ownerUser },
				outcome: { status: "applied", operationId: proposal.id },
			},
		});
		const record = await recordRow(recordId);
		expect(record).toMatchObject({
			duration_minutes: 240,
			updated_by: ids.ownerUser,
			approval_state: "approved",
		});
		const period = await periodRow(periodId);
		expect(period.graph_revision).toBe(beforeApply.periods[0].graph_revision + 1);
		expect(period.duration_minutes).toBe(240);

		const {
			rows: [receipt],
		} = await admin.query("select * from completed_work_operation where id = $1", [proposal.id]);
		expect(receipt).toMatchObject({
			kind: "apply_historical_repair_proposal",
			writer: "historical_repair_proposal",
			actor_kind: "human",
			actor_user_id: ids.ownerUser,
			work_period_id: periodId,
			append_admission: "legacy",
		});
		expect(receipt.result).toMatchObject({
			proposalId: proposal.id,
			originalActor: { kind: "unknown_historical" },
			proposer: { userId: ids.ownerUser },
			approver: { userId: ids.adminUser },
			executor: { kind: "human", userId: ids.ownerUser },
			reason: "Resolve the July minutes conflict",
			changes: [{ field: "duration_minutes", before: 200, after: 240 }],
		});
		// Approval state and history are untouched: no decision is recorded or rebuilt.
		expect(beforeApply.requests).toEqual((await snapshot()).requests);
		expect(await findingKinds()).not.toContain("duration_conflict");

		// Repeating the application returns the recorded outcome and writes nothing.
		const afterApply = await snapshot();
		const repeated = await applyProposal(proposal.id);
		expect(repeated.body).toMatchObject({ status: "already_applied" });
		expect(await snapshot()).toEqual(afterApply);

		// A retry after authorization was withdrawn still returns the recorded outcome.
		await admin.query("delete from historical_work_repair_control where organization_id = $1", [
			ids.organization,
		]);
		expect((await applyProposal(proposal.id)).body).toMatchObject({ status: "already_applied" });
	});

	it("accepts approval by the proposer and returns the same proposal for a repeated creation", async () => {
		const { periodId } = await conflictingWork("2026-07-07", 200);
		const proposalId = randomUUID();
		const changes = [{ target: "time_record", field: "duration_minutes", after: 240 }];
		const first = await proposeRepair(periodId, changes, { proposalId });
		const again = await proposeRepair(periodId, changes, { proposalId });
		expect(again.body.proposal).toEqual(first.body.proposal);
		const conflicting = await proposeRepair(
			periodId,
			[{ target: "time_record", field: "duration_minutes", after: 230 }],
			{ proposalId },
		);
		expect(conflicting).toMatchObject({ status: 409, body: { code: "proposal_id_conflict" } });

		// A fingerprint other than the reviewed one does not approve anything.
		const wrong = await approve({ id: proposalId, fingerprint: "0".repeat(64) });
		expect(wrong).toMatchObject({ status: 409, body: { code: "fingerprint_mismatch" } });
		const own = await approve(first.body.proposal);
		expect(own.body).toMatchObject({
			status: "approved",
			proposal: { approvedBy: { id: ids.ownerUser } },
		});
		expect((await approve(first.body.proposal)).body).toMatchObject({
			code: "invalid_status",
			status: "approved",
		});
	});

	it("fails stale proposals at approval and application and never overwrites newer changes", async () => {
		await authorizeRepair();
		const { periodId, recordId } = await conflictingWork("2026-07-08", 200);
		const changes = [{ target: "time_record", field: "duration_minutes", after: 240 }];

		// Evidence changed before approval: approval records staleness instead.
		const early = (await proposeRepair(periodId, changes)).body.proposal;
		await admin.query("update time_record set duration_minutes = 210 where id = $1", [recordId]);
		const staleApproval = await approve(early);
		expect(staleApproval.body).toMatchObject({
			status: "stale",
			proposal: { status: "stale", outcome: { status: "stale", stage: "approval" } },
		});

		// Evidence changed after approval: application stops without writing the work.
		const late = (await proposeRepair(periodId, changes)).body.proposal;
		expect((await approve(late)).body.status).toBe("approved");
		await admin.query("update time_record set duration_minutes = 220 where id = $1", [recordId]);
		const before = await snapshot();
		const stale = await applyProposal(late.id);
		expect(stale.body).toMatchObject({
			status: "stale",
			proposal: {
				status: "stale",
				resolvedBy: { id: ids.ownerUser },
				outcome: { stage: "application" },
			},
		});
		expect(await snapshot()).toEqual(before);
		expect((await recordRow(recordId)).duration_minutes).toBe(220);
		expect((await applyProposal(late.id)).body).toMatchObject({ status: "stale" });

		// Corrective recovery is a new audited proposal over the newest state.
		const recovery = (await proposeRepair(periodId, changes)).body.proposal;
		expect(recovery.proposal.changes[0]).toMatchObject({ before: 220, after: 240 });
		await approve(recovery);
		expect((await applyProposal(recovery.id)).body.status).toBe("applied");
		const reverse = (
			await proposeRepair(periodId, [
				{ target: "time_record", field: "duration_minutes", after: 220 },
			])
		).body.proposal;
		await approve(reverse);
		await admin.query("update work_period set work_location_type = 'home' where id = $1", [
			periodId,
		]);
		expect((await applyProposal(reverse.id)).body.status).toBe("stale");
		expect((await recordRow(recordId)).duration_minutes).toBe(240);
	});

	it("revalidates under the employee's coordination key after a concurrent writer commits", async () => {
		await authorizeRepair();
		const { periodId, recordId } = await conflictingWork("2026-07-09", 200);
		const proposal = (
			await proposeRepair(periodId, [
				{ target: "time_record", field: "duration_minutes", after: 240 },
			])
		).body.proposal;
		await approve(proposal);

		const writer = await asConcurrentWriter();
		const pending = applyProposal(proposal.id);
		await waitForLockWaiter();
		await writer.commit(async (client) => {
			await client.query(
				"update work_period set graph_revision = graph_revision + 1, duration_minutes = 235 where id = $1",
				[periodId],
			);
		});
		expect((await pending).body).toMatchObject({ status: "stale" });
		expect((await recordRow(recordId)).duration_minutes).toBe(200);
		const { rows } = await admin.query("select id from completed_work_operation where id = $1", [
			proposal.id,
		]);
		expect(rows).toEqual([]);
	});

	it("rolls back the whole repair when its receipt fails, then serializes concurrent applications", async () => {
		await authorizeRepair();
		const { periodId, recordId } = await conflictingWork("2026-07-10", 200);
		const proposal = (
			await proposeRepair(periodId, [
				{ target: "time_record", field: "duration_minutes", after: 240 },
				{ target: "work_period", field: "project_id", after: ids.project },
			])
		).body.proposal;
		await approve(proposal);

		await admin.query(`
			create or replace function t323_fail_receipt() returns trigger language plpgsql as $$
			begin
				if new.kind = 'apply_historical_repair_proposal' then
					raise exception 't323 receipt failure';
				end if;
				return new;
			end $$`);
		await admin.query(
			"create trigger t323_fail_receipt before insert on completed_work_operation for each row execute function t323_fail_receipt()",
		);
		const before = await snapshot();
		try {
			expect((await applyProposal(proposal.id)).status).toBe(500);
		} finally {
			await admin.query("drop trigger t323_fail_receipt on completed_work_operation");
			await admin.query("drop function t323_fail_receipt()");
		}
		expect(await snapshot()).toEqual(before);
		expect((await proposalRow(proposal.id)).status).toBe("approved");

		const results = await Promise.all([applyProposal(proposal.id), applyProposal(proposal.id)]);
		expect(results.map((result) => result.body.status).toSorted()).toEqual([
			"already_applied",
			"applied",
		]);
		const { rows } = await admin.query(
			"select id from completed_work_operation where kind = 'apply_historical_repair_proposal'",
		);
		expect(rows).toHaveLength(1);
		expect(await recordRow(recordId)).toMatchObject({ duration_minutes: 240 });
		expect(await periodRow(periodId)).toMatchObject({ project_id: ids.project });
	});

	it("refuses non-waivable proposals and unauthorized or foreign callers", async () => {
		const { periodId, recordId } = await conflictingWork("2026-07-13", 200);
		const minutes = [{ target: "time_record", field: "duration_minutes", after: 240 }];

		expect(
			(
				await proposeRepair(periodId, [
					{ target: "work_period", field: "project_id", after: ids.foreignProject },
				])
			).body,
		).toMatchObject({ code: "proposal_refused", reasons: ["reference_outside_organization"] });
		// A value that cannot name a row is not the organization's either (not a 500).
		expect(
			(
				await proposeRepair(periodId, [
					{ target: "work_period", field: "project_id", after: "not-a-project" },
				])
			).body,
		).toMatchObject({ code: "proposal_refused", reasons: ["reference_outside_organization"] });
		expect(
			(
				await proposeRepair(periodId, [
					{ target: "work_period", field: "start_at", after: "2026-07-13T06:00:00Z" },
				])
			).body,
		).toMatchObject({ code: "proposal_refused", reasons: ["field_not_repairable"] });
		expect(
			(
				await proposeRepair(periodId, [
					{ target: "time_record", field: "duration_minutes", after: 241 },
				])
			).body,
		).toMatchObject({
			reasons: ["minutes_exceed_interval"],
		});

		await admin.query("update time_record set approval_state = 'pending' where id = $1", [
			recordId,
		]);
		expect((await proposeRepair(periodId, minutes)).body).toMatchObject({
			reasons: ["approval_pending"],
		});
		await admin.query("update time_record set approval_state = 'approved' where id = $1", [
			recordId,
		]);
		await admin.query("update work_period set deleted_at = now() where id = $1", [periodId]);
		expect((await proposeRepair(periodId, minutes)).body).toMatchObject({
			reasons: ["work_deleted"],
		});
		await admin.query("update work_period set deleted_at = null where id = $1", [periodId]);

		// Managers and employees cannot propose, approve or apply.
		expect((await proposeRepair(periodId, minutes, { userId: ids.managerUser })).status).toBe(403);
		expect((await proposeRepair(periodId, minutes, { userId: ids.workerUser })).status).toBe(403);
		const proposal = (await proposeRepair(periodId, minutes)).body.proposal;
		expect((await approve(proposal, ids.managerUser)).status).toBe(403);
		expect((await applyProposal(proposal.id, ids.workerUser)).status).toBe(403);

		// Another organization's administrator cannot see or act on it.
		harness.userId = ids.foreignUser;
		harness.organizationId = ids.otherOrganization;
		const foreign = await proposalsRoute(
			new Request("http://localhost/api/time-entries/diagnostics/proposals", {
				method: "POST",
				body: JSON.stringify({
					action: "approve",
					proposalId: proposal.id,
					fingerprint: proposal.fingerprint,
				}),
			}) as unknown as NextRequest,
		);
		expect(foreign.status).toBe(404);
		const foreignWork = await proposalsRoute(
			new Request("http://localhost/api/time-entries/diagnostics/proposals", {
				method: "POST",
				body: JSON.stringify({
					action: "propose_repair",
					proposalId: randomUUID(),
					workPeriodId: periodId,
					changes: minutes,
					evidenceNote: "x",
					reason: "x",
				}),
			}) as unknown as NextRequest,
		);
		expect(foreignWork.status).toBe(404);

		// Another organization's authorization does not authorize this one.
		await authorizeRepair(ids.otherOrganization);
		await approve(proposal);
		expect((await applyProposal(proposal.id)).body).toMatchObject({
			code: "repair_not_authorized",
		});

		// A rejected proposal cannot be approved or applied.
		const rejected = await call({
			action: "reject",
			proposalId: proposal.id,
			note: "Timesheet unsigned",
		});
		expect(rejected.body).toMatchObject({
			status: "rejected",
			proposal: { status: "rejected", outcome: { note: "Timesheet unsigned" } },
		});
		await authorizeRepair();
		expect((await applyProposal(proposal.id)).body).toMatchObject({
			code: "invalid_status",
			status: "rejected",
		});
		expect((await call({ action: "apply", proposalId: "not-a-uuid" })).status).toBe(400);
		expect(
			(
				await call({
					action: "propose_repair",
					proposalId: randomUUID(),
					workPeriodId: periodId,
					changes: minutes,
					evidenceNote: " ",
					reason: "x",
				})
			).status,
		).toBe(400);
	});

	it("leaves committed replay unchanged after a repair", async () => {
		await authorizeRepair();
		const submissionId = randomUUID();
		actAs(ids.workerUser);
		const command = {
			submissionId,
			reason: "Forgot to clock",
			timezone: "Europe/Berlin",
			browserTimezone: "Europe/Berlin",
			date: "2026-07-14",
			clockInTime: "08:00",
			clockOutTime: "12:00",
		} as unknown as ManualTimeEntryCommand;
		const original = await createManualTimeEntry(command);
		expect(original).toMatchObject({ success: true });
		const periodId = (original as { data: { workPeriodId: string } }).data.workPeriodId;
		await admin.query("update work_period set approval_status = 'approved' where id = $1", [
			periodId,
		]);
		await admin.query(
			"update time_record set approval_state = 'approved', duration_minutes = 200 where id = (select canonical_record_id from work_period where id = $1)",
			[periodId],
		);
		const proposal = (
			await proposeRepair(periodId, [
				{ target: "time_record", field: "duration_minutes", after: 240 },
			])
		).body.proposal;
		await approve(proposal);
		expect((await applyProposal(proposal.id)).body.status).toBe("applied");

		const before = await snapshot();
		actAs(ids.workerUser);
		const replay = await createManualTimeEntry(command);
		// The replay keeps its established result; it neither repeats nor reverts the repair.
		expect(replay).toEqual(original);
		expect(await snapshot()).toEqual(before);
	});

	describe("append continuation", () => {
		/** A forked hash history: root R followed by A and by B. Tips: A and B. */
		async function forkedHistory() {
			const root = seedEntry(null, "clock_in", "2026-07-01T08:00:00Z");
			const left = seedEntry(root, "clock_out", "2026-07-01T16:00:00Z");
			const right = seedEntry(root, "clock_out", "2026-07-01T17:00:00Z");
			await insertEntries([root, left, right]);
			return { root, left, right };
		}

		async function proposeContinuation(
			anchor: { id: string; hash: string },
			employeeId: string = ids.worker,
		) {
			return call({
				action: "propose_continuation",
				proposalId: randomUUID(),
				employeeId,
				anchorEntryId: anchor.id,
				anchorHash: anchor.hash,
				reason: "Imported history forked; continue from the reviewed final clock-out",
			});
		}

		it("establishes continuation state atomically with its approval and execution provenance", async () => {
			await adoptAppend();
			await authorizeRepair();
			const { root, left, right } = await forkedHistory();

			const created = await proposeContinuation(right);
			expect(created.status).toBe(200);
			const proposal = created.body.proposal;
			expect(proposal).toMatchObject({
				kind: "append_continuation",
				workPeriodId: null,
				proposal: {
					anchor: { entryId: right.id, hash: right.hash, hashStatus: "reproduced" },
					candidates: [{ entryId: left.id }, { entryId: right.id }],
					issues: [{ kind: "fork", predecessorId: root.id }],
					guarantee: { scope: "post_anchor", anchorEntryId: right.id },
					expected: { entryCount: 3, position: null },
				},
			});
			await approve(proposal, ids.adminUser);
			const beforeApply = await snapshot();
			const applied = await applyProposal(proposal.id);
			expect(applied.body).toMatchObject({
				status: "applied",
				proposal: { outcome: { position: { anchor: { entryId: right.id }, entryCount: 3 } } },
			});
			const {
				rows: [position],
			} = await admin.query("select * from time_entry_append_position where employee_id = $1", [
				ids.worker,
			]);
			expect(position).toMatchObject({
				tip_entry_id: right.id,
				tip_hash: right.hash,
				entry_count: 3,
				admission: "authorized_continuation",
				admitted_tip_entry_id: right.id,
				admitted_entry_count: 3,
				continuation_proposal_id: proposal.id,
				admitted_operation: "authorized_continuation",
			});
			// No entry was rehashed, rechained, removed or invented.
			expect((await snapshot()).entries).toEqual(beforeApply.entries);
			expect((await applyProposal(proposal.id)).body.status).toBe("already_applied");

			// The organization and employee cleanup removes the proposal and its position.
			await admin.query("delete from organization where id = $1", [ids.organization]);
			const { rows } = await admin.query(
				"select count(*)::int as count from historical_work_proposal where organization_id = $1",
				[ids.organization],
			);
			expect(rows[0].count).toBe(0);
		});

		it("cannot waive a missing, foreign, ambiguous or forking anchor", async () => {
			await adoptAppend();
			const { root, left } = await forkedHistory();
			const foreignEntry = seedEntry(null, "clock_in", "2026-07-02T08:00:00Z", ids.foreign);
			await insertEntries([foreignEntry], ids.otherOrganization);

			expect((await proposeContinuation(root)).body).toMatchObject({
				reasons: ["anchor_has_successor"],
			});
			expect((await proposeContinuation(foreignEntry)).body).toMatchObject({
				reasons: ["anchor_not_found"],
			});
			expect((await proposeContinuation(foreignEntry, ids.foreign)).status).toBe(404);
			expect((await proposeContinuation({ id: left.id, hash: "0".repeat(64) })).body).toMatchObject(
				{
					reasons: ["anchor_hash_mismatch"],
				},
			);
			// An identical twin of the anchor makes its identity ambiguous.
			await admin.query(
				`insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
				   timezone, timezone_source, previous_entry_id, hash, previous_hash, created_at, created_by)
				 select 'd3232000-0000-4000-8000-000000000001', employee_id, organization_id, type, timestamp,
				   utc_offset_minutes, timezone, timezone_source, null, hash, previous_hash, created_at, created_by
				 from time_entry where id = $1`,
				[left.id],
			);
			expect((await proposeContinuation(left)).body.reasons).toContain("anchor_identity_ambiguous");
		});

		it("refuses admissible history and existing positions, and needs append adoption to apply", async () => {
			await authorizeRepair();
			const root = seedEntry(null, "clock_in", "2026-07-01T08:00:00Z");
			const tip = seedEntry(root, "clock_out", "2026-07-01T16:00:00Z");
			await insertEntries([root, tip]);
			expect((await proposeContinuation(tip)).body).toMatchObject({
				reasons: ["history_admissible"],
			});

			const other = seedEntry(root, "clock_out", "2026-07-01T18:00:00Z");
			await insertEntries([other]);
			const proposal = (await proposeContinuation(other)).body.proposal;
			await approve(proposal);
			// Legacy organizations do not admit appends from positions.
			expect((await applyProposal(proposal.id)).body).toMatchObject({ code: "append_not_adopted" });

			await adoptAppend();
			expect((await applyProposal(proposal.id)).body.status).toBe("applied");
			expect((await proposeContinuation(tip)).body).toMatchObject({
				reasons: expect.arrayContaining(["position_exists"]),
			});
		});

		it("goes stale when history changes between approval and application", async () => {
			await adoptAppend();
			await authorizeRepair();
			const { right } = await forkedHistory();
			const proposal = (await proposeContinuation(right)).body.proposal;
			await approve(proposal);
			await insertEntries([seedEntry(null, "clock_in", "2026-07-03T08:00:00Z")]);
			expect((await applyProposal(proposal.id)).body).toMatchObject({
				status: "stale",
				proposal: { outcome: { stage: "application" } },
			});
			const { rows } = await admin.query(
				"select * from time_entry_append_position where employee_id = $1",
				[ids.worker],
			);
			expect(rows).toEqual([]);
		});

		it("refuses to continue past open work and removes proposals with demo history", async () => {
			await adoptAppend();
			await authorizeRepair();
			const { right } = await forkedHistory();
			// Open work: its clock-out must follow its own clock-in, not a chosen anchor.
			const open = seedEntry(null, "clock_in", "2026-07-02T08:00:00Z");
			await insertEntries([open]);
			await admin.query(
				`insert into work_period (id, employee_id, organization_id, clock_in_id, start_time, is_active, created_at, updated_at)
				 values ($1, $2, $3, $4, $5, true, now(), now())`,
				[randomUUID(), ids.worker, ids.organization, open.id, new Date("2026-07-02T08:00:00Z")],
			);
			expect((await proposeContinuation(right)).body).toMatchObject({
				reasons: expect.arrayContaining(["active_work"]),
			});
			await admin.query("update work_period set is_active = false where employee_id = $1", [
				ids.worker,
			]);
			const proposal = (await proposeContinuation(right)).body.proposal;
			await approve(proposal);
			expect((await applyProposal(proposal.id)).body.status).toBe("applied");

			// Runtime demo cleanup removes the position, then the proposals, with the history.
			await withCompletedWorkTransaction(
				{ organizationId: ids.organization, employeeId: ids.worker, actorUserId: ids.ownerUser },
				(scope) =>
					deleteDemoEmployeeHistory(scope, {
						organizationId: ids.organization,
						employeeId: ids.worker,
					}),
			);
			const { rows } = await admin.query(
				`select (select count(*)::int from historical_work_proposal where employee_id = $1) as proposals,
				        (select count(*)::int from time_entry_append_position where employee_id = $1) as positions`,
				[ids.worker],
			);
			expect(rows[0]).toEqual({ proposals: 0, positions: 0 });
		});
	});
});
