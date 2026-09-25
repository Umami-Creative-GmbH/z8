/**
 * #319 / T54 runtime evidence: historical work diagnostics with scoped completeness.
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * The real diagnostics route (membership/employee lookups, principal loader, CASL
 * ability, snapshot reader) reads work written by the real public
 * `createManualTimeEntry` action: legacy submissions before adoption and a strict
 * version-2 command after it. Only the session, request headers, billing
 * provisioning, notification delivery and Next cache are replaced. Defects that
 * no current writer produces (a missing time record, disagreeing durations, a
 * payable deleted period) are injected with SQL, as history would contain them.
 * Append adoption is enabled by inserting its control row directly.
 */

import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
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
								id: `t319-session-${harness.userId}`,
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

const { POST } = await import("@/app/api/time-entries/diagnostics/route");
const { createManualTimeEntry } = await import("@/app/[locale]/(app)/time-tracking/actions");

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
	describe.skip(`work diagnostics PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t319-diagnostics-org",
	otherOrganization: "t319-other-org",
	ownerUser: "t319-owner-user",
	managerUser: "t319-manager-user",
	workerUser: "t319-worker-user",
	peerUser: "t319-peer-user",
	foreignUser: "t319-foreign-user",
	owner: "d3190000-0000-4000-8000-000000000001",
	manager: "d3190000-0000-4000-8000-000000000002",
	worker: "d3190000-0000-4000-8000-000000000003",
	peer: "d3190000-0000-4000-8000-000000000004",
	foreign: "d3190000-0000-4000-8000-000000000005",
} as const;
const users = [ids.ownerUser, ids.managerUser, ids.workerUser, ids.peerUser, ids.foreignUser];
const july = { startDate: "2026-07-01", endDate: "2026-07-31" };

type Finding = {
	id: string;
	kind: string;
	shape: string;
	treatment: string;
	blocking: boolean;
	employeeIds: string[];
	workPeriodIds: string[];
	timeRecordIds: string[];
	provenance: { state: string; basis?: string; reason?: string; writer?: string };
	details: Record<string, unknown>;
	redacted?: true;
};

describeIntegration("historical work diagnostics on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = new Pool({ connectionString: databaseUrl, max: 4 });

	function actAs(userId: string, organizationId: string = ids.organization) {
		harness.userId = userId;
		harness.organizationId = organizationId;
	}

	async function diagnose(userId: string, body: Record<string, unknown>) {
		actAs(userId);
		const response = await POST(
			new Request("http://localhost/api/time-entries/diagnostics", {
				method: "POST",
				body: JSON.stringify(body),
			}) as unknown as NextRequest,
		);
		return { status: response.status, body: await response.json() };
	}

	async function operatorFindings(body: Record<string, unknown>): Promise<Finding[]> {
		const { status, body: result } = await diagnose(ids.ownerUser, body);
		expect(status).toBe(200);
		expect(result.diagnostics).toBe("record_level");
		return result.work.findings;
	}

	/** A legacy manual submission for the worker (organization not adopted). */
	async function legacyManual(input: {
		date: string;
		clockInTime: string;
		clockOutTime: string;
		timezone?: string;
	}) {
		actAs(ids.workerUser);
		const result = await createManualTimeEntry({
			submissionId: randomUUID(),
			reason: "Forgot to clock",
			timezone: input.timezone ?? "Europe/Berlin",
			browserTimezone: input.timezone ?? "Europe/Berlin",
			...input,
		} as unknown as ManualTimeEntryCommand);
		expect(result).toMatchObject({ success: true });
		return (result as { data: { workPeriodId: string } }).data.workPeriodId;
	}

	async function snapshot() {
		const { rows } = await admin.query(
			`select
			   (select json_agg(row_to_json(t) order by t.id) from work_period t where organization_id = $1) as periods,
			   (select json_agg(row_to_json(t) order by t.id) from time_entry t where organization_id = $1) as entries,
			   (select json_agg(row_to_json(t) order by t.id) from time_record t where organization_id = $1) as records,
			   (select json_agg(row_to_json(t) order by t.record_id) from time_record_work t where organization_id = $1) as details,
			   (select json_agg(row_to_json(t) order by t.id) from time_record_allocation t where organization_id = $1) as allocations,
			   (select json_agg(row_to_json(t) order by t.id) from completed_work_operation t where organization_id = $1) as receipts,
			   (select json_agg(row_to_json(t) order by t.employee_id) from time_entry_append_position t where organization_id = $1) as positions`,
			[ids.organization],
		);
		return rows[0];
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
			 ($1, 'T319 diagnostics', $1, 'Europe/Berlin', $3), ($2, 'T319 other', $2, 'UTC', $3)`,
			[ids.organization, ids.otherOrganization, timestamp],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[users, timestamp],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values
			 ('t319-m-owner', $1, $2, 'owner', 'approved', $7),
			 ('t319-m-manager', $1, $3, 'member', 'approved', $7),
			 ('t319-m-worker', $1, $4, 'member', 'approved', $7),
			 ('t319-m-peer', $1, $5, 'member', 'approved', $7),
			 ('t319-m-foreign', $6, $8, 'member', 'approved', $7)`,
			[
				ids.organization,
				ids.ownerUser,
				ids.managerUser,
				ids.workerUser,
				ids.peerUser,
				ids.otherOrganization,
				timestamp,
				ids.foreignUser,
			],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $11, 'admin', $12), ($3, $4, $11, 'manager', $12),
			 ($5, $6, $11, 'employee', $12), ($7, $8, $11, 'employee', $12),
			 ($9, $10, $13, 'employee', $12)`,
			[
				ids.owner,
				ids.ownerUser,
				ids.manager,
				ids.managerUser,
				ids.worker,
				ids.workerUser,
				ids.peer,
				ids.peerUser,
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
			throw new Error("Work diagnostics PostgreSQL is disabled");
		}
	});

	beforeEach(seed);

	afterAll(async () => {
		await cleanup();
		await admin.end();
		const { pool } = (await import("@/db")) as unknown as { pool: Pool };
		await pool.end();
	});

	it("reports consistent legacy manual work as complete and writes nothing", async () => {
		await legacyManual({ date: "2026-07-02", clockInTime: "08:00", clockOutTime: "16:00" });
		const before = await snapshot();

		const { status, body } = await diagnose(ids.ownerUser, { employeeId: ids.worker, ...july });

		expect(status).toBe(200);
		expect(body.work.completeness).toEqual({
			status: "complete",
			widenedTo: "requested",
			affectedEmployeeIds: [],
			blockingFindingIds: [],
		});
		expect(body.work.findings).toEqual([]);
		// Append assurance is reported separately and never decides completeness.
		expect(body.appendAssurance.assurance.limitations).toContainEqual({
			code: "payroll_readiness_not_assessed",
		});
		expect(await snapshot()).toEqual(before);
	});

	it("diagnoses real legacy trimming and UTC holiday dates without changing the stored interval", async () => {
		await legacyManual({ date: "2026-07-03", clockInTime: "09:00", clockOutTime: "10:00" });
		const trimmedId = await legacyManual({
			date: "2026-07-03",
			clockInTime: "00:30",
			clockOutTime: "09:30",
		});
		const before = await snapshot();

		const findings = await operatorFindings({ employeeId: ids.worker, ...july });

		const trimmed = findings.find((finding) => finding.kind === "manual_trimmed");
		expect(trimmed).toMatchObject({
			shape: "suspected_defect",
			treatment: "review_required",
			blocking: false,
			workPeriodIds: [trimmedId],
			provenance: { state: "pre_adoption", basis: "organization_not_adopted" },
			details: {
				zone: "Europe/Berlin",
				zoneBasis: "request",
				submittedStart: "2026-07-02T22:30:00Z",
				submittedEnd: "2026-07-03T07:30:00Z",
				persistedStart: "2026-07-02T22:30:00Z",
				persistedEnd: "2026-07-03T06:59:00Z",
			},
		});
		expect(
			findings.find((finding) => finding.kind === "manual_holiday_check_dates_differ"),
		).toMatchObject({
			workPeriodIds: [trimmedId],
			details: {
				zone: "Europe/Berlin",
				checkedDates: ["2026-07-02", "2026-07-03"],
				occupiedDates: ["2026-07-03"],
			},
		});
		expect(await snapshot()).toEqual(before);
	});

	it("assesses pending, missing-canonical and open-ended work before payroll filters and widens unknown ends", async () => {
		const missingCanonical = await legacyManual({
			date: "2026-07-06",
			clockInTime: "08:00",
			clockOutTime: "12:00",
		});
		const pendingNoDuration = await legacyManual({
			date: "2026-07-07",
			clockInTime: "08:00",
			clockOutTime: "12:00",
		});
		const juneOpenEnd = await legacyManual({
			date: "2026-06-10",
			clockInTime: "08:00",
			clockOutTime: "12:00",
		});
		const {
			rows: [{ canonical_record_id: removedRecord }],
		} = await admin.query("select canonical_record_id from work_period where id = $1", [
			missingCanonical,
		]);
		await admin.query("update work_period set canonical_record_id = null where id = $1", [
			missingCanonical,
		]);
		await admin.query("delete from time_record where id = $1", [removedRecord]);
		await admin.query(
			`update work_period set approval_status = 'pending', duration_minutes = null where id = $1`,
			[pendingNoDuration],
		);
		await admin.query(
			"update time_record set approval_state = 'pending' where id = (select canonical_record_id from work_period where id = $1)",
			[pendingNoDuration],
		);
		await admin.query(
			"update work_period set end_time = null, duration_minutes = null, clock_out_id = null where id = $1",
			[juneOpenEnd],
		);

		const findings = await operatorFindings({ employeeId: ids.worker, ...july });
		const byKind = (kind: string) => findings.filter((finding) => finding.kind === kind);

		expect(byKind("canonical_missing")).toMatchObject([
			{ workPeriodIds: [missingCanonical], treatment: "historical_gap", blocking: true },
		]);
		expect(byKind("duration_missing")).toMatchObject([
			{ workPeriodIds: [pendingNoDuration], details: { source: "period" } },
		]);
		expect(byKind("approval_relationship_missing")).toMatchObject([
			{ workPeriodIds: [pendingNoDuration] },
		]);
		// A June period whose end is unknown stays relevant to July.
		expect(byKind("endpoint_missing")).toMatchObject([
			{ workPeriodIds: [juneOpenEnd], details: { side: "period_end" } },
		]);

		// Another employee's scope is unaffected and stays complete.
		const peer = await diagnose(ids.ownerUser, { employeeId: ids.peer, ...july });
		expect(peer.body.work.completeness.status).toBe("complete");
	});

	it("classifies an injected defect in fresh post-adoption work as an integrity incident", async () => {
		const historical = await legacyManual({
			date: "2026-07-08",
			clockInTime: "08:00",
			clockOutTime: "12:00",
		});
		await admin.query(
			"insert into time_entry_append_control (organization_id, mode) values ($1, 'active')",
			[ids.organization],
		);
		actAs(ids.workerUser);
		const submissionId = randomUUID();
		const fresh = await createManualTimeEntry({
			version: 2,
			submissionId,
			targetEmployeeId: ids.worker,
			date: "2026-07-09",
			clockIn: { time: "08:00", occurrence: null, displayedOffsetMinutes: 120 },
			clockOut: { time: "12:00", occurrence: null, displayedOffsetMinutes: 120 },
			zone: { basis: "target", timezone: "Europe/Berlin" },
			browserTimezone: "Europe/Berlin",
			reason: "Backdated entry",
			projectId: null,
			workCategoryId: null,
		});
		expect(fresh).toMatchObject({ success: true });
		for (const periodId of [historical, submissionId]) {
			await admin.query(
				"update time_record set duration_minutes = 1 where id = (select canonical_record_id from work_period where id = $1)",
				[periodId],
			);
		}

		const conflicts = (await operatorFindings({ employeeId: ids.worker, ...july })).filter(
			(finding) => finding.kind === "duration_conflict",
		);

		expect(conflicts).toHaveLength(2);
		expect(conflicts.find((finding) => finding.workPeriodIds[0] === historical)).toMatchObject({
			provenance: { state: "pre_adoption", basis: "written_before_admission" },
			treatment: "review_required",
		});
		expect(conflicts.find((finding) => finding.workPeriodIds[0] === submissionId)).toMatchObject({
			provenance: { state: "fresh_backdated", writer: "manual_entry" },
			treatment: "integrity_incident",
		});
	});

	it("never offers a deleted period as payable work and keeps the deletion", async () => {
		const deleted = await legacyManual({
			date: "2026-07-10",
			clockInTime: "08:00",
			clockOutTime: "12:00",
		});
		await admin.query(
			"update work_period set deleted_at = now(), deletion_reason = 'duplicate' where id = $1",
			[deleted],
		);

		const findings = await operatorFindings({ employeeId: ids.worker, ...july });

		expect(findings.map((finding) => finding.kind)).toEqual(["deleted_work_payable"]);
		const { rows } = await admin.query("select deleted_at from work_period where id = $1", [
			deleted,
		]);
		expect(rows[0].deleted_at).not.toBeNull();
	});

	it("authorizes record-level diagnostics per employee and redacts other employees", async () => {
		const periodId = await legacyManual({
			date: "2026-07-13",
			clockInTime: "08:00",
			clockOutTime: "12:00",
		});
		await admin.query("update work_period set duration_minutes = null where id = $1", [periodId]);
		// The worker's period now links a record owned by their peer.
		const shared = await legacyManual({
			date: "2026-07-14",
			clockInTime: "08:00",
			clockOutTime: "12:00",
		});
		await admin.query(
			"update time_record set employee_id = $2 where id = (select canonical_record_id from work_period where id = $1)",
			[shared, ids.peer],
		);

		// Direct manager: record-level for the report, peer details redacted.
		const manager = await diagnose(ids.managerUser, { employeeId: ids.worker, ...july });
		expect(manager.status).toBe(200);
		expect(manager.body.diagnostics).toBe("record_level");
		expect(JSON.stringify(manager.body.work)).not.toContain(ids.peer);
		expect(
			manager.body.work.findings.map((finding: Finding) => [
				finding.kind,
				finding.redacted ?? false,
			]),
		).toEqual(
			expect.arrayContaining([
				["duration_missing", false],
				["ownership_conflict", true],
			]),
		);
		expect(manager.body.work.completeness.redactedEmployeeCount).toBe(1);
		expect(manager.body.appendAssurance.entries).toBeDefined();

		// Organization owner: everything, including the peer's identity.
		const owner = await diagnose(ids.ownerUser, { employeeId: ids.worker, ...july });
		expect(
			owner.body.work.findings.find((finding: Finding) => finding.kind === "ownership_conflict")
				.employeeIds,
		).toEqual([ids.worker, ids.peer].toSorted());

		// The employee reading their own history: status and counts only.
		const self = await diagnose(ids.workerUser, july);
		expect(self.status).toBe(200);
		expect(self.body.diagnostics).toBe("summary");
		expect(self.body.work).toMatchObject({ status: "incomplete", blockingFindingCount: 2 });
		expect(JSON.stringify(self.body)).not.toContain(periodId);
		expect(self.body.appendAssurance.entries).toBeUndefined();

		// A peer and another organization's employee are refused.
		expect((await diagnose(ids.workerUser, { employeeId: ids.peer, ...july })).status).toBe(403);
		expect((await diagnose(ids.managerUser, { employeeId: ids.peer, ...july })).status).toBe(403);
		expect((await diagnose(ids.ownerUser, { employeeId: ids.foreign, ...july })).status).toBe(404);
		expect(
			(await diagnose(ids.ownerUser, { startDate: "2026-07-31", endDate: "2026-07-01" })).status,
		).toBe(400);
	});
});
